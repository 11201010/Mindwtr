import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { closeDb, ensureMindwtrDbPath, openMindwtrDb } from './db.js';

const tempDirs: string[] = [];
const originalPlatform = process.platform;
const originalEnv = {
  APPDATA: process.env.APPDATA,
  MINDWTR_DB_PATH: process.env.MINDWTR_DB_PATH,
  MINDWTR_DB: process.env.MINDWTR_DB,
};

const setPlatform = (platform: string) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

const createTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mindwtr-mcp-db-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  setPlatform(originalPlatform);
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('mcp db bootstrap', () => {
  test('bootstraps a missing sqlite database from sibling data.json', async () => {
    const dir = createTempDir();
    const dbPath = join(dir, 'mindwtr.db');
    const dataPath = join(dir, 'data.json');
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      writeFileSync(
        dataPath,
        JSON.stringify(
          {
            tasks: [
              {
                id: 'task-1',
                title: 'Bootstrap task',
                status: 'inbox',
                createdAt: '2026-04-13T00:00:00.000Z',
                updatedAt: '2026-04-13T00:00:00.000Z',
              },
            ],
            projects: [],
            sections: [],
            areas: [],
            people: [
              {
                id: 'person-1',
                name: 'Alex',
                note: 'Design lead',
                referenceLink: 'https://example.com/alex',
                createdAt: '2026-04-13T00:00:00.000Z',
                updatedAt: '2026-04-13T00:00:00.000Z',
              },
            ],
            settings: {},
          },
          null,
          2
        )
      );

      const { db, path } = await openMindwtrDb({ dbPath, readonly: true });
      try {
        expect(path).toBe(dbPath);
        expect(existsSync(dbPath)).toBe(true);
        expect(
          db.prepare('SELECT id, title, status FROM tasks ORDER BY id').all()
        ).toEqual([{ id: 'task-1', title: 'Bootstrap task', status: 'inbox' }]);
        expect(
          db.prepare('SELECT id, name, note, referenceLink FROM people ORDER BY id').all()
        ).toEqual([
          {
            id: 'person-1',
            name: 'Alex',
            note: 'Design lead',
            referenceLink: 'https://example.com/alex',
          },
        ]);
      } finally {
        closeDb(db);
      }
      expect(warnSpy).toHaveBeenCalledWith(`[mindwtr-mcp] Bootstrapping SQLite database from fallback data.json: ${dataPath}`);
      expect(warnSpy).toHaveBeenCalledWith(`[mindwtr-mcp] Bootstrapped SQLite database at: ${dbPath}`);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('never exposes the canonical database path while the bootstrap is still running', async () => {
    const dir = createTempDir();
    const dbPath = join(dir, 'mindwtr.db');
    const dataPath = join(dir, 'data.json');
    writeFileSync(
      dataPath,
      JSON.stringify({ tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} })
    );

    const core = await import('@mindwtr/core');
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
    let canonicalPathDuringSave: boolean | null = null;
    const saveSpy = spyOn(core.SqliteAdapter.prototype, 'saveData').mockImplementation(async () => {
      // A SIGKILL or host startup timeout here runs no cleanup at all, so the
      // canonical path must not hold a schema-only database yet.
      canonicalPathDuringSave = existsSync(dbPath);
      throw new Error('interrupted mid-bootstrap');
    });

    try {
      await expect(ensureMindwtrDbPath({ dbPath })).rejects.toThrow('interrupted mid-bootstrap');
      expect(canonicalPathDuringSave).toBe(false);
      expect(existsSync(dbPath)).toBe(false);
      expect(readdirSync(dir)).toEqual(['data.json']);
    } finally {
      saveSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  test('bootstraps beside the data.json it is built from, not in the data/ candidate', async () => {
    const appData = createTempDir();
    const profile = join(appData, 'mindwtr');
    mkdirSync(profile, { recursive: true });
    writeFileSync(
      join(profile, 'data.json'),
      JSON.stringify({ tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} })
    );
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      setPlatform('win32');
      process.env.APPDATA = appData;
      delete process.env.MINDWTR_DB_PATH;
      delete process.env.MINDWTR_DB;

      expect(await ensureMindwtrDbPath()).toBe(join(profile, 'mindwtr.db'));
      expect(existsSync(join(profile, 'data', 'mindwtr.db'))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('keeps the original error when no db or fallback data exists', async () => {
    const dir = createTempDir();
    const dbPath = join(dir, 'mindwtr.db');

    await expect(ensureMindwtrDbPath({ dbPath })).rejects.toThrow(
      `Mindwtr database not found at: ${dbPath}`
    );
  });
});
