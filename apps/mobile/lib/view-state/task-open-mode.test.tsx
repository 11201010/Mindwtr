import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  getItem: vi.fn<() => Promise<string | null>>(),
  setItem: vi.fn<(key: string, value: string) => Promise<void>>(),
}));

vi.mock('@/lib/workspace-session-storage', () => ({
  workspaceSessionStorage: storage,
}));

import {
  __resetTaskOpenModeStoreForTests,
  ensureTaskOpenModeHydrated,
  resolveTaskOpenTab,
  setTaskOpenMode,
  useTaskOpenMode,
} from './task-open-mode';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
};

const mounted: renderer.ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

describe('task open tab resolver', () => {
  it.each([
    ['automatic', 'task', false, false, 'task'],
    ['automatic', 'view', false, false, 'view'],
    ['preview', 'task', false, false, 'view'],
    ['preview', 'view', false, false, 'view'],
    ['edit', 'task', false, false, 'task'],
    ['edit', 'view', false, false, 'task'],
    ['preview', 'view', false, true, 'task'],
    ['automatic', 'view', false, true, 'task'],
    ['edit', 'task', true, true, 'view'],
    ['edit', 'view', true, false, 'view'],
  ] as const)(
    '%s with automatic %s, readOnly=%s, explicitEdit=%s resolves %s',
    (mode, automaticTab, readOnly, explicitEdit, expected) => {
      expect(resolveTaskOpenTab({ mode, automaticTab, readOnly, explicitEdit })).toBe(expected);
    },
  );
});

describe('task open mode store', () => {
  beforeEach(() => {
    __resetTaskOpenModeStoreForTests();
    storage.getItem.mockReset();
    storage.setItem.mockReset();
    storage.getItem.mockResolvedValue(null);
    storage.setItem.mockResolvedValue(undefined);
  });

  it.each([
    ['preview', 'preview'],
    ['edit', 'edit'],
    ['unknown', 'automatic'],
    [null, 'automatic'],
  ] as const)('hydrates persisted %s as %s', async (raw, expected) => {
    storage.getItem.mockResolvedValueOnce(raw);
    await ensureTaskOpenModeHydrated();

    let observed!: ReturnType<typeof useTaskOpenMode>;
    function Probe() {
      observed = useTaskOpenMode();
      return null;
    }
    act(() => { mounted.push(renderer.create(<Probe />)); });

    expect(observed).toEqual({ hydrated: true, mode: expected, setMode: expect.any(Function) });
  });

  it('treats storage failure as a nonfatal automatic preference', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(ensureTaskOpenModeHydrated()).resolves.toBeUndefined();

    let observed!: ReturnType<typeof useTaskOpenMode>;
    function Probe() {
      observed = useTaskOpenMode();
      return null;
    }
    act(() => { mounted.push(renderer.create(<Probe />)); });
    expect(observed.mode).toBe('automatic');
    expect(observed.hydrated).toBe(true);
  });

  it('does not let a pending load overwrite a user selection', async () => {
    const load = deferred<string | null>();
    storage.getItem.mockReturnValueOnce(load.promise);
    const hydration = ensureTaskOpenModeHydrated();

    setTaskOpenMode('edit');
    load.resolve('preview');
    await hydration;

    let observed!: ReturnType<typeof useTaskOpenMode>;
    function Probe() {
      observed = useTaskOpenMode();
      return null;
    }
    act(() => { mounted.push(renderer.create(<Probe />)); });
    expect(observed.mode).toBe('edit');
    expect(observed.hydrated).toBe(true);
  });

  it('serializes rapid selections so the final choice is persisted last', async () => {
    const firstWrite = deferred<void>();
    storage.setItem
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(undefined);

    setTaskOpenMode('preview');
    setTaskOpenMode('edit');
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(1));
    expect(storage.setItem.mock.calls[0]?.[1]).toBe('preview');

    firstWrite.resolve();
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(2));
    expect(storage.setItem.mock.calls[1]?.[1]).toBe('edit');
  });

  it('publishes one live value to every mounted consumer', () => {
    const observed: Array<ReturnType<typeof useTaskOpenMode>> = [];
    function Probe({ index }: { index: number }) {
      observed[index] = useTaskOpenMode();
      return null;
    }
    act(() => {
      mounted.push(renderer.create(<><Probe index={0} /><Probe index={1} /></>));
    });
    act(() => { setTaskOpenMode('preview'); });

    expect(observed[0]?.mode).toBe('preview');
    expect(observed[1]?.mode).toBe('preview');
  });
});
