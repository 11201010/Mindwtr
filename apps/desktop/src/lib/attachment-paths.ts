import { ATTACHMENTS_DIR_NAME } from '@mindwtr/core';
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

// #1245 moved an installed Windows/macOS profile's managed folders from
// `<root>/` down into `<root>/data/`. Only these two hold files whose absolute
// path was recorded in an attachment `uri`; `quick-add-images` did not move, so
// old pasted-image paths must keep resolving exactly where they are.
const RELOCATED_MANAGED_DIR_NAMES = [ATTACHMENTS_DIR_NAME, 'audio-captures'];

/**
 * Map a path recorded at the flat profile root onto the same file under the
 * current managed data dir, or null when the shape does not match. Unlike the
 * relocated portable profile of #1038 this stale path sits inside the OS data
 * dir and its file name need not be the attachment id (audio captures are named
 * after their timestamp), so the id-based fallback never reaches it.
 *
 * The result always stays inside the managed data dir: the rest of the path may
 * not contain `.` or `..`, so this opens no location the app did not already own.
 */
export function rehomeManagedSubfolderPath(path: string, managedDataDir: string): string | null {
    const normalized = normalizeAttachmentPathForUrl(path.trim());
    const managed = normalizeAttachmentPathForUrl(managedDataDir.trim()).replace(/\/+$/, '');
    if (!normalized || !managed) return null;
    const parentEnd = managed.lastIndexOf('/');
    if (parentEnd < 0) return null;
    const parent = managed.slice(0, parentEnd);
    const prefix = parent.endsWith('/') ? parent : `${parent}/`;
    if (!normalized.startsWith(prefix)) return null;
    const segments = normalized.slice(prefix.length).split('/');
    const dirName = segments.shift();
    if (!dirName || !RELOCATED_MANAGED_DIR_NAMES.includes(dirName)) return null;
    if (segments.length === 0) return null;
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
    const rehomed = `${managed}/${dirName}/${segments.join('/')}`;
    return rehomed === normalized ? null : rehomed;
}

export function resolveAttachmentOpenTarget(uri: string): string {
    const trimmed = uri.trim();
    if (!trimmed) return trimmed;
    if (!isLocalAttachmentPath(trimmed)) return trimmed;
    return stripFileScheme(trimmed);
}

// A portable profile travels with the install, so an attachment URI recorded at
// the previous location is stale even though the file moved along inside the
// profile's attachments dir. The recorded path always wins while it resolves;
// only once it is gone do we retry the same file name in the current managed
// attachments dir, so the stored URI format never changes (#1038).
export async function resolveAttachmentReadPath(uri: string, attachmentId: string): Promise<string> {
    const target = resolveAttachmentOpenTarget(uri);
    if (!target || !isLocalAttachmentPath(target)) return target;
    const { exists } = await import('@tauri-apps/plugin-fs');
    // A path outside the webview's fs scope throws instead of returning false.
    const readable = async (path: string): Promise<boolean> => {
        try {
            return await exists(path);
        } catch {
            return false;
        }
    };
    if (await readable(target)) return target;
    const { getManagedDataDir, getManagedPath } = await import('./managed-paths');
    const rehomed = rehomeManagedSubfolderPath(target, await getManagedDataDir());
    if (rehomed && (await readable(rehomed))) return rehomed;
    const fileName = normalizeAttachmentPathForUrl(target).split('/').pop();
    if (
        !fileName
        || (fileName !== attachmentId && !fileName.startsWith(`${attachmentId}.`))
    ) return target;
    const fallback = await getManagedPath(ATTACHMENTS_DIR_NAME, fileName);
    return (await readable(fallback)) ? fallback : target;
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
