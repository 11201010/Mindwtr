import { describe, expect, it } from 'vitest';

import { DEFAULT_POMODORO_DURATIONS, createPomodoroState } from '@mindwtr/core';

import { buildWatchApplicationContext, WATCH_FOCUS_TASK_LIMIT, WATCH_TITLE_LIMIT, watchPomodoroPublicationKey } from './watch-snapshot';
import type { MobilePomodoroControllerState } from './pomodoro-controller';

const pomodoro = (overrides: Partial<MobilePomodoroControllerState> = {}): MobilePomodoroControllerState => ({
  durations: DEFAULT_POMODORO_DURATIONS,
  timerState: createPomodoroState(DEFAULT_POMODORO_DURATIONS),
  phaseEndsAt: undefined,
  selectedTaskId: undefined,
  lastEvent: null,
  sessionHistory: {
    totalCompletedFocusSessions: 0,
    completedFocusSessionsByTaskId: {},
    todayDayKey: '1970-01-01',
    completedTodayFocusSessions: 0,
  },
  isHydrating: false,
  updatedAtMs: 0,
  ...overrides,
});

describe('Watch application context', () => {
  it('bounds and deduplicates Focus tasks and strips nullable timer fields', () => {
    const focus = Array.from({ length: 30 }, (_, index) => ({
      id: `task-${index}`,
      title: `Task ${index} ${'x'.repeat(300)}`,
    }));
    focus.splice(1, 0, focus[0]);

    const context = buildWatchApplicationContext({ focus, pomodoro: pomodoro(), now: new Date(0) });

    expect(context.focus).toHaveLength(WATCH_FOCUS_TASK_LIMIT);
    expect(context.focus[0].title.length).toBe(WATCH_TITLE_LIMIT);
    expect(context.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(context.pomodoro).toEqual({
      phase: 'focus',
      isRunning: false,
      remainingSeconds: DEFAULT_POMODORO_DURATIONS.focusMinutes * 60,
      completionAlert: true,
    });
    expect(JSON.stringify(context)).not.toContain('null');
  });

  it('publishes a running timer at minute rollover, not every second', () => {
    const first = pomodoro({
      timerState: { ...createPomodoroState(DEFAULT_POMODORO_DURATIONS), isRunning: true, remainingSeconds: 1499 },
      phaseEndsAt: '2026-09-07T00:00:00.000Z',
    });
    const sameMinute = pomodoro({ ...first, timerState: { ...first.timerState, remainingSeconds: 1498 } });
    const nextMinute = pomodoro({ ...first, timerState: { ...first.timerState, remainingSeconds: 1440 } });
    const alertsOff = buildWatchApplicationContext({
      focus: [],
      pomodoro: first,
      completionAlertEnabled: false,
    });

    expect(watchPomodoroPublicationKey(first)).toBe(watchPomodoroPublicationKey(sameMinute));
    expect(watchPomodoroPublicationKey(first)).not.toBe(watchPomodoroPublicationKey(nextMinute));
    expect(alertsOff.pomodoro.completionAlert).toBe(false);
  });
});
