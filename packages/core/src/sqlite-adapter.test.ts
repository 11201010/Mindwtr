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
                    createdAt: now,
                    updatedAt: now,
                },
            ],
            sections: [],
            areas: [
                {
                    id: 'area-1',
                    name: 'Work',
                    order: 0,
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
        expect(loaded.sections).toHaveLength(0);
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

        const project = loaded.projects[0];
        expect(project.title).toBe('Mindwtr');
        expect(project.tagIds).toEqual(['tag-1']);
        expect(project.isSequential).toBe(true);
        expect(project.isFocused).toBe(false);

        const area = loaded.areas[0];
        expect(area.name).toBe('Work');
        expect(area.order).toBe(0);
    });
});
