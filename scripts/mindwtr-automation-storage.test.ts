import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
    });
});
