import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { flushPendingSave } from '@mindwtr/core';

import type { SyncBackend } from './sync-service-utils';
import { logInfo, logWarn } from './app-log';
import { areJsTimersPaused } from './js-timers';
import { quiesceMobileStorage } from './storage-adapter';
import { abortMobileSync, getMobileSyncConfigurationStatus, performMobileSync, setMobileSyncRequestDeadline } from './sync-service';
import {
  BACKGROUND_SYNC_LAST_REGISTERED_INTERVAL_KEY,
  type LegacyBackgroundSyncInterval,
} from './sync-constants';

export const MOBILE_BACKGROUND_SYNC_TASK_NAME = 'mindwtr-background-sync';
export const MOBILE_BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES = 15;
export const MOBILE_BACKGROUND_SYNC_INTERVAL = '15m' as const;
// JobScheduler stops a WorkManager job that is still running after its
// allowance (10 minutes normally, 20 in the ACTIVE standby bucket), counts a
// "timeout" against the app, and defers the next run by about 40 minutes. On
// device the job held a wakelock for the whole allowance whenever the sync did
// not settle (#1001). The run is abandoned well inside that allowance instead,
// so the job always returns and the wakelock is released.
//
// Android pauses JavaScript timers while the app is not in the foreground, so
// the setTimeout race below only fires when the app is visible. The deadline
// that holds in the background is the request deadline handed to the sync's
// fetch, which refuses to start a request past it and caps each request at it.
export const MOBILE_BACKGROUND_SYNC_DEADLINE_MS = 4 * 60 * 1000;
export const MOBILE_BACKGROUND_SYNC_QUIESCE_DEADLINE_MS = 20 * 1000;
/** A run past this is written to the log even with debug logging off: a job
 *  that lives this long is what drained batteries in #1001, and the log a
 *  user shares is the only view into a background run. */
export const MOBILE_BACKGROUND_SYNC_SLOW_RUN_MS = 60 * 1000;

type MobileBackgroundSyncRegistrationAction = 'registered' | 'unregistered' | 'unchanged';

export type MobileBackgroundSyncRegistrationResult = {
  action: MobileBackgroundSyncRegistrationAction;
  available: boolean;
  backend: SyncBackend;
  configured: boolean;
  interval: typeof MOBILE_BACKGROUND_SYNC_INTERVAL;
  registered: boolean;
  status: BackgroundTask.BackgroundTaskStatus | null;
};

export const supportsMobileScheduledBackgroundSync = (backend: SyncBackend): boolean => (
  backend === 'webdav' || backend === 'cloud' || backend === 'cloudkit'
);

const logBackgroundSyncWarning = (message: string, error?: unknown) => {
  const extra = error ? { error: error instanceof Error ? error.message : String(error) } : undefined;
  void logWarn(message, { scope: 'sync', extra });
};

const isBackgroundTaskRegistered = async (): Promise<boolean> => {
  try {
    return await TaskManager.isTaskRegisteredAsync(MOBILE_BACKGROUND_SYNC_TASK_NAME);
  } catch (error) {
    logBackgroundSyncWarning('Failed to read mobile background sync registration state', error);
    return false;
  }
};

const getBackgroundTaskStatus = async (): Promise<BackgroundTask.BackgroundTaskStatus | null> => {
  try {
    return await BackgroundTask.getStatusAsync();
  } catch (error) {
    logBackgroundSyncWarning('Failed to read mobile background sync availability', error);
    return null;
  }
};

const isTaskManagerAvailable = async (): Promise<boolean> => {
  try {
    return await TaskManager.isAvailableAsync();
  } catch (error) {
    logBackgroundSyncWarning('Failed to read task manager availability', error);
    return false;
  }
};

const isLegacyBackgroundSyncInterval = (value: unknown): value is LegacyBackgroundSyncInterval => (
  value === 'off' || value === '15m' || value === '1h' || value === '6h'
);

// expo-background-task keeps the previously registered interval on a repeat
// registerTaskAsync call, so the registration loop needs its own record of
// what interval is actually live to know when it must unregister first.
const getLastRegisteredBackgroundSyncInterval = async (): Promise<LegacyBackgroundSyncInterval | null> => {
  try {
    const stored = await AsyncStorage.getItem(BACKGROUND_SYNC_LAST_REGISTERED_INTERVAL_KEY);
    return isLegacyBackgroundSyncInterval(stored) ? stored : null;
  } catch (error) {
    logBackgroundSyncWarning('Failed to read the last registered background sync interval', error);
    return null;
  }
};

const setLastRegisteredBackgroundSyncInterval = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(BACKGROUND_SYNC_LAST_REGISTERED_INTERVAL_KEY, MOBILE_BACKGROUND_SYNC_INTERVAL);
  } catch (error) {
    logBackgroundSyncWarning('Failed to persist the last registered background sync interval', error);
  }
};

const clearLastRegisteredBackgroundSyncInterval = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(BACKGROUND_SYNC_LAST_REGISTERED_INTERVAL_KEY);
  } catch (error) {
    logBackgroundSyncWarning('Failed to clear the last registered background sync interval', error);
  }
};

const withDeadline = <T>(work: Promise<T>, deadlineMs: number, onDeadline: () => T): Promise<T> => (
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(onDeadline()), deadlineMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  })
);

const performBackgroundSyncWork = async (): Promise<BackgroundTask.BackgroundTaskResult> => {
  const { backend, configured } = await getMobileSyncConfigurationStatus();
  if (!configured || !supportsMobileScheduledBackgroundSync(backend)) {
    return BackgroundTask.BackgroundTaskResult.Success;
  }

  await flushPendingSave().catch((error) => {
    logBackgroundSyncWarning('Mobile background sync save flush failed', error);
  });
  const result = await performMobileSync();
  if (result.success) {
    return BackgroundTask.BackgroundTaskResult.Success;
  }

  logBackgroundSyncWarning('Mobile background sync failed', result.error);
  return BackgroundTask.BackgroundTaskResult.Failed;
};

const runMobileBackgroundSync = async (): Promise<BackgroundTask.BackgroundTaskResult> => {
  const startedAt = Date.now();
  // Kept on an object: the deadline callback below assigns it from a closure,
  // which control-flow narrowing on a plain `let` cannot see.
  const run: { outcome: 'success' | 'failed' | 'abandoned' | 'crashed' } = { outcome: 'crashed' };
  setMobileSyncRequestDeadline(startedAt + MOBILE_BACKGROUND_SYNC_DEADLINE_MS);
  // A "started" line without its "finished" line in a shared log is the
  // signature of a run that never settled (#1001).
  void logInfo('Mobile background sync started', {
    scope: 'sync',
    extra: { timersPaused: String(areJsTimersPaused()) },
  });
  try {
    const result = await withDeadline(performBackgroundSyncWork(), MOBILE_BACKGROUND_SYNC_DEADLINE_MS, () => {
      abortMobileSync();
      run.outcome = 'abandoned';
      void logWarn('Mobile background sync did not finish before its deadline and was abandoned', {
        scope: 'sync',
        extra: { deadlineMs: String(MOBILE_BACKGROUND_SYNC_DEADLINE_MS) },
      });
      return BackgroundTask.BackgroundTaskResult.Failed;
    });
    if (run.outcome !== 'abandoned') {
      run.outcome = result === BackgroundTask.BackgroundTaskResult.Success ? 'success' : 'failed';
    }
    return result;
  } catch (error) {
    logBackgroundSyncWarning('Mobile background sync crashed', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  } finally {
    setMobileSyncRequestDeadline(null);
    // This runs in a headless RN instance that is destroyed the moment the task
    // promise settles; deferred storage work must land before that, not after.
    // It gets its own short deadline for the same reason as the sync above.
    await withDeadline(quiesceMobileStorage(), MOBILE_BACKGROUND_SYNC_QUIESCE_DEADLINE_MS, () => {
      logBackgroundSyncWarning('Mobile background sync storage quiesce did not finish before its deadline');
    });
    const elapsedMs = Date.now() - startedAt;
    const extra = { outcome: run.outcome, elapsedMs: String(elapsedMs) };
    if (elapsedMs >= MOBILE_BACKGROUND_SYNC_SLOW_RUN_MS) {
      void logWarn('Mobile background sync run took longer than a minute', { scope: 'sync', force: true, extra });
    } else {
      void logInfo('Mobile background sync finished', { scope: 'sync', extra });
    }
  }
};

// expo-background-task delivers every queued event it has accumulated, so several
// invocations can land at once (three arrived in the same millisecond on device) and
// performMobileSync has no re-entrancy guard of its own. Overlapping runs raced each
// other's snapshots and widened the teardown window above, so they share one run.
let inFlightBackgroundSync: Promise<BackgroundTask.BackgroundTaskResult> | null = null;

const defineMobileBackgroundSyncTask = () => {
  if (TaskManager.isTaskDefined(MOBILE_BACKGROUND_SYNC_TASK_NAME)) return;

  TaskManager.defineTask(MOBILE_BACKGROUND_SYNC_TASK_NAME, async () => {
    if (!inFlightBackgroundSync) {
      inFlightBackgroundSync = runMobileBackgroundSync().finally(() => {
        inFlightBackgroundSync = null;
      });
    }
    return inFlightBackgroundSync;
  });
};

defineMobileBackgroundSyncTask();

type MobileBackgroundSyncRegistrationSnapshot = {
  configuration: Awaited<ReturnType<typeof getMobileSyncConfigurationStatus>>;
  lastRegisteredInterval: LegacyBackgroundSyncInterval | null;
  registered: boolean;
  status: BackgroundTask.BackgroundTaskStatus | null;
  taskManagerAvailable: boolean;
};

const readMobileBackgroundSyncRegistrationSnapshot = async (): Promise<MobileBackgroundSyncRegistrationSnapshot> => {
  const [configuration, status, taskManagerAvailable, registered, lastRegisteredInterval] = await Promise.all([
    getMobileSyncConfigurationStatus(),
    getBackgroundTaskStatus(),
    isTaskManagerAvailable(),
    isBackgroundTaskRegistered(),
    getLastRegisteredBackgroundSyncInterval(),
  ]);

  return { configuration, lastRegisteredInterval, registered, status, taskManagerAvailable };
};

const shouldUseAutomaticMobileBackgroundSync = (snapshot: MobileBackgroundSyncRegistrationSnapshot): boolean => (
  snapshot.taskManagerAvailable
  && snapshot.status === BackgroundTask.BackgroundTaskStatus.Available
  && snapshot.configuration.configured
  && supportsMobileScheduledBackgroundSync(snapshot.configuration.backend)
);

const registrationResult = (
  snapshot: MobileBackgroundSyncRegistrationSnapshot,
  action: MobileBackgroundSyncRegistrationAction,
  registered = snapshot.registered,
): MobileBackgroundSyncRegistrationResult => ({
  action,
  available: snapshot.taskManagerAvailable
    && snapshot.status === BackgroundTask.BackgroundTaskStatus.Available,
  backend: snapshot.configuration.backend,
  configured: snapshot.configuration.configured,
  interval: MOBILE_BACKGROUND_SYNC_INTERVAL,
  registered,
  status: snapshot.status,
});

const logRegistrationDecision = (
  snapshot: MobileBackgroundSyncRegistrationSnapshot,
  decision: string,
) => {
  void logInfo('Mobile background sync registration checked', {
    scope: 'sync',
    extra: {
      appState: String(AppState.currentState),
      decision,
      interval: MOBILE_BACKGROUND_SYNC_INTERVAL,
      registered: String(snapshot.registered),
      storedInterval: snapshot.lastRegisteredInterval ?? 'none',
    },
  });
};

let automaticScheduleReadyLogged = false;

const logAutomaticScheduleReady = (outcome: 'registered' | 'unchanged') => {
  if (automaticScheduleReadyLogged) return;
  automaticScheduleReadyLogged = true;
  void logInfo('Automatic mobile background sync schedule ready', {
    scope: 'sync',
    extra: {
      releaseCheck: 'v1.3.0/automatic-background-sync',
      interval: MOBILE_BACKGROUND_SYNC_INTERVAL,
      outcome,
    },
  });
};

const reconcileAutomaticMobileBackgroundSyncRegistration = async (): Promise<MobileBackgroundSyncRegistrationResult> => {
  let previousAction: MobileBackgroundSyncRegistrationAction = 'unchanged';

  while (true) {
    const snapshot = await readMobileBackgroundSyncRegistrationSnapshot();
    const shouldRegister = shouldUseAutomaticMobileBackgroundSync(snapshot);

    // Registration calls replace or cancel Expo's one shared native worker. A
    // headless wake can report an inactive app and a transient false negative
    // registration, so every native mutation waits for a foreground pass.
    if (AppState.currentState !== 'active') {
      logRegistrationDecision(snapshot, 'deferred-until-foreground');
      return registrationResult(
        snapshot,
        previousAction,
        snapshot.registered || snapshot.lastRegisteredInterval !== null,
      );
    }

    const needsNativeMutation = shouldRegister
      ? !snapshot.registered || snapshot.lastRegisteredInterval !== MOBILE_BACKGROUND_SYNC_INTERVAL
      : snapshot.registered;
    if (needsNativeMutation && inFlightBackgroundSync) {
      logRegistrationDecision(snapshot, 'waiting-for-background-run');
      await inFlightBackgroundSync.catch(() => undefined);
      // The app state, backend configuration, native registration, and legacy
      // record may all have changed while the run settled. Read them again.
      continue;
    }

    if (shouldRegister) {
      if (snapshot.registered && snapshot.lastRegisteredInterval !== MOBILE_BACKGROUND_SYNC_INTERVAL) {
        automaticScheduleReadyLogged = false;
        logRegistrationDecision(snapshot, 're-register');
        // Expo ignores an interval change on a repeat register call. Remove the
        // legacy worker first, then loop so configuration and app state are
        // re-read before the replacement native mutation.
        await BackgroundTask.unregisterTaskAsync(MOBILE_BACKGROUND_SYNC_TASK_NAME);
        await clearLastRegisteredBackgroundSyncInterval();
        previousAction = 'unregistered';
        continue;
      }

      if (!snapshot.registered) {
        logRegistrationDecision(snapshot, 'register');
        await BackgroundTask.registerTaskAsync(MOBILE_BACKGROUND_SYNC_TASK_NAME, {
          minimumInterval: MOBILE_BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES,
        });
        await setLastRegisteredBackgroundSyncInterval();

        // A backend switch can finish while the native call is in flight. Do
        // not claim readiness for a schedule that is already stale; the queued
        // reconciliation for that switch will re-read and clean it up.
        const latestConfiguration = await getMobileSyncConfigurationStatus();
        if (
          AppState.currentState === 'active'
          && latestConfiguration.configured
          && supportsMobileScheduledBackgroundSync(latestConfiguration.backend)
        ) {
          logAutomaticScheduleReady('registered');
        }
        void logInfo('Mobile background sync registered', {
          scope: 'sync',
          extra: { backend: latestConfiguration.backend, interval: MOBILE_BACKGROUND_SYNC_INTERVAL },
        });
        return registrationResult(
          { ...snapshot, configuration: latestConfiguration },
          'registered',
          true,
        );
      }

      logRegistrationDecision(snapshot, 'unchanged');
      logAutomaticScheduleReady('unchanged');
      return registrationResult(snapshot, previousAction === 'unregistered' ? 'registered' : 'unchanged', true);
    }

    automaticScheduleReadyLogged = false;
    if (snapshot.registered) {
      logRegistrationDecision(snapshot, 'unregister');
      await BackgroundTask.unregisterTaskAsync(MOBILE_BACKGROUND_SYNC_TASK_NAME);
      await clearLastRegisteredBackgroundSyncInterval();
      void logInfo('Mobile background sync unregistered', {
        scope: 'sync',
        extra: {
          available: String(snapshot.taskManagerAvailable
            && snapshot.status === BackgroundTask.BackgroundTaskStatus.Available),
          backend: snapshot.configuration.backend,
          configured: String(snapshot.configuration.configured),
          interval: MOBILE_BACKGROUND_SYNC_INTERVAL,
        },
      });
      return registrationResult(snapshot, 'unregistered', false);
    }

    if (snapshot.lastRegisteredInterval !== null) {
      await clearLastRegisteredBackgroundSyncInterval();
    }
    return registrationResult(snapshot, previousAction, false);
  }
};

// Queue callers rather than sharing the current promise: a settings callback
// arriving after a backend change must run its own fresh native/config read.
let registrationReconciliationTail: Promise<void> = Promise.resolve();

export function syncMobileBackgroundSyncRegistration(): Promise<MobileBackgroundSyncRegistrationResult> {
  const reconciliation = registrationReconciliationTail.then(
    reconcileAutomaticMobileBackgroundSyncRegistration,
  );
  registrationReconciliationTail = reconciliation.then(
    () => undefined,
    () => undefined,
  );
  return reconciliation;
}
