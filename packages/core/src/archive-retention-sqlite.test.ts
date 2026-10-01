import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteAdapter, type SqliteClient } from './sqlite-adapter';
import { SQLITE_BASE_SCHEMA } from './sqlite-schema';
import { parseSyncDocument, toRemoteSyncDocument } from './sync-document';
import type { AppData } from './types';

const at = '2026-09-01T10:20:30.123Z';
const initial = (): AppData => ({
    tasks: [{ id: 't', title: 'Archived task', status: 'archived', projectId: 'p', tags: [], contexts: [],
        archivedAt: at, createdAt: at, updatedAt: at, rev: 1, revBy: 'test' }],
    projects: [{ id: 'p', title: 'Archived project', status: 'archived', color: '#000000', order: 0, tagIds: [],
        archivedAt: at, createdAt: at, updatedAt: at, rev: 1, revBy: 'test' }],
    sections: [], areas: [], people: [], settings: { deviceId: 'test', gtd: { archiveRetentionDays: 180 } },
});

const adapterFor = (db: DatabaseSync): SqliteAdapter => {
    const client: SqliteClient = {
        run: async (sql, params = []) => { db.prepare(sql).run(...params as SQLInputValue[]); },
        all: async <T>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params as SQLInputValue[]) as T[],
        get: async <T>(sql: string, params: unknown[] = []) => db.prepare(sql).get(...params as SQLInputValue[]) as T | undefined,
        exec: async (sql) => { db.exec(sql); },
    };
    return new SqliteAdapter(client);
};

describe('archive clocks survive SQLite and data.json', () => {
    let directory: string;
    let filename: string;
    let db: DatabaseSync;
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'mindwtr-archive-clock-'));
        filename = join(directory, 'data.db');
        db = new DatabaseSync(filename);
    });
    afterEach(() => {
        db.close();
        rmSync(directory, { recursive: true, force: true });
    });

    it('persists both clocks across reopen and sync JSON, and persists clearing them', async () => {
        await adapterFor(db).saveData(initial());
        db.close();
        db = new DatabaseSync(filename);
        const adapter = adapterFor(db);
        const loaded = await adapter.getData();
        expect(loaded.tasks[0].archivedAt).toBe(at);
        expect(loaded.projects[0].archivedAt).toBe(at);
        const parsed = parseSyncDocument(JSON.parse(JSON.stringify(toRemoteSyncDocument(loaded))), 'remote');
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) throw new Error('Roundtrip sync document rejected');
        expect(parsed.data.tasks[0].archivedAt).toBe(at);
        expect(parsed.data.projects[0].archivedAt).toBe(at);
        expect(parsed.data.settings.gtd?.archiveRetentionDays).toBe(180);
        const restoredAt = '2026-09-02T10:20:30.123Z';
        await adapter.saveData({ ...parsed.data,
            tasks: parsed.data.tasks.map(task => ({ ...task, status: 'next', archivedAt: undefined, updatedAt: restoredAt, rev: 2 })),
            projects: parsed.data.projects.map(project => ({ ...project, status: 'active', archivedAt: undefined, updatedAt: restoredAt, rev: 2 })),
        });
        db.close();
        db = new DatabaseSync(filename);
        const restored = await adapterFor(db).getData();
        expect(restored.tasks[0].archivedAt).toBeUndefined();
        expect(restored.projects[0].archivedAt).toBeUndefined();
    });

    it('repairs old current-version tables without inventing legacy archive dates', async () => {
        db.exec(SQLITE_BASE_SCHEMA.replaceAll('  archivedAt TEXT,\n', ''));
        db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY); INSERT OR IGNORE INTO schema_migrations VALUES (11)');
        db.prepare('INSERT INTO projects (id,title,status,color,createdAt,updatedAt) VALUES (?,?,?,?,?,?)')
            .run('legacy-p', 'Keep project', 'archived', '#000000', at, at);
        db.prepare('INSERT INTO tasks (id,title,status,createdAt,updatedAt) VALUES (?,?,?,?,?)')
            .run('legacy-t', 'Keep task', 'archived', at, at);
        for (const table of ['tasks', 'projects']) {
            expect(db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === 'archivedAt')).toBe(false);
        }
        const loaded = await adapterFor(db).getData();
        for (const table of ['tasks', 'projects']) {
            expect(db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === 'archivedAt')).toBe(true);
        }
        expect(loaded.tasks[0]).toMatchObject({ id: 'legacy-t', title: 'Keep task' });
        expect(loaded.projects[0]).toMatchObject({ id: 'legacy-p', title: 'Keep project' });
        expect(loaded.tasks[0].archivedAt).toBeUndefined();
        expect(loaded.projects[0].archivedAt).toBeUndefined();
        const parsed = parseSyncDocument(JSON.parse(JSON.stringify(toRemoteSyncDocument(loaded))), 'remote');
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) throw new Error('Legacy sync document rejected');
        expect(parsed.data.tasks[0].archivedAt).toBeUndefined();
        expect(parsed.data.projects[0].archivedAt).toBeUndefined();
    });
});
