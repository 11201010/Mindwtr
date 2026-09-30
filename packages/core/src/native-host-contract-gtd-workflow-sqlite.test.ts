import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createNativeHostContract } from './native-host-contract';
import type { NativeGtdWorkflowRequest } from './native-host-contract-gtd-workflow';
import { NativeReceiptSqliteAdapter, resetNativeRequestReceipts } from './native-request-receipts';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { SqliteClient } from './sqlite-adapter';
import type { AppData, Task } from './types';

const require = createRequire(import.meta.url);
type Statement = { run: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown };
type Database = { exec: (sql: string) => void; prepare: (sql: string) => Statement; close: () => void };
const DatabaseSync = (require('node:sqlite') as { DatabaseSync: new (path: string) => Database }).DatabaseSync;
const clientOf = (db: Database, fault: { commits: number }): SqliteClient => ({
    run: async (sql, params = []) => {
        if (sql === 'COMMIT' && fault.commits > 0) { fault.commits -= 1; throw new Error('injected commit failure'); }
        db.prepare(sql).run(...params);
    },
    all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params) as T[],
    get: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).get(...params) as T | undefined,
    exec: async (sql) => { db.exec(sql); },
});
const ID = '00000000-0000-4000-8000-000000000103';
const AT = '2026-09-01T00:00:00.000Z';
const task: Task = { id: 'gtd-raw', title: 'Raw terminal', status: 'done', tags: [], contexts: [],
    focusOrder: 9, createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', rev: 7 };
const initial = (): AppData => ({ tasks: [task], projects: [], sections: [], areas: [], people: [],
    settings: { deviceId: 'gtd-device', gtd: { focusGroupBy: 'project', legacySibling: 'keep' },
        syncPreferencesUpdatedAt: { gtd: AT, language: AT } } as AppData['settings'] });

const tempRoot = join(process.cwd(), '../../.orchestrator/tmp');
mkdirSync(tempRoot, { recursive: true });
const directories: string[] = [];
const databases: Database[] = [];
afterEach(async () => {
    await flushPendingSave(); resetForTests(); resetNativeRequestReceipts();
    for (const db of databases.splice(0)) db.close();
    for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function open(path: string, seed = false) {
    await flushPendingSave(); resetForTests(); resetNativeRequestReceipts();
    const db = new DatabaseSync(path); databases.push(db);
    const fault = { commits: 0 };
    const client = clientOf(db, fault);
    if (seed) await new NativeReceiptSqliteAdapter(client).saveData(initial());
    const adapter = new NativeReceiptSqliteAdapter(client, { rejectConcurrentWrites: true });
    setStorageAdapter(adapter);
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    await flushPendingSave();
    const host = createNativeHostContract();
    expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
    await flushPendingSave();
    return { db, adapter, host, fault };
}

async function plan(host: ReturnType<typeof createNativeHostContract>,
    edit: NativeGtdWorkflowRequest['edit']) {
    const options = await host.getGtdWorkflowOptions({});
    if (!options.ok) throw new Error(JSON.stringify(options));
    const request: NativeGtdWorkflowRequest = { requestId: ID, edit, expected: options.value.expected[edit.type] };
    const prepared = await host.prepareGtdWorkflow(request);
    if (!prepared.ok || prepared.value.kind !== 'prepared') throw new Error(JSON.stringify(prepared));
    return { request, prepared: prepared.value.prepared };
}

describe('GTD workflow SQLite recovery', () => {
    it('requeues raw saved rows after failed COMMIT and cold-replays the exact field/stamp', async () => {
        const dir = mkdtempSync(join(tempRoot, 'gtd-workflow-')); directories.push(dir);
        const path = join(dir, 'library.db');
        const first = await open(path, true);
        const beforeTask = first.db.prepare('SELECT * FROM tasks WHERE id = ?').get('gtd-raw');
        const beforeSettings = (await first.adapter.getData()).settings;
        const envelope = await plan(first.host, { type: 'focusTaskLimit', value: 5 });
        first.fault.commits = 10;
        expect(await first.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
            error: { code: 'SAVE_FAILED' } });
        expect(first.db.prepare('SELECT * FROM tasks WHERE id = ?').get('gtd-raw')).toEqual(beforeTask);
        expect((await first.adapter.getData()).settings).toEqual(beforeSettings);
        expect(await first.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
            error: { code: 'SAVE_FAILED' } });
        expect(first.db.prepare('SELECT * FROM tasks WHERE id = ?').get('gtd-raw')).toEqual(beforeTask);
        expect((await first.adapter.getData()).settings).toEqual(beforeSettings);
        first.fault.commits = 0;
        expect(await first.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true,
            value: { type: 'focusTaskLimit', value: 5, changed: true } });
        expect(first.db.prepare('SELECT * FROM tasks WHERE id = ?').get('gtd-raw')).toEqual(beforeTask);
        const saved = (await first.adapter.getData()).settings;
        expect(saved.gtd).toEqual({ ...beforeSettings.gtd, focusTaskLimit: 5 });
        expect(saved.syncPreferencesUpdatedAt?.gtd).toBe(envelope.prepared.after.stamp);
        expect(saved.syncPreferencesUpdatedAt?.language).toBe(AT);
        first.db.close(); databases.splice(databases.indexOf(first.db), 1);
        const cold = await open(path);
        expect(await cold.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true,
            value: envelope.prepared.result });
        expect(cold.db.prepare('SELECT * FROM tasks WHERE id = ?').get('gtd-raw')).toEqual(beforeTask);
        expect((await cold.adapter.getData()).settings).toEqual(saved);
    }, 20_000);

    it('applies a frozen journal after restart only at the original field/group CAS', async () => {
        const dir = mkdtempSync(join(tempRoot, 'gtd-workflow-')); directories.push(dir);
        const path = join(dir, 'library.db');
        const first = await open(path, true);
        const envelope = await plan(first.host, { type: 'defaultProjectFlowMode', value: 'sequential' });
        first.db.close(); databases.splice(databases.indexOf(first.db), 1);
        const cold = await open(path);
        expect(await cold.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true,
            value: envelope.prepared.result });
        const data = await cold.adapter.getData();
        expect(data.settings.gtd?.defaultProjectFlowMode).toBe('sequential');
        expect(data.settings.syncPreferencesUpdatedAt?.gtd).toBe(envelope.prepared.after.stamp);
    });

    it('refuses independent same-target and ABA changes with a distinct group stamp', async () => {
        const dir = mkdtempSync(join(tempRoot, 'gtd-workflow-')); directories.push(dir);
        const path = join(dir, 'library.db');
        const first = await open(path, true);
        const envelope = await plan(first.host, { type: 'defaultScheduleTime', value: '09:30' });
        const changed = await first.adapter.getData();
        changed.settings.gtd = { ...changed.settings.gtd, defaultScheduleTime: '09:30' };
        changed.settings.syncPreferencesUpdatedAt = { ...changed.settings.syncPreferencesUpdatedAt,
            gtd: '2026-09-02T00:00:00.000Z' };
        await first.adapter.saveData(changed);
        first.db.close(); databases.splice(databases.indexOf(first.db), 1);
        const cold = await open(path);
        expect(await cold.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        const changedAgain = await cold.adapter.getData();
        changedAgain.settings.gtd = { ...changedAgain.settings.gtd, defaultScheduleTime: undefined };
        await cold.adapter.saveData(changedAgain);
        cold.db.close(); databases.splice(databases.indexOf(cold.db), 1);
        const afterAba = await open(path);
        expect(await afterAba.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect((await afterAba.adapter.getData()).settings.gtd?.defaultScheduleTime).toBeUndefined();
    });
});
