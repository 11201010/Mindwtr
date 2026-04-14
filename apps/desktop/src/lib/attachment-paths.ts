import { stripFileScheme } from './sync-service-utils';

const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATTERN = /^\\\\[^\\]/;

export function isLocalAttachmentPath(uri: string): boolean {
    const trimmed = uri.trim();
    if (!trimmed) return false;
    if (/^file:\/\//i.test(trimmed)) return true;
    if (WINDOWS_DRIVE_PATTERN.test(trimmed)) return true;
    if (WINDOWS_UNC_PATTERN.test(trimmed)) return true;
    if (trimmed.startsWith('/')) return true;
    return !URI_SCHEME_PATTERN.test(trimmed);
}

export function resolveAttachmentOpenTarget(uri: string): string {
    const trimmed = uri.trim();
    if (!trimmed) return trimmed;
    if (!isLocalAttachmentPath(trimmed)) return trimmed;
    return stripFileScheme(trimmed);
}

export function normalizeAttachmentPathForUrl(path: string): string {
    if (!path) return path;
    if (WINDOWS_UNC_PATTERN.test(path)) {
        return `//${path.replace(/^\\\\+/, '').replace(/\\/g, '/')}`;
    }
    return path.replace(/\\/g, '/');
}

export function toAttachmentBrowserUrl(uri: string): string {
    const trimmed = uri.trim();
    if (!trimmed) return trimmed;
    if (!isLocalAttachmentPath(trimmed)) return trimmed;
    const normalizedPath = normalizeAttachmentPathForUrl(resolveAttachmentOpenTarget(trimmed));
    if (normalizedPath.startsWith('//')) return `file:${normalizedPath}`;
    if (normalizedPath.startsWith('/')) return `file://${normalizedPath}`;
    return `file:///${normalizedPath}`;
}
