const PROJECTS_SIDEBAR_WIDTH_STORAGE_KEY = 'mindwtr:projects:sidebarWidth';

export const PROJECTS_SIDEBAR_DEFAULT_WIDTH = 304;
export const PROJECTS_SIDEBAR_MIN_WIDTH = 240;
export const PROJECTS_SIDEBAR_MAX_WIDTH = 520;
export const PROJECTS_WORKSPACE_MIN_WIDTH = 380;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
    if (storage !== undefined) return storage ?? null;
    if (typeof window === 'undefined') return null;
    return window.localStorage;
}

export function getProjectsSidebarMaxWidth(containerWidth?: number) {
    if (typeof containerWidth !== 'number' || !Number.isFinite(containerWidth)) {
        return PROJECTS_SIDEBAR_MAX_WIDTH;
    }

    const maxWidth = Math.floor(containerWidth) - PROJECTS_WORKSPACE_MIN_WIDTH;
    return Math.max(
        PROJECTS_SIDEBAR_MIN_WIDTH,
        Math.min(PROJECTS_SIDEBAR_MAX_WIDTH, maxWidth),
    );
}

export function clampProjectsSidebarWidth(width: number, containerWidth?: number) {
    const maxWidth = getProjectsSidebarMaxWidth(containerWidth);
    const fallbackWidth = Math.min(PROJECTS_SIDEBAR_DEFAULT_WIDTH, maxWidth);

    if (!Number.isFinite(width)) return fallbackWidth;

    return Math.min(
        Math.max(Math.round(width), PROJECTS_SIDEBAR_MIN_WIDTH),
        maxWidth,
    );
}

export function loadProjectsSidebarWidth(storage?: StorageLike | null) {
    const target = resolveStorage(storage);
    if (!target) return PROJECTS_SIDEBAR_DEFAULT_WIDTH;

    try {
        const raw = target.getItem(PROJECTS_SIDEBAR_WIDTH_STORAGE_KEY);
        if (!raw) return PROJECTS_SIDEBAR_DEFAULT_WIDTH;
        return clampProjectsSidebarWidth(Number.parseFloat(raw));
    } catch {
        return PROJECTS_SIDEBAR_DEFAULT_WIDTH;
    }
}

export function saveProjectsSidebarWidth(width: number, storage?: StorageLike | null) {
    const target = resolveStorage(storage);
    if (!target) return;

    try {
        target.setItem(
            PROJECTS_SIDEBAR_WIDTH_STORAGE_KEY,
            String(clampProjectsSidebarWidth(width)),
        );
    } catch {
        // storage unavailable — fall back to in-memory only
    }
}
