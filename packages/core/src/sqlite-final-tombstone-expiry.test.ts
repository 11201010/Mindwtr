import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteAdapter, type SqliteClient } from './sqlite-adapter';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Task } from './types';

const require = createRequire(import.meta.url);
type BunStatement = {
    run: (params?: unknown[] | unknown) => unknown;
    all: (params?: unknown[] | unknown) => unknown[];
    get: (params?: unknown[] | unknown) => unknown;
};
type NodeStatement = {
    run: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
};
type Database = {
    exec: (sql: string) => void;
    close: () => void;
    query?: (sql: string) => BunStatement;
    prepare?: (sql: string) => NodeStatement;
};
type DatabaseCtor = new (filename: string) => Database;

const getStatement = (db: Database, sql: string): BunStatement | NodeStatement => {
    if (typeof db.prepare === 'function') return db.prepare(sql);
    if (typeof db.query === 'function') return db.query(sql);
    throw new Error('Unsupported sqlite runtime: missing prepare/query');
};

const createClient = (db: Database): SqliteClient => ({
    run: async (sql, params = []) => {
        const statement = getStatement(db, sql);
        if (typeof db.prepare === 'function') {
            (statement as NodeStatement).run(...params);
        } else {
            (statement as BunStatement).run(params);
        }
    },
    all: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
        const statement = getStatement(db, sql);
        return (typeof db.prepare === 'function'
            ? (statement as NodeStatement).all(...params)
            : (statement as BunStatement).all(params)) as T[];
    },
    get: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
        const statement = getStatement(db, sql);
        return (typeof db.prepare === 'function'
            ? (statement as NodeStatement).get(...params)
            : (statement as BunStatement).get(params)) as T | undefined;
    },
    exec: async (sql) => db.exec(sql),
});

const loadDatabaseCtor = (): DatabaseCtor | null => {
    const bunGlobal = globalThis as typeof globalThis & { Bun?: unknown };
    if (typeof bunGlobal.Bun !== 'undefined') {
        try {
            return (require('bun:sqlite') as { Database: DatabaseCtor }).Database;
        } catch {
            return null;
        }
    }
    try {
        return (require('node:sqlite') as { DatabaseSync: DatabaseCtor }).DatabaseSync;
    } catch {
        return null;
    }
};

const RuntimeDatabase = loadDatabaseCtor();
const describeSqlite = RuntimeDatabase ? describe : describe.skip;

it('has a sqlite runtime available for the store integration suite', () => {
    expect(RuntimeDatabase).not.toBeNull();
});

describeSqlite('store SQLite final tombstone expiry', () => {
    let databaseDir: string;
    let db: Database;
    let adapter: SqliteAdapter;

    const old = '2025-01-01T00:00:00.000Z';
    const expiredTask: Task = {
        id: 'expired-task',
        title: 'Expired task tombstone',
        status: 'done',
        tags: [],
        contexts: [],
        createdAt: old,
        updatedAt: old,
        deletedAt: old,
        purgedAt: old,
        rev: 1,
        revBy: 'test',
    };

    beforeEach(() => {
        if (!RuntimeDatabase) throw new Error('No compatible sqlite runtime available for tests');
        databaseDir = mkdtempSync(join(tmpdir(), 'mindwtr-store-sqlite-tombstone-'));
        db = new RuntimeDatabase(join(databaseDir, 'mindwtr.db'));
        adapter = new SqliteAdapter(createClient(db));
        setStorageAdapter(adapter);
        useTaskStore.setState({
            tasks: [],
            projects: [],
            sections: [],
            areas: [],
            people: [],
            settings: {},
            isLoading: false,
            error: null,
            persistenceFailure: null,
            editLockCount: 0,
            _allTasks: [],
            _allProjects: [],
            _allSections: [],
            _allAreas: [],
            _allPeople: [],
            _tasksById: new Map(),
            _projectsById: new Map(),
            _sectionsById: new Map(),
            _areasById: new Map(),
            _peopleById: new Map(),
            lastDataChangeAt: 0,
        });
    });

    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        db.close();
        rmSync(databaseDir, { recursive: true, force: true });
    });

    it('persists load-time expiry of the final tombstone and a later settings-only edit', async () => {
        const seeded: AppData = {
            tasks: [expiredTask],
            projects: [],
            sections: [],
            areas: [],
            people: [],
            settings: {
                deviceId: 'device-a',
                migrations: {
                    version: 1,
                    lastAutoArchiveAt: old,
                    lastTombstoneCleanupAt: old,
                },
                gtd: {
                    taskEditor: { defaultsVersion: 9999 },
                    focusGroupByDefaultsVersion: 9999,
                },
                theme: 'light',
            },
        };
        await adapter.saveData(seeded);

        await useTaskStore.getState().fetchData();
        await flushPendingSave();

        expect(useTaskStore.getState()._allTasks).toEqual([]);
        expect(useTaskStore.getState().persistenceFailure).toBeNull();
        expect((await adapter.getData()).tasks).toEqual([]);

        await useTaskStore.getState().updateSettings({ theme: 'dark' });
        await flushPendingSave();

        const persisted = await adapter.getData();
        expect(persisted.tasks).toEqual([]);
        expect(persisted.settings.theme).toBe('dark');
        expect(useTaskStore.getState().persistenceFailure).toBeNull();
    });
});
