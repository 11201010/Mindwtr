import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPendingSave, setStorageAdapter, useTaskStore } from '@mindwtr/core';
import type { AppData, StorageAdapter } from '@mindwtr/core';

function getTauriMocks() {
    const globalObject = globalThis as typeof globalThis & {
        __localWatcherInvokeMock?: ReturnType<typeof vi.fn>;
    };
    if (!globalObject.__localWatcherInvokeMock) {
        globalObject.__localWatcherInvokeMock = vi.fn();
    }
    return {
        invokeMock: globalObject.__localWatcherInvokeMock,
    };
}

vi.mock('@tauri-apps/api/core', () => ({
    invoke: getTauriMocks().invokeMock,
}));

import { __localDataWatcherTestUtils, markLocalWrite } from './local-data-watcher';

let nowMs = 0;
let externalData: AppData;
let saveCalls: AppData[] = [];
let timerId = 1;
const scheduledTimers = new Map<number, () => void>();

const scheduleMock = ((callback: TimerHandler) => {
    const id = timerId++;
    const fn = typeof callback === 'function' ? callback : () => undefined;
    scheduledTimers.set(id, fn as () => void);
    return id as unknown as ReturnType<typeof setTimeout>;
}) as unknown as typeof setTimeout;

const cancelScheduleMock = ((id: ReturnType<typeof setTimeout>) => {
    scheduledTimers.delete(id as unknown as number);
}) as unknown as typeof clearTimeout;

const flushScheduledTimers = async () => {
    let guard = 0;
    let idleRounds = 0;
    while (guard < 50 && idleRounds < 5) {
        guard += 1;
        if (scheduledTimers.size === 0) {
            idleRounds += 1;
            await Promise.resolve();
            continue;
        }
        idleRounds = 0;
        const callbacks = Array.from(scheduledTimers.entries());
        scheduledTimers.clear();
        callbacks.forEach(([, callback]) => callback());
        await Promise.resolve();
    }
};

const emptyData = (): AppData => ({
    tasks: [],
    projects: [],
    sections: [],
    areas: [],
    settings: { deviceId: 'dev-local' },
});

const storageAdapter: StorageAdapter = {
    getData: async () => emptyData(),
    saveData: async (data) => {
        saveCalls.push(data);
    },
    queryTasks: async () => [],
    searchAll: async () => ({ tasks: [], projects: [] }),
};

beforeEach(() => {
    const { invokeMock } = getTauriMocks();
    invokeMock.mockReset();

    nowMs = 0;
    timerId = 1;
    scheduledTimers.clear();
    saveCalls = [];
    externalData = emptyData();

    setStorageAdapter(storageAdapter);

    useTaskStore.setState((state) => ({
        ...state,
        tasks: [],
        projects: [],
        sections: [],
        areas: [],
        _allTasks: [],
        _allProjects: [],
        _allSections: [],
        _allAreas: [],
        settings: { deviceId: 'dev-local' },
        lastDataChangeAt: 0,
        error: null,
    }));

    __localDataWatcherTestUtils.resetForTests();
    __localDataWatcherTestUtils.setDependenciesForTests({
        now: () => nowMs,
        readDataJson: async () => externalData,
        schedule: scheduleMock,
        cancelSchedule: cancelScheduleMock,
        hashPayload: async (payload) => payload,
        logInfo: () => undefined,
        logWarn: () => undefined,
    });
});

afterEach(async () => {
    __localDataWatcherTestUtils.resetForTests();
    scheduledTimers.clear();
    await flushPendingSave();
});

describe('local-data-watcher', () => {
    it('re-reads external writes that happen during ignore window', async () => {
        externalData = {
            ...emptyData(),
            tasks: [
                {
                    id: 'ext-1',
                    title: 'From CLI',
                    status: 'inbox',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        } as AppData;

        markLocalWrite();

        nowMs = 1000;
        await __localDataWatcherTestUtils.triggerChangeForTests();
        expect(saveCalls).toHaveLength(0);

        nowMs = 2200;
        await flushScheduledTimers();

        expect(saveCalls).toHaveLength(1);
        expect(saveCalls[0]?.tasks.some((task) => task.id === 'ext-1')).toBe(true);
    });

    it('persists merged changes through store save queue (without direct tauri save_data calls)', async () => {
        externalData = {
            ...emptyData(),
            tasks: [
                {
                    id: 'ext-2',
                    title: 'Merged task',
                    status: 'next',
                    createdAt: '2026-01-02T00:00:00.000Z',
                    updatedAt: '2026-01-02T00:00:00.000Z',
                },
            ],
        } as AppData;

        await __localDataWatcherTestUtils.triggerChangeForTests();
        await flushScheduledTimers();

        const { invokeMock } = getTauriMocks();
        expect(invokeMock.mock.calls.some(([command]) => command === 'save_data')).toBe(false);
        expect(saveCalls).toHaveLength(1);
        expect(saveCalls[0]?.tasks.some((task) => task.id === 'ext-2')).toBe(true);
    });
});
