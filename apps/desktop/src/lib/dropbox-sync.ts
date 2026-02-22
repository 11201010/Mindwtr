import type { AppData } from '@mindwtr/core';

const DROPBOX_SYNC_PATH = '/data.json';
const DOWNLOAD_ENDPOINT = 'https://content.dropboxapi.com/2/files/download';
const UPLOAD_ENDPOINT = 'https://content.dropboxapi.com/2/files/upload';
const FILE_METADATA_ENDPOINT = 'https://api.dropboxapi.com/2/files/get_metadata';
const FILE_DELETE_ENDPOINT = 'https://api.dropboxapi.com/2/files/delete_v2';

export class DropboxConflictError extends Error {
    constructor(message = 'Dropbox remote data changed during sync') {
        super(message);
        this.name = 'DropboxConflictError';
    }
}

export class DropboxUnauthorizedError extends Error {
    constructor(message = 'Dropbox authorization failed (HTTP 401)') {
        super(message);
        this.name = 'DropboxUnauthorizedError';
    }
}

export class DropboxFileNotFoundError extends Error {
    constructor(message = 'Dropbox file not found') {
        super(message);
        this.name = 'DropboxFileNotFoundError';
    }
}

export type DropboxDownloadResult = {
    data: AppData | null;
    rev: string | null;
};

const parseDropboxMetadata = (raw: string | null): { rev: string | null } => {
    if (!raw) return { rev: null };
    try {
        const parsed = JSON.parse(raw) as { rev?: unknown };
        return { rev: typeof parsed.rev === 'string' ? parsed.rev : null };
    } catch {
        return { rev: null };
    }
};

const parseDropboxApiErrorTag = async (response: Response): Promise<string> => {
    try {
        const payload = await response.json() as {
            error?: {
                '.tag'?: unknown;
                path?: { '.tag'?: unknown };
            };
        };
        const top = payload?.error?.['.tag'];
        if (typeof top === 'string') {
            if (top === 'path') {
                const nested = payload?.error?.path?.['.tag'];
                if (typeof nested === 'string') return `path/${nested}`;
            }
            return top;
        }
        return '';
    } catch {
        return '';
    }
};

const resolveDropboxPath = (path: string): string => {
    const trimmed = path.trim();
    if (!trimmed) throw new Error('Dropbox path is required');
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

export async function downloadDropboxAppData(
    accessToken: string,
    fetcher: typeof fetch = fetch
): Promise<DropboxDownloadResult> {
    const response = await fetcher(DOWNLOAD_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Dropbox-API-Arg': JSON.stringify({ path: DROPBOX_SYNC_PATH }),
        },
    });

    if (response.status === 409) {
        return { data: null, rev: null };
    }
    if (response.status === 401) {
        throw new DropboxUnauthorizedError('Dropbox download failed: HTTP 401');
    }
    if (!response.ok) {
        throw new Error(`Dropbox download failed: HTTP ${response.status}`);
    }

    const metadata = parseDropboxMetadata(response.headers.get('dropbox-api-result'));
    const text = await response.text();
    if (!text.trim()) {
        return { data: null, rev: metadata.rev };
    }

    let data: AppData;
    try {
        data = JSON.parse(text) as AppData;
    } catch {
        throw new Error('Dropbox data.json is not valid JSON');
    }
    return { data, rev: metadata.rev };
}

export async function uploadDropboxAppData(
    accessToken: string,
    data: AppData,
    expectedRev: string | null,
    fetcher: typeof fetch = fetch
): Promise<{ rev: string | null }> {
    const mode = expectedRev
        ? { '.tag': 'update', update: expectedRev }
        : { '.tag': 'overwrite' };
    const response = await fetcher(UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Dropbox-API-Arg': JSON.stringify({
                path: DROPBOX_SYNC_PATH,
                mode,
                mute: true,
                strict_conflict: false,
            }),
            'Content-Type': 'application/octet-stream',
        },
        body: JSON.stringify(data),
    });

    if (response.status === 409) {
        const errorTag = await parseDropboxApiErrorTag(response);
        if (errorTag.startsWith('path')) {
            throw new DropboxConflictError();
        }
    }
    if (response.status === 401) {
        throw new DropboxUnauthorizedError('Dropbox upload failed: HTTP 401');
    }
    if (!response.ok) {
        throw new Error(`Dropbox upload failed: HTTP ${response.status}`);
    }

    const payload = await response.json().catch(() => null) as { rev?: unknown } | null;
    return { rev: typeof payload?.rev === 'string' ? payload.rev : null };
}

export async function downloadDropboxFile(
    accessToken: string,
    path: string,
    fetcher: typeof fetch = fetch
): Promise<ArrayBuffer> {
    const response = await fetcher(DOWNLOAD_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Dropbox-API-Arg': JSON.stringify({ path: resolveDropboxPath(path) }),
        },
    });
    if (response.status === 401) {
        throw new DropboxUnauthorizedError('Dropbox file download failed: HTTP 401');
    }
    if (response.status === 409) {
        throw new DropboxFileNotFoundError('Dropbox file not found');
    }
    if (!response.ok) {
        throw new Error(`Dropbox file download failed: HTTP ${response.status}`);
    }
    return response.arrayBuffer();
}

export async function uploadDropboxFile(
    accessToken: string,
    path: string,
    content: ArrayBuffer | Uint8Array,
    contentType = 'application/octet-stream',
    fetcher: typeof fetch = fetch
): Promise<{ rev: string | null }> {
    const sourceBytes = content instanceof Uint8Array ? content : new Uint8Array(content);
    const bytes = new Uint8Array(sourceBytes.length);
    bytes.set(sourceBytes);
    const requestBody: BodyInit = new Blob([bytes], {
        type: contentType || 'application/octet-stream',
    });
    const response = await fetcher(UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Dropbox-API-Arg': JSON.stringify({
                path: resolveDropboxPath(path),
                mode: { '.tag': 'overwrite' },
                mute: true,
                strict_conflict: false,
            }),
            'Content-Type': contentType,
        },
        body: requestBody,
    });
    if (response.status === 401) {
        throw new DropboxUnauthorizedError('Dropbox file upload failed: HTTP 401');
    }
    if (!response.ok) {
        throw new Error(`Dropbox file upload failed: HTTP ${response.status}`);
    }
    const payload = await response.json().catch(() => null) as { rev?: unknown } | null;
    return { rev: typeof payload?.rev === 'string' ? payload.rev : null };
}

export async function deleteDropboxFile(
    accessToken: string,
    path: string,
    fetcher: typeof fetch = fetch
): Promise<void> {
    const response = await fetcher(FILE_DELETE_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: resolveDropboxPath(path) }),
    });
    if (response.status === 401) {
        throw new DropboxUnauthorizedError('Dropbox file delete failed: HTTP 401');
    }
    if (response.status === 409) {
        return;
    }
    if (!response.ok) {
        throw new Error(`Dropbox file delete failed: HTTP ${response.status}`);
    }
}

export async function testDropboxAccess(
    accessToken: string,
    fetcher: typeof fetch = fetch
): Promise<void> {
    const response = await fetcher(FILE_METADATA_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            path: DROPBOX_SYNC_PATH,
            include_media_info: false,
            include_deleted: false,
        }),
    });
    if (response.status === 409) {
        // First sync, file might not exist yet.
        return;
    }
    if (response.status === 401) {
        throw new DropboxUnauthorizedError('Dropbox connection failed: HTTP 401');
    }
    if (!response.ok) {
        throw new Error(`Dropbox connection failed: HTTP ${response.status}`);
    }
}
