import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveMindwtrDbPath } from './paths.js';

const originalEnv = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  MINDWTR_DB_PATH: process.env.MINDWTR_DB_PATH,
  MINDWTR_DB: process.env.MINDWTR_DB,
};
const tempDirs: string[] = [];

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('mcp default database discovery', () => {
  if (process.platform !== 'linux') return;

  test('prefers the data/ subfolder over a flat root an older version left behind', () => {
    const dataHome = mkdtempSync(join(tmpdir(), 'mindwtr-mcp-layout-'));
    tempDirs.push(dataHome);
    const flatDb = join(dataHome, 'mindwtr', 'mindwtr.db');
    const splitDb = join(dataHome, 'mindwtr', 'data', 'mindwtr.db');
    mkdirSync(join(splitDb, '..'), { recursive: true });
    writeFileSync(flatDb, '');
    writeFileSync(splitDb, '');

    process.env.XDG_DATA_HOME = dataHome;
    delete process.env.MINDWTR_DB_PATH;
    delete process.env.MINDWTR_DB;

    expect(resolveMindwtrDbPath()).toBe(splitDb);
  });

  test('discovers the Flatpak database when XDG locations are empty', () => {
    const home = mkdtempSync(join(tmpdir(), 'mindwtr-mcp-flatpak-'));
    tempDirs.push(home);
    const dbPath = join(
      home,
      '.var',
      'app',
      'tech.dongdongbh.mindwtr',
      'data',
      'mindwtr',
      'mindwtr.db'
    );
    mkdirSync(join(dbPath, '..'), { recursive: true });
    writeFileSync(dbPath, '');

    process.env.HOME = home;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.MINDWTR_DB_PATH;
    delete process.env.MINDWTR_DB;

    expect(resolveMindwtrDbPath()).toBe(dbPath);
  });
});
