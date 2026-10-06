import { workspaceSessionStorage as AsyncStorage } from '@/lib/workspace-session-storage';
import {
  createMobilePomodoroController as createCorePomodoroController,
  type MobilePomodoroControllerState,
  useTaskStore,
} from '@mindwtr/core';
import { useSyncExternalStore } from 'react';

import { logWarn } from './app-log';

export type { MobilePomodoroControllerState, PomodoroCommandAction, PomodoroCommandOutcome } from '@mindwtr/core';

/** Core's controller (packages/core/src/pomodoro-controller.ts) on RN's workspace storage, task store and app log. */
export function createMobilePomodoroController(
  options: Partial<Parameters<typeof createCorePomodoroController>[0]> = {},
): ReturnType<typeof createCorePomodoroController> {
  return createCorePomodoroController({
    logWarn,
    getTaskStore: () => {
      const state = useTaskStore.getState();
      return { tasks: state.tasks, updateTask: state.updateTask };
    },
    ...options,
    storage: options.storage ?? AsyncStorage,
  });
}

export const mobilePomodoroController = createMobilePomodoroController();

export const useMobilePomodoroControllerState = (): MobilePomodoroControllerState => (
  useSyncExternalStore(
    mobilePomodoroController.subscribe,
    mobilePomodoroController.getSnapshot,
    mobilePomodoroController.getSnapshot,
  )
);

type MobilePomodoroNotificationState = Pick<MobilePomodoroControllerState, 'isHydrating' | 'phaseEndsAt'> & {
  phase: MobilePomodoroControllerState['timerState']['phase'];
  isRunning: boolean;
};

let notificationSnapshot: MobilePomodoroNotificationState | null = null;
const getNotificationSnapshot = (): MobilePomodoroNotificationState => {
  const current = mobilePomodoroController.getSnapshot();
  if (
    notificationSnapshot
    && notificationSnapshot.isHydrating === current.isHydrating
    && notificationSnapshot.phaseEndsAt === current.phaseEndsAt
    && notificationSnapshot.phase === current.timerState.phase
    && notificationSnapshot.isRunning === current.timerState.isRunning
  ) return notificationSnapshot;
  notificationSnapshot = {
    isHydrating: current.isHydrating,
    phaseEndsAt: current.phaseEndsAt,
    phase: current.timerState.phase,
    isRunning: current.timerState.isRunning,
  };
  return notificationSnapshot;
};

/** Stable selector: second-by-second remaining time cannot rerender RootLayout. */
export const useMobilePomodoroNotificationState = (): MobilePomodoroNotificationState => (
  useSyncExternalStore(
    mobilePomodoroController.subscribe,
    getNotificationSnapshot,
    getNotificationSnapshot,
  )
);
