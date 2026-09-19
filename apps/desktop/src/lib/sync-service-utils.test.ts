import { describe, expect, it, vi } from 'vitest';

import { createLocalAttachmentFs, resolveFileBackendPath, writeFileSafelyAbsolute } from './sync-service-utils';

const BASE_DATA_DIR = '/os-data';
const MANAGED_DIR = '/new-profile/attachments';
const STALE_URI = '/old-profile/attachments/a1.pdf';
const MANAGED_FILE = `${MANAGED_DIR}/a1.pdf`;

const createFs = (files: Record<string, Uint8Array>) => {
    const exists = vi.fn(async (path: string) => path in files);
    const readFile = vi.fn(async (path: string) => {
        const bytes = files[path];
        if (!bytes) throw new Error(`missing ${path}`);
        return bytes;
    });
    return { exists, readFile };
};

describe('createLocalAttachmentFs managed-dir fallback', () => {
    it('recovers a stale portable path from the current managed dir', async () => {
        // #1038: moving a portable profile leaves every stored URI pointing at
        // the previous location while the file travelled inside attachments/.
        const bytes = new Uint8Array([1, 2, 3]);
        const { exists, readFile } = createFs({ [MANAGED_FILE]: bytes });
        const logSyncWarning = vi.fn();
        const fs = createLocalAttachmentFs(logSyncWarning, {
            baseDataDir: BASE_DATA_DIR,
            dataBaseDir: 'data',
            exists,
            readFile,
            managedAttachmentsDir: MANAGED_DIR,
        });

        const attachment = { id: 'a1' };
        expect(await fs.localFilePresence(STALE_URI, attachment)).toBe('present');
        expect(await fs.localFileExists(STALE_URI, attachment)).toBe(true);
        expect(await fs.readLocalFile(STALE_URI, attachment)).toBe(bytes);
    });

    it('still reports a genuinely missing file as missing', async () => {
        const { exists, readFile } = createFs({});
        const fs = createLocalAttachmentFs(vi.fn(), {
            baseDataDir: BASE_DATA_DIR,
            dataBaseDir: 'data',
            exists,
            readFile,
            managedAttachmentsDir: MANAGED_DIR,
        });

        const attachment = { id: 'report' };
        expect(await fs.localFilePresence('/home/demo/report.pdf', attachment)).toBe('confirmed-not-found');
        expect(await fs.localFileExists('/home/demo/report.pdf', attachment)).toBe(false);
        await expect(fs.readLocalFile('/home/demo/report.pdf', attachment)).rejects.toThrow();
    });

    it('leaves callers without a managed dir on the recorded path only', async () => {
        const { exists, readFile } = createFs({ [MANAGED_FILE]: new Uint8Array([1]) });
        const fs = createLocalAttachmentFs(vi.fn(), {
            baseDataDir: BASE_DATA_DIR,
            dataBaseDir: 'data',
            exists,
            readFile,
        });

        expect(await fs.localFileExists(STALE_URI, { id: 'a1' })).toBe(false);
    });

    it('does not treat a path that only shares the data-dir prefix as managed', async () => {
        const outsidePath = `${BASE_DATA_DIR}-archive/a1.pdf`;
        const bytes = new Uint8Array([1, 2, 3]);
        const { exists, readFile } = createFs({ [outsidePath]: bytes });
        const fs = createLocalAttachmentFs(vi.fn(), {
            baseDataDir: BASE_DATA_DIR,
            dataBaseDir: 'data',
            exists,
            readFile,
        });

        const attachment = { id: 'a1' };
        expect(await fs.localFileExists(outsidePath, attachment)).toBe(true);
        expect(await fs.readLocalFile(outsidePath, attachment)).toBe(bytes);
        expect(exists).toHaveBeenCalledWith(outsidePath);
        expect(readFile).toHaveBeenCalledWith(outsidePath);
    });

    it('does not fall back to a managed file owned by a different attachment', async () => {
        const { exists, readFile } = createFs({ [MANAGED_FILE]: new Uint8Array([1]) });
        const fs = createLocalAttachmentFs(vi.fn(), {
            baseDataDir: BASE_DATA_DIR,
            dataBaseDir: 'data',
            exists,
            readFile,
            managedAttachmentsDir: MANAGED_DIR,
        });

        expect(await fs.localFileExists(STALE_URI, { id: 'different-id' })).toBe(false);
        await expect(fs.readLocalFile(STALE_URI, { id: 'different-id' })).rejects.toThrow();
        expect(exists).not.toHaveBeenCalledWith(MANAGED_FILE);
    });

    it('uses a successful managed fallback after the recorded-path probe errors', async () => {
        const exists = vi.fn(async (path: string) => {
            if (path === STALE_URI) throw new Error('portable path unavailable');
            return path === MANAGED_FILE;
        });
        const fs = createLocalAttachmentFs(vi.fn(), {
            baseDataDir: BASE_DATA_DIR,
            dataBaseDir: 'data',
            exists,
            readFile: vi.fn(),
            managedAttachmentsDir: MANAGED_DIR,
        });

        await expect(fs.localFilePresence(STALE_URI, { id: 'a1' })).resolves.toBe('present');
    });

    it('reports unreadable when any candidate errors and no fallback proves presence', async () => {
        const exists = vi.fn(async (path: string) => {
            if (path === MANAGED_FILE) throw new Error('managed storage denied');
            return false;
        });
        const fs = createLocalAttachmentFs(vi.fn(), {
            baseDataDir: BASE_DATA_DIR,
            dataBaseDir: 'data',
            exists,
            readFile: vi.fn(),
            managedAttachmentsDir: MANAGED_DIR,
        });

        await expect(fs.localFilePresence(STALE_URI, { id: 'a1' })).resolves.toBe('unreadable');
    });
});

// #1245 moved an installed Windows/macOS profile's managed folders from <root>/
// down into <root>/data/. Unlike the relocated portable profile of #1038 the
// stale path sits INSIDE the OS data dir, the one shape the old fallback skipped:
// presence said "present" while stat and read still failed, which pins the
// attachment as a pending upload and stops every remote write for the device.
describe('createLocalAttachmentFs flat-root fallback after the profile folder move', () => {
    const OS_DATA_DIR = '/Roaming';
    const MOVED_ATTACHMENTS_DIR = '/Roaming/mindwtr/data/attachments';

    const createMovedFs = (files: Record<string, Uint8Array>) => {
        const exists = vi.fn(async (path: string, options?: { baseDir: unknown }) => (
            !options && path in files
        ));
        const readFile = vi.fn(async (path: string, options?: { baseDir: unknown }) => {
            const bytes = options ? undefined : files[path];
            if (!bytes) throw new Error(`missing ${path}`);
            return bytes;
        });
        const stat = vi.fn(async (path: string, options?: { baseDir: unknown }) => {
            const bytes = options ? undefined : files[path];
            if (!bytes) throw new Error(`missing ${path}`);
            return { mtime: new Date(1700000000000), size: bytes.length };
        });
        return { exists, readFile, stat };
    };

    const createMovedAttachmentFs = (files: Record<string, Uint8Array>) => {
        const { exists, readFile, stat } = createMovedFs(files);
        const fs = createLocalAttachmentFs(vi.fn(), {
            baseDataDir: OS_DATA_DIR,
            dataBaseDir: 'data',
            exists,
            readFile,
            stat,
            managedAttachmentsDir: MOVED_ATTACHMENTS_DIR,
        });
        return { fs, exists, readFile, stat };
    };

    it('reads, stats and confirms a stale flat-root attachment that now lives under data/', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const moved = `${MOVED_ATTACHMENTS_DIR}/a1.pdf`;
        const { fs } = createMovedAttachmentFs({ [moved]: bytes });

        const attachment = { id: 'a1' };
        const stale = '/Roaming/mindwtr/attachments/a1.pdf';
        expect(await fs.localFilePresence(stale, attachment)).toBe('present');
        expect(await fs.readLocalFile(stale, attachment)).toBe(bytes);
        expect(await fs.statLocalFile(stale, attachment)).toEqual({ mtimeMs: 1700000000000, size: 3 });
    });

    it('recovers an audio capture whose file name is not the attachment id', async () => {
        const bytes = new Uint8Array([4, 5]);
        const moved = '/Roaming/mindwtr/data/audio-captures/mindwtr-audio-1756-abc.wav';
        const { fs } = createMovedAttachmentFs({ [moved]: bytes });

        const attachment = { id: 'attachment-uuid' };
        const stale = '/Roaming/mindwtr/audio-captures/mindwtr-audio-1756-abc.wav';
        expect(await fs.localFilePresence(stale, attachment)).toBe('present');
        expect(await fs.readLocalFile(stale, attachment)).toBe(bytes);
        expect(await fs.statLocalFile(stale, attachment)).toEqual({ mtimeMs: 1700000000000, size: 2 });
    });

    it('never re-homes a path that escapes the managed data dir', async () => {
        const { fs, exists } = createMovedAttachmentFs({});

        const hostile = '/Roaming/mindwtr/attachments/../../../secrets.toml';
        expect(await fs.localFilePresence(hostile, { id: 'a1' })).toBe('confirmed-not-found');
        expect(exists.mock.calls.every(([path]) => !String(path).includes('secrets.toml') || String(path).includes('..')))
            .toBe(true);
        expect(exists).toHaveBeenCalledTimes(1);
    });

    it('leaves a folder the move did not touch on its recorded path', async () => {
        const pasted = '/Roaming/mindwtr/quick-add-images/pasted-1.png';
        const { fs, exists } = createMovedAttachmentFs({});

        expect(await fs.localFilePresence(pasted, { id: 'a1' })).toBe('confirmed-not-found');
        expect(exists).toHaveBeenCalledTimes(1);
    });
});

describe('resolveFileBackendPath', () => {
    const join = vi.fn(async (...paths: string[]) => paths.join('/'));

    it('resolves an ordinary cloudKey under the sync folder', async () => {
        await expect(resolveFileBackendPath(join, '/sync', 'attachments/a1.pdf'))
            .resolves.toBe('/sync/attachments/a1.pdf');
    });

    // SEC-08: a cloudKey arrives over sync, so it is attacker-controlled input to a
    // filesystem write/delete. Escaping the sync folder must fail loudly — both callers
    // treat a rejection as a failed transfer, never as a completed one.
    it('refuses a cloudKey that escapes the sync folder', async () => {
        for (const hostile of ['attachments/../../escape.txt', 'attachments\\..\\..\\escape.txt', '../escape.txt', 'attachments/a\0.pdf']) {
            await expect(resolveFileBackendPath(join, '/sync', hostile)).rejects.toThrow(/outside the sync folder|invalid/i);
        }
    });
});

// #1057: attachment downloads must be write-temp-then-rename so a cut connection
// can never leave a truncated file at the real target path that a later sync would
// mistake for new content.
describe('writeFileSafelyAbsolute', () => {
    it('never touches the target path until the temp write has fully succeeded', async () => {
        const target = '/managed/attachments/a1.pdf';
        const previousBytes = new Uint8Array([9, 9, 9]);
        const files = new Map<string, Uint8Array>([[target, previousBytes]]);
        const writeFile = vi.fn(async (path: string, data: Uint8Array) => {
            if (path === target) throw new Error('should never write the target directly on the happy path');
            files.set(path, data);
        });
        const rename = vi.fn(async (from: string, to: string) => {
            files.set(to, files.get(from)!);
            files.delete(from);
        });
        const remove = vi.fn(async (path: string) => { files.delete(path); });

        await writeFileSafelyAbsolute(target, new Uint8Array([1, 2, 3]), { writeFile, rename, remove });

        expect(files.get(target)).toEqual(new Uint8Array([1, 2, 3]));
        // The first writeFile call landed on a temp path, not the target.
        expect(writeFile.mock.calls[0]?.[0]).toMatch(
            /^\/managed\/attachments\/\.mindwtr-attachment-write-[0-9a-z]+-[0-9a-f]{12}\.tmp$/,
        );
    });

    it('a failed temp write leaves the previously-downloaded file completely untouched', async () => {
        const target = '/managed/attachments/a1.pdf';
        const previousBytes = new Uint8Array([9, 9, 9]);
        const files = new Map<string, Uint8Array>([[target, previousBytes]]);
        const tempWriteError = new Error('connection cut mid-download');
        const writeFile = vi.fn(async (path: string, data: Uint8Array) => {
            if (path !== target) throw tempWriteError;
            files.set(path, data);
        });
        const rename = vi.fn();
        const remove = vi.fn();

        await expect(
            writeFileSafelyAbsolute(target, new Uint8Array([1, 2, 3]), { writeFile, rename, remove }),
        ).rejects.toThrow(tempWriteError);

        // The interrupted download never reached the rename step, so the file that
        // was there before this sync pass is exactly as it was — never truncated,
        // never partially overwritten.
        expect(files.get(target)).toEqual(previousBytes);
        expect(rename).not.toHaveBeenCalled();
    });
});
