import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { setTimeout as waitFor } from 'timers/promises';

import type { AppData, Person, Task } from '@mindwtr/core';

import { createMindwtrAutomationStorage } from './mindwtr-automation-storage';
import { createMindwtrAutomationService } from './mindwtr-automation-core';

const tempDirs: string[] = [];

const makeProfile = () => {
    const dir = mkdtempSync(join(tmpdir(), 'mindwtr-automation-storage-'));
    tempDirs.push(dir);
    return { dataPath: join(dir, 'data.json'), dbPath: join(dir, 'mindwtr.db') };
};

const readRow = (dbPath: string, sql: string, id: string) => {
    const db = new Database(dbPath, { readonly: true });
    try {
        return db.prepare(sql).get(id) as Record<string, unknown> | null;
    } finally {
        db.close();
    }
};

const emptyData = (): AppData => ({ tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} });

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) rmSync(dir, { recursive: true, force: true });
    }
});

describe('automation script sqlite writes', () => {
    test('preserves people and their notes while migrating JSON into SQLite and its mirror', async () => {
        const { dataPath, dbPath } = makeProfile();
        const now = '2026-09-22T12:00:00.000Z';
        const person: Person = {
            id: 'person-json-migration',
            name: 'Alex',
            note: 'Design lead\nKeeps **project context**.',
            referenceLink: 'https://example.com/alex',
            createdAt: now,
            updatedAt: now,
        };
        writeFileSync(dataPath, JSON.stringify({
            ...emptyData(),
            people: [person],
        }, null, 2));

        const stdoutSpy = spyOn(console, 'info').mockImplementation(() => undefined);
        const stderrLines: string[] = [];
        const stderrTarget = process.stderr as unknown as { write: (chunk: string) => boolean };
        const stderrSpy = spyOn(stderrTarget, 'write').mockImplementation((chunk) => {
            stderrLines.push(chunk);
            return true;
        });
        try {
            const storage = createMindwtrAutomationStorage({ dataPath, dbPath });
            const loaded = await storage.getData();

            expect(loaded.people).toEqual([person]);
            expect(readRow(dbPath, 'SELECT id, name, note, referenceLink FROM people WHERE id = ?', person.id))
                .toEqual({ id: person.id, name: person.name, note: person.note, referenceLink: person.referenceLink });
            expect((JSON.parse(readFileSync(dataPath, 'utf8')) as AppData).people).toEqual([person]);
            expect(stdoutSpy).not.toHaveBeenCalled();
            expect(JSON.parse(stderrLines.join('').trim())).toMatchObject({
                level: 'info',
                scope: 'automation-storage',
                message: 'Automation people preserved during storage migration',
                context: {
                    releaseCheck: 'v1.3.2/automation-people-preserved',
                    count: 1,
                },
            });
        } finally {
            stderrSpy.mockRestore();
            stdoutSpy.mockRestore();
        }
    });

    test('stores every task column the API accepts, not just the ones it once listed', async () => {
        const { dataPath, dbPath } = makeProfile();
        const service = await createMindwtrAutomationService({ dataPath, dbPath });

        const created = await service.createTask({
            title: 'Call Bob',
            props: { status: 'waiting', assignedTo: 'Bob', energyLevel: 'high', timeSpentMinutes: 12 },
        });
        expect(created).toMatchObject({ assignedTo: 'Bob', energyLevel: 'high', timeSpentMinutes: 12 });

        expect(readRow(dbPath, 'SELECT assignedTo, energyLevel, timeSpentMinutes FROM tasks WHERE id = ?', created.id))
            .toEqual({ assignedTo: 'Bob', energyLevel: 'high', timeSpentMinutes: 12 });
    });

    test('writes into the installed data/ layout instead of orphaning a database at a pinned flat path', async () => {
        const { dataPath, dbPath } = makeProfile();
        const root = join(dataPath, '..');
        const movedData = join(root, 'data', 'data.json');
        const movedDb = join(root, 'data', 'mindwtr.db');

        // The app has already moved this profile; the pinned paths are one folder off.
        const moved = createMindwtrAutomationStorage({ dataPath: movedData, dbPath: movedDb });
        await moved.saveData(emptyData());
        expect(existsSync(movedDb)).toBe(true);

        const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const pinned = createMindwtrAutomationStorage({ dataPath, dbPath });
            expect(pinned.paths).toEqual({ dataPath: movedData, dbPath: movedDb });
            await pinned.saveData({
                ...emptyData(),
                tasks: [{
                    id: 'pinned-path-task',
                    title: 'Captured through a pinned flat path',
                    status: 'inbox',
                    tags: [],
                    contexts: [],
                    createdAt: '2026-09-18T12:00:00.000Z',
                    updatedAt: '2026-09-18T12:00:00.000Z',
                } as Task],
            });
        } finally {
            errorSpy.mockRestore();
        }

        expect(readRow(movedDb, 'SELECT title FROM tasks WHERE id = ?', 'pinned-path-task'))
            .toEqual({ title: 'Captured through a pinned flat path' });
        expect(existsSync(dbPath)).toBe(false);
        expect(existsSync(dataPath)).toBe(false);
    });

    test('never rewrites an unrelated data.json that merely shares the name', async () => {
        const { dataPath } = makeProfile();
        const root = join(dataPath, '..');
        const unrelated = join(root, 'data.json');
        const contents = '{"someOtherTool":true}';
        writeFileSync(unrelated, contents);

        // A fresh sandbox profile inside a folder that already holds a data.json.
        const pinnedData = join(root, 'data', 'data.json');
        const pinnedDb = join(root, 'data', 'mindwtr.db');
        const storage = createMindwtrAutomationStorage({ dataPath: pinnedData, dbPath: pinnedDb });
        await storage.saveData(emptyData());

        expect(storage.paths).toEqual({ dataPath: pinnedData, dbPath: pinnedDb });
        expect(readFileSync(unrelated, 'utf8')).toBe(contents);
        expect(existsSync(pinnedDb)).toBe(true);
    });

    test('refuses to overwrite a newer row with an older revision', async () => {
        const { dataPath, dbPath } = makeProfile();
        const now = '2026-09-18T12:00:00.000Z';
        const task = (rev: number, title: string): Task => ({
            id: 'rev-guard-task',
            title,
            status: 'next',
            tags: [],
            contexts: [],
            rev,
            createdAt: now,
            updatedAt: now,
        } as Task);

        const seed = createMindwtrAutomationStorage({ dataPath, dbPath });
        await seed.saveData({ ...emptyData(), tasks: [task(5, 'Newer desktop write')] });

        // A second process reads, then saves a snapshot that predates the seed.
        const stale = createMindwtrAutomationStorage({ dataPath, dbPath });
        await stale.saveData({ ...emptyData(), tasks: [task(4, 'Stale automation write')] });

        expect(readRow(dbPath, 'SELECT rev, title FROM tasks WHERE id = ?', 'rev-guard-task'))
            .toEqual({ rev: 5, title: 'Newer desktop write' });
        const mirror = JSON.parse(readFileSync(dataPath, 'utf8')) as AppData;
        expect(mirror.tasks.find((item) => item.id === 'rev-guard-task')?.title)
            .toBe('Newer desktop write');
    });

    test('rejects an equal-revision write after another storage instance commits', async () => {
        const { dataPath, dbPath } = makeProfile();
        const createdAt = '2026-09-22T12:00:00.000Z';
        const updatedAt = '2026-09-22T12:01:00.000Z';
        const original: Task = {
            id: 'equal-revision-race',
            title: 'Original',
            status: 'next',
            tags: [],
            contexts: [],
            rev: 1,
            revBy: 'seed',
            createdAt,
            updatedAt: createdAt,
        };
        const seed = createMindwtrAutomationStorage({ dataPath, dbPath });
        await seed.saveData({ ...emptyData(), tasks: [original] });

        const stale = createMindwtrAutomationStorage({ dataPath, dbPath });
        const current = createMindwtrAutomationStorage({ dataPath, dbPath });
        const staleSnapshot = await stale.getData();
        const currentSnapshot = await current.getData();
        await current.saveData({
            ...currentSnapshot,
            tasks: [{ ...currentSnapshot.tasks[0], title: 'Current writer', rev: 2, revBy: 'shared', updatedAt }],
        });

        await expect(stale.saveData({
            ...staleSnapshot,
            tasks: [{ ...staleSnapshot.tasks[0], title: 'Stale writer', rev: 2, revBy: 'shared', updatedAt }],
        })).rejects.toThrow('SQLITE_BUSY: database changed after the automation snapshot was loaded');
        expect(readRow(dbPath, 'SELECT rev, title FROM tasks WHERE id = ?', original.id))
            .toEqual({ rev: 2, title: 'Current writer' });
        const mirror = JSON.parse(readFileSync(dataPath, 'utf8')) as AppData;
        expect(mirror.tasks.find((task) => task.id === original.id)?.title).toBe('Current writer');
    });

    test('preserves concurrent service operations in SQLite and the mirror', async () => {
        const { dataPath, dbPath } = makeProfile();
        const gatePath = join(dataPath, '..', 'start');
        const workerCode = `
            import { existsSync, writeFileSync } from 'fs';
            import { createMindwtrAutomationService } from './mindwtr-automation-core.ts';
            const service = await createMindwtrAutomationService({
                dataPath: process.env.TEST_DATA_PATH,
                dbPath: process.env.TEST_DB_PATH,
            });
            writeFileSync(process.env.TEST_READY_PATH, 'ready');
            while (!existsSync(process.env.TEST_GATE_PATH)) {
                await new Promise((resolve) => setTimeout(resolve, 1));
            }
            await service.createTask({ title: process.env.TEST_TASK_TITLE });
        `;
        const stderr: string[] = ['', ''];
        const workers = ['First concurrent task', 'Second concurrent task'].map((title, index) => {
            const worker = spawn(process.execPath, ['-e', workerCode], {
                cwd: import.meta.dir,
                env: {
                    ...process.env,
                    TEST_DATA_PATH: dataPath,
                    TEST_DB_PATH: dbPath,
                    TEST_GATE_PATH: gatePath,
                    TEST_READY_PATH: join(dataPath, '..', `ready-${index}`),
                    TEST_TASK_TITLE: title,
                },
                stdio: ['ignore', 'ignore', 'pipe'],
            });
            worker.stderr?.on('data', (chunk) => {
                stderr[index] += String(chunk);
            });
            return worker;
        });
        const exits = workers.map((worker) => new Promise<number | null>((resolve, reject) => {
            worker.once('error', reject);
            worker.once('close', resolve);
        }));
        try {
            const readyDeadline = Date.now() + 10_000;
            while (!workers.every((_, index) => existsSync(join(dataPath, '..', `ready-${index}`)))) {
                if (Date.now() > readyDeadline) {
                    throw new Error(`Timed out waiting for automation workers: ${stderr.join('\n')}`);
                }
                await waitFor(5);
            }
            writeFileSync(gatePath, 'start');

            expect(await Promise.all(exits)).toEqual([0, 0]);
            const db = new Database(dbPath, { readonly: true });
            try {
                expect(db.prepare('SELECT title FROM tasks ORDER BY title').all()).toEqual([
                    { title: 'First concurrent task' },
                    { title: 'Second concurrent task' },
                ]);
            } finally {
                db.close();
            }
            expect((JSON.parse(readFileSync(dataPath, 'utf8')) as AppData).tasks.map((task) => task.title).sort())
                .toEqual(['First concurrent task', 'Second concurrent task']);
        } finally {
            workers.forEach((worker) => worker.kill());
        }
    }, 30_000);

    test('retries a service operation after an external commit lands between read and save', async () => {
        const { dataPath, dbPath } = makeProfile();
        const afterReadPath = join(dataPath, '..', 'after-read');
        const continuePath = join(dataPath, '..', 'continue');
        const workerCode = `
            import { existsSync, writeFileSync } from 'fs';
            import { createMindwtrAutomationService } from './mindwtr-automation-core.ts';
            const service = await createMindwtrAutomationService({
                dataPath: process.env.TEST_DATA_PATH,
                dbPath: process.env.TEST_DB_PATH,
            });
            const props = {
                get status() {
                    writeFileSync(process.env.TEST_AFTER_READ_PATH, 'ready');
                    while (!existsSync(process.env.TEST_CONTINUE_PATH)) Bun.sleepSync(1);
                    return 'inbox';
                },
            };
            await service.createTask({ title: 'Retried service task', props });
        `;
        let stderr = '';
        const worker = spawn(process.execPath, ['-e', workerCode], {
            cwd: import.meta.dir,
            env: {
                ...process.env,
                TEST_DATA_PATH: dataPath,
                TEST_DB_PATH: dbPath,
                TEST_AFTER_READ_PATH: afterReadPath,
                TEST_CONTINUE_PATH: continuePath,
            },
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        worker.stderr?.on('data', (chunk) => {
            stderr += String(chunk);
        });
        const exit = new Promise<number | null>((resolve, reject) => {
            worker.once('error', reject);
            worker.once('close', resolve);
        });
        try {
            const readDeadline = Date.now() + 10_000;
            while (!existsSync(afterReadPath)) {
                if (Date.now() > readDeadline) throw new Error(`Timed out waiting for service read: ${stderr}`);
                await waitFor(5);
            }
            const external = createMindwtrAutomationStorage({ dataPath, dbPath });
            const current = await external.getData();
            await external.saveData({
                ...current,
                tasks: [{
                    id: 'external-writer-task',
                    title: 'External writer task',
                    status: 'inbox',
                    tags: [],
                    contexts: [],
                    rev: 1,
                    revBy: 'external',
                    createdAt: '2026-09-22T12:00:00.000Z',
                    updatedAt: '2026-09-22T12:00:00.000Z',
                } as Task],
            });
            writeFileSync(continuePath, 'continue');

            expect(await exit).toBe(0);
            const db = new Database(dbPath, { readonly: true });
            try {
                expect(db.prepare('SELECT title FROM tasks ORDER BY title').all()).toEqual([
                    { title: 'External writer task' },
                    { title: 'Retried service task' },
                ]);
            } finally {
                db.close();
            }
            expect((JSON.parse(readFileSync(dataPath, 'utf8')) as AppData).tasks.map((task) => task.title).sort())
                .toEqual(['External writer task', 'Retried service task']);
            expect(stderr).toContain('v1.3.2/automation-concurrent-write-retry');
        } finally {
            worker.kill();
        }
    }, 30_000);

    test('keeps concurrent same-process services bound to their own profiles', async () => {
        const first = makeProfile();
        const second = makeProfile();
        const firstService = await createMindwtrAutomationService(first);
        const secondService = await createMindwtrAutomationService(second);

        await Promise.all([
            firstService.createTask({ title: 'First profile task' }),
            secondService.createTask({ title: 'Second profile task' }),
        ]);

        expect(readRow(first.dbPath, 'SELECT title FROM tasks')).toEqual({ title: 'First profile task' });
        expect(readRow(second.dbPath, 'SELECT title FROM tasks')).toEqual({ title: 'Second profile task' });
        expect((JSON.parse(readFileSync(first.dataPath, 'utf8')) as AppData).tasks.map((task) => task.title))
            .toEqual(['First profile task']);
        expect((JSON.parse(readFileSync(second.dataPath, 'utf8')) as AppData).tasks.map((task) => task.title))
            .toEqual(['Second profile task']);
    });
});
