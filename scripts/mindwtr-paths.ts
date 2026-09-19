import { existsSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

const APP_ID = 'tech.dongdongbh.mindwtr';
const APP_DIR = 'mindwtr';
const DATA_FILE_NAME = 'data.json';
const DB_FILE_NAME = 'mindwtr.db';

function getLinuxConfigHome() {
    return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

function getLinuxDataHome() {
    return process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
}

function getWindowsAppDataHome() {
    return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
}

function getMacAppSupportHome() {
    return join(homedir(), 'Library', 'Application Support');
}

function getConfigHome(): string {
    const platform = process.platform;
    if (platform === 'win32') return getWindowsAppDataHome();
    if (platform === 'darwin') return getMacAppSupportHome();
    return getLinuxConfigHome();
}

function getDataHome(): string {
    const platform = process.platform;
    if (platform === 'win32') return getWindowsAppDataHome();
    if (platform === 'darwin') return getMacAppSupportHome();
    return getLinuxDataHome();
}

function getCandidateRoots(): string[] {
    const platform = process.platform;
    const configHome = getConfigHome();
    const dataHome = getDataHome();

    return [
        // Installed Windows and macOS builds keep the profile under data/ since
        // v1.3.2 (#1245); a flat root left behind by an older version comes next.
        // Linux and the portable build never split, so the subfolder is not a
        // candidate there: an orphan data/ copy must never win over the real one.
        ...(platform === 'win32' || platform === 'darwin' ? [join(dataHome, APP_DIR, 'data')] : []),
        join(dataHome, APP_DIR),
        join(configHome, APP_DIR),
        join(dataHome, APP_ID),
        join(configHome, APP_ID),
    ];
}

function firstExisting(paths: string[]): string | null {
    for (const path of paths) {
        if (existsSync(path)) return path;
    }
    return null;
}

export function resolveMindwtrDataPath(overridePath?: string): string {
    const explicit = overridePath || process.env.MINDWTR_DATA;
    if (explicit) return resolve(explicit);

    const candidates = getCandidateRoots().map((root) => join(root, DATA_FILE_NAME));
    const existing = firstExisting(candidates);
    return existing || candidates[0] || join(getDataHome(), APP_DIR, DATA_FILE_NAME);
}

export function resolveMindwtrDbPath(overridePath?: string, dataPath?: string): string {
    const explicit = overridePath || process.env.MINDWTR_DB_PATH || process.env.MINDWTR_DB;
    if (explicit) return resolve(explicit);
    if (dataPath) return join(dirname(resolve(dataPath)), DB_FILE_NAME);

    const candidates = getCandidateRoots().map((root) => join(root, DB_FILE_NAME));
    const existing = firstExisting(candidates);
    return existing || candidates[0] || join(getDataHome(), APP_DIR, DB_FILE_NAME);
}

export function resolveMindwtrStoragePaths(options?: { dataPath?: string; dbPath?: string }) {
    const dataPath = resolveMindwtrDataPath(options?.dataPath);
    const dbPath = resolveMindwtrDbPath(options?.dbPath, dataPath);
    return { dataPath, dbPath };
}
