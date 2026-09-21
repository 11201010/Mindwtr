import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppRegistry, AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { flushPendingSave } from '@mindwtr/core';

import type { SyncBackend } from './sync-service-utils';
import { logInfo, logWarn } from './app-log';
import { areJsTimersPaused } from './js-timers';
import { drainPendingCapturesInBackground } from './pending-capture-drain';
import { quiesceMobileStorage } from './storage-adapter';
import { abortMobileSync, getMobileSyncConfigurationStatus, performMobileSync, setMobileSyncRequestDeadline } from './sync-service';
import {
  BACKGROUND_SYNC_FAILURE_STATE_KEY,
  BACKGROUND_SYNC_LAST_REGISTERED_INTERVAL_KEY,
  type LegacyBackgroundSyncInterval,
} from './sync-constants';

export const MOBILE_BACKGROUND_SYNC_TASK_NAME = 'mindwtr-background-sync';
/** Started by the Android capture dialog right after Save (#1257); the name is
 *  repeated in modules/android-widget CaptureSyncHeadlessService.kt. */
export const MOBILE_CAPTURE_SYNC_HEADLESS_TASK_NAME = 'MindwtrCaptureSync';
type BackgroundSyncTrigger = 'scheduled' | 'capture';
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
/** Ceiling for the failure cooldown below: eight scheduled intervals, i.e. two
 *  hours. The foreground controller's ceiling (10 minutes) cannot be reused —
 *  it is shorter than this task's own 15-minute interval, so it would never
 *  skip a run. */
export const MOBILE_BACKGROUND_SYNC_MAX_FAILURE_COOLDOWN_MS =
  8 * MOBILE_BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES * 60 * 1000;

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

// A backend that cannot accept this device (a wrong password, a server that is
// gone) otherwise costs a full failing cycle — wakelock, storage flush, network
// — every 15 minutes forever. Each failure in a row doubles the wait from one
// scheduled interval up to the ceiling above; one success clears the record.
type BackgroundSyncFailureState = { lastFailureAt: number; consecutiveFailures: number };

const backgroundSyncFailureCooldownMs = (consecutiveFailures: number): number => Math.min(
  MOBILE_BACKGROUND_SYNC_MAX_FAILURE_COOLDOWN_MS,
  MOBILE_BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES * 60 * 1000 * (2 ** (Math.max(1, consecutiveFailures) - 1)),
);

const readBackgroundSyncFailureState = async (): Promise<BackgroundSyncFailureState | null> => {
  try {
    const stored = await AsyncStorage.getItem(BACKGROUND_SYNC_FAILURE_STATE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<BackgroundSyncFailureState> | null;
    const lastFailureAt = Number(parsed?.lastFailureAt);
    const consecutiveFailures = Number(parsed?.consecutiveFailures);
    if (!Number.isFinite(lastFailureAt) || !Number.isFinite(consecutiveFailures) || consecutiveFailures < 1) {
      return null;
    }
    return { lastFailureAt, consecutiveFailures };
  } catch (error) {
    logBackgroundSyncWarning('Failed to read the background sync failure record', error);
    return null;
  }
};

const recordBackgroundSyncOutcome = async (
  succeeded: boolean,
  previous: BackgroundSyncFailureState | null,
): Promise<void> => {
  try {
    if (succeeded) {
      if (previous) await AsyncStorage.removeItem(BACKGROUND_SYNC_FAILURE_STATE_KEY);
      return;
    }
    await AsyncStorage.setItem(BACKGROUND_SYNC_FAILURE_STATE_KEY, JSON.stringify({
      lastFailureAt: Date.now(),
      consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
    } satisfies BackgroundSyncFailureState));
  } catch (error) {
    logBackgroundSyncWarning('Failed to persist the background sync failure record', error);
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

const quiesceWithinDeadline = (): Promise<void> => (
  withDeadline(quiesceMobileStorage(), MOBILE_BACKGROUND_SYNC_QUIESCE_DEADLINE_MS, () => {
    logBackgroundSyncWarning('Mobile background sync storage quiesce did not finish before its deadline');
  })
);

const runMobileBackgroundSync = async (
  trigger: BackgroundSyncTrigger = 'scheduled',
): Promise<BackgroundTask.BackgroundTaskResult> => {
  const startedAt = Date.now();
  // Captures and widget check-offs made while the app was closed only exist as
  // queue files; import them first so this sync has them to send (#1257). It is
  // local work, so it runs even when the network part below is skipped.
  const drained = await drainPendingCapturesInBackground(trigger).catch((error) => {
    logBackgroundSyncWarning('Background capture import failed', error);
    return 0;
  });
  // A Save that the visible app already imported has nothing left to send from here.
  if (trigger === 'capture' && drained === 0) return BackgroundTask.BackgroundTaskResult.Success;
  const failureState = await readBackgroundSyncFailureState();
  // The cooldown spares the battery from scheduled retries; a Save is the user acting now.
  if (failureState && trigger === 'scheduled') {
    const cooldownMs = backgroundSyncFailureCooldownMs(failureState.consecutiveFailures);
    const waitedMs = startedAt - failureState.lastFailureAt;
    // A clock that moved backwards reads as a negative wait; run rather than
    // sit out a cooldown that can never expire.
    if (waitedMs >= 0 && waitedMs < cooldownMs) {
      void logInfo('Mobile background sync skipped during failure cooldown', {
        scope: 'sync',
        extra: {
          consecutiveFailures: String(failureState.consecutiveFailures),
          cooldownMs: String(cooldownMs),
          waitedMs: String(waitedMs),
        },
      });
      if (drained > 0) await quiesceWithinDeadline();
      return BackgroundTask.BackgroundTaskResult.Success;
    }
  }
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
    await quiesceWithinDeadline();
    // Written here for the same reason as the quiesce above: the headless
    // instance is destroyed as soon as this promise settles.
    await recordBackgroundSyncOutcome(run.outcome === 'success', failureState);
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

const runSharedBackgroundSync = (trigger: BackgroundSyncTrigger): Promise<BackgroundTask.BackgroundTaskResult> => {
  if (!inFlightBackgroundSync) {
    inFlightBackgroundSync = runMobileBackgroundSync(trigger).finally(() => {
      inFlightBackgroundSync = null;
    });
  }
  return inFlightBackgroundSync;
};

const defineMobileBackgroundSyncTask = () => {
  if (TaskManager.isTaskDefined(MOBILE_BACKGROUND_SYNC_TASK_NAME)) return;

  TaskManager.defineTask(MOBILE_BACKGROUND_SYNC_TASK_NAME, () => runSharedBackgroundSync('scheduled'));
};

defineMobileBackgroundSyncTask();

/** A second Save during a run waits for it, then imports and sends its own capture. */
export const runCaptureSyncHeadlessTask = async (): Promise<void> => {
  if (inFlightBackgroundSync) await inFlightBackgroundSync.catch(() => undefined);
  await runSharedBackgroundSync('capture');
};

if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask(MOBILE_CAPTURE_SYNC_HEADLESS_TASK_NAME, () => runCaptureSyncHeadlessTask);
}

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
