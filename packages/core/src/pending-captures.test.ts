import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainPendingCaptureQueue, type PendingCaptureDrainDeps, type PendingCaptureQueuePort } from './pending-captures';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Task } from './types';

// React Native's own tests (apps/mobile/lib/pending-captures.test.ts) replay every
// branch through the React Native binding. These drive core's drain over fake ports
// and a real store: what the native app's runner will call.

const CAPTURE_ID = '0b6f1c4e-7a3d-4c55-9e21-4f7a8a1d2c01';
const INTENT_ID = '5c2e9d10-3b4a-4f6e-8d7c-1a2b3c4d5e6f';
const AUDIO_ID = '22222222-2222-4abc-8def-222222222222';

const task = (id: string, props: Partial<Task> = {}): Task => ({
    id,
    title: `Task ${id}`,
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...props,
} as Task);

/** A queue directory in memory. `failDelete` names files whose next delete throws, as a kill before the delete would leave them. */
function fakeQueue(files: Record<string, unknown>) {
    const stored = new Map(Object.entries(files).map(([name, body]) => [name, typeof body === 'string' ? body : JSON.stringify(body)]));
    const failDelete = new Set<string>();
    const port: PendingCaptureQueuePort = {
        list: vi.fn(async () => [...stored.keys()]),
        read: vi.fn(async (name: string) => {
            const body = stored.get(name);
            if (body === undefined) throw new Error('missing file');
            return body;
        }),
        delete: vi.fn(async (name: string) => {
            if (failDelete.delete(name)) throw new Error('killed before the delete');
            stored.delete(name);
        }),
    };
    return { port, stored, failDelete };
}

// Each test's own storage, so a late save from an earlier test cannot land in it.
let saved: () => AppData;

async function openStore(tasks: Task[]) {
    await flushPendingSave();
    resetForTests();
    let persisted: AppData = { tasks, projects: [], sections: [], areas: [], people: [], settings: { deviceId: 'queue-test' } };
    saved = () => persisted;
    setStorageAdapter({
        getData: async () => structuredClone(persisted),
        saveData: async (data) => { persisted = structuredClone(data); },
    });
    useTaskStore.setState({
        _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
    } as never);
    await useTaskStore.getState().fetchData({ silent: true });
}

/** As after process death: the store forgets memory and loads what was saved. */
async function restartStore() {
    await flushPendingSave();
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [], settings: {} });
    await useTaskStore.getState().fetchData({ silent: true });
}

function storeDeps(queue: PendingCaptureQueuePort, extra: Partial<PendingCaptureDrainDeps> = {}): PendingCaptureDrainDeps {
    const { addTask, updateTask, addProject, projects, areas, tasks, people, settings } = useTaskStore.getState();
    return {
        addTask, updateTask, addProject, projects, areas, tasks, people, settings,
        getTasks: () => useTaskStore.getState()._allTasks,
        flushPendingSave,
        queue,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        ...extra,
    };
}

const storeData = () => {
    const state = useTaskStore.getState();
    return [state._allTasks, state._allProjects, state._allAreas, state._allPeople, state.settings];
};

afterEach(async () => {
    await flushPendingSave();
    resetForTests();
});

describe('drainPendingCaptureQueue', () => {
    const items = {
        [`${CAPTURE_ID}.json`]: { id: CAPTURE_ID, title: 'From the dialog', source: 'android-quick-capture' },
        [`${INTENT_ID}.json`]: { kind: 'text', id: INTENT_ID, title: 'Dictated #errands', source: 'android-capture-intent' },
        'c.json': { kind: 'complete', id: 'c1', taskId: 'open', completedAt: '2026-09-02T08:00:00.000Z', source: 'android-widget' },
        'd.json': { kind: 'defer', id: 'd1', taskId: 'later', startDate: '2026-09-20', source: 'apple-watch' },
    };

    it('stores each capture, text, check-off and defer once, and a replay of the same files writes nothing', async () => {
        await openStore([task('open'), task('later')]);
        const queue = fakeQueue(items);

        expect(await drainPendingCaptureQueue(storeDeps(queue.port))).toBe(4);

        const tasks = useTaskStore.getState()._allTasks;
        expect(tasks.filter((entry) => entry.id === CAPTURE_ID)).toMatchObject([{ title: 'From the dialog', status: 'inbox' }]);
        expect(tasks.filter((entry) => entry.id === INTENT_ID)).toMatchObject([{ title: 'Dictated', tags: ['#errands'], status: 'inbox' }]);
        expect(tasks.find((entry) => entry.id === 'open')).toMatchObject({ status: 'done', completedAt: '2026-09-02T08:00:00.000Z' });
        expect(tasks.find((entry) => entry.id === 'later')?.startTime).toBe('2026-09-20');
        expect(tasks).toHaveLength(4);
        expect(queue.stored.size).toBe(0);
        expect(saved().tasks).toHaveLength(4);

        // The same files again, as when the writer or a restore replays them.
        const replay = fakeQueue(items);
        const before = storeData();
        expect(await drainPendingCaptureQueue(storeDeps(replay.port))).toBe(4);
        expect(storeData()).toEqual(before);
        storeData().forEach((entry, index) => expect(entry).toBe(before[index]));
        expect(replay.stored.size).toBe(0);
    });

    it('does not duplicate a capture or repeat a check-off when the app died between the save and the delete', async () => {
        await openStore([task('open'), task('later')]);
        const queue = fakeQueue(items);
        for (const name of Object.keys(items)) queue.failDelete.add(name);

        expect(await drainPendingCaptureQueue(storeDeps(queue.port))).toBe(0);
        expect(queue.stored.size).toBe(4);
        expect(saved().tasks).toHaveLength(4);

        await restartStore();
        const before = storeData();
        expect(await drainPendingCaptureQueue(storeDeps(queue.port))).toBe(4);

        storeData().forEach((entry, index) => expect(entry).toBe(before[index]));
        const tasks = useTaskStore.getState()._allTasks;
        expect(tasks.filter((entry) => entry.id === CAPTURE_ID)).toHaveLength(1);
        expect(tasks.filter((entry) => entry.id === INTENT_ID)).toHaveLength(1);
        expect(tasks).toHaveLength(4);
        expect(queue.stored.size).toBe(0);
    });

    it('keeps a file whose save did not become durable, and drains it once the save recovers', async () => {
        await openStore([]);
        const queue = fakeQueue({ [`${CAPTURE_ID}.json`]: items[`${CAPTURE_ID}.json`] });
        const failingFlush = vi.fn(async () => { throw new Error('disk full'); });

        expect(await drainPendingCaptureQueue(storeDeps(queue.port, { flushPendingSave: failingFlush }))).toBe(0);
        expect(queue.stored.size).toBe(1);
        expect(queue.port.delete).not.toHaveBeenCalled();

        expect(await drainPendingCaptureQueue(storeDeps(queue.port))).toBe(1);
        expect(useTaskStore.getState()._allTasks.filter((entry) => entry.id === CAPTURE_ID)).toHaveLength(1);
        expect(queue.stored.size).toBe(0);
    });

    it('leaves audio and Pomodoro items in the queue untouched without their host ports', async () => {
        await openStore([task('open')]);
        const queue = fakeQueue({
            [`${AUDIO_ID}.json`]: {
                kind: 'audio', id: AUDIO_ID, source: 'android-quick-capture',
                audioPath: `file:///data/files/quick-capture-audio/${AUDIO_ID}.wav`,
            },
            // An audio item whose path a host would refuse is kept too: only the host can judge it.
            'bad-audio.json': { kind: 'audio', id: 'not-a-uuid', audioPath: 'file:///etc/passwd', source: 'android-quick-capture' },
            'timer.json': { kind: 'pomodoro', id: 'p1', action: 'start', taskId: 'open', source: 'apple-watch' },
            'z.json': { id: 'shortcut-1', title: 'Still drained' },
        });
        const before = useTaskStore.getState()._allTasks;

        expect(await drainPendingCaptureQueue(storeDeps(queue.port))).toBe(1);

        expect([...queue.stored.keys()].sort()).toEqual([`${AUDIO_ID}.json`, 'bad-audio.json', 'timer.json']);
        expect(queue.port.delete).toHaveBeenCalledTimes(1);
        expect(queue.port.delete).toHaveBeenCalledWith('z.json');
        const added = useTaskStore.getState()._allTasks.filter((entry) => !before.includes(entry));
        expect(added.map((entry) => entry.title)).toEqual(['Still drained']);
    });

    it('reads nothing when the queue directory does not exist, and logs a list failure without throwing', async () => {
        await openStore([]);
        const missing: PendingCaptureQueuePort = { list: vi.fn(async () => null), read: vi.fn(), delete: vi.fn() };
        expect(await drainPendingCaptureQueue(storeDeps(missing))).toBe(0);
        expect(missing.read).not.toHaveBeenCalled();

        const broken: PendingCaptureQueuePort = { list: vi.fn(async () => { throw new Error('io'); }), read: vi.fn(), delete: vi.fn() };
        const deps = storeDeps(broken);
        expect(await drainPendingCaptureQueue(deps)).toBe(0);
        expect(deps.log.error).toHaveBeenCalledWith(expect.any(Error), { scope: 'shortcuts', extra: { message: 'Failed to read pending captures' } });
    });
});
