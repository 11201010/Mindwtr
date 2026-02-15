import type { AppData } from './types';

export const cloneAppData = (data: AppData): AppData => JSON.parse(JSON.stringify(data)) as AppData;

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

type WebdavDownloadBackoffOptions = {
    missingBackoffMs: number;
    errorBackoffMs: number;
};

export const createWebdavDownloadBackoff = (options: WebdavDownloadBackoffOptions) => {
    const backoff = new Map<string, number>();

    return {
        getBlockedUntil(attachmentId: string): number | null {
            const blockedUntil = backoff.get(attachmentId);
            if (!blockedUntil) return null;
            if (Date.now() >= blockedUntil) {
                backoff.delete(attachmentId);
                return null;
            }
            return blockedUntil;
        },
        setFromError(attachmentId: string, error: unknown): void {
            const status = getErrorStatus(error);
            if (status === 404) {
                backoff.set(attachmentId, Date.now() + options.missingBackoffMs);
                return;
            }
            backoff.set(attachmentId, Date.now() + options.errorBackoffMs);
        },
        prune(now = Date.now()): void {
            for (const [id, blockedUntil] of backoff) {
                if (blockedUntil <= now) {
                    backoff.delete(id);
                }
            }
        },
        deleteEntry(attachmentId: string): void {
            backoff.delete(attachmentId);
        },
        clear(): void {
            backoff.clear();
        },
        size(): number {
            return backoff.size;
        },
    };
};
