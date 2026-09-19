import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveMindwtrDbPath } from './mindwtr-paths';

const originalPlatform = process.platform;
const originalEnv = {
    APPDATA: process.env.APPDATA,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    MINDWTR_DATA: process.env.MINDWTR_DATA,
    MINDWTR_DB_PATH: process.env.MINDWTR_DB_PATH,
    MINDWTR_DB: process.env.MINDWTR_DB,
};
const tempDirs: string[] = [];

const setPlatform = (platform: string) => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
};

const makeTempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'mindwtr-paths-'));
    tempDirs.push(dir);
    return dir;
};

const touch = (path: string) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '');
};

afterEach(() => {
    setPlatform(originalPlatform);
    for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) rmSync(dir, { recursive: true, force: true });
    }
});

const clearOverrides = () => {
    delete process.env.MINDWTR_DATA;
    delete process.env.MINDWTR_DB_PATH;
    delete process.env.MINDWTR_DB;
};

describe('automation script database discovery', () => {
    test('prefers the data/ subfolder on Windows over a flat root an older version left behind', () => {
        const appData = makeTempDir();
        const flatDb = join(appData, 'mindwtr', 'mindwtr.db');
        const splitDb = join(appData, 'mindwtr', 'data', 'mindwtr.db');
        touch(flatDb);
        touch(splitDb);

        setPlatform('win32');
        process.env.APPDATA = appData;
        clearOverrides();

        expect(resolveMindwtrDbPath()).toBe(splitDb);
    });

    test('still finds a flat Windows root written by 1.3.1 and earlier', () => {
        const appData = makeTempDir();
        const flatDb = join(appData, 'mindwtr', 'mindwtr.db');
        touch(flatDb);

        setPlatform('win32');
        process.env.APPDATA = appData;
        clearOverrides();

        expect(resolveMindwtrDbPath()).toBe(flatDb);
    });

    test('keeps the flat root on Linux, where the app never uses a data/ subfolder', () => {
        const dataHome = makeTempDir();
        const flatDb = join(dataHome, 'mindwtr', 'mindwtr.db');
        const splitDb = join(dataHome, 'mindwtr', 'data', 'mindwtr.db');
        touch(flatDb);
        touch(splitDb);

        setPlatform('linux');
        process.env.XDG_DATA_HOME = dataHome;
        process.env.XDG_CONFIG_HOME = join(dataHome, 'config');
        clearOverrides();

        expect(resolveMindwtrDbPath()).toBe(flatDb);
    });
});
