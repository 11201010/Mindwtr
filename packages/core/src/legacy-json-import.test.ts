import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
    LEGACY_JSON_IMPORT_DATA_TABLES,
    legacyImportMismatch,
    planLegacyJsonImport,
    sqliteHasAnyData,
    type LegacyJsonImportState,
} from './legacy-json-import';
import { SqliteAdapter, type SqliteClient } from './sqlite-adapter';
import type { AppData, Task } from './types';

const task = (id: string, rev: number, extra: Partial<Task> = {}): Task => ({
    id,
    title: id,
    status: 'inbox',
    tags: [],
    contexts: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: `2026-09-0${rev}T00:00:00.000Z`,
    rev,
    revBy: 'rn-device',
    ...extra,
});
const data = (tasks: Task[]): AppData => ({ tasks, projects: [], sections: [], areas: [], people: [], settings: {} });
const state = (overrides: Partial<LegacyJsonImportState> = {}): LegacyJsonImportState => ({
    jsonAhead: false, reconciled: true, backupVersion: '2', backupJson: null, ...overrides,
});
// SQLite holds `kept` at rev 2; the backup holds an older `kept` and a task SQLite never took.
const sqlite = data([task('kept', 2)]);
const backupJson = JSON.stringify(data([task('kept', 1, { title: 'stale' }), task('json-only', 1)]));
const titles = (appData?: AppData) => appData?.tasks.map((item) => `${item.id}:${item.title}`).sort();

describe('planLegacyJsonImport', () => {
    it('(a) merges a json-ahead backup, keeps newer SQLite rows, clears the marker', () => {
        const plan = planLegacyJsonImport(state({ jsonAhead: true, backupJson }), sqlite, true);
        expect(plan).toMatchObject({ outcome: 'imported', path: 'json-ahead', clearJsonAhead: true, setReconciled: false });
        expect(titles(plan.merged)).toEqual(['json-only:json-only', 'kept:kept']);
        // RN's tasksFromBackup also counts rows whose tie resolved to the backup copy.
        expect(plan.counts).toMatchObject({ backupTasks: 2, sqliteTasks: 1, mergedTasks: 2 });
    });

    it('(a) then (b): an unset reconcile flag is set after the json-ahead import, whatever the backup version', () => {
        for (const backupVersion of ['2', null]) {
            const plan = planLegacyJsonImport(state({ jsonAhead: true, reconciled: false, backupVersion, backupJson }), sqlite, true);
            expect(plan).toMatchObject({ outcome: 'imported', clearJsonAhead: true, setReconciled: true });
        }
    });

    it('(a) abandons an absent or corrupt backup: marker cleared, flag set only when (b) would run', () => {
        for (const [json, reason] of [[null, 'backup-missing'], ['{"tasks": [', 'backup-corrupt'], ['null', 'backup-corrupt']] as const) {
            const withData = planLegacyJsonImport(state({ jsonAhead: true, reconciled: false, backupJson: json }), sqlite, true);
            expect(withData).toEqual({ outcome: 'abandoned', path: 'json-ahead', reason, clearJsonAhead: true, setReconciled: true });
            const empty = planLegacyJsonImport(state({ jsonAhead: true, reconciled: false, backupJson: json }), data([]), false);
            expect(empty).toEqual({ outcome: 'abandoned', path: 'json-ahead', reason, clearJsonAhead: true, setReconciled: false });
        }
    });

    it('(b) reconciles a version-2 backup once, and only sets the flag for any other backup', () => {
        const unset = state({ reconciled: false, backupJson });
        expect(planLegacyJsonImport(unset, sqlite, true)).toMatchObject({ outcome: 'imported', path: 'reconcile', clearJsonAhead: false, setReconciled: true });
        expect(planLegacyJsonImport({ ...unset, backupVersion: '1' }, sqlite, true))
            .toEqual({ outcome: 'abandoned', path: 'reconcile', reason: 'backup-version', clearJsonAhead: false, setReconciled: true });
        expect(planLegacyJsonImport({ ...unset, backupJson: 'nope' }, sqlite, true))
            .toEqual({ outcome: 'abandoned', path: 'reconcile', reason: 'backup-corrupt', clearJsonAhead: false, setReconciled: true });
        expect(planLegacyJsonImport({ ...unset, backupJson: null }, sqlite, true))
            .toEqual({ outcome: 'abandoned', path: 'reconcile', reason: 'backup-missing', clearJsonAhead: false, setReconciled: true });
        expect(planLegacyJsonImport(state({ backupJson }), sqlite, true)).toEqual({ outcome: 'none', clearJsonAhead: false, setReconciled: false });
    });

    it('(c) migrates into empty SQLite whatever the flag or version; a corrupt backup changes nothing', () => {
        const plan = planLegacyJsonImport(state({ reconciled: false, backupVersion: null, backupJson }), data([]), false);
        expect(plan).toMatchObject({ outcome: 'imported', path: 'migrate', clearJsonAhead: false, setReconciled: true });
        expect(titles(plan.merged)).toEqual(['json-only:json-only', 'kept:stale']);
        expect(planLegacyJsonImport(state({ backupJson }), data([]), false).setReconciled).toBe(false);
        expect(planLegacyJsonImport(state({ reconciled: false, backupJson: '[' }), data([]), false))
            .toEqual({ outcome: 'abandoned', path: 'migrate', reason: 'backup-corrupt', clearJsonAhead: false, setReconciled: false });
        expect(planLegacyJsonImport(state({ reconciled: false }), data([]), false))
            .toEqual({ outcome: 'none', clearJsonAhead: false, setReconciled: false });
    });

    it('normalizes a partial backup the way RN parses it', () => {
        const plan = planLegacyJsonImport(state({ reconciled: false, backupJson: '{"tasks":"x","settings":null}' }), data([]), false);
        expect(plan.merged).toMatchObject({ tasks: [], projects: [], sections: [], areas: [], people: [] });
    });
});

type NodeDatabase = { exec(sql: string): void; prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown } };
const DatabaseSync = (() => {
    try {
        return (createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => NodeDatabase }).DatabaseSync;
    } catch {
        return null;
    }
})();

describe.runIf(DatabaseSync)('legacy JSON import through SqliteAdapter', () => {
    const client = (db: NodeDatabase): SqliteClient => ({
        run: async (sql, params = []) => { db.prepare(sql).run(...params); },
        all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params) as T[],
        get: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).get(...params) as T | undefined,
        exec: async (sql) => { db.exec(sql); },
    });

    it('saves once; planning again (the AsyncStorage update failed) re-merges to the same rows', async () => {
        const sqliteClient = client(new DatabaseSync!(':memory:'));
        const adapter = new SqliteAdapter(sqliteClient);
        await adapter.saveData(sqlite);
        expect(await sqliteHasAnyData(sqliteClient)).toBe(true);
        const input = state({ jsonAhead: true, backupJson });
        const first = planLegacyJsonImport(input, await adapter.getData(), true);
        await adapter.saveData(first.merged!);
        const saved = await adapter.getData();
        expect(titles(saved)).toEqual(['json-only:json-only', 'kept:kept']);

        const again = planLegacyJsonImport(input, saved, await sqliteHasAnyData(sqliteClient));
        expect(again.counts).toMatchObject({ sqliteTasks: 2, mergedTasks: 2 });
        await adapter.saveData(again.merged!);
        expect(await adapter.getData()).toEqual(saved);
    });

    it('confirms a rich import field by field, and names the table a lost field is in', async () => {
        const at = '2026-09-20T10:00:00.000Z';
        const rich = {
            tasks: [
                {
                    id: 't1', title: 'Rich ü 😀', description: 'Notes\nline 2', status: 'next', priority: 'high',
                    dueDate: '2026-10-01', startTime: '2026-09-25T09:00', reviewAt: '2026-11-01', tags: ['#a'], contexts: ['@home'],
                    checklist: [{ id: 'c1', title: 'x', isCompleted: true }], projectId: 'p1', sectionId: 's1', areaId: 'a1',
                    assignedTo: 'Alex', recurrence: { rule: 'weekly', strategy: 'strict', byDay: ['MO'] },
                    rev: 4, revBy: 'rn', createdAt: at, updatedAt: at,
                },
                { id: 't2', title: 'Gone', status: 'inbox', tags: [], contexts: [], deletedAt: at, rev: 2, revBy: 'rn', createdAt: at, updatedAt: at },
            ],
            projects: [{ id: 'p1', title: 'P', status: 'active', color: '#94a3b8', order: 0, tagIds: [], areaId: 'a1', rev: 2, revBy: 'rn', createdAt: at, updatedAt: at }],
            sections: [{ id: 's1', projectId: 'p1', title: 'S', order: 0, rev: 1, revBy: 'rn', createdAt: at, updatedAt: at }],
            areas: [{ id: 'a1', name: 'Work', order: 0, color: '#123456', rev: 1, revBy: 'rn', createdAt: at, updatedAt: at }],
            people: [{ id: 'pe1', name: 'Alex', note: 'n', rev: 1, revBy: 'rn', createdAt: at, updatedAt: at }],
            settings: { theme: 'dark', gtd: { autoArchiveDays: 7 }, deviceId: 'rn-device', savedFilters: [
                { id: 'f1', name: 'F', view: 'focus', criteria: { contexts: ['@home'] }, createdAt: at, updatedAt: at },
            ] },
        };
        const sqliteClient = client(new DatabaseSync!(':memory:'));
        const adapter = new SqliteAdapter(sqliteClient);
        const input = state({ reconciled: false, backupJson: JSON.stringify(rich) });
        const plan = planLegacyJsonImport(input, await adapter.getData(), false);
        await adapter.saveData(plan.merged!);
        const saved = await adapter.getData();
        expect(legacyImportMismatch(plan.merged!, saved)).toBeNull();
        // A second plan over the saved import is already saved: the host skips its write. (RN stamps
        // every entity; one without timestamps would get fresh merge timestamps on each plan.)
        expect(legacyImportMismatch(planLegacyJsonImport({ ...input, jsonAhead: true }, saved, true).merged!, saved)).toBeNull();

        const lost = structuredClone(saved);
        lost.tasks[0] = { ...lost.tasks.find((item) => item.id === 't1')!, description: undefined };
        lost.tasks[1] = saved.tasks.find((item) => item.id === 't2')!;
        expect(legacyImportMismatch(plan.merged!, lost)).toBe('tasks');
        expect(legacyImportMismatch(plan.merged!, { ...saved, people: [] })).toBe('people');
        expect(legacyImportMismatch(plan.merged!, { ...saved, settings: { ...saved.settings, theme: 'light' } })).toBe('settings');
        // Null is missing, and an absent saved-filter list is an empty one.
        const bare = { ...saved, settings: { ...saved.settings, savedFilters: undefined, language: null } } as unknown as AppData;
        expect(legacyImportMismatch({ ...bare, settings: { ...bare.settings, savedFilters: [] } }, bare)).toBeNull();
    });

    it('counts every RN table to tell empty SQLite from data', async () => {
        const db = new DatabaseSync!(':memory:');
        const sqliteClient = client(db);
        await new SqliteAdapter(sqliteClient).ensureSchema();
        expect(await sqliteHasAnyData(sqliteClient)).toBe(false);
        expect(LEGACY_JSON_IMPORT_DATA_TABLES).toContain('saved_filters');
        db.exec(`INSERT INTO settings (id, data) VALUES (1, '{}')`);
        expect(await sqliteHasAnyData(sqliteClient)).toBe(true);
    });
});
