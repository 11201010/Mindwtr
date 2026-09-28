import { describe, expect, it, vi } from 'vitest';
import type { AppData, Attachment } from './types';
import { runMobileAttachmentCleanup } from './mobile-attachment-cleanup';
import type { MobileSyncAttachmentCleanupOptions } from './mobile-sync-service';
import { DropboxConflictError } from './dropbox';
import { createMemoryFileSystem, MANAGED } from './__fixtures__/mobile-attachment-fakes';

const now = '2026-09-28T00:00:00.000Z';

const purgedTaskWith = (attachment: Partial<Attachment>): AppData => ({
  tasks: [{
    id: 'purged',
    title: 'Purged',
    status: 'done',
    tags: [],
    contexts: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: now,
    purgedAt: now,
    attachments: [{
      id: 'orphan',
      kind: 'file',
      title: 'orphan.pdf',
      uri: '',
      createdAt: now,
      updatedAt: now,
      ...attachment,
    }],
  }],
  projects: [],
  sections: [],
  areas: [],
  settings: {},
});

const setup = (data: AppData, overrides: Partial<MobileSyncAttachmentCleanupOptions> = {}) => {
  const memory = createMemoryFileSystem();
  const webdavHeadFile = vi.fn(async () => ({ exists: true, etag: '"v1"', fingerprint: null, lastModified: null, contentLength: null }));
  const webdavDeleteFileVersioned = vi.fn(async () => undefined);
  const cloudDeleteFile = vi.fn(async () => undefined);
  const options: MobileSyncAttachmentCleanupOptions = {
    appData: data,
    backend: 'webdav',
    webdavConfig: { url: 'https://dav.example/Mindwtr/data.json', username: 'me', password: 'pw' },
    cloudConfig: null,
    cloudProvider: 'selfhosted',
    fetcher: vi.fn() as unknown as typeof fetch,
    ensureLocalSnapshotFresh: vi.fn(),
    assertRemoteMutationFenceHeld: vi.fn(async () => undefined),
    deleteDropboxAttachment: vi.fn(async () => undefined),
    isRemoteMissingError: () => false,
    logSyncInfo: vi.fn(),
    logSyncWarning: vi.fn(),
    ...overrides,
  };
  const run = () => runMobileAttachmentCleanup(options, {
    fs: memory.fs,
    core: { webdavHeadFile, webdavDeleteFileVersioned, cloudDeleteFile },
  });
  return { memory, options, run, webdavHeadFile, webdavDeleteFileVersioned, cloudDeleteFile };
};

describe('mobile attachment cleanup', () => {
  it('deletes an orphaned WebDAV attachment only against its strong ETag, under the fence', async () => {
    const { run, options, webdavHeadFile, webdavDeleteFileVersioned } = setup(purgedTaskWith({ cloudKey: 'attachments/orphan.pdf' }));

    const result = await run();

    expect(webdavHeadFile).toHaveBeenCalledWith('https://dav.example/Mindwtr/attachments/orphan.pdf', expect.objectContaining({ username: 'me' }));
    expect(options.assertRemoteMutationFenceHeld).toHaveBeenCalledWith(35_000);
    expect(webdavDeleteFileVersioned).toHaveBeenCalledWith('https://dav.example/Mindwtr/attachments/orphan.pdf', '"v1"', expect.anything());
    expect(result.appData.settings.attachments?.pendingRemoteDeletes).toBeUndefined();
  });

  it('keeps the delete pending when the server offers only a weak ETag', async () => {
    const { run, webdavHeadFile, webdavDeleteFileVersioned } = setup(purgedTaskWith({ cloudKey: 'attachments/orphan.pdf' }));
    webdavHeadFile.mockResolvedValueOnce({ exists: true, etag: 'W/"v1"', fingerprint: null, lastModified: null, contentLength: null });

    const result = await run();

    expect(webdavDeleteFileVersioned).not.toHaveBeenCalled();
    expect(result.appData.settings.attachments?.pendingRemoteDeletes).toEqual([
      expect.objectContaining({ cloudKey: 'attachments/orphan.pdf', attempts: 1 }),
    ]);
  });

  it('deletes local bytes only inside the managed attachment folders', async () => {
    const inside = setup(purgedTaskWith({ uri: `${MANAGED}orphan.pdf` }), { backend: 'off' });
    inside.memory.put(`${MANAGED}orphan.pdf`, new Uint8Array([1]));
    await inside.run();
    expect(inside.memory.read(`${MANAGED}orphan.pdf`)).toBeUndefined();

    const outside = setup(purgedTaskWith({ uri: 'file:///storage/Download/orphan.pdf' }), { backend: 'off' });
    outside.memory.put('file:///storage/Download/orphan.pdf', new Uint8Array([1]));
    await outside.run();
    expect(outside.memory.read('file:///storage/Download/orphan.pdf')).toEqual(new Uint8Array([1]));
  });

  it('keeps File Sync bytes: another peer may still reselect that generation', async () => {
    const { run, webdavHeadFile, cloudDeleteFile } = setup(purgedTaskWith({ cloudKey: 'attachments/orphan.pdf' }), { backend: 'file' });

    const result = await run();

    expect(webdavHeadFile).not.toHaveBeenCalled();
    expect(cloudDeleteFile).not.toHaveBeenCalled();
    expect(result.appData.settings.attachments?.pendingRemoteDeletes).toBeUndefined();
  });

  it('ends the cycle on a Dropbox write conflict instead of logging it', async () => {
    const deleteDropboxAttachment = vi.fn(async () => { throw new DropboxConflictError(); });
    const { run } = setup(purgedTaskWith({ cloudKey: 'attachments/orphan.pdf' }), {
      backend: 'cloud',
      cloudProvider: 'dropbox',
      deleteDropboxAttachment,
    });

    await expect(run()).rejects.toBeInstanceOf(DropboxConflictError);
  });
});
