import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { storeState } = vi.hoisted(() => ({
  storeState: {
    tasks: [] as unknown[],
    updateTask: vi.fn(async () => ({ success: true })),
    settings: { gtd: { pomodoro: {} } } as Record<string, any>,
  },
}));

vi.mock('@mindwtr/core', async () => {
  const actual = await vi.importActual<typeof import('@mindwtr/core')>('@mindwtr/core');
  const useTaskStore = Object.assign((selector?: (state: typeof storeState) => unknown) => (
    selector ? selector(storeState) : storeState
  ), { getState: () => storeState });
  return { ...actual, useTaskStore };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
  },
}));

const notificationMocks = vi.hoisted(() => ({
  cancelMobilePomodoroCompletionNotification: vi.fn(async () => undefined),
  scheduleMobilePomodoroCompletionNotification: vi.fn(async () => undefined),
}));
vi.mock('@/lib/notification-service', () => notificationMocks);
vi.mock('@/lib/app-log', () => ({ logWarn: vi.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { mobilePomodoroController } from '@/lib/pomodoro-controller';
// eslint-disable-next-line import/first
import { useRootLayoutPomodoro } from './use-root-layout-pomodoro';

const resolveText = (_key: string, fallback: string) => fallback;

function Harness() {
  useRootLayoutPomodoro({ dataReady: true, resolveText });
  return null;
}

describe('useRootLayoutPomodoro', () => {
  beforeEach(() => {
    mobilePomodoroController.resetForTests();
    storeState.settings = { gtd: { pomodoro: {} } };
    vi.clearAllMocks();
    vi.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
  });

  it('does not cancel an existing alarm before hydration and schedules the restored run', async () => {
    let release!: (value: string) => void;
    vi.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<Harness />); });
    expect(notificationMocks.cancelMobilePomodoroCompletionNotification).not.toHaveBeenCalled();

    const phaseEndsAt = new Date(Date.now() + 600_000).toISOString();
    await act(async () => {
      release(JSON.stringify({
        durations: { focusMinutes: 25, breakMinutes: 5 },
        timerState: { phase: 'focus', remainingSeconds: 600, isRunning: true, completedFocusSessions: 0 },
        phaseEndsAt,
      }));
    });

    expect(notificationMocks.scheduleMobilePomodoroCompletionNotification).toHaveBeenCalledWith(
      'Pomodoro Timer',
      'Focus session complete. Take a short break.',
      new Date(phaseEndsAt),
      { phase: 'focus-complete' },
    );
    act(() => tree.unmount());
  });

  it('cancels the timer alarm when the completion alert setting is off', async () => {
    storeState.settings = { gtd: { pomodoro: { completionAlert: false } } };
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(null);
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<Harness />); });

    expect(notificationMocks.scheduleMobilePomodoroCompletionNotification).not.toHaveBeenCalled();
    expect(notificationMocks.cancelMobilePomodoroCompletionNotification).toHaveBeenCalledWith('completion-alert-off');
    act(() => tree.unmount());
  });
});
