import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

const APP_ID = 'tech.dongdongbh.mindwtr';
const APP_DIR = 'mindwtr';

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

function getCandidateDataPaths(): string[] {
    const configHome = getConfigHome();
    const dataHome = getDataHome();

    return [
        // Current desktop storage (v0.3.x): config dir + mindwtr/data.json
        join(configHome, APP_DIR, 'data.json'),
        // Proposed XDG-style layout (data dir + mindwtr/data.json)
        join(dataHome, APP_DIR, 'data.json'),
        // Legacy Tauri identifier-based paths
        join(dataHome, APP_ID, 'data.json'),
        join(configHome, APP_ID, 'data.json'),
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

    const candidates = getCandidateDataPaths();
    const existing = firstExisting(candidates);
    return existing || candidates[0] || join(getConfigHome(), APP_DIR, 'data.json');
}
