import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_POMODORO_DURATIONS, getPomodoroLocalDayKey, type Task } from '@mindwtr/core';

vi.mock('./app-log', () => ({ logWarn: vi.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { createMobilePomodoroController } from './pomodoro-controller';

const makeStorage = (stored: unknown = null) => ({
  getItem: vi.fn(async () => stored === null ? null : JSON.stringify(stored)),
  setItem: vi.fn(async () => undefined),
});

describe('mobile pomodoro controller', () => {
  let nowMs = 10_000;

  beforeEach(() => {
    nowMs = 10_000;
  });

  it.each([
    ['focus', 'start', 'focus-finished'],
    ['focus', 'reset', 'focus-finished'],
    ['focus', 'switch-phase', 'focus-finished'],
    ['focus', 'dismiss', 'focus-finished'],
    ['break', 'start', 'break-finished'],
    ['break', 'reset', 'break-finished'],
    ['break', 'switch-phase', 'break-finished'],
    ['break', 'dismiss', 'break-finished'],
  ] as const)('keeps %s completion feedback through idle ticks until %s', async (phase, action, event) => {
    const controller = createMobilePomodoroController({ storage: makeStorage(), now: () => nowMs });
    await controller.ensureHydrated();
    controller.setDurations({ focusMinutes: 1, breakMinutes: 1 });
    if (phase === 'break') controller.switchPhase();
    controller.toggle();

    nowMs += 60_000;
    controller.reconcile();
    expect(controller.getSnapshot().lastEvent).toBe(event);

    for (let idleTick = 0; idleTick < 3; idleTick += 1) {
      nowMs += 1_000;
      controller.reconcile();
    }
    expect(controller.getSnapshot().lastEvent).toBe(event);

    if (action === 'start') controller.toggle();
    if (action === 'reset') controller.reset();
    if (action === 'switch-phase') controller.switchPhase();
    if (action === 'dismiss') controller.clearLastEvent();
    expect(controller.getSnapshot().lastEvent).toBeNull();
  });

  it('treats Watch actions as timestamped idempotent setters', async () => {
    const storage = makeStorage();
    const controller = createMobilePomodoroController({ storage, now: () => nowMs });
    await controller.ensureHydrated();

    expect(await controller.applyWatchCommand({ action: 'start', createdAt: new Date(20_000).toISOString() })).toBe('applied');
    expect(controller.getSnapshot().timerState.isRunning).toBe(true);
    expect(await controller.applyWatchCommand({ action: 'start', createdAt: new Date(20_000).toISOString() })).toBe('already-applied');

    nowMs = 21_000;
    expect(await controller.applyWatchCommand({ action: 'pause', createdAt: new Date(21_000).toISOString() })).toBe('applied');
    expect(controller.getSnapshot().timerState.isRunning).toBe(false);
  });

  it('keeps a command retryable until its timer session is durable', async () => {
    const storage = makeStorage();
    storage.setItem.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const controller = createMobilePomodoroController({ storage, now: () => nowMs });
    await controller.ensureHydrated();
    const command = { action: 'start' as const, createdAt: new Date(20_000).toISOString() };

    await expect(controller.applyWatchCommand(command)).rejects.toThrow('disk full');
    await expect(controller.applyWatchCommand(command)).resolves.toBe('already-applied');
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it('rejects an offline Watch command older than a phone-side mutation', async () => {
    const controller = createMobilePomodoroController({ storage: makeStorage(), now: () => nowMs });
    await controller.ensureHydrated();
    controller.toggle();
    expect(controller.getSnapshot().updatedAtMs).toBe(10_000);

    expect(await controller.applyWatchCommand({
      action: 'pause',
      createdAt: new Date(9_000).toISOString(),
    })).toBe('stale');
    expect(controller.getSnapshot().timerState.isRunning).toBe(true);
  });

  it('keeps a later phone action authoritative across Watch clock skew', async () => {
    const controller = createMobilePomodoroController({ storage: makeStorage(), now: () => nowMs });
    await controller.ensureHydrated();
    const watchTime = new Date(20_000).toISOString();
    expect(await controller.applyWatchCommand({ action: 'start', createdAt: watchTime })).toBe('applied');

    nowMs = 11_000;
    controller.toggle();
    expect(controller.getSnapshot().timerState.isRunning).toBe(false);
    expect(controller.getSnapshot().updatedAtMs).toBe(20_001);

    expect(await controller.applyWatchCommand({ action: 'start', createdAt: watchTime })).toBe('stale');
    expect(controller.getSnapshot().timerState.isRunning).toBe(false);
  });

  it('respects the phone link-task setting and rejects a terminal Watch task link', async () => {
    const openTask = { id: 'open', title: 'Open', status: 'next' } as Task;
    const doneTask = { id: 'done', title: 'Done', status: 'done' } as Task;
    const controller = createMobilePomodoroController({
      storage: makeStorage(),
      now: () => nowMs,
      getTaskStore: () => ({ tasks: [openTask, doneTask], updateTask: vi.fn(async () => ({ success: true })) }),
    });
    await controller.ensureHydrated();
    nowMs = 11_000;
    controller.setSelectedTaskId(openTask.id);

    expect(await controller.applyWatchCommand(
      { action: 'start', taskId: openTask.id, createdAt: new Date(20_000).toISOString() },
      {},
      { linkTaskEnabled: false },
    )).toBe('applied');
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined();

    nowMs = 20_500;
    controller.setSelectedTaskId(openTask.id);
    expect(await controller.applyWatchCommand(
      { action: 'pause', taskId: doneTask.id, createdAt: new Date(21_000).toISOString() },
      {},
      { linkTaskEnabled: true },
    )).toBe('applied');
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined();
  });

  it('credits a completed linked focus session once across repeated reconciliation', async () => {
    const task = { id: 'task-1', title: 'Write', timeSpentMinutes: 5 } as Task;
    const updateTask = vi.fn(async () => ({ success: true }));
    const stored = {
      durations: DEFAULT_POMODORO_DURATIONS,
      timerState: {
        phase: 'focus',
        remainingSeconds: 1,
        isRunning: true,
        completedFocusSessions: 0,
      },
      selectedTaskId: task.id,
      phaseEndsAt: new Date(9_000).toISOString(),
      sessionHistory: {
        totalCompletedFocusSessions: 0,
        completedFocusSessionsByTaskId: {},
        todayDayKey: getPomodoroLocalDayKey(nowMs),
        completedTodayFocusSessions: 0,
      },
    };
    const controller = createMobilePomodoroController({
      storage: makeStorage(stored),
      now: () => nowMs,
      getTaskStore: () => ({ tasks: [task], updateTask }),
    });

    await controller.ensureHydrated();
    controller.reconcile();
    controller.reconcile();

    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith(task.id, {
      timeSpentMinutes: 5 + DEFAULT_POMODORO_DURATIONS.focusMinutes,
    });
  });
});
