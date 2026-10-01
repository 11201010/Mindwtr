// On-demand attachment fetch: what runs when a user opens an attachment whose bytes exist
// only on the sync remote. One branch per backend (File Sync, CloudKit, self-hosted cloud,
// Dropbox, WebDAV); each downloads into scratch and publishes through the native installer
// only while the managed target is still absent. It moved here from React Native's
// `apps/mobile/lib/attachment-sync-availability.ts` so the native apps run the same rules.
//
// Data safety: a failed download never deletes local bytes, a target already on disk is used
// only when its bytes prove they are the current remote generation, and a CloudKit not-found or a
// WebDAV 404 is terminal (the attachment is marked unrecoverable).
import type { Attachment } from './types';
import { computeSha256Hex, isSha256Hex } from './attachment-hash';
import { extractExtension, getBaseSyncUrl, getCloudBaseUrl } from './attachment-paths';
import { reportProgress, validateAttachmentHash } from './attachment-transfer';
import { markAttachmentUnrecoverable } from './attachment-validation';
import { cloudGetFile } from './cloud';
import { parseCloudKitAttachmentKey } from './cloudkit-attachments';
import { downloadDropboxFile } from './dropbox';
import { withRetry } from './retry-utils';
import { getErrorStatus } from './sync-runtime-utils';
import { isSandboxMode } from './sandbox';
import { CLOUD_PROVIDER_DROPBOX } from './sync-client-helpers';
import { CLOUD_PROVIDER_KEY, SYNC_BACKEND_KEY, SYNC_PATH_KEY, type SyncKeyValueStoragePort } from './sync-storage-keys';
import { webdavGetFile } from './webdav';
import { getMobileCloudRequestOptions, getMobileWebDavRequestOptions } from './mobile-sync-utils';
import { isHttpAttachmentUri, type MobileAttachmentFiles } from './mobile-attachment-files';
import type { MobileAttachmentCommon } from './mobile-attachment-common';
import type { MobileSyncEncryptionPort } from './mobile-sync-service';

export type AttachmentAvailabilityOutcome =
  | { status: 'available'; attachment: Attachment }
  | { status: 'generation-conflict' }
  | { status: 'unrecoverable'; attachment: Attachment }
  | { status: 'unavailable' };

const GENERATION_CONFLICT = Symbol('attachment-generation-conflict');
type InternalUnrecoverableOutcome = {
  availabilityStatus: 'unrecoverable';
  attachment: Attachment;
};
type InternalAvailabilityOutcome =
  | Attachment
  | InternalUnrecoverableOutcome
  | null
  | typeof GENERATION_CONFLICT;

/** A download may only be shared while it represents the same immutable remote bytes. */
export const getAttachmentDownloadIdentity = (attachment: Attachment): string => JSON.stringify([
  attachment.id,
  attachment.cloudKey ?? null,
  attachment.fileHash ?? null,
  attachment.contentRev ?? 0,
]);

export const hasAttachmentDownloadIdentity = (
  attachment: Attachment | undefined,
  identity: string,
): attachment is Attachment => Boolean(attachment && getAttachmentDownloadIdentity(attachment) === identity);

/** Descriptive metadata belongs to the current document. A completed download may
 * only publish device-local availability and fill a previously absent verified hash. */
export const getAttachmentAvailabilityPatch = (
  current: Attachment,
  resolved: Attachment,
): Partial<Attachment> => ({
  uri: resolved.uri,
  localStatus: resolved.localStatus,
  ...(!current.fileHash && resolved.fileHash ? { fileHash: resolved.fileHash } : {}),
});

/** Terminal remote absence may clear only lifecycle fields. Descriptive metadata remains
 * owned by the latest document selected by the caller's download-identity guard. */
export const getAttachmentUnrecoverablePatch = (
  resolved: Attachment,
): Partial<Attachment> => ({
  cloudKey: resolved.cloudKey,
  fileHash: resolved.fileHash,
  localStatus: resolved.localStatus,
  deletedAt: resolved.deletedAt,
  updatedAt: resolved.updatedAt,
});

/** Core functions called through here so a host's tests can replace them the way they
 *  replace `@mindwtr/core`. A host that passes nothing gets core's own. */
export type MobileAttachmentAvailabilityCoreFunctions = {
  isSandboxMode: typeof isSandboxMode;
  withRetry: typeof withRetry;
  cloudGetFile: typeof cloudGetFile;
  webdavGetFile: typeof webdavGetFile;
  downloadDropboxFile: (accessToken: string, path: string) => Promise<ArrayBuffer>;
};

/** iCloud attachment assets (iOS only). */
export type MobileAttachmentCloudKitPort = {
  /** Downloads the record's asset into `stagedUri`. */
  fetchAttachmentAsset(recordName: string, stagedUri: string): Promise<unknown>;
  isAttachmentNotFoundError(error: unknown): boolean;
};

export type MobileAttachmentAvailabilityHost = {
  files: MobileAttachmentFiles;
  common: MobileAttachmentCommon;
  /** The device key-value store (React Native: AsyncStorage). */
  storage: Pick<SyncKeyValueStoragePort, 'getItem'>;
  encryption: Pick<MobileSyncEncryptionPort, 'getSyncEncryptionMaterial'>;
  /** The build's Dropbox app key, or '' when none is configured. */
  getDropboxClientId(): Promise<string>;
  /** A host without CloudKit reports every `cloudkit` attachment as unavailable. */
  cloudKit?: MobileAttachmentCloudKitPort;
  core?: Partial<MobileAttachmentAvailabilityCoreFunctions>;
};

export const createMobileAttachmentAvailability = (host: MobileAttachmentAvailabilityHost) => {
  const core: MobileAttachmentAvailabilityCoreFunctions = {
    isSandboxMode,
    withRetry,
    cloudGetFile,
    webdavGetFile,
    downloadDropboxFile: (accessToken, path) => downloadDropboxFile(accessToken, path),
    ...host.core,
  };
  const { files, common } = host;
  const downloadLocks = new Map<string, Promise<AttachmentAvailabilityOutcome>>();

  /** A managed target left by a prior attempt is usable only when its bytes prove
   * they are the current remote generation. Without a remote hash there is no safe
   * way to distinguish a crash retry from a stale generation that won the absent CAS. */
  const resolveMatchingManagedTarget = async (
    attachment: Attachment,
    targetUri: string,
  ): Promise<InternalAvailabilityOutcome> => {
    if (!isSha256Hex(attachment.fileHash)) return GENERATION_CONFLICT;
    try {
      await validateAttachmentHash(attachment, await files.readFileAsBytes(targetUri));
      return { ...attachment, uri: targetUri, localStatus: 'available' };
    } catch (error) {
      files.logAttachmentWarn(`Managed attachment ${attachment.id} does not match the requested generation`, error);
      return GENERATION_CONFLICT;
    }
  };

  /**
   * Publish an on-demand download only while the managed target is still absent.
   * The native installer owns the scratch generation once invoked; a false result
   * is a late local create and already records centralized failed progress.
   */
  const installMissingAttachmentBytes = async (
    attachment: Attachment,
    attachmentsDir: string,
    targetUri: string,
    bytes: Uint8Array,
  ): Promise<InternalAvailabilityOutcome> => {
    const installed = await common.installAttachmentDownloadBytes(
      attachment,
      attachmentsDir,
      targetUri,
      bytes,
      { kind: 'absent' },
    );
    if (!installed) return GENERATION_CONFLICT;
    return { ...attachment, uri: targetUri, localStatus: 'available' };
  };

  const installMissingAttachmentStage = async (
    attachment: Attachment,
    stagedPath: string,
    targetUri: string,
    material: Awaited<ReturnType<MobileSyncEncryptionPort['getSyncEncryptionMaterial']>>,
  ): Promise<InternalAvailabilityOutcome> => {
    let installHelperOwnsStage = false;
    try {
      let expectedStagedHash = !material && isSha256Hex(attachment.fileHash)
        ? attachment.fileHash.toLowerCase()
        : null;
      if (!expectedStagedHash) {
        const wireBytes = await common.readAttachmentDownloadStageBytes(stagedPath);
        const plaintextBytes = await common.openAttachmentBytesFromDownload(wireBytes, material);
        const plaintextHash = await computeSha256Hex(plaintextBytes);
        if (!plaintextHash) throw new Error('Attachment download hash is unavailable');
        await validateAttachmentHash(attachment, plaintextBytes);
        if (plaintextBytes !== wireBytes) {
          await files.writeBytesSafely(stagedPath, plaintextBytes);
        }
        expectedStagedHash = plaintextHash;
      }
      installHelperOwnsStage = true;
      const installed = await common.installStagedAttachmentDownload({
        attachment,
        stagedPath,
        targetPath: targetUri,
        expectation: { kind: 'absent' },
        expectedStagedHash,
      });
      if (!installed) return GENERATION_CONFLICT;
      return { ...attachment, uri: targetUri, localStatus: 'available' };
    } catch (error) {
      if (!installHelperOwnsStage) {
        await common.deleteAttachmentDownloadStageBestEffort(stagedPath);
      }
      throw error;
    }
  };

  const ensureFileAttachmentAvailable = async (
    attachment: Attachment,
    syncPath: string
  ): Promise<InternalAvailabilityOutcome> => {
    const syncDir = await files.resolveFileSyncDir(syncPath);
    if (!syncDir) return null;
    if (!attachment.cloudKey) return null;
    const attachmentsDir = await files.getAttachmentsDir();
    if (!attachmentsDir) return null;
    const filename = attachment.cloudKey.split('/').pop() || `${attachment.id}${extractExtension(attachment.title)}`;
    const targetUri = `${attachmentsDir}${filename}`;
    const targetPresence = await files.getLocalAttachmentPresence(targetUri);
    if (targetPresence === 'unreadable') return null;
    if (targetPresence === 'present') {
      return resolveMatchingManagedTarget(attachment, targetUri);
    }

    let stagedPath: string | null = null;
    let installerOwnsStage = false;
    try {
      // #1056: the local attachments directory always holds plaintext, so an encrypted
      // sync folder's bytes are opened on the way in. `null` material keeps the
      // byte-for-byte pre-feature behavior. Inside the try: S3 — an enabled-but-no-key
      // device throws instead of returning `null`, and that must fail this fetch closed
      // (logged, `null` result), never fall through to a plaintext path as if encryption
      // were off.
      const material = await host.encryption.getSyncEncryptionMaterial();
      let sourceUri: string;
      if (syncDir.type === 'file') {
        sourceUri = `${syncDir.attachmentsDirUri}${filename}`;
        const sourcePresence = await files.getLocalAttachmentPresence(sourceUri);
        if (sourcePresence !== 'present') return null;
      } else {
        const entry = await files.findSafEntry(syncDir.attachmentsDirUri, filename);
        if (!entry) return null;
        sourceUri = entry;
      }
      stagedPath = await common.copyAttachmentDownloadToStage(attachment, attachmentsDir, sourceUri);
      installerOwnsStage = true;
      return await installMissingAttachmentStage(attachment, stagedPath, targetUri, material);
    } catch (error) {
      if (stagedPath && !installerOwnsStage) {
        await common.deleteAttachmentDownloadStageBestEffort(stagedPath);
      }
      files.logAttachmentWarn(`Failed to make attachment ${attachment.id} available from sync folder`, error);
      return null;
    }
  };

  const ensureCloudKitAttachmentAvailable = async (
    attachment: Attachment,
    cloudKit: MobileAttachmentCloudKitPort,
  ): Promise<InternalAvailabilityOutcome> => {
    const recordName = parseCloudKitAttachmentKey(attachment.cloudKey);
    if (!recordName) return null;
    const attachmentsDir = await files.getAttachmentsDir();
    if (!attachmentsDir) return null;
    const extension = extractExtension(attachment.title) || extractExtension(attachment.uri);
    const targetUri = `${attachmentsDir}${attachment.id}${extension}`;
    const targetPresence = await files.getLocalAttachmentPresence(targetUri);
    if (targetPresence === 'unreadable') return null;
    if (targetPresence === 'present') {
      return resolveMatchingManagedTarget(attachment, targetUri);
    }

    const stagedUri = common.createAttachmentDownloadStagePath(attachmentsDir, attachment);
    let installerOwnsStage = false;
    try {
      reportProgress(attachment.id, 'download', 0, attachment.size ?? 0, 'active');
      await cloudKit.fetchAttachmentAsset(recordName, stagedUri);
      installerOwnsStage = true;
      const installed = await common.installStagedAttachmentDownload({
        attachment,
        stagedPath: stagedUri,
        targetPath: targetUri,
        expectation: { kind: 'absent' },
      });
      if (!installed) return GENERATION_CONFLICT;
      reportProgress(
        attachment.id,
        'download',
        attachment.size ?? 0,
        attachment.size ?? 0,
        'completed',
      );
      return { ...attachment, uri: targetUri, localStatus: 'available' };
    } catch (error) {
      if (!installerOwnsStage) {
        await common.deleteAttachmentDownloadStageBestEffort(stagedUri);
      }
      const terminalNotFound = cloudKit.isAttachmentNotFoundError(error);
      reportProgress(
        attachment.id,
        'download',
        0,
        attachment.size ?? 0,
        'failed',
        terminalNotFound
          ? 'Attachment is no longer available'
          : error instanceof Error ? error.message : String(error),
      );
      if (terminalNotFound) {
        markAttachmentUnrecoverable(attachment);
        files.logAttachmentWarn(`CloudKit attachment ${attachment.id} is no longer available`, error);
        return { availabilityStatus: 'unrecoverable', attachment };
      }
      files.logAttachmentWarn(`Failed to download CloudKit attachment ${attachment.id}`, error);
      return null;
    }
  };

  const ensureAttachmentAvailableInternal = async (
    attachment: Attachment,
  ): Promise<InternalAvailabilityOutcome> => {
    if (attachment.kind !== 'file') return attachment;
    const localAttachment = { ...attachment };
    const uri = localAttachment.uri || '';
    if (uri && isHttpAttachmentUri(uri)) {
      return { ...localAttachment, localStatus: 'available' };
    }

    if (uri) {
      const sourcePresence = await files.getLocalAttachmentPresence(uri);
      if (sourcePresence === 'unreadable') return null;
      if (sourcePresence === 'present') {
        if (await files.ensureAttachmentStoredLocally(localAttachment)) {
          return localAttachment;
        }
        return { ...localAttachment, localStatus: 'available' };
      }
    }

    const backend = await host.storage.getItem(SYNC_BACKEND_KEY);
    if (backend === 'file') {
      const syncPath = await host.storage.getItem(SYNC_PATH_KEY);
      if (syncPath) {
        const resolved = await ensureFileAttachmentAvailable(localAttachment, syncPath);
        if (resolved) return resolved;
      }
      return null;
    }

    if (backend === 'cloudkit') {
      if (!host.cloudKit) return null;
      return ensureCloudKitAttachmentAvailable(localAttachment, host.cloudKit);
    }

    if (backend === 'cloud' && localAttachment.cloudKey) {
      const attachmentsDir = await files.getAttachmentsDir();
      if (!attachmentsDir) return null;
      const filename = localAttachment.cloudKey.split('/').pop() || `${localAttachment.id}${extractExtension(localAttachment.title)}`;
      const targetUri = `${attachmentsDir}${filename}`;
      const targetPresence = await files.getLocalAttachmentPresence(targetUri);
      if (targetPresence === 'unreadable') return null;
      if (targetPresence === 'present') {
        return resolveMatchingManagedTarget(localAttachment, targetUri);
      }
      const cloudProvider = ((await host.storage.getItem(CLOUD_PROVIDER_KEY)) || '').trim();
      if (cloudProvider === CLOUD_PROVIDER_DROPBOX) {
        const dropboxClientId = await host.getDropboxClientId();
        if (!dropboxClientId) return null;
        try {
          const data = await files.runDropboxAuthorized(
            dropboxClientId,
            (accessToken) => core.downloadDropboxFile(accessToken, localAttachment.cloudKey as string),
          );
          const bytes = await common.openAttachmentBytesFromDownload(
            data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer),
            await host.encryption.getSyncEncryptionMaterial(),
          );
          const installedAttachment = await installMissingAttachmentBytes(
            localAttachment,
            attachmentsDir,
            targetUri,
            bytes,
          );
          if (installedAttachment === GENERATION_CONFLICT) return GENERATION_CONFLICT;
          if (!installedAttachment) return null;
          reportProgress(localAttachment.id, 'download', bytes.length, bytes.length, 'completed');
          return installedAttachment;
        } catch (error) {
          reportProgress(
            localAttachment.id,
            'download',
            0,
            localAttachment.size ?? 0,
            'failed',
            error instanceof Error ? error.message : String(error)
          );
          files.logAttachmentWarn(`Failed to download attachment ${localAttachment.id}`, error);
          return null;
        }
      }
      const config = await files.loadCloudConfig();
      if (!config?.url) return null;
      const baseSyncUrl = getCloudBaseUrl(config.url);
      try {
        const data = await core.withRetry(() =>
          core.cloudGetFile(`${baseSyncUrl}/${localAttachment.cloudKey}`, {
            ...getMobileCloudRequestOptions(config.allowInsecureHttp),
            token: config.token,
            onProgress: (loaded, total) => reportProgress(localAttachment.id, 'download', loaded, total, 'active'),
          })
        );
        const bytes = await common.openAttachmentBytesFromDownload(
          data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer),
          await host.encryption.getSyncEncryptionMaterial(),
        );
        const installedAttachment = await installMissingAttachmentBytes(
          localAttachment,
          attachmentsDir,
          targetUri,
          bytes,
        );
        if (installedAttachment === GENERATION_CONFLICT) return GENERATION_CONFLICT;
        if (!installedAttachment) return null;
        reportProgress(localAttachment.id, 'download', bytes.length, bytes.length, 'completed');
        return installedAttachment;
      } catch (error) {
        reportProgress(
          localAttachment.id,
          'download',
          0,
          localAttachment.size ?? 0,
          'failed',
          error instanceof Error ? error.message : String(error)
        );
        files.logAttachmentWarn(`Failed to download attachment ${localAttachment.id}`, error);
        return null;
      }
    }

    if (localAttachment.cloudKey) {
      const config = await files.loadWebDavConfig();
      if (!config?.url) return null;
      const baseSyncUrl = getBaseSyncUrl(config.url);
      const attachmentsDir = await files.getAttachmentsDir();
      if (!attachmentsDir) return null;
      const filename = localAttachment.cloudKey.split('/').pop() || `${localAttachment.id}${extractExtension(localAttachment.title)}`;
      const targetUri = `${attachmentsDir}${filename}`;
      const targetPresence = await files.getLocalAttachmentPresence(targetUri);
      if (targetPresence === 'unreadable') return null;
      if (targetPresence === 'present') {
        return resolveMatchingManagedTarget(localAttachment, targetUri);
      }
      try {
        const data = await core.withRetry(() =>
          core.webdavGetFile(`${baseSyncUrl}/${localAttachment.cloudKey}`, {
            ...getMobileWebDavRequestOptions(config.allowInsecureHttp),
            username: config.username,
            password: config.password,
            onProgress: (loaded, total) => reportProgress(localAttachment.id, 'download', loaded, total, 'active'),
          })
        );
        const bytes = await common.openAttachmentBytesFromDownload(
          data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer),
          await host.encryption.getSyncEncryptionMaterial(),
        );
        const installedAttachment = await installMissingAttachmentBytes(
          localAttachment,
          attachmentsDir,
          targetUri,
          bytes,
        );
        if (installedAttachment === GENERATION_CONFLICT) return GENERATION_CONFLICT;
        if (!installedAttachment) return null;
        reportProgress(localAttachment.id, 'download', bytes.length, bytes.length, 'completed');
        return installedAttachment;
      } catch (error) {
        // A 404 is terminal, as the sync pass treats it: the remote file is gone.
        const terminalNotFound = getErrorStatus(error) === 404;
        reportProgress(
          localAttachment.id,
          'download',
          0,
          localAttachment.size ?? 0,
          'failed',
          terminalNotFound
            ? 'Attachment is no longer available'
            : error instanceof Error ? error.message : String(error)
        );
        if (terminalNotFound) {
          markAttachmentUnrecoverable(localAttachment);
          files.logAttachmentWarn(`WebDAV attachment ${localAttachment.id} is no longer available`, error, {
            releaseCheck: 'v1.3.4/webdav-download-not-found',
          });
          return { availabilityStatus: 'unrecoverable', attachment: localAttachment };
        }
        files.logAttachmentWarn(`Failed to download attachment ${localAttachment.id}`, error);
        return null;
      }
    }

    return null;
  };

  const ensureAttachmentAvailableDetailed = async (
    attachment: Attachment,
  ): Promise<AttachmentAvailabilityOutcome> => {
    if (core.isSandboxMode()) return { status: 'unavailable' };
    if (attachment.kind !== 'file') return { status: 'available', attachment };
    const identity = getAttachmentDownloadIdentity(attachment);
    const existing = downloadLocks.get(identity);
    if (existing) return existing;
    const downloadPromise = ensureAttachmentAvailableInternal(attachment).then((result): AttachmentAvailabilityOutcome => {
      if (result === GENERATION_CONFLICT) return { status: 'generation-conflict' };
      if (!result) return { status: 'unavailable' };
      if ('availabilityStatus' in result) {
        return { status: 'unrecoverable', attachment: result.attachment };
      }
      return { status: 'available', attachment: result };
    });
    downloadLocks.set(identity, downloadPromise);
    try {
      return await downloadPromise;
    } finally {
      downloadLocks.delete(identity);
    }
  };

  /** Compatibility wrapper for existing non-UI callers. Detailed callers retain conflicts. */
  const ensureAttachmentAvailable = async (attachment: Attachment): Promise<Attachment | null> => {
    const outcome = await ensureAttachmentAvailableDetailed(attachment);
    return outcome.status === 'available' ? outcome.attachment : null;
  };

  return {
    ensureAttachmentAvailableDetailed,
    ensureAttachmentAvailable,
  };
};

export type MobileAttachmentAvailability = ReturnType<typeof createMobileAttachmentAvailability>;
