import type { AppData, Attachment } from '@mindwtr/core';

export const ATTACHMENTS_DIR_NAME = 'attachments';

export const toStableJson = (value: unknown): string => {
    const normalize = (input: any): any => {
        if (Array.isArray(input)) {
            return input.map(normalize);
        }
        if (input && typeof input === 'object') {
            const entries = Object.keys(input)
                .sort()
                .map((key) => [key, normalize(input[key])]);
            const result: Record<string, any> = {};
            for (const [key, val] of entries) {
                result[key] = val;
            }
            return result;
        }
        return input;
    };
    return JSON.stringify(normalize(value));
};

export const hashString = async (value: string): Promise<string> => {
    if (globalThis.crypto?.subtle) {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    }

    // Fallback for runtimes without Web Crypto.
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = Math.imul(31, hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(16);
};

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const getErrorStatus = (error: unknown): number | null => {
    if (!error || typeof error !== 'object') return null;
    const anyError = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
    const status = anyError.status ?? anyError.statusCode ?? anyError.response?.status;
    return typeof status === 'number' ? status : null;
};

export const isWebdavRateLimitedError = (error: unknown): boolean => {
    const status = getErrorStatus(error);
    if (status === 429 || status === 503) return true;
    const message = error instanceof Error ? error.message : String(error || '');
    const normalized = message.toLowerCase();
    return (
        normalized.includes('blockedtemporarily') ||
        normalized.includes('too many requests') ||
        normalized.includes('rate limit') ||
        normalized.includes('rate limited')
    );
};

export const normalizePath = (input: string) => input.replace(/\\/g, '/').toLowerCase();

export const isSyncFilePath = (path: string, syncFileName: string, legacySyncFileName: string) => {
    const normalized = normalizePath(path);
    return normalized.endsWith(`/${syncFileName}`) || normalized.endsWith(`/${legacySyncFileName}`);
};

export const cloneAppData = (data: AppData): AppData => JSON.parse(JSON.stringify(data)) as AppData;

export const stripFileScheme = (uri: string): string => {
    if (!/^file:\/\//i.test(uri)) return uri;
    try {
        const parsed = new URL(uri);
        let path = decodeURIComponent(parsed.pathname);
        if (/^\/[A-Za-z]:\//.test(path)) {
            path = path.slice(1);
        }
        return path;
    } catch {
        return uri.replace(/^file:\/\//i, '');
    }
};

export const extractExtension = (value?: string): string => {
    if (!value) return '';
    const stripped = value.split('?')[0].split('#')[0];
    const leaf = stripped.split(/[\\/]/).pop() || '';
    const match = leaf.match(/\.[A-Za-z0-9]{1,8}$/);
    return match ? match[0].toLowerCase() : '';
};

const buildTempPath = (relativePath: string): string => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    return `${relativePath}.tmp-${suffix}`;
};

export const writeAttachmentFileSafely = async (
    relativePath: string,
    bytes: Uint8Array,
    options: {
        baseDir: any;
        writeFile: (path: string, data: Uint8Array, opts: { baseDir: any }) => Promise<void>;
        rename: (oldPath: string, newPath: string, opts: { oldPathBaseDir: any; newPathBaseDir: any }) => Promise<void>;
        remove: (path: string, opts: { baseDir: any }) => Promise<void>;
    }
): Promise<void> => {
    const tempPath = buildTempPath(relativePath);
    await options.writeFile(tempPath, bytes, { baseDir: options.baseDir });
    try {
        await options.rename(tempPath, relativePath, {
            oldPathBaseDir: options.baseDir,
            newPathBaseDir: options.baseDir,
        });
    } catch {
        await options.writeFile(relativePath, bytes, { baseDir: options.baseDir });
        try {
            await options.remove(tempPath, { baseDir: options.baseDir });
        } catch {
            // Ignore cleanup errors for temp file.
        }
    }
};

export const writeFileSafelyAbsolute = async (
    path: string,
    bytes: Uint8Array,
    options: {
        writeFile: (path: string, data: Uint8Array) => Promise<void>;
        rename: (oldPath: string, newPath: string) => Promise<void>;
        remove: (path: string) => Promise<void>;
    }
): Promise<void> => {
    const tempPath = buildTempPath(path);
    await options.writeFile(tempPath, bytes);
    try {
        await options.rename(tempPath, path);
    } catch {
        await options.writeFile(path, bytes);
        try {
            await options.remove(tempPath);
        } catch {
            // Ignore cleanup errors for temp file.
        }
    }
};

export const buildCloudKey = (attachment: Attachment): string => {
    const ext = extractExtension(attachment.title) || extractExtension(attachment.uri);
    return `${ATTACHMENTS_DIR_NAME}/${attachment.id}${ext}`;
};

export const isTempAttachmentFile = (name: string): boolean => {
    return name.includes('.tmp-') || name.endsWith('.tmp') || name.endsWith('.partial');
};
