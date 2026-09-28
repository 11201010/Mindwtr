// The mobile apps' automatic sync triggers: what the app does on resume, on leaving the
// foreground, on a data change and on a CloudKit change, the per-backend pacing, the
// app-state dedupe, and when an automatic failure is worth a log line and a warning. It moved
// here from React Native's `hooks/root-layout/use-root-layout-sync-effects.ts` so the native
// app triggers sync by the same rules. The pacing itself is core's `createAutoSyncController`.
import { createAutoSyncController, type AutoSyncCadence, type AutoSyncController } from './auto-sync-controller';

export type MobileAutoSyncCadence = AutoSyncCadence & {
  foregroundMinIntervalMs: number;
};

const AUTO_SYNC_BACKEND_CACHE_TTL_MS = 5_000;
const APP_STATE_TRIGGER_DEDUPE_MS = 1_000;
// Auto-sync pacing adapts to how long cycles actually take on this device/dataset:
// period = cycle duration T + idle gap, and share = T / period is the fraction of
// time sync occupies the JS thread. Gap = 9T (capped) makes period = 10T, so a
// continuously-editing device spends ~10% of its time syncing instead of ~33%
// at gap = 2T (#766).
const ADAPTIVE_SYNC_DURATION_MULTIPLIER = 9;
const MAX_ADAPTIVE_SYNC_INTERVAL_MS = 5 * 60_000;
// Same base and ceiling as the desktop auto-sync controller.
const AUTO_SYNC_FAILURE_COOLDOWN_MS = 60_000;
const MAX_AUTO_SYNC_FAILURE_COOLDOWN_MS = 10 * 60_000;
/** The same failure is logged and shown again only after this long. */
const AUTO_SYNC_FAILURE_REPORT_REPEAT_MS = 10 * 60 * 1000;
export const MOBILE_AUTO_SYNC_CADENCE_FILE: MobileAutoSyncCadence = {
  minIntervalMs: 30_000,
  debounceFirstChangeMs: 8_000,
  debounceContinuousChangeMs: 15_000,
  foregroundMinIntervalMs: 45_000,
};
export const MOBILE_AUTO_SYNC_CADENCE_REMOTE: MobileAutoSyncCadence = {
  minIntervalMs: 5_000,
  debounceFirstChangeMs: 2_000,
  debounceContinuousChangeMs: 5_000,
  foregroundMinIntervalMs: 30_000,
};
export const MOBILE_AUTO_SYNC_CADENCE_OFF: MobileAutoSyncCadence = {
  minIntervalMs: 60_000,
  debounceFirstChangeMs: 15_000,
  debounceContinuousChangeMs: 30_000,
  foregroundMinIntervalMs: 60_000,
};

/** File Sync is far cheaper to leave alone than a remote backend; sync off barely paces. */
export const getMobileAutoSyncCadence = (backend: string): MobileAutoSyncCadence => {
  if (backend === 'file') return MOBILE_AUTO_SYNC_CADENCE_FILE;
  if (backend === 'webdav' || backend === 'cloud' || backend === 'cloudkit') return MOBILE_AUTO_SYNC_CADENCE_REMOTE;
  return MOBILE_AUTO_SYNC_CADENCE_OFF;
};

type SyncStoreSnapshot = {
  lastDataChangeAt: number;
  settings?: { lastSyncStatus?: string; lastSyncAt?: string } | null;
};

export type MobileSyncTriggerPorts = {
  /** The app state when the host mounted ('active', 'background', 'inactive'). */
  initialAppState: string;
  performSync(): Promise<{ success: boolean; error?: string }>;
  abortSync(): unknown;
  flushPendingSave(): Promise<void>;
  /** Schedules or cancels the platform's periodic background job for the current config. */
  reconcileBackgroundSync(): void;
  readStoredBackend(): Promise<string | null>;
  /** The stored backend value as a backend this device supports (CloudKit only where present). */
  resolveSupportedBackend(raw: string | null): string;
  /** The sync payload fingerprint (core's `getInMemorySyncChangeFingerprint`); may throw. */
  getSyncChangeFingerprint(): string | null;
  isLikelyOfflineSyncError(error: string): boolean;
  classifySyncFailure(error: string): string;
  reportError(error: unknown): void;
  logWarn(message: string, context: { scope: string; extra: Record<string, string> }): unknown;
  /** Show the user one warning for an automatic sync failure, by its classification. */
  showSyncIssue(classification: string): void;
};

export const createMobileSyncTriggers = (ports: MobileSyncTriggerPorts) => {
  let appState = ports.initialAppState;
  let isActive = true;
  let lastLoggedAutoSyncError: string | null = null;
  let lastLoggedAutoSyncErrorAt = 0;
  let syncCadence: MobileAutoSyncCadence = MOBILE_AUTO_SYNC_CADENCE_REMOTE;
  let syncBackendCache: { backend: string; readAt: number } = {
    backend: 'off',
    readAt: 0,
  };
  let lastAutoSyncPayloadFingerprint: string | null = null;
  let lastAppStateSyncTriggerAt = -APP_STATE_TRIGGER_DEDUPE_MS;
  let controller: AutoSyncController | null = null;

  const refreshSyncCadence = async (): Promise<MobileAutoSyncCadence> => {
    const now = Date.now();
    const cached = syncBackendCache;
    if (now - cached.readAt <= AUTO_SYNC_BACKEND_CACHE_TTL_MS) {
      syncCadence = getMobileAutoSyncCadence(cached.backend);
      return syncCadence;
    }
    const rawBackend = await ports.readStoredBackend();
    const backend = ports.resolveSupportedBackend(rawBackend);
    syncBackendCache = { backend, readAt: now };
    syncCadence = getMobileAutoSyncCadence(backend);
    return syncCadence;
  };

  // Device-local bookkeeping (lastSync*, pendingRemoteWrite*, network) is not
  // part of a sync payload, so the change fingerprint ignores it for free —
  // no separate strip pass needed.
  const readCurrentSyncChangeFingerprint = (): string | null => {
    try {
      return ports.getSyncChangeFingerprint();
    } catch (error) {
      ports.reportError(error);
      return null;
    }
  };

  const shouldDedupeAppStateSyncTrigger = (now: number): boolean => {
    const currentFingerprint = readCurrentSyncChangeFingerprint();
    const previousFingerprint = lastAutoSyncPayloadFingerprint;
    if (currentFingerprint) {
      lastAutoSyncPayloadFingerprint = currentFingerprint;
    }
    if (!currentFingerprint || !previousFingerprint || currentFingerprint !== previousFingerprint) {
      return false;
    }
    return now - lastAppStateSyncTriggerAt < APP_STATE_TRIGGER_DEDUPE_MS;
  };

  const markAppStateSyncTrigger = (now: number) => {
    lastAppStateSyncTriggerAt = now;
  };

  const reportAutoSyncFailure = (error: string) => {
    const nowMs = Date.now();
    const shouldLog = error !== lastLoggedAutoSyncError
      || nowMs - lastLoggedAutoSyncErrorAt > AUTO_SYNC_FAILURE_REPORT_REPEAT_MS;
    if (!shouldLog) return;
    lastLoggedAutoSyncError = error;
    lastLoggedAutoSyncErrorAt = nowMs;
    void ports.logWarn('Auto-sync failed', {
      scope: 'sync',
      extra: { error },
    });
    ports.showSyncIssue(ports.classifySyncFailure(error));
  };

  // One controller at a time: the shared pacing machine in core, configured with the mobile
  // policy switches. A disposed controller is replaced on the next use, but the runtime stays
  // inactive once disposed, as it always has.
  const getController = (): AutoSyncController => {
    if (controller) return controller;
    controller = createAutoSyncController({
      // A rejected cycle must reach the failure cooldown like any other
      // failed one, so the throw is converted here rather than propagated.
      performSync: () => ports.performSync().catch((error) => ({ success: false, error: String(error) })),
      flushPendingSave: () => ports.flushPendingSave(),
      reportError: (_label, error) => ports.reportError(error),
      isRuntimeActive: () => isActive,
      onSyncFailure: reportAutoSyncFailure,
      // Being offline is not a backend refusing us: no cooldown, no toast.
      // A failure with no message carries nothing to back off from either.
      isIgnorableFailure: (error) => !error || ports.isLikelyOfflineSyncError(error),
      getCadence: () => syncCadence,
      refreshCadence: refreshSyncCadence,
      // The fingerprint runs once per quiet period, not per write (#766).
      shouldSyncOnDebouncedChange: () => {
        const currentFingerprint = readCurrentSyncChangeFingerprint();
        const previousFingerprint = lastAutoSyncPayloadFingerprint;
        if (currentFingerprint) {
          lastAutoSyncPayloadFingerprint = currentFingerprint;
        }
        return !(currentFingerprint && previousFingerprint && currentFingerprint === previousFingerprint);
      },
      adaptivePacing: {
        durationMultiplier: ADAPTIVE_SYNC_DURATION_MULTIPLIER,
        maxIntervalMs: MAX_ADAPTIVE_SYNC_INTERVAL_MS,
      },
      isSuspended: () => appState !== 'active',
      // Both preserve mobile's existing pacing exactly: the first-change
      // debounce applies once per foreground session, and a throttle or
      // cooldown retry that a newer cycle already overtook is dropped.
      continuousDebounceUntilSuspend: true,
      skipRetryWhileCycleRunning: true,
      autoFailureCooldownMs: AUTO_SYNC_FAILURE_COOLDOWN_MS,
      maxFailureCooldownMs: MAX_AUTO_SYNC_FAILURE_COOLDOWN_MS,
      // No foreground heartbeat on mobile; background sync is a platform job,
      // never a JS timer.
      periodicSyncIntervalMs: null,
    });
    return controller;
  };

  return {
    /** Starts watching: reads the cadence, reconciles the background job, seeds the fingerprint. */
    start(): void {
      getController();
      void refreshSyncCadence().catch(ports.reportError);
      ports.reconcileBackgroundSync();
      lastAutoSyncPayloadFingerprint = readCurrentSyncChangeFingerprint();
    },

    // Every trigger routed through here is automatic — app-state changes, CloudKit
    // change notifications, startup — so every one of them waits out a failure
    // cooldown. Exempting them let a throttled device fire again on the very next
    // foreground/background switch, which is how testing across two devices stayed
    // stuck (#948). The user-facing Sync now button does not come through here; it
    // calls the sync service directly and still forces a run.
    requestSync(minIntervalMs?: number): void {
      const activeController = getController();
      if (typeof minIntervalMs === 'number') {
        void activeController.requestAutoSync(minIntervalMs, 'external').catch(ports.reportError);
        return;
      }
      void refreshSyncCadence()
        .then(() => activeController.requestAutoSync(undefined, 'external'))
        .catch(ports.reportError);
    },

    /** A store update: a finished sync cancels a failure retry; a data change starts the debounce. */
    handleStoreChange(state: SyncStoreSnapshot, prevState: SyncStoreSnapshot): void {
      const activeController = getController();
      const currentSyncStatus = state.settings?.lastSyncStatus;
      const previousSyncStatus = prevState.settings?.lastSyncStatus;
      const syncCompleted = currentSyncStatus === 'success' || currentSyncStatus === 'conflict';
      if (
        syncCompleted
        && (
          currentSyncStatus !== previousSyncStatus
          || state.settings?.lastSyncAt !== prevState.settings?.lastSyncAt
        )
      ) {
        // Manual sync bypasses these triggers, but its successful status
        // update must still cancel an automatic retry left by a prior
        // failure.
        activeController.notifyExternalSyncSuccess();
      }
      // Cheap check first: the fingerprint reads a small tuple digest, not the
      // whole dataset, but it still must not run on every store update (#766).
      // Data writes always bump lastDataChangeAt, so skipping the fingerprint
      // here is safe.
      if (state.lastDataChangeAt === prevState.lastDataChangeAt) return;
      activeController.handleDataChange();
    },

    /** An app state change. Returns 'resumed' when the app came back to the foreground, so the
     *  host refreshes what it shows; 'left' when it went to the background; otherwise null. */
    handleAppStateChange(nextAppState: string): 'resumed' | 'left' | null {
      if (!isActive) return null;
      const activeController = getController();
      const previousState = appState;
      const wasInactiveOrBackground = previousState === 'inactive' || previousState === 'background';
      const nextInactiveOrBackground = nextAppState === 'inactive' || nextAppState === 'background';
      let transition: 'resumed' | 'left' | null = null;
      if (wasInactiveOrBackground && nextAppState === 'active') {
        transition = 'resumed';
        ports.reconcileBackgroundSync();
        if (activeController.takePendingSuspendedRequest()) {
          void activeController.requestAutoSync(0, 'app-state-resume').catch(ports.reportError);
        } else {
          void refreshSyncCadence()
            .then((cadence) => {
              const now = Date.now();
              if (now - activeController.getLastAutoSyncAt() > cadence.foregroundMinIntervalMs) {
                if (shouldDedupeAppStateSyncTrigger(now)) return;
                markAppStateSyncTrigger(now);
                void activeController.requestAutoSync(0, 'app-state-active').catch(ports.reportError);
              }
            })
            .catch(ports.reportError);
        }
      }
      if (previousState === 'active' && nextInactiveOrBackground) {
        transition = 'left';
        ports.reconcileBackgroundSync();
        activeController.handleSuspend();
        ports.abortSync();
        const now = Date.now();
        if (!shouldDedupeAppStateSyncTrigger(now)) {
          markAppStateSyncTrigger(now);
          void activeController.requestAutoSync(0, 'app-state-background').catch(ports.reportError);
        }
      }
      appState = nextAppState;
      return transition;
    },

    handleCloudKitChange(): void {
      void getController().requestAutoSync(0, 'cloudkit').catch(ports.reportError);
    },

    /** False once disposed: the host's own foreground work checks it too. */
    isRuntimeActive: (): boolean => isActive,

    /** Stops every trigger for good and drops the controller's timers. */
    dispose(): void {
      isActive = false;
      controller?.dispose();
      controller = null;
    },
  };
};

export type MobileSyncTriggers = ReturnType<typeof createMobileSyncTriggers>;
