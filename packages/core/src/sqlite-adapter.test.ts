import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { SqliteAdapter, type SqliteClient } from './sqlite-adapter';
import type { AppData } from './types';

type Database = import('bun:sqlite').Database;

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const describeBun = isBun ? describe : describe.skip;

const createClient = (db: Database): SqliteClient => ({
    run: async (sql: string, params: unknown[] = []) => {
        db.query(sql).run(params);
    },
    all: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
        db.query(sql).all(params) as T[],
    get: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
        db.query(sql).get(params) as T | undefined,
    exec: async (sql: string) => {
        db.exec(sql);
    },
});

describeBun('SqliteAdapter', () => {
    let db: Database;
    let adapter: SqliteAdapter;
    let DatabaseCtor: typeof Database | null = null;

    beforeEach(async () => {
        if (!DatabaseCtor) {
            const mod = await import('bun:sqlite');
            DatabaseCtor = mod.Database;
        }
        db = new DatabaseCtor(':memory:');
        adapter = new SqliteAdapter(createClient(db));
    });

    afterEach(() => {
        db.close();
    });

    it('round-trips tasks, projects, areas, and settings', async () => {
        const now = new Date().toISOString();
        const data: AppData = {
            tasks: [
                {
                    id: 'task-1',
                    title: 'Write docs',
                    status: 'next',
                    rev: 5,
                    revBy: 'device-desktop',
                    tags: ['#docs', '#writing'],
                    contexts: ['@computer'],
                    recurrence: {
                        rule: 'weekly',
                        strategy: 'strict',
                        byDay: ['MO', 'WE'],
                        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
                    },
                    checklist: [{ id: 'c1', title: 'Outline', isCompleted: false }],
                    attachments: [
                        {
                            id: 'a1',
                            kind: 'file',
                            title: 'spec.pdf',
                            uri: '/tmp/spec.pdf',
                            createdAt: now,
                            updatedAt: now,
                        },
                    ],
                    createdAt: now,
                    updatedAt: now,
                },
            ],
            projects: [
                {
                    id: 'proj-1',
                    title: 'Mindwtr',
                    status: 'active',
                    color: '#1D4ED8',
                    order: 0,
                    tagIds: ['tag-1'],
                    isSequential: true,
                    isFocused: false,
                    rev: 7,
                    revBy: 'device-desktop',
                    createdAt: now,
                    updatedAt: now,
                },
            ],
            sections: [
                {
                    id: 'section-1',
                    projectId: 'proj-1',
                    title: 'Milestones',
                    order: 0,
                    rev: 2,
                    revBy: 'device-desktop',
                    createdAt: now,
                    updatedAt: now,
                },
            ],
            areas: [
                {
                    id: 'area-1',
                    name: 'Work',
                    order: 0,
                    rev: 3,
                    revBy: 'device-desktop',
                },
            ],
            settings: {
                gtd: { autoArchiveDays: 7 },
            },
        };

        await adapter.saveData(data);
        const loaded = await adapter.getData();

        expect(loaded.tasks).toHaveLength(1);
        expect(loaded.projects).toHaveLength(1);
        expect(loaded.sections).toHaveLength(1);
        expect(loaded.areas).toHaveLength(1);
        expect(loaded.settings.gtd?.autoArchiveDays).toBe(7);

        const task = loaded.tasks[0];
        expect(task.title).toBe('Write docs');
        expect(task.tags).toEqual(['#docs', '#writing']);
        expect(task.contexts).toEqual(['@computer']);
        expect(task.recurrence).toEqual({
            rule: 'weekly',
            strategy: 'strict',
            byDay: ['MO', 'WE'],
            rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
        });
        expect(task.checklist?.[0]?.title).toBe('Outline');
        expect(task.attachments?.[0]?.title).toBe('spec.pdf');
        expect(task.rev).toBe(5);
        expect(task.revBy).toBe('device-desktop');

        const project = loaded.projects[0];
        expect(project.title).toBe('Mindwtr');
        expect(project.tagIds).toEqual(['tag-1']);
        expect(project.isSequential).toBe(true);
        expect(project.isFocused).toBe(false);
        expect(project.rev).toBe(7);
        expect(project.revBy).toBe('device-desktop');

        const section = loaded.sections[0];
        expect(section.title).toBe('Milestones');
        expect(section.rev).toBe(2);
        expect(section.revBy).toBe('device-desktop');

        const area = loaded.areas[0];
        expect(area.name).toBe('Work');
        expect(area.order).toBe(0);
        expect(area.rev).toBe(3);
        expect(area.revBy).toBe('device-desktop');
    });

    it('drops attachments with empty URIs when loading tasks', async () => {
        const now = new Date().toISOString();
        const data: AppData = {
            tasks: [
                {
                    id: 'task-empty-uri',
                    title: 'Task with invalid attachment',
                    status: 'inbox',
                    tags: [],
                    contexts: [],
                    attachments: [
                        {
                            id: 'att-empty',
                            kind: 'file',
                            title: 'empty',
                            uri: '   ',
                            createdAt: now,
                            updatedAt: now,
                        },
                    ],
                    createdAt: now,
                    updatedAt: now,
                },
            ],
            projects: [],
            sections: [],
            areas: [],
            settings: {},
        };

        await adapter.saveData(data);
        const loaded = await adapter.getData();

        expect(loaded.tasks).toHaveLength(1);
        expect(loaded.tasks[0].attachments).toBeUndefined();
    });

    it('adds missing task columns on older schemas', async () => {
        db.exec(`
            CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                status TEXT NOT NULL
            );
        `);
        db.exec(`
            CREATE TABLE projects (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                status TEXT NOT NULL,
                color TEXT NOT NULL
            );
        `);
        db.exec(`CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);`);
        db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);`);

        await adapter.ensureSchema();

        const columns = db.query('PRAGMA table_info(tasks)').all() as { name: string }[];
        const names = columns.map((col) => col.name);
        expect(names).toContain('orderNum');
        expect(names).toContain('areaId');
        expect(names).toContain('sectionId');
        expect(names).toContain('purgedAt');
        expect(names).toContain('rev');
        expect(names).toContain('revBy');

        const projectColumns = db.query('PRAGMA table_info(projects)').all() as { name: string }[];
        const projectColumnNames = projectColumns.map((col) => col.name);
        expect(projectColumnNames).toContain('rev');
        expect(projectColumnNames).toContain('revBy');

        const sectionColumns = db.query('PRAGMA table_info(sections)').all() as { name: string }[];
        const sectionColumnNames = sectionColumns.map((col) => col.name);
        expect(sectionColumnNames).toContain('rev');
        expect(sectionColumnNames).toContain('revBy');

        const areaColumns = db.query('PRAGMA table_info(areas)').all() as { name: string }[];
        const areaColumnNames = areaColumns.map((col) => col.name);
        expect(areaColumnNames).toContain('rev');
        expect(areaColumnNames).toContain('revBy');
    });

    it('rejects invalid task status values at the database layer', async () => {
        await adapter.ensureSchema();

        expect(() =>
            db.query(`
                INSERT INTO tasks (id, title, status, createdAt, updatedAt)
                VALUES ('bad-status', 'Bad status', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
            `).run()
        ).toThrow(/invalid_task_status/i);
    });

    it('rejects malformed json fields at the database layer', async () => {
        await adapter.ensureSchema();

        expect(() =>
            db.query(`
                INSERT INTO tasks (id, title, status, tags, createdAt, updatedAt)
                VALUES ('bad-json', 'Bad json', 'next', '{invalid', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
            `).run()
        ).toThrow(/invalid_tasks_tags_json/i);
    });

    it('creates composite indexes used by sync queries', async () => {
        await adapter.ensureSchema();

        const indexes = db.query(`PRAGMA index_list(tasks)`).all() as Array<{ name: string }>;
        const names = new Set(indexes.map((index) => index.name));

        expect(names.has('idx_tasks_project_status_updatedAt')).toBe(true);
        expect(names.has('idx_tasks_area_deletedAt')).toBe(true);
    });
});
