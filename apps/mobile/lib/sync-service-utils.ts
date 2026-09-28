import {
  isLikelyOfflineSyncError as isCoreLikelyOfflineSyncError,
  isRemoteSyncBackend as isCoreRemoteSyncBackend,
  type SyncBackend as CoreSyncBackend,
} from '@mindwtr/core';

// The classification and path rules live in core (mobile-sync-utils.ts) so the native app
// classifies a sync failure and reads a sync path exactly as this app does.
export {
  classifySyncFailure,
  coerceSupportedBackend,
  formatMobileSyncErrorMessage as formatSyncErrorMessage,
  getFileSyncBaseDir,
  getSyncConflictCount,
  getSyncMaxClockSkewMs,
  getSyncTimestampAdjustments,
  hasSameUserFacingSyncConflictSummary,
  isLikelyFilePath,
  isMobileSyncFilePath as isSyncFilePath,
  normalizeFileSyncPath,
  resolveBackend,
  type SyncFailureKind,
} from '@mindwtr/core/mobile-sync-utils';

export type SyncBackend = CoreSyncBackend | 'cloudkit';

export const isLikelyOfflineSyncError = (errorOrMessage: unknown): boolean => {
  return isCoreLikelyOfflineSyncError(errorOrMessage);
};

export const isRemoteSyncBackend = (backend: SyncBackend): boolean => isCoreRemoteSyncBackend(backend);
