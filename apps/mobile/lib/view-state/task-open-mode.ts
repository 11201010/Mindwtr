import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { isSandboxMode } from '@mindwtr/core';

import { workspaceSessionStorage } from '@/lib/workspace-session-storage';

export const TASK_OPEN_MODE_STORAGE_KEY = 'mindwtr:view:taskOpenMode:v1';

export const TASK_OPEN_MODES = ['automatic', 'preview', 'edit'] as const;
export type TaskOpenMode = typeof TASK_OPEN_MODES[number];
export type TaskOpenTab = 'task' | 'view';

type TaskOpenModeSnapshot = {
  hydrated: boolean;
  mode: TaskOpenMode;
};

type ScopedTaskOpenModeState = {
  hydration: Promise<void> | null;
  persistence: Promise<void>;
  revision: number;
  snapshot: TaskOpenModeSnapshot;
};

const createScopedState = (): ScopedTaskOpenModeState => ({
  hydration: null,
  persistence: Promise.resolve(),
  revision: 0,
  snapshot: { hydrated: false, mode: 'automatic' },
});

const scopedStates = new Map<'personal' | 'sandbox', ScopedTaskOpenModeState>();
const listeners = new Set<() => void>();
let resetEpoch = 0;

const getScope = (): 'personal' | 'sandbox' => (isSandboxMode() ? 'sandbox' : 'personal');

const getScopedState = (): ScopedTaskOpenModeState => {
  const scope = getScope();
  const existing = scopedStates.get(scope);
  if (existing) return existing;
  const created = createScopedState();
  scopedStates.set(scope, created);
  return created;
};

const publish = (state: ScopedTaskOpenModeState, snapshot: TaskOpenModeSnapshot) => {
  state.snapshot = snapshot;
  listeners.forEach((listener) => listener());
};

export function readTaskOpenMode(raw: string | null): TaskOpenMode {
  return TASK_OPEN_MODES.includes(raw as TaskOpenMode)
    ? raw as TaskOpenMode
    : 'automatic';
}

export function resolveTaskOpenTab({
  mode,
  automaticTab,
  explicitEdit = false,
  readOnly = false,
}: {
  mode: TaskOpenMode;
  automaticTab: TaskOpenTab;
  explicitEdit?: boolean;
  readOnly?: boolean;
}): TaskOpenTab {
  if (readOnly) return 'view';
  if (explicitEdit) return 'task';
  if (mode === 'preview') return 'view';
  if (mode === 'edit') return 'task';
  return automaticTab;
}

export async function ensureTaskOpenModeHydrated(): Promise<void> {
  const state = getScopedState();
  if (state.snapshot.hydrated) return;
  if (state.hydration) return state.hydration;

  const revisionAtStart = state.revision;
  const epochAtStart = resetEpoch;
  state.hydration = workspaceSessionStorage.getItem(TASK_OPEN_MODE_STORAGE_KEY)
    .then((raw) => {
      if (epochAtStart !== resetEpoch) return;
      const mode = state.revision === revisionAtStart
        ? readTaskOpenMode(raw)
        : state.snapshot.mode;
      publish(state, { hydrated: true, mode });
    })
    .catch(() => {
      if (epochAtStart !== resetEpoch) return;
      publish(state, { hydrated: true, mode: state.snapshot.mode });
    })
    .finally(() => {
      if (epochAtStart === resetEpoch) state.hydration = null;
    });
  return state.hydration;
}

export function setTaskOpenMode(mode: TaskOpenMode): void {
  const state = getScopedState();
  state.revision += 1;
  publish(state, { hydrated: true, mode });

  // Serialize writes so a slow earlier selection can never land after the
  // user's final choice. A failed write is deliberately nonfatal and does not
  // block later selections from reaching storage.
  state.persistence = state.persistence
    .catch(() => undefined)
    .then(() => workspaceSessionStorage.setItem(TASK_OPEN_MODE_STORAGE_KEY, mode))
    .catch(() => undefined);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => getScopedState().snapshot;

export function useTaskOpenMode(): TaskOpenModeSnapshot & { setMode: (mode: TaskOpenMode) => void } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void ensureTaskOpenModeHydrated();
  }, []);
  const setMode = useCallback((mode: TaskOpenMode) => setTaskOpenMode(mode), []);
  return { ...snapshot, setMode };
}

/** Clears module state between isolated store tests. */
export function __resetTaskOpenModeStoreForTests(): void {
  resetEpoch += 1;
  scopedStates.clear();
  listeners.forEach((listener) => listener());
}
