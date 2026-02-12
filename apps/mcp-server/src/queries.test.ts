import { describe, expect, test } from 'bun:test';
import { addTask, listTasks, parseQuickAdd, type Project } from './queries.js';
import type { DbClient } from './db.js';

const createMockDb = (rows: any[] = []): { db: DbClient; calls: { sql: string; params: any[] }[] } => {
    const calls: { sql: string; params: any[] }[] = [];
    const db: DbClient = {
        prepare: (sql: string) => ({
            all: (...params: any[]) => {
                calls.push({ sql, params });
                if (sql.startsWith('PRAGMA table_info(tasks)')) {
                    return [{ name: 'id' }, { name: 'title' }, { name: 'updatedAt' }, { name: 'status' }];
                }
                return rows;
            },
            get: (...params: any[]) => {
                calls.push({ sql, params });
                return rows[0];
            },
            run: (...params: any[]) => {
                calls.push({ sql, params });
                return { changes: 1 };
            },
        }),
        close: () => undefined,
    };
    return { db, calls };
};

describe('mcp queries', () => {
    test('parseQuickAdd resolves project by +Title token', () => {
        const projects: Project[] = [{ id: 'p1', title: 'Home' }];
        const parsed = parseQuickAdd('Buy milk +Home @errands #weekly', projects);
        expect(parsed.title).toBe('Buy milk');
        expect(parsed.props.projectId).toBe('p1');
        expect(parsed.props.contexts).toEqual(['@errands']);
        expect(parsed.props.tags).toEqual(['#weekly']);
    });

    test('listTasks escapes wildcard characters in search input', () => {
        const now = '2026-02-01T00:00:00.000Z';
        const { db, calls } = createMockDb([
            {
                id: 't1',
                title: 'Task',
                status: 'inbox',
                createdAt: now,
                updatedAt: now,
                isFocusedToday: 0,
            },
        ]);

        const tasks = listTasks(db, { search: '100%_done\\now', includeDeleted: false });
        expect(tasks).toHaveLength(1);
        const queryCall = calls.find((call) => call.sql.startsWith('SELECT'));
        expect(queryCall).toBeTruthy();
        expect(queryCall?.params[0]).toBe('%100\\%\\_done\\\\now%');
        expect(queryCall?.params[1]).toBe('%100\\%\\_done\\\\now%');
    });

    test('listTasks caches task column introspection per db client', () => {
        const now = '2026-02-01T00:00:00.000Z';
        const { db, calls } = createMockDb([
            {
                id: 't1',
                title: 'Task',
                status: 'inbox',
                createdAt: now,
                updatedAt: now,
                isFocusedToday: 0,
            },
        ]);

        listTasks(db, { includeDeleted: false });
        listTasks(db, { includeDeleted: false });

        const pragmaCalls = calls.filter((call) => call.sql.startsWith('PRAGMA table_info(tasks)'));
        expect(pragmaCalls).toHaveLength(1);
    });

    test('addTask quickAdd uses lightweight project lookup', () => {
        const now = '2026-02-01T00:00:00.000Z';
        const { db, calls } = createMockDb([{ id: 'p1', title: 'Home', createdAt: now, updatedAt: now }]);

        const created = addTask(db, { quickAdd: 'Buy milk +Home' });

        expect(created.title).toBe('Buy milk');
        expect(created.projectId).toBe('p1');
        const projectLookup = calls.find((call) => call.sql.startsWith('SELECT id, title FROM projects WHERE deletedAt IS NULL'));
        expect(projectLookup).toBeTruthy();
    });
});
