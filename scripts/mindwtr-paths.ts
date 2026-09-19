import { existsSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

// The folder list lives in the MCP server because that package is published and cannot import
// from scripts/; the import only ever goes this way. A local copy drifted twice in three days.
import { getDesktopProfileDirs } from '../apps/mcp-server/src/paths';

const DATA_FILE_NAME = 'data.json';
const DB_FILE_NAME = 'mindwtr.db';

function firstExisting(paths: string[]): string | null {
    for (const path of paths) {
        if (existsSync(path)) return path;
    }
    return null;
}

// v1.3.2 moved an installed Windows or macOS profile from <root>/ into <root>/data/
// (#1245), so a path pinned on either side of that move is one folder off while the
// file itself sits in the sibling folder. Two conditions before redirecting: the
// sibling file exists, AND mindwtr.db sits beside it, which is what makes that folder
// a Mindwtr profile rather than any folder that happens to be called `data` next to
// any file that happens to be called `data.json` — the storage layer rewrites the
// file it opens, so a generic name must never be enough. With no profile there the
// pinned path is returned untouched, so an explicit --data/--db at a fresh location
// still means "make the profile here" and nothing is created early.
function withSiblingLayoutFallback(path: string): string {
    if (existsSync(path)) return path;
    const dir = dirname(path);
    const file = basename(path);
    const sibling = basename(dir) === 'data' ? join(dirname(dir), file) : join(dir, 'data', file);
    if (!existsSync(sibling) || !existsSync(join(dirname(sibling), DB_FILE_NAME))) return path;
    // stderr: stdout is the CLI's machine-readable contract.
    console.error(`[mindwtr] Using ${sibling} (nothing at the configured path: ${path})`);
    return sibling;
}

export function resolveMindwtrDataPath(overridePath?: string): string {
    const explicit = overridePath || process.env.MINDWTR_DATA;
    if (explicit) return withSiblingLayoutFallback(resolve(explicit));

    const candidates = getDesktopProfileDirs().map((root) => join(root, DATA_FILE_NAME));
    return firstExisting(candidates) || candidates[0];
}

export function resolveMindwtrDbPath(overridePath?: string, dataPath?: string): string {
    const explicit = overridePath || process.env.MINDWTR_DB_PATH || process.env.MINDWTR_DB;
    if (explicit) return withSiblingLayoutFallback(resolve(explicit));
    if (dataPath) return join(dirname(resolve(dataPath)), DB_FILE_NAME);

    const candidates = getDesktopProfileDirs().map((root) => join(root, DB_FILE_NAME));
    return firstExisting(candidates) || candidates[0];
}

export function resolveMindwtrStoragePaths(options?: { dataPath?: string; dbPath?: string }) {
    const dataPath = resolveMindwtrDataPath(options?.dataPath);
    const dbPath = resolveMindwtrDbPath(options?.dbPath, dataPath);
    return { dataPath, dbPath };
}
