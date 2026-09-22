import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storeState } = vi.hoisted(() => ({
  storeState: { addTask: vi.fn(async () => ({ success: true })) },
}));

vi.mock('@mindwtr/core', async () => {
  const actual = await vi.importActual<typeof import('@mindwtr/core')>('@mindwtr/core');
  const useTaskStore = Object.assign((selector?: (state: typeof storeState) => unknown) => (
    selector ? selector(storeState) : storeState
  ), { getState: () => storeState });
  return { ...actual, useTaskStore };
});

const importMocks = vi.hoisted(() => ({
  runAppleRemindersAutoImport: vi.fn(),
  requestAppleRemindersPermission: vi.fn(),
}));
vi.mock('@/lib/apple-reminders-import', () => importMocks);

// The real AppState shim drops its listeners; the hook's whole job is what it
// does on each foreground, so the test keeps them.
const appStateListeners = vi.hoisted(() => ({ current: [] as ((state: string) => void)[] }));
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    AppState: {
      currentState: 'active',
      addEventListener: (_event: string, listener: (state: string) => void) => {
        appStateListeners.current.push(listener);
        return {
          remove: () => {
            appStateListeners.current = appStateListeners.current.filter((entry) => entry !== listener);
          },
        };
      },
    },
  };
});
const foreground = async () => {
  await act(async () => {
    appStateListeners.current.forEach((listener) => listener('active'));
    await Promise.resolve();
  });
};

const logMocks = vi.hoisted(() => ({
  logError: vi.fn(async () => undefined),
  logInfo: vi.fn(async () => undefined),
}));
vi.mock('@/lib/app-log', () => logMocks);
vi.mock('@/lib/data-transfer', () => ({ createMobileRecoverySnapshot: vi.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { useRootLayoutAppleRemindersAutoImport } from './use-root-layout-apple-reminders';

const emptyResult = {
  importedCount: 0,
  deletedCount: 0,
  deleteFailedCount: 0,
  skippedDuplicateCount: 0,
  skippedCompletedCount: 0,
  skippedEmptyTitleCount: 0,
  failedCount: 0,
};

const showToast = vi.fn();

function Harness({ dataReady = true, disabled = false }: { dataReady?: boolean; disabled?: boolean }) {
  useRootLayoutAppleRemindersAutoImport({ dataReady, disabled, showToast, t: (key: string) => key });
  return null;
}

const mount = async (props: { dataReady?: boolean; disabled?: boolean } = {}) => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<Harness {...props} />);
    await Promise.resolve();
  });
  return tree;
};

describe('useRootLayoutAppleRemindersAutoImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    appStateListeners.current = [];
    importMocks.runAppleRemindersAutoImport.mockResolvedValue(null);
  });

  // The import runs on every foreground, so a run that changed nothing must
  // leave no trace at all: no toast, and no log line either.
  it('writes no log line on a foreground where nothing was imported', async () => {
    importMocks.runAppleRemindersAutoImport.mockResolvedValue({ ...emptyResult, skippedDuplicateCount: 3 });
    const tree = await mount();

    expect(importMocks.runAppleRemindersAutoImport).toHaveBeenCalledOnce();
    expect(logMocks.logInfo).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  // Without a flush the import records a reminder as done while its task is
  // still only in memory, so the hook must hand one in.
  it('hands the import ways to flush and resolve the pending task save', async () => {
    const tree = await mount();

    expect(importMocks.runAppleRemindersAutoImport).toHaveBeenCalledWith(
      expect.objectContaining({
        flushPendingSave: expect.any(Function),
        getTaskById: expect.any(Function),
      }),
    );
    act(() => tree.unmount());
  });

  it('logs the run once reminders were imported', async () => {
    importMocks.runAppleRemindersAutoImport.mockResolvedValue({ ...emptyResult, importedCount: 2 });
    const tree = await mount();

    expect(logMocks.logInfo).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });
  it('does not run before the data is ready or while it is disabled', async () => {
    const notReady = await mount({ dataReady: false });
    const disabled = await mount({ disabled: true });

    expect(importMocks.runAppleRemindersAutoImport).not.toHaveBeenCalled();
    act(() => { notReady.unmount(); disabled.unmount(); });
  });

  // A foreground burst (unlock, switcher, share sheet) fires several 'active'
  // events in a row; reading the Reminders store each time is wasted work.
  it('waits 30 seconds between runs', async () => {
    vi.useFakeTimers();
    const tree = await mount();
    expect(importMocks.runAppleRemindersAutoImport).toHaveBeenCalledOnce();

    await foreground();
    await foreground();
    expect(importMocks.runAppleRemindersAutoImport).toHaveBeenCalledOnce();

    await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
    await foreground();
    expect(importMocks.runAppleRemindersAutoImport).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  });

  it('never starts a second run while one is still in flight', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    importMocks.runAppleRemindersAutoImport.mockReturnValue(new Promise((resolve) => {
      release = () => resolve(null);
    }));
    const tree = await mount();
    expect(importMocks.runAppleRemindersAutoImport).toHaveBeenCalledOnce();

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await foreground();
    expect(importMocks.runAppleRemindersAutoImport).toHaveBeenCalledOnce();

    await act(async () => { release(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await foreground();
    expect(importMocks.runAppleRemindersAutoImport).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  });

  // The user did not ask for anything on this foreground: a failure is logged
  // and nothing else, and it must not wedge later runs.
  it('swallows an import failure without a toast and keeps running later', async () => {
    vi.useFakeTimers();
    importMocks.runAppleRemindersAutoImport.mockRejectedValueOnce(new Error('reminders unavailable'));
    const tree = await mount();

    expect(logMocks.logError).toHaveBeenCalledOnce();
    expect(showToast).not.toHaveBeenCalled();

    importMocks.runAppleRemindersAutoImport.mockResolvedValue({ ...emptyResult, importedCount: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
    await foreground();
    expect(importMocks.runAppleRemindersAutoImport).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  });

  it('never asks for the Reminders permission itself', async () => {
    const tree = await mount();
    await foreground();

    expect(importMocks.requestAppleRemindersPermission).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('stops listening once the screen goes away', async () => {
    const tree = await mount();
    act(() => tree.unmount());

    expect(appStateListeners.current).toHaveLength(0);
  });
});
