import * as LegacyFileSystem from 'expo-file-system/legacy';
import {
  assertAttachmentSyncNotAborted,
  CLOUD_ATTACHMENT_PRESENCE_MAX_CHECKS_PER_PASS,
  createAttachmentAbortError,
  createMobileAttachmentCommon,
  isAttachmentSyncAbortError,
  resolveAttachmentDownloadTargetPath,
  StreamedUploadCancellationUnconfirmedError,
  type MobileAttachmentCommon,
} from '@mindwtr/core/mobile-attachment-common';
import { mobileAttachmentFiles, mobileAttachmentFileSystem } from '../attachment-sync-utils';
import { installAttachmentFileGeneration } from '../attachment-file-installer';
import { isExpoGo } from '../expo-go';
import { areJsTimersPaused } from '../js-timers';
import { logSyncEncryptionEvent } from '../sync-encryption-state';
import { mobileSyncCryptoPrimitives } from '../sync-crypto-native';

// The attachment passes' shared layer — sealing and opening bytes, download staging and
// installation, upload snapshots, the lifecycle adapter, the bespoke content checks, the
// pre-passes, abort-aware delays and the streamed PUT — lives in core
// (`packages/core/src/mobile-attachment-common.ts`) so the native app runs the same rules. This
// module binds it to expo-file-system, the native installer, the crypto module, Expo Go and the
// paused-timer check. Every binding calls the imported function when used, so tests that
// replace these modules still reach their mocks; the core object is made on first use.

export {
  assertAttachmentSyncNotAborted,
  CLOUD_ATTACHMENT_PRESENCE_MAX_CHECKS_PER_PASS,
  createAttachmentAbortError,
  isAttachmentSyncAbortError,
  resolveAttachmentDownloadTargetPath,
  StreamedUploadCancellationUnconfirmedError,
};
export type { BespokeAttachmentRemoteWinnerCheck } from '@mindwtr/core/mobile-attachment-common';

/** #1136: the enum lives in `expo-file-system/legacy`, never in the local wrapper.
 *  Android's native `FileSystemUploadOptions.uploadType` has no default and expo's
 *  `UploadTask` spreads our options over its own default, so an undefined value
 *  reaches Kotlin as null and `uploadTaskStartAsync` dies on `Enum.ordinal()`.
 *  Never return undefined: 0 is BINARY_CONTENT on both sides. */
const resolveUploadType = (): number => {
  const types = (LegacyFileSystem as any).FileSystemUploadType;
  return types?.BINARY_CONTENT ?? types?.BINARY ?? 0;
};

let common: MobileAttachmentCommon | null = null;

/** The core attachment common object, made on first use. */
export const mobileAttachmentCommon = (): MobileAttachmentCommon => {
  if (common) return common;
  common = createMobileAttachmentCommon({
    fs: mobileAttachmentFileSystem,
    files: mobileAttachmentFiles(),
    crypto: mobileSyncCryptoPrimitives,
    encryption: {
      logSyncEncryptionEvent: (event, extra, options) => logSyncEncryptionEvent(event, extra, options),
    },
    installer: {
      installAttachmentFileGeneration: (stagedPath, targetPath, expected, expectedDownloadSha256) => (
        installAttachmentFileGeneration(stagedPath, targetPath, expected, expectedDownloadSha256)
      ),
    },
    installerMayBeMissing: () => isExpoGo(),
    timersPaused: () => areJsTimersPaused(),
    uploads: {
      // uploadAsync has no cancellation handle, so only the task API is used; without it the
      // caller falls back to the bounded byte PUT.
      createUploadTask: (url, fileUri, options, onProgress) => {
        if (typeof LegacyFileSystem.uploadAsync !== 'function') return null;
        if (typeof LegacyFileSystem.createUploadTask !== 'function') return null;
        return LegacyFileSystem.createUploadTask(
          url,
          fileUri,
          { ...options, uploadType: resolveUploadType() },
          onProgress,
        );
      },
    },
  });
  return common;
};

type Common = MobileAttachmentCommon;

export const sealAttachmentBytesForUpload: Common['sealAttachmentBytesForUpload'] = (...args) => (
  mobileAttachmentCommon().sealAttachmentBytesForUpload(...args)
);
export const openAttachmentBytesFromDownload: Common['openAttachmentBytesFromDownload'] = (...args) => (
  mobileAttachmentCommon().openAttachmentBytesFromDownload(...args)
);
export const deleteAttachmentDownloadStageBestEffort: Common['deleteAttachmentDownloadStageBestEffort'] = (...args) => (
  mobileAttachmentCommon().deleteAttachmentDownloadStageBestEffort(...args)
);
export const copyAttachmentDownloadToStage: Common['copyAttachmentDownloadToStage'] = (...args) => (
  mobileAttachmentCommon().copyAttachmentDownloadToStage(...args)
);
export const readAttachmentDownloadStageBytes: Common['readAttachmentDownloadStageBytes'] = (...args) => (
  mobileAttachmentCommon().readAttachmentDownloadStageBytes(...args)
);
export const installStagedAttachmentDownload: Common['installStagedAttachmentDownload'] = (...args) => (
  mobileAttachmentCommon().installStagedAttachmentDownload(...args)
);
export const installAttachmentDownloadBytes: Common['installAttachmentDownloadBytes'] = (...args) => (
  mobileAttachmentCommon().installAttachmentDownloadBytes(...args)
);
/** CloudKit's native fetch must receive scratch, never the canonical target. */
export const createAttachmentDownloadStagePath: Common['createAttachmentDownloadStagePath'] = (...args) => (
  mobileAttachmentCommon().createAttachmentDownloadStagePath(...args)
);
export const createMobileAttachmentUploadSnapshot: Common['createMobileAttachmentUploadSnapshot'] = (...args) => (
  mobileAttachmentCommon().createMobileAttachmentUploadSnapshot(...args)
);
export const createMobileAttachmentUploadSnapshotWithLimit: Common['createMobileAttachmentUploadSnapshotWithLimit'] = (...args) => (
  mobileAttachmentCommon().createMobileAttachmentUploadSnapshotWithLimit(...args)
);
export const runMobileAttachmentLifecycle: Common['runMobileAttachmentLifecycle'] = (...args) => (
  mobileAttachmentCommon().runMobileAttachmentLifecycle(...args)
);
export const prepareBespokeAttachmentContentCandidate: Common['prepareBespokeAttachmentContentCandidate'] = (...args) => (
  mobileAttachmentCommon().prepareBespokeAttachmentContentCandidate(...args)
);
export const pendingBespokeAttachmentContentStillMatches: Common['pendingBespokeAttachmentContentStillMatches'] = (...args) => (
  mobileAttachmentCommon().pendingBespokeAttachmentContentStillMatches(...args)
);
export const checkBespokeAttachmentRemoteWinner: Common['checkBespokeAttachmentRemoteWinner'] = (...args) => (
  mobileAttachmentCommon().checkBespokeAttachmentRemoteWinner(...args)
);
export const refreshBespokeAttachmentDownloadedContentStat: Common['refreshBespokeAttachmentDownloadedContentStat'] = (...args) => (
  mobileAttachmentCommon().refreshBespokeAttachmentDownloadedContentStat(...args)
);
export const migrateAttachmentsLocallyBeforeSync: Common['migrateAttachmentsLocallyBeforeSync'] = (...args) => (
  mobileAttachmentCommon().migrateAttachmentsLocallyBeforeSync(...args)
);
export const reconcileRemoteAttachmentPresence: Common['reconcileRemoteAttachmentPresence'] = (...args) => (
  mobileAttachmentCommon().reconcileRemoteAttachmentPresence(...args)
);
export const waitForAttachmentSyncDelay: Common['waitForAttachmentSyncDelay'] = (...args) => (
  mobileAttachmentCommon().waitForAttachmentSyncDelay(...args)
);
export const uploadWebdavFileWithFileSystem: Common['uploadWebdavFileWithFileSystem'] = (...args) => (
  mobileAttachmentCommon().uploadWebdavFileWithFileSystem(...args)
);
export const uploadCloudFileWithFileSystem: Common['uploadCloudFileWithFileSystem'] = (...args) => (
  mobileAttachmentCommon().uploadCloudFileWithFileSystem(...args)
);
