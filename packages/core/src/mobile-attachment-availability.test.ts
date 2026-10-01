import { describe, expect, it, vi } from 'vitest';
import type { Attachment } from './types';
import { computeSha256Hex } from './attachment-hash';
import { createMobileAttachmentFiles } from './mobile-attachment-files';
import { createMobileAttachmentCommon } from './mobile-attachment-common';
import { createMobileAttachmentAvailability, type MobileAttachmentCloudKitPort } from './mobile-attachment-availability';
import { CLOUD_PROVIDER_KEY, CLOUD_URL_KEY, SYNC_BACKEND_KEY, SYNC_PATH_KEY, WEBDAV_PASSWORD_KEY, WEBDAV_URL_KEY, WEBDAV_USERNAME_KEY } from './sync-storage-keys';
import { createMemoryFileSystem, createMemoryStorage, createRecordingLog, MANAGED } from './__fixtures__/mobile-attachment-fakes';

const now = '2026-09-28T00:00:00.000Z';
const REMOTE = new Uint8Array([9, 8, 7, 6]);
const toArrayBuffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

const remoteAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'att-1',
  kind: 'file',
  title: 'att-1.txt',
  uri: '',
  cloudKey: 'attachments/att-1.txt',
  localStatus: 'missing',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const setup = (options: {
  storage?: Record<string, string>;
  sandbox?: boolean;
  cloudKit?: MobileAttachmentCloudKitPort;
} = {}) => {
  const memory = createMemoryFileSystem();
  const { storage } = createMemoryStorage(options.storage);
  const { log, lines } = createRecordingLog();
  const secrets: Record<string, string> = { [WEBDAV_PASSWORD_KEY]: 'pw' };
  const files = createMobileAttachmentFiles({
    fs: memory.fs,
    storage,
    getSecureConfigValue: async (key) => secrets[key] ?? null,
    log,
    fetch: vi.fn() as unknown as typeof fetch,
    dropboxAuth: { getValidAccessToken: async () => 'token', forceRefreshAccessToken: async () => 'token' },
    core: { isSandboxMode: () => options.sandbox === true },
  });
  const installAttachmentFileGeneration = vi.fn(async (stagedPath: string, targetPath: string) => {
    await memory.fs.move(stagedPath, targetPath);
    return { status: 'installed' as const };
  });
  const common = createMobileAttachmentCommon({
    fs: memory.fs,
    files,
    crypto: {} as never,
    encryption: { logSyncEncryptionEvent: async () => undefined },
    installer: { installAttachmentFileGeneration },
    installerMayBeMissing: () => false,
    timersPaused: () => false,
    uploads: { createUploadTask: () => null },
  });
  const webdavGetFile = vi.fn(async () => toArrayBuffer(REMOTE));
  const cloudGetFile = vi.fn(async () => toArrayBuffer(REMOTE));
  const downloadDropboxFile = vi.fn(async () => toArrayBuffer(REMOTE));
  const availability = createMobileAttachmentAvailability({
    files,
    common,
    storage,
    encryption: { getSyncEncryptionMaterial: async () => null },
    getDropboxClientId: async () => 'app-key',
    cloudKit: options.cloudKit,
    core: {
      isSandboxMode: () => options.sandbox === true,
      withRetry: (operation) => operation(),
      webdavGetFile,
      cloudGetFile,
      downloadDropboxFile,
    },
  });
  return { availability, memory, lines, installAttachmentFileGeneration, webdavGetFile, cloudGetFile, downloadDropboxFile };
};

const webdav = {
  [SYNC_BACKEND_KEY]: 'webdav',
  [WEBDAV_URL_KEY]: 'https://dav.example/Mindwtr/data.json',
  [WEBDAV_USERNAME_KEY]: 'me',
};

const deletesOutsideScratch = (calls: string[]) => calls.filter((call) => (
  call.startsWith('delete ') && !call.includes('.mindwtr-download-')
));

describe('mobile attachment availability', () => {
  it('downloads a WebDAV attachment into <files>/attachments/ through the installer', async () => {
    const { availability, memory, webdavGetFile, installAttachmentFileGeneration } = setup({ storage: webdav });
    const requested = remoteAttachment({ fileHash: await computeSha256Hex(REMOTE) });

    const outcome = await availability.ensureAttachmentAvailableDetailed(requested);

    expect(outcome).toMatchObject({ status: 'available', attachment: { uri: `${MANAGED}att-1.txt`, localStatus: 'available' } });
    expect(webdavGetFile).toHaveBeenCalledWith(
      'https://dav.example/Mindwtr/attachments/att-1.txt',
      expect.objectContaining({ username: 'me', password: 'pw' }),
    );
    expect(installAttachmentFileGeneration.mock.calls[0]?.slice(1, 3)).toEqual([`${MANAGED}att-1.txt`, { kind: 'absent' }]);
    expect(memory.read(`${MANAGED}att-1.txt`)).toEqual(REMOTE);
  });

  it('rejects bytes that fail the recorded hash and writes nothing', async () => {
    const { availability, memory, installAttachmentFileGeneration } = setup({ storage: webdav });

    await expect(availability.ensureAttachmentAvailableDetailed(remoteAttachment({ fileHash: 'a'.repeat(64) })))
      .resolves.toEqual({ status: 'unavailable' });
    expect(installAttachmentFileGeneration).not.toHaveBeenCalled();
    expect(memory.read(`${MANAGED}att-1.txt`)).toBeUndefined();
  });

  it('never deletes local bytes when a download fails', async () => {
    const { availability, memory, webdavGetFile } = setup({ storage: webdav });
    webdavGetFile.mockRejectedValueOnce(Object.assign(new Error('Server error'), { status: 500 }));

    await expect(availability.ensureAttachmentAvailableDetailed(remoteAttachment())).resolves.toEqual({ status: 'unavailable' });
    expect(deletesOutsideScratch(memory.calls)).toEqual([]);
  });

  it('treats a WebDAV 404 as terminal, as the sync pass does: no second request, no Download, local bytes kept', async () => {
    const { availability, memory, webdavGetFile, lines } = setup({ storage: webdav });
    webdavGetFile.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    const requested = remoteAttachment({ fileHash: 'a'.repeat(64) });

    const outcome = await availability.ensureAttachmentAvailableDetailed(requested);

    expect(outcome).toMatchObject({
      status: 'unrecoverable',
      attachment: { cloudKey: undefined, fileHash: undefined, localStatus: 'missing', deletedAt: expect.any(String) },
    });
    expect(requested.cloudKey).toBe('attachments/att-1.txt');
    expect(deletesOutsideScratch(memory.calls)).toEqual([]);
    expect(lines).toContainEqual(expect.objectContaining({
      level: 'warn', extra: expect.objectContaining({ releaseCheck: 'v1.3.4/webdav-download-not-found' }),
    }));
    if (outcome.status !== 'unrecoverable') throw new Error('Expected a terminal outcome');
    await expect(availability.ensureAttachmentAvailableDetailed(outcome.attachment)).resolves.toEqual({ status: 'unavailable' });
    expect(webdavGetFile).toHaveBeenCalledTimes(1);
  });

  it('uses a managed file already on disk only when it matches the remote hash', async () => {
    const { availability, memory, webdavGetFile } = setup({ storage: webdav });
    memory.put(`${MANAGED}att-1.txt`, REMOTE);

    await expect(availability.ensureAttachmentAvailableDetailed(remoteAttachment({ fileHash: await computeSha256Hex(REMOTE) })))
      .resolves.toMatchObject({ status: 'available', attachment: { uri: `${MANAGED}att-1.txt` } });
    await expect(availability.ensureAttachmentAvailableDetailed(remoteAttachment({ fileHash: 'b'.repeat(64) })))
      .resolves.toEqual({ status: 'generation-conflict' });
    await expect(availability.ensureAttachmentAvailableDetailed(remoteAttachment()))
      .resolves.toEqual({ status: 'generation-conflict' });
    expect(webdavGetFile).not.toHaveBeenCalled();
    expect(memory.read(`${MANAGED}att-1.txt`)).toEqual(REMOTE);
  });

  it('shares one download between concurrent requests for the same generation', async () => {
    const { availability, webdavGetFile } = setup({ storage: webdav });
    const requested = remoteAttachment({ fileHash: await computeSha256Hex(REMOTE) });

    const [first, second] = await Promise.all([
      availability.ensureAttachmentAvailable(requested),
      availability.ensureAttachmentAvailable({ ...requested }),
    ]);

    expect(first?.uri).toBe(`${MANAGED}att-1.txt`);
    expect(second).toBe(first);
    expect(webdavGetFile).toHaveBeenCalledTimes(1);
  });

  it('reads Dropbox and self-hosted cloud attachments from their own transports', async () => {
    const dropbox = setup({ storage: { [SYNC_BACKEND_KEY]: 'cloud', [CLOUD_PROVIDER_KEY]: 'dropbox' } });
    await expect(dropbox.availability.ensureAttachmentAvailableDetailed(remoteAttachment())).resolves.toMatchObject({ status: 'available' });
    expect(dropbox.downloadDropboxFile).toHaveBeenCalledWith('token', 'attachments/att-1.txt');

    const cloud = setup({ storage: { [SYNC_BACKEND_KEY]: 'cloud', [CLOUD_URL_KEY]: 'https://cloud.example/v1/data' } });
    await expect(cloud.availability.ensureAttachmentAvailableDetailed(remoteAttachment())).resolves.toMatchObject({ status: 'available' });
    expect(cloud.cloudGetFile).toHaveBeenCalledWith('https://cloud.example/v1/attachments/att-1.txt', expect.objectContaining({ token: '' }));
  });

  it('copies a File Sync attachment from the sync folder through a staged install', async () => {
    const { availability, memory } = setup({ storage: { [SYNC_BACKEND_KEY]: 'file', [SYNC_PATH_KEY]: 'file:///storage/Mindwtr/data.json' } });
    memory.put('file:///storage/Mindwtr/attachments/att-1.txt', REMOTE);

    await expect(availability.ensureAttachmentAvailableDetailed(remoteAttachment()))
      .resolves.toMatchObject({ status: 'available', attachment: { uri: `${MANAGED}att-1.txt` } });
    expect(memory.read('file:///storage/Mindwtr/attachments/att-1.txt')).toEqual(REMOTE);
    expect(memory.read(`${MANAGED}att-1.txt`)).toEqual(REMOTE);
  });

  it('treats a CloudKit not-found as terminal', async () => {
    const cloudKit = {
      fetchAttachmentAsset: vi.fn(async () => { throw new Error('asset gone'); }),
      isAttachmentNotFoundError: () => true,
    };
    const { availability } = setup({ storage: { [SYNC_BACKEND_KEY]: 'cloudkit' }, cloudKit });

    const outcome = await availability.ensureAttachmentAvailableDetailed(remoteAttachment({ cloudKey: 'cloudkit:att-1' }));

    expect(outcome.status).toBe('unrecoverable');
    expect(outcome.status === 'unrecoverable' && outcome.attachment.deletedAt).toBeTruthy();
  });

  it('reports CloudKit attachments unavailable on a host without CloudKit', async () => {
    const { availability, memory } = setup({ storage: { [SYNC_BACKEND_KEY]: 'cloudkit' } });

    await expect(availability.ensureAttachmentAvailableDetailed(remoteAttachment({ cloudKey: 'cloudkit:att-1' })))
      .resolves.toEqual({ status: 'unavailable' });
    expect(memory.calls).toEqual([]);
  });

  it('does nothing in sandbox mode', async () => {
    const { availability, memory } = setup({ storage: webdav, sandbox: true });

    await expect(availability.ensureAttachmentAvailableDetailed(remoteAttachment())).resolves.toEqual({ status: 'unavailable' });
    expect(memory.calls).toEqual([]);
  });
});
