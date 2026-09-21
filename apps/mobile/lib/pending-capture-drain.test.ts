import { beforeEach, describe, expect, it, vi } from 'vitest';

const order = vi.hoisted(() => [] as string[]);
const noopStorage = vi.hoisted(() => ({ name: 'noop' }));
const mobileStorage = vi.hoisted(() => ({ name: 'mobile' }));

const core = vi.hoisted(() => {
  const state = {
    adapter: null as unknown,
    sandbox: false,
    store: {
      error: null as string | null,
      _allTasks: [],
      tasks: [], projects: [], areas: [], people: [], settings: {},
      addTask: vi.fn(), updateTask: vi.fn(), addProject: vi.fn(),
      fetchData: vi.fn(async () => { order.push('fetchData'); }),
    },
  };
  return {
    state,
    noopStorage: null as unknown,
    flushPendingSave: vi.fn(async () => { order.push('flush'); }),
    getStorageAdapter: vi.fn(() => state.adapter),
    setStorageAdapter: vi.fn((adapter: unknown) => { state.adapter = adapter; order.push('setStorageAdapter'); }),
    isSandboxMode: vi.fn(() => state.sandbox),
    isWorkspaceTransitionActive: vi.fn(() => false),
    useTaskStore: { getState: () => state.store },
  };
});
const reactNative = vi.hoisted(() => ({ AppState: { currentState: 'background' as string } }));
const fileSystem = vi.hoisted(() => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: vi.fn(async () => ({ exists: true })),
  readDirectoryAsync: vi.fn(async () => ['a.json'] as string[]),
}));
const ingest = vi.hoisted(() => ({
  ingestPendingCaptures: vi.fn(async (_deps: Record<string, unknown>) => { order.push('ingest'); return 1; }),
}));

vi.mock('react-native', () => reactNative);
vi.mock('@mindwtr/core', () => ({ ...core, noopStorage }));
vi.mock('./app-log', () => ({ logInfo: vi.fn() }));
vi.mock('./file-system', () => fileSystem);
vi.mock('./pending-capture-persistence', () => ({ flushPendingTaskActionSave: vi.fn() }));
vi.mock('./pending-captures', () => ({ ...ingest, PENDING_CAPTURES_DIRECTORY: 'pending-captures' }));
vi.mock('./storage-adapter', () => ({ mobileStorage }));

import { drainPendingCapturesInBackground } from './pending-capture-drain';

describe('background capture drain (#1257)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    core.state.adapter = noopStorage;
    core.state.sandbox = false;
    core.state.store.error = null;
    reactNative.AppState.currentState = 'background';
    fileSystem.readDirectoryAsync.mockResolvedValue(['a.json']);
  });

  it('connects storage and loads the store before the first write in a headless runtime', async () => {
    await expect(drainPendingCapturesInBackground('capture')).resolves.toBe(1);
    expect(core.setStorageAdapter).toHaveBeenCalledWith(mobileStorage);
    expect(order).toEqual(['setStorageAdapter', 'flush', 'fetchData', 'ingest']);
    expect(ingest.ingestPendingCaptures.mock.calls[0]?.[0]).not.toHaveProperty('transcribeAudio');
  });

  it('keeps the storage a live app already connected', async () => {
    core.state.adapter = mobileStorage;
    await drainPendingCapturesInBackground('scheduled');
    expect(core.setStorageAdapter).not.toHaveBeenCalled();
    expect(order).toEqual(['flush', 'fetchData', 'ingest']);
  });

  it('does no work for an empty queue', async () => {
    fileSystem.readDirectoryAsync.mockResolvedValue(['a.json.tmp']);
    await expect(drainPendingCapturesInBackground('scheduled')).resolves.toBe(0);
    expect(order).toEqual([]);
  });

  it.each([
    ['the app is visible', () => { reactNative.AppState.currentState = 'active'; }],
    ['the sandbox workspace is open', () => { core.state.sandbox = true; }],
  ])('leaves the queue alone when %s', async (_label, arrange) => {
    arrange();
    await expect(drainPendingCapturesInBackground('capture')).resolves.toBe(0);
    expect(ingest.ingestPendingCaptures).not.toHaveBeenCalled();
  });

  it('never writes into a store that failed to load', async () => {
    core.state.store.fetchData.mockImplementationOnce(async () => { core.state.store.error = 'load failed'; });
    await expect(drainPendingCapturesInBackground('capture')).resolves.toBe(0);
    expect(ingest.ingestPendingCaptures).not.toHaveBeenCalled();
  });
});
