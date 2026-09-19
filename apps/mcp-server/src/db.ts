import { existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, dirname, join } from 'path';

import type { AppData, SqliteClient } from '@mindwtr/core';

import { resolveMindwtrDataJsonPath, resolveMindwtrDbPath } from './paths.js';

export type DbOptions = {
  dbPath?: string;
  readonly?: boolean;
};

export type DbClient = {
  prepare: (sql: string) => {
    all: <T = Record<string, unknown>>(...args: unknown[]) => T[];
    get: <T = Record<string, unknown>>(...args: unknown[]) => T | undefined;
    run: (...args: unknown[]) => { changes?: number };
  };
  pragma?: (sql: string) => void;
  close: () => void;
};

type CoreModule = {
  SqliteAdapter: new (client: SqliteClient) => {
    ensureSchema: () => Promise<void>;
    saveData: (data: AppData) => Promise<void>;
  };
  normalizeAppData: (data: AppData) => AppData;
};

const isBun = () => typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeBootstrapData = (core: CoreModule, raw: unknown): AppData => {
  const record = isRecord(raw) ? raw : {};
  return core.normalizeAppData({
    tasks: Array.isArray(record.tasks) ? (record.tasks as AppData['tasks']) : [],
    projects: Array.isArray(record.projects) ? (record.projects as AppData['projects']) : [],
    sections: Array.isArray(record.sections) ? (record.sections as AppData['sections']) : [],
    areas: Array.isArray(record.areas) ? (record.areas as AppData['areas']) : [],
    people: Array.isArray(record.people) ? (record.people as AppData['people']) : [],
    settings: isRecord(record.settings) ? (record.settings as AppData['settings']) : {},
  });
};

const createBootstrapSqliteClient = async (dbPath: string) => {
  if (isBun()) {
    const mod = await import('bun:sqlite');
    const db = new mod.Database(dbPath);
    const run = async (sql: string, params: unknown[] = []) => {
      db.prepare(sql).run(params);
    };
    const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(params) as T[];
    const get = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).get(params) as T | undefined;
    const exec = async (sql: string) => {
      db.exec(sql);
    };
    await exec('PRAGMA journal_mode = WAL;');
    await exec('PRAGMA foreign_keys = ON;');
    await exec('PRAGMA busy_timeout = 5000;');
    return {
      client: { run, all, get, exec } satisfies SqliteClient,
      close: () => db.close(),
    };
  }

  const mod = await import('better-sqlite3');
  const Database = mod.default;
  const db = new Database(dbPath);
  const run = async (sql: string, params: unknown[] = []) => {
    db.prepare(sql).run(params);
  };
  const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    db.prepare(sql).all(params) as T[];
  const get = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    db.prepare(sql).get(params) as T | undefined;
  const exec = async (sql: string) => {
    db.exec(sql);
  };
  await exec('PRAGMA journal_mode = WAL;');
  await exec('PRAGMA foreign_keys = ON;');
  await exec('PRAGMA busy_timeout = 5000;');
  return {
    client: { run, all, get, exec } satisfies SqliteClient,
    close: () => db.close(),
  };
};

async function bootstrapMindwtrDbFromJson(dbPath: string, dataJsonPath: string): Promise<void> {
  const raw = await readFile(dataJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const core = (await import('@mindwtr/core')) as CoreModule;
  const data = normalizeBootstrapData(core, parsed);

  mkdirSync(dirname(dbPath), { recursive: true });
  // Build at a temp path and rename into place. A SIGKILL, a host startup timeout,
  // or the server's own SIGINT handler partway through must never leave a
  // schema-only database at the canonical path: the next start would see the file,
  // skip the bootstrap, and serve an empty library forever.
  const tempPath = `${dbPath}.bootstrap-tmp`;
  const removeTemp = () => {
    rmSync(tempPath, { force: true });
    rmSync(`${tempPath}-shm`, { force: true });
    rmSync(`${tempPath}-wal`, { force: true });
  };
  // A temp left by an interrupted earlier start is never reused. Two first starts
  // at once would still collide, exactly as the previous in-place build did.
  removeTemp();
  const { client, close } = await createBootstrapSqliteClient(tempPath);
  let closed = false;
  const closeOnce = () => {
    if (closed) return;
    closed = true;
    close();
  };
  try {
    const adapter = new core.SqliteAdapter(client);
    await adapter.ensureSchema();
    await adapter.saveData(data);
    // Fold the WAL into the database file before the rename: the -wal sibling is
    // left behind at the temp path, so the renamed file has to be self-contained.
    await client.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    closeOnce();
    renameSync(tempPath, dbPath);
  } finally {
    closeOnce();
    removeTemp();
  }
}

export async function ensureMindwtrDbPath(options: DbOptions = {}): Promise<string> {
  const path = resolveMindwtrDbPath(options.dbPath);
  if (existsSync(path)) return path;

  const dataJsonPath = resolveMindwtrDataJsonPath(options.dbPath);
  if (existsSync(dataJsonPath)) {
    // Build the database beside the data.json it comes from. Discovery may have
    // picked the installed data/ candidate on a profile whose data.json is still
    // flat, and the desktop app only ever looks where its own data.json lives;
    // a database anywhere else is an orphan it never reads (#1245). With an
    // explicit --db the two already share a directory, so this keeps that path.
    const bootstrapPath = join(dirname(dataJsonPath), basename(path));
    try {
      console.warn(`[mindwtr-mcp] Bootstrapping SQLite database from fallback data.json: ${dataJsonPath}`);
      await bootstrapMindwtrDbFromJson(bootstrapPath, dataJsonPath);
      if (existsSync(bootstrapPath)) {
        console.warn(`[mindwtr-mcp] Bootstrapped SQLite database at: ${bootstrapPath}`);
        return bootstrapPath;
      }
    } catch (error) {
      throw new Error(
        `Mindwtr database not found at: ${path}\n` +
        `Found fallback data at: ${dataJsonPath}\n` +
        `Failed to bootstrap SQLite from data.json: ${getErrorMessage(error)}`
      );
    }
  }

  throw new Error(
    `Mindwtr database not found at: ${path}\n` +
    `Please ensure the Mindwtr app has been run at least once to create the database, ` +
    `or specify a custom path using --db /path/to/mindwtr.db or MINDWTR_DB_PATH environment variable.`
  );
}

export async function openMindwtrDb(options: DbOptions = {}) {
  const path = await ensureMindwtrDbPath(options);

  let db: DbClient;
  if (isBun()) {
    const mod = await import('bun:sqlite');
    // bun:sqlite doesn't accept { readonly: false }, only omit or { readonly: true }
    db = options.readonly
      ? new mod.Database(path, { readonly: true })
      : new mod.Database(path);
  } else {
    const mod = await import('better-sqlite3');
    const Database = mod.default;
    db = new Database(path, {
      readonly: options.readonly ?? false,
      fileMustExist: true,
    });
  }

  // Configure pragmas - use pragma method if available, otherwise fall back to exec
  const runPragma = (sql: string) => {
    if (db.pragma) {
      db.pragma(sql);
    } else {
      db.prepare(`PRAGMA ${sql}`).run();
    }
  };
  runPragma('journal_mode = WAL');
  runPragma('foreign_keys = ON');
  runPragma('busy_timeout = 5000');

  return { db, path };
}

export function closeDb(db: DbClient) {
  try {
    db.close();
  } catch {
    // ignore close errors
  }
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
