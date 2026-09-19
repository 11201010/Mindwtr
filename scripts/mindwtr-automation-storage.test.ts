import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { AppData, Task } from '@mindwtr/core';

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
