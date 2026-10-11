import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consoleLogger, sanitizeLogContext, setLogger, type LogPayload } from './logger';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import { taskRevisionOf } from './native-request-receipts';
import { openSqliteHost } from './screen-parity.replay';
import { planTaskUpdateEffects } from './store-tasks';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Task } from './types';

const marker = 'v1.3.5/start-only-recurrence';
const clock = '2026-10-11T15:00:00.000Z';
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
    id, title: 'Private recurring title', notes: 'Private notes', status: 'next',
    startTime: '2026-01-01', recurrence: { rule: 'daily', strategy: 'strict' },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    tags: [], contexts: [], rev: 1, revBy: 'device-a', ...overrides,
});
const value = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

describe('start-only recurrence completion diagnostic', () => {
    let logs: LogPayload[];
    let saved: AppData;
    const receipts = () => logs.filter((entry) => entry.context?.releaseCheck === marker);

    beforeEach(() => {
        resetForTests();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(clock));
        logs = [];
        setLogger((payload) => logs.push(payload));
        saved = { tasks: [], projects: [], areas: [], sections: [], people: [],
            settings: { deviceId: 'device-a', diagnostics: { loggingEnabled: true } } };
        setStorageAdapter({ getData: async () => structuredClone(saved),
            saveData: async (next) => { saved = structuredClone(next); } });
        useTaskStore.setState({ _allTasks: [], _allProjects: [], _allAreas: [], _allSections: [], _allPeople: [],
            settings: saved.settings, persistenceFailure: null, error: null, isLoading: false,
            editLockCount: 0, lastDataChangeAt: 0 });
    });

    afterEach(async () => {
        setLogger(consoleLogger);
        await flushPendingSave();
        resetForTests();
        vi.useRealTimers();
    });

    const load = async (tasks: Task[]) => {
        saved.tasks = tasks;
        await useTaskStore.getState().fetchData({ throwOnError: true });
        await flushPendingSave();
        logs.length = 0;
    };

    it('logs the actual completion without content, identifiers, dates, or a durable claim', async () => {
        await load([task('private-id')]);
        await expect(useTaskStore.getState().moveTask('private-id', 'done')).resolves.toEqual({ success: true });
        expect(receipts()).toEqual([{ level: 'info', message: 'Strict start-only recurrence generated',
            scope: 'store', category: 'storage',
            context: { releaseCheck: marker, outcome: 'generated', count: 1 } }]);
        expect(sanitizeLogContext(receipts()[0].context)).toEqual({ releaseCheck: marker, outcome: 'generated', count: '1' });
        const generated = useTaskStore.getState()._allTasks.find((row) => row.id !== 'private-id')!;
        expect(generated.startTime).toBe('2026-10-11');
        expect(generated.dueDate).toBeUndefined();
        await flushPendingSave();
        expect(saved.tasks).toHaveLength(2);
        await useTaskStore.getState().moveTask('private-id', 'done');
        expect(receipts()).toHaveLength(1);
    });

    it('reports one aggregate line for a real bulk completion', async () => {
        await load([task('first'), task('second')]);
        await useTaskStore.getState().batchMoveTasks(['first', 'second'], 'done');
        expect(receipts()).toHaveLength(1);
        expect(receipts()[0].context).toEqual({ releaseCheck: marker, outcome: 'generated', count: 2 });
        await flushPendingSave();
        expect(saved.tasks).toHaveLength(4);
    });

    it.each([
        ['future start', { startTime: '2027-01-01' }],
        ['fluid', { recurrence: { rule: 'daily', strategy: 'fluid' } }],
        ['has due', { dueDate: '2026-01-02' }],
        ['no recurrence', { recurrence: undefined }],
        ['expired count', { recurrence: { rule: 'daily', strategy: 'strict', count: 1 } }],
    ] as Array<[string, Partial<Task>]>)('keeps %s completions quiet', async (_label, overrides) => {
        await load([task('control', overrides)]);
        await useTaskStore.getState().moveTask('control', 'done');
        expect(receipts()).toEqual([]);
    });

    it('does not log projections or prepared previews, and logs the prepared commit only once', async () => {
        await load([task('prepared')]);
        const source = useTaskStore.getState()._tasksById.get('prepared')!;
        planTaskUpdateEffects({ task: source, preparedUpdates: { status: 'done' },
            allTasks: [source], allProjects: [], allSections: [], now: clock, deviceId: 'device-a' });
        const host = createNativeHostContract();
        value(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' }));
        value(await host.activate({ writeSafetyReady: true }));
        const request = { id: source.id, requestId: '00000000-0000-4000-8000-000000000401',
            taskRevision: value(host.getTaskView({ id: source.id })).taskRevision };
        const prepared = value(host.prepareTaskCompletion(request)).prepared;
        value(host.validatePreparedTaskCompletion({ request, prepared }));
        expect(receipts()).toEqual([]);
        value(await host.commitPreparedTaskCompletion({ request, prepared }));
        expect(receipts()).toHaveLength(1);
        value(await host.commitPreparedTaskCompletion({ request, prepared }));
        expect(receipts()).toHaveLength(1);
        expect(saved.tasks).toHaveLength(2);
    });

    it('still queues and saves the completion when the optional diagnostic sink throws', async () => {
        await load([task('throwing-sink')]);
        setLogger((payload) => { if (payload.context?.releaseCheck === marker) throw new Error('diagnostic sink unavailable'); });
        await expect(useTaskStore.getState().moveTask('throwing-sink', 'done')).resolves.toEqual({ success: true });
        await flushPendingSave();
        expect(saved.tasks).toHaveLength(2);
        expect(saved.tasks[0].status).toBe('done');
    });

    it('logs a real Process Inbox completion once and keeps its preview and replay quiet', async () => {
        await load([task('processed', { status: 'someday', reviewAt: '2026-10-11' })]);
        const host = createNativeHostContract();
        value(await host.activate({ writeSafetyReady: true }));
        const started = value(host.startInboxProcessing());
        if (!started.view) throw new Error('Missing Inbox task');
        const base = { sessionId: started.sessionId!, taskId: started.view.taskId };
        const flow = value(host.inboxCommitPrepare({ ...base, step: started.view.step,
            decision: { choice: 'actionable' }, requestId: '00000000-0000-4000-8000-000000000411' }));
        if (flow.kind !== 'flow' || !flow.result.view) throw new Error('Missing done step');
        const request = { ...base, step: flow.result.view.step, decision: { choice: 'done' },
            requestId: '00000000-0000-4000-8000-000000000412' };
        const prepared = value(host.inboxCommitPrepare(request));
        if (prepared.kind !== 'prepared') throw new Error('Missing completion effect');
        const envelope = { request, prepared: prepared.prepared };
        value(host.inboxPreparedValidate(envelope));
        expect(receipts()).toEqual([]);
        value(await host.inboxPreparedCommit(envelope));
        expect(receipts().map((entry) => entry.context)).toEqual([{ releaseCheck: marker, outcome: 'generated', count: 1 }]);
        value(await host.inboxPreparedCommit(envelope));
        expect(receipts()).toHaveLength(1);
        expect(saved.tasks).toHaveLength(2);
    });

    it('logs a real raw Reference bulk completion once and keeps preview and durable replay quiet', async () => {
        const sqlite = await openSqliteHost({ ...saved, tasks: [task('reference', { status: 'reference' })] },
            undefined, undefined, { rejectConcurrentWrites: true });
        try {
            const request = { requestId: '00000000-0000-4000-8000-000000000413', taskIds: ['reference'],
                taskRevisions: { reference: taskRevisionOf(useTaskStore.getState()._tasksById.get('reference')!) },
                status: 'done' as const, params: {} };
            const prepared = value(await sqlite.host.prepareReferenceTasksMove(request)).prepared;
            const envelope = { request, prepared };
            value(sqlite.host.validatePreparedReferenceTasksMove(envelope));
            expect(receipts()).toEqual([]);
            value(await sqlite.host.commitPreparedReferenceTasksMove(envelope));
            expect(receipts().map((entry) => entry.context)).toEqual([{ releaseCheck: marker, outcome: 'generated', count: 1 }]);
            value(await sqlite.host.commitPreparedReferenceTasksMove(envelope));
            expect(receipts()).toHaveLength(1);
            expect(await sqlite.receiptIds()).toEqual([request.requestId]);
            expect(useTaskStore.getState()._allTasks).toHaveLength(2);
        } finally { await sqlite.close(); }
    });
});
