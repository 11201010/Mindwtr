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

const importMocks = vi.hoisted(() => ({ runAppleRemindersAutoImport: vi.fn() }));
vi.mock('@/lib/apple-reminders-import', () => importMocks);

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

  it('logs the run once reminders were imported', async () => {
    importMocks.runAppleRemindersAutoImport.mockResolvedValue({ ...emptyResult, importedCount: 2 });
    const tree = await mount();

    expect(logMocks.logInfo).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });
});
