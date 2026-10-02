import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createNativeHostContract } from './native-host-contract';
import { archiveRestoreEffect } from './native-host-contract-archive-task-restore';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { NativeReceiptSqliteAdapter, loadNativeRequestReceipts, resetNativeRequestReceipts,
    taskRevisionOf } from './native-request-receipts';
import type { SqliteClient } from './sqlite-adapter';
import type { AppData, Project, Section, Task } from './types';

const AT = '2026-09-30T12:00:00.000Z';
const NOW = '2026-10-02T12:00:00.000Z';
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id,
    status: 'archived', archivedAt: AT, completedAt: AT, description: 'Full retained note',
    recurrence: { rule: 'daily', strategy: 'strict', seriesId: id },
    checklist: [{ id: 'item', title: 'Keep', isCompleted: true }],
    tags: ['#keep'], contexts: ['@home'], createdAt: AT, updatedAt: AT,
    rev: 7, revBy: 'first-device', ...extra });
const project = (): Project => ({ id: 'project', title: 'Archived parent', status: 'archived',
    color: '#123456', order: 1, tagIds: [], archivedAt: AT, createdAt: AT, updatedAt: AT,
    rev: 3, revBy: 'first-device' });
const section = (): Section => ({ id: 'section', projectId: 'project', title: 'Section', order: 1,
    createdAt: AT, updatedAt: AT, deletedAt: AT, projectArchivedAt: AT,
    rev: 2, revBy: 'first-device' });
const seed = (parent = false): AppData => ({
    tasks: [task('source', parent ? { projectId: 'project', sectionId: 'section',
        projectArchivedAt: AT, statusBeforeProjectArchive: 'next' } : {}),
    task('cancelled', { cancelledAt: AT, completedAt: undefined }),
    task('survivor', { status: 'next', archivedAt: undefined, completedAt: undefined }),
    ...(parent ? [task('sibling', { projectId: 'project', sectionId: 'section',
        status: 'done', archivedAt: undefined, projectArchivedAt: AT,
        statusBeforeProjectArchive: 'waiting' })] : [])],
    projects: parent ? [project()] : [], sections: parent ? [section()] : [],
    areas: [], people: [], settings: { deviceId: 'restore-device' },
});

async function open(initial: AppData) {
    await flushPendingSave(); resetForTests(); resetNativeRequestReceipts();
    let durable = copy(initial);
    setStorageAdapter({ getData: async () => copy(durable), saveData: async (value) => { durable = copy(value); } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    const host = createNativeHostContract();
    expect(await host.activate({ writeSafetyReady: true, recoveryLoad: true })).toMatchObject({ ok: true });
    await flushPendingSave();
    return { host, data: () => copy(durable) };
}

afterEach(async () => { await flushPendingSave(); resetForTests(); resetNativeRequestReceipts(); vi.useRealTimers(); });

describe('native archived Task Restore', () => {
    const request = (row: Task, requestId = '2f60ec3e-5024-4c24-90ec-4bb2be943fa1') =>
        ({ requestId, taskId: row.id, taskRevision: taskRevisionOf(row) });
    it.each([{ parent: false, id: 'source' }, { parent: false, id: 'cancelled' },
        { parent: true, id: 'source' }])('matches RN updateTask for $id with archived parent=$parent', async ({ parent, id }) => {
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
        const input = seed(parent);
        const rn = await open(input);
        expect(await useTaskStore.getState().updateTask(id, { status: 'inbox' })).toMatchObject({ success: true });
        await flushPendingSave();
        const expected = rn.data();
        const native = await open(input);
        const source = native.data().tasks.find((row) => row.id === id)!;
        const inputRequest = request(source);
        const plan = await native.host.prepareArchivedTaskRestore(inputRequest);
        if (!plan.ok) throw new Error(JSON.stringify(plan));
        expect(plan.value.kind).toBe('prepared');
        const envelope = { request: inputRequest, prepared: plan.value.prepared };
        expect(native.host.validatePreparedArchivedTaskRestore(envelope))
            .toMatchObject({ ok: true, value: { id, status: 'inbox' } });
        expect(await native.host.commitPreparedArchivedTaskRestore(envelope))
            .toMatchObject({ ok: true, value: { id, status: 'inbox' } });
        expect(native.data()).toEqual(expected);
    });

    it('rejects malformed, stale, live and deleted row requests before any write', async () => {
        const env = await open(seed());
        const source = env.data().tasks[0];
        const valid = request(source);
        const before = env.data();
        for (const invalid of [{ ...valid, requestId: 'bad' }, { ...valid, taskId: ' ' },
            { ...valid, taskRevision: '' }, { ...valid, taskId: 'x'.repeat(501) },
            { ...valid, extra: true }]) {
            expect(await env.host.prepareArchivedTaskRestore(invalid as never))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        expect(await env.host.prepareArchivedTaskRestore({ ...valid, taskRevision: 'stale' }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await env.host.prepareArchivedTaskRestore(request(env.data().tasks[2])))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await env.host.prepareArchivedTaskRestore({ ...valid, taskId: 'missing' }))
            .toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
        expect(env.data()).toEqual(before);
    });

    it('rejects forged effects, stale owned sibling and another UUID with identical after rows', async () => {
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
        const env = await open(seed(true));
        const source = env.data().tasks[0];
        const first = request(source);
        const second = request(source, '4f60ec3e-5024-4c24-90ec-4bb2be943fa1');
        const firstPlan = await env.host.prepareArchivedTaskRestore(first);
        const secondPlan = await env.host.prepareArchivedTaskRestore(second);
        if (!firstPlan.ok || !secondPlan.ok) throw new Error('prepare failed');
        const envelope = { request: first, prepared: firstPlan.value.prepared };
        const forged = copy(envelope);
        forged.prepared.effect.tasks[0].after.description = 'forged';
        expect(env.host.validatePreparedArchivedTaskRestore(forged))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await env.host.commitPreparedArchivedTaskRestore(forged))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const malformedParent = copy(envelope);
        malformedParent.prepared.scope.parentProject!.archivedAt = 'not-an-ISO-datetime';
        malformedParent.prepared.effect = archiveRestoreEffect(malformedParent.prepared.scope,
            malformedParent.prepared.deviceIdBefore!, malformedParent.prepared.updateAt,
            malformedParent.prepared.futureBoundary,
            new Map(malformedParent.prepared.dates.map((row) => [row.value, row])))!;
        expect(env.host.validatePreparedArchivedTaskRestore(malformedParent))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await env.host.commitPreparedArchivedTaskRestore(envelope)).toMatchObject({ ok: true });
        const committed = env.data();
        expect(await env.host.commitPreparedArchivedTaskRestore({ request: second, prepared: secondPlan.value.prepared }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(env.data()).toEqual(committed);
        expect(env.host.archivedTaskRestoreOutcome(envelope))
            .toMatchObject({ ok: true, value: { id: source.id, status: 'inbox' } });
        expect(env.host.archivedTaskRestoreOutcome({ request: second, prepared: secondPlan.value.prepared }))
            .toMatchObject({ ok: true, value: null });
    });

    it('refuses an edited sibling in an archived parent before mutating any row', async () => {
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
        const env = await open(seed(true));
        const source = env.data().tasks[0];
        const inputRequest = request(source);
        const planned = await env.host.prepareArchivedTaskRestore(inputRequest);
        if (!planned.ok) throw new Error(JSON.stringify(planned));
        const current = useTaskStore.getState();
        useTaskStore.setState({ _allTasks: current._allTasks.map((row) => row.id === 'sibling'
            ? { ...row, description: 'Later content', rev: 8, revBy: 'other-device', updatedAt: NOW }
            : row) });
        await useTaskStore.getState().persistSnapshot();
        await flushPendingSave();
        const changed = env.data();
        expect(await env.host.commitPreparedArchivedTaskRestore({ request: inputRequest, prepared: planned.value.prepared }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(env.data()).toEqual(changed);
    });

    it('matches RN when a legacy Section-only archived Task implicitly reactivates its parent', async () => {
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
        const input = seed(true);
        input.tasks[0].projectId = undefined;
        input.sections[0].deletedAt = undefined;
        input.sections[0].projectArchivedAt = undefined;
        input.sections.push({ ...section(), id: 'other-section', title: 'Other section' });
        input.tasks.push(task('other-sibling', { projectId: 'project', sectionId: 'other-section',
            status: 'done', archivedAt: undefined, projectArchivedAt: AT,
            statusBeforeProjectArchive: 'waiting' }));
        const rn = await open(input);
        expect(await useTaskStore.getState().updateTask('source', { status: 'inbox' }))
            .toMatchObject({ success: true });
        await flushPendingSave();
        const expected = rn.data();
        const native = await open(input);
        const inputRequest = request(native.data().tasks[0]);
        const plan = await native.host.prepareArchivedTaskRestore(inputRequest);
        if (!plan.ok) throw new Error(JSON.stringify(plan));
        expect(plan.value.prepared.scope.parentTasks.map((row) => row.id)).toContain('other-sibling');
        expect(plan.value.prepared.scope.parentSections.map((row) => row.id)).toContain('other-section');
        expect(await native.host.commitPreparedArchivedTaskRestore({ request: inputRequest, prepared: plan.value.prepared }))
            .toMatchObject({ ok: true });
        expect(native.data()).toEqual(expected);
    });

    it('validates and replays a future-start restore across a different local day and timezone', async () => {
        const originalTZ = process.env.TZ;
        try {
            process.env.TZ = 'America/New_York';
            vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
            const input = seed(); input.tasks[0].startTime = '2026-10-03';
            const env = await open(input);
            const inputRequest = request(env.data().tasks[0]);
            const plan = await env.host.prepareArchivedTaskRestore(inputRequest);
            if (!plan.ok) throw new Error(JSON.stringify(plan));
            const envelope = { request: inputRequest, prepared: plan.value.prepared };
            expect(plan.value.prepared.effect.tasks.find((pair) => pair.before.id === 'source')?.after.isFocusedToday)
                .toBe(false);
            process.env.TZ = 'Pacific/Honolulu';
            vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
            expect(env.host.validatePreparedArchivedTaskRestore(envelope)).toMatchObject({ ok: true });
            expect(await env.host.commitPreparedArchivedTaskRestore(envelope)).toMatchObject({ ok: true });
            expect(env.data().tasks.find((row) => row.id === 'source')?.startTime).toBe('2026-10-03');
        } finally {
            if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ;
        }
    });

    it.each(['missing', 'deleted'] as const)('matches RN clearing a %s Area on a Project Task restore', async (areaState) => {
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
        const input = seed(true);
        input.projects[0].status = 'active'; input.projects[0].archivedAt = undefined;
        input.sections[0].deletedAt = undefined; input.sections[0].projectArchivedAt = undefined;
        input.tasks[0].areaId = 'old-area';
        if (areaState === 'deleted') input.areas.push({ id: 'old-area', name: 'Old', order: 1,
            createdAt: AT, updatedAt: AT, deletedAt: AT });
        const rn = await open(input);
        expect(await useTaskStore.getState().updateTask('source', { status: 'inbox' }))
            .toMatchObject({ success: true });
        await flushPendingSave();
        const expected = rn.data();
        const native = await open(input);
        const inputRequest = request(native.data().tasks[0]);
        const plan = await native.host.prepareArchivedTaskRestore(inputRequest);
        if (!plan.ok) throw new Error(JSON.stringify(plan));
        expect(await native.host.commitPreparedArchivedTaskRestore({ request: inputRequest, prepared: plan.value.prepared }))
            .toMatchObject({ ok: true });
        expect(native.data()).toEqual(expected);
    });
});

const require = createRequire(import.meta.url);
type Statement = { run: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown };
type Database = { exec: (sql: string) => void; prepare: (sql: string) => Statement; close: () => void };
const DatabaseSync = (require('node:sqlite') as { DatabaseSync: new (path: string) => Database }).DatabaseSync;
const sqliteRoot = join(process.cwd(), '../../.orchestrator/tmp');
mkdirSync(sqliteRoot, { recursive: true });

describe('archived Task Restore durable SQLite receipt', () => {
    const databases: Database[] = [];
    const directories: string[] = [];
    async function openSqlite(path: string, initial?: AppData) {
        await flushPendingSave(); resetForTests(); resetNativeRequestReceipts();
        const db = new DatabaseSync(path); databases.push(db);
        const fault = { commits: 0 };
        const client: SqliteClient = {
            run: async (sql, params = []) => {
                if (sql === 'COMMIT' && fault.commits > 0) { fault.commits -= 1; throw new Error('injected COMMIT failure'); }
                db.prepare(sql).run(...params);
            },
            all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params) as T[],
            get: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).get(...params) as T | undefined,
            exec: async (sql) => { db.exec(sql); },
        };
        if (initial) await new NativeReceiptSqliteAdapter(client).saveData(initial);
        const adapter = new NativeReceiptSqliteAdapter(client, { rejectConcurrentWrites: true });
        await loadNativeRequestReceipts(client, { durableCommands: ['archivedTaskRestore'] });
        setStorageAdapter(adapter);
        useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
        await useTaskStore.getState().fetchData({ throwOnError: true });
        await flushPendingSave();
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true, recoveryLoad: true })).toMatchObject({ ok: true });
        await flushPendingSave();
        return { db, host, fault };
    }
    afterEach(async () => {
        await flushPendingSave(); resetForTests(); resetNativeRequestReceipts();
        for (const db of databases.splice(0)) db.close();
        for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
        vi.useRealTimers();
    });

    it('cold-retries failed COMMIT and later acknowledges only the exact saved UUID/envelope', async () => {
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
        const directory = mkdtempSync(join(sqliteRoot, 'archive-task-')); directories.push(directory);
        const path = join(directory, 'data.sqlite');
        const first = await openSqlite(path, seed(true));
        const source = useTaskStore.getState()._tasksById.get('source')!;
        const request = { requestId: '6f60ec3e-5024-4c24-90ec-4bb2be943fa1', taskId: source.id,
            taskRevision: taskRevisionOf(source) };
        const alternate = { ...request, requestId: '7f60ec3e-5024-4c24-90ec-4bb2be943fa1' };
        const firstPlan = await first.host.prepareArchivedTaskRestore(request);
        const alternatePlan = await first.host.prepareArchivedTaskRestore(alternate);
        if (!firstPlan.ok || !alternatePlan.ok) throw new Error('prepare failed');
        const envelope = { request, prepared: firstPlan.value.prepared };
        const otherEnvelope = { request: alternate, prepared: alternatePlan.value.prepared };
        const before = first.db.prepare('SELECT * FROM tasks ORDER BY id').all();
        first.fault.commits = 10;
        expect(await first.host.commitPreparedArchivedTaskRestore(envelope))
            .toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(first.db.prepare('SELECT * FROM tasks ORDER BY id').all()).toEqual(before);
        first.fault.commits = 0;
        const cold = await openSqlite(path);
        expect(cold.host.archivedTaskRestoreOutcome(envelope)).toMatchObject({ ok: true, value: null });
        expect(await cold.host.commitPreparedArchivedTaskRestore(envelope))
            .toMatchObject({ ok: true, value: { id: source.id, status: 'inbox' } });
        const committed = cold.db.prepare('SELECT * FROM tasks ORDER BY id').all();
        expect(committed).not.toEqual(before);
        expect(await cold.host.commitPreparedArchivedTaskRestore(otherEnvelope))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        cold.db.prepare('UPDATE tasks SET description = ?, rev = ?, revBy = ?, updatedAt = ? WHERE id = ?')
            .run('Later edit', 99, 'other-device', '2026-10-03T12:00:00.000Z', 'source');
        const changed = cold.db.prepare('SELECT * FROM tasks ORDER BY id').all();
        const later = await openSqlite(path);
        expect(later.host.archivedTaskRestoreOutcome(envelope))
            .toMatchObject({ ok: true, value: { id: source.id, status: 'inbox' } });
        expect(await later.host.commitPreparedArchivedTaskRestore(envelope)).toMatchObject({ ok: true });
        expect(later.db.prepare('SELECT * FROM tasks ORDER BY id').all()).toEqual(changed);
        expect(later.host.archivedTaskRestoreOutcome(otherEnvelope)).toMatchObject({ ok: true, value: null });
    }, 40_000);
});
