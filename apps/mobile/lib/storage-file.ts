import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Directory as ExpoDirectory, File as ExpoFile } from 'expo-file-system';
import { AppData } from '@mindwtr/core';
import { Platform } from 'react-native';
import { logError, logInfo, logWarn } from './app-log';

// StorageAccessFramework is part of the legacy FileSystem module
const StorageAccessFramework = (FileSystem as any).StorageAccessFramework;

interface PickResult extends AppData {
    __fileUri?: string;
}

const SYNC_FILE_NAME = 'data.json';
const LEGACY_SYNC_FILE_NAME = 'mindwtr-sync.json';
const READONLY_FOLDER_MESSAGE = 'Selected folder is read-only. Please choose a writable folder or make it available offline.';
const syncUriResolutionCache = new Map<string, string>();

const isReadOnlyError = (error: unknown): boolean => {
    const message = String(error);
    return /isn't writable|not writable|read-only|read only|permission denied|EACCES/i.test(message);
};

const isPickerCanceledError = (error: unknown): boolean => {
    const message = String(error);
    return /cancel/i.test(message);
};

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const normalizeDirectoryUri = (uri: string): string => uri.replace(/\/+$/, '');

const buildSyncFileUri = (directoryUri: string, fileName = SYNC_FILE_NAME): string =>
    `${normalizeDirectoryUri(directoryUri)}/${fileName}`;

const decodeUriSafe = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

const isLikelySyncFileUri = (uri: string): boolean => {
    const decoded = decodeUriSafe(uri);
    return decoded.endsWith(`/${SYNC_FILE_NAME}`)
        || decoded.endsWith(`:${SYNC_FILE_NAME}`)
        || decoded.endsWith(`/${LEGACY_SYNC_FILE_NAME}`)
        || decoded.endsWith(`:${LEGACY_SYNC_FILE_NAME}`);
};

const buildChildDocId = (baseDocId: string, leafName: string): string => {
    if (baseDocId.endsWith(':')) return `${baseDocId}${leafName}`;
    return `${baseDocId}/${leafName}`;
};

type SafContext = {
    prefix: string;
    treeIdEncoded: string;
    treeIdDecoded: string;
};

const parseSafContext = (uri: string): SafContext | null => {
    const prefixMatch = uri.match(/^(content:\/\/[^/]+)/);
    if (!prefixMatch) return null;
    const prefix = prefixMatch[1];

    const treeMatch = uri.match(/\/tree\/([^/?#]+)/);
    if (treeMatch) {
        const treeIdEncoded = treeMatch[1];
        return {
            prefix,
            treeIdEncoded,
            treeIdDecoded: decodeUriSafe(treeIdEncoded),
        };
    }

    const docMatch = uri.match(/\/document\/([^/?#]+)/);
    if (!docMatch) return null;
    const documentId = decodeUriSafe(docMatch[1]);
    if (!documentId) return null;

    if (isLikelySyncFileUri(uri)) {
        const lastSlash = documentId.lastIndexOf('/');
        const parentDocumentId = lastSlash >= 0 ? documentId.slice(0, lastSlash) : documentId;
        if (!parentDocumentId) return null;
        return {
            prefix,
            treeIdEncoded: encodeURIComponent(parentDocumentId),
            treeIdDecoded: parentDocumentId,
        };
    }

    return {
        prefix,
        treeIdEncoded: encodeURIComponent(documentId),
        treeIdDecoded: documentId,
    };
};

const buildTreeDocumentUri = (context: SafContext, documentId: string): string => {
    const documentIdEncoded = encodeURIComponent(documentId);
    return `${context.prefix}/tree/${context.treeIdEncoded}/document/${documentIdEncoded}`;
};

const listDirectoryForSyncFile = async (directoryUri: string): Promise<string | null> => {
    if (!StorageAccessFramework?.readDirectoryAsync) return null;
    try {
        const entries = await StorageAccessFramework.readDirectoryAsync(directoryUri);
        const decoded: Array<{ entry: string; decoded: string }> = entries.map((entry: string) => ({
            entry,
            decoded: decodeUriSafe(entry),
        }));
        const matchEntry = decoded.find((item) =>
            item.decoded.endsWith(`/${SYNC_FILE_NAME}`)
            || item.decoded.endsWith(`:${SYNC_FILE_NAME}`)
            || item.decoded.endsWith(`/${LEGACY_SYNC_FILE_NAME}`)
            || item.decoded.endsWith(`:${LEGACY_SYNC_FILE_NAME}`)
        );
        return matchEntry?.entry ?? null;
    } catch {
        return null;
    }
};

function sanitizeJsonText(raw: string): string {
    // Strip BOM and trailing NULs which can appear with partial/unsafe writes.
    let text = raw.replace(/^\uFEFF/, '').trim();
    // eslint-disable-next-line no-control-regex
    text = text.replace(/\u0000+$/g, '').trim();
    return text;
}

function parseAppData(text: string): AppData {
    const sanitized = sanitizeJsonText(text);
    if (!sanitized) throw new Error('Sync file is empty');
    const tryParse = (value: string): AppData => {
        const data = JSON.parse(value) as AppData;
        if (!data.tasks || !data.projects) {
            throw new Error('Invalid data format');
        }
        data.areas = Array.isArray(data.areas) ? data.areas : [];
        return data;
    };

    try {
        return tryParse(sanitized);
    } catch (error) {
        const start = sanitized.indexOf('{');
        const end = sanitized.lastIndexOf('}');
        if (start !== -1 && end > start && (start > 0 || end < sanitized.length - 1)) {
            const sliced = sanitized.slice(start, end + 1);
            return tryParse(sliced);
        }
        if (!sanitized.startsWith('{')) {
            throw new Error(`Sync file is not JSON (starts with "${sanitized.slice(0, 20)}")`);
        }
        throw error;
    }
}

const writeWithModernFileApi = (fileUri: string, content: string): void => {
    const file = new ExpoFile(fileUri);
    if (!file.exists) {
        file.create({ intermediates: true, overwrite: false });
    }
    file.write(content);
};

async function readFileText(fileUri: string): Promise<string | null> {
    if (fileUri.startsWith('content://')) {
        if (!StorageAccessFramework?.readAsStringAsync) {
            throw new Error('This Android build does not support Storage Access Framework (SAF).');
        }
        // Do not fall back to FileSystem.* for content:// URIs — it will throw Invalid URI.
        return await StorageAccessFramework.readAsStringAsync(fileUri);
    }

    if (Platform.OS === 'ios' && fileUri.startsWith('file://')) {
        try {
            const file = new ExpoFile(fileUri);
            if (!file.exists) {
                void logInfo('Sync file does not exist', { scope: 'sync', extra: { fileUri } });
                return null;
            }
            return await file.text();
        } catch {
            // Fall back to legacy API for compatibility with older paths.
        }
    }

    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (!fileInfo.exists) {
        void logInfo('Sync file does not exist', { scope: 'sync', extra: { fileUri } });
        return null;
    }
    return await FileSystem.readAsStringAsync(fileUri);
}

// Pick a sync file and return both the parsed data and the file URI
export const pickAndParseSyncFile = async (): Promise<PickResult | null> => {
    try {
        const result = await DocumentPicker.getDocumentAsync({
            type: 'application/json',
            copyToCacheDirectory: false, // Keep original path for persistent access
        });

        if (result.canceled) {
            return null;
        }

        const fileUri = result.assets[0].uri;
        const fileContent = await readFileText(fileUri);
        if (!fileContent) throw new Error('Sync file does not exist');
        const data = parseAppData(fileContent);

        // Return data with file URI attached
        return {
            ...data,
            __fileUri: fileUri,
        };
    } catch (error) {
        void logError(error, { scope: 'sync', extra: { operation: 'import', message: 'Failed to import data' } });
        throw error;
    }
};

export const resolveSyncFileUri = async (
    uri: string,
    options?: { createIfMissing?: boolean }
): Promise<string> => {
    if (!uri.startsWith('content://')) return uri;
    if (isLikelySyncFileUri(uri)) return uri;

    const cached = syncUriResolutionCache.get(uri);
    if (cached) return cached;

    const context = parseSafContext(uri);
    if (!context) return uri;
    const createIfMissing = options?.createIfMissing ?? true;
    const treeUri = `${context.prefix}/tree/${context.treeIdEncoded}`;
    const documentUri = buildTreeDocumentUri(context, context.treeIdDecoded);
    const candidates = [documentUri, treeUri];

    for (const candidate of candidates) {
        const match = await listDirectoryForSyncFile(candidate);
        if (match) {
            syncUriResolutionCache.set(uri, match);
            return match;
        }
    }

    if (createIfMissing && StorageAccessFramework?.createFileAsync) {
        for (const candidate of candidates) {
            try {
                const created = await StorageAccessFramework.createFileAsync(candidate, SYNC_FILE_NAME, 'application/json');
                syncUriResolutionCache.set(uri, created);
                return created;
            } catch {
                // Try the next candidate.
            }
        }
    }

    const fallback = buildTreeDocumentUri(context, buildChildDocId(context.treeIdDecoded, SYNC_FILE_NAME));
    syncUriResolutionCache.set(uri, fallback);
    return fallback;
};

const assertDirectoryWritable = async (
    directoryUri: string,
    existingFileUri?: string,
    existingContent?: string | null,
): Promise<void> => {
    if (!StorageAccessFramework?.createFileAsync || !StorageAccessFramework?.writeAsStringAsync) return;
    let testUri: string | null = null;
    try {
        try {
            testUri = await StorageAccessFramework.createFileAsync(
                directoryUri,
                `mindwtr-write-test-${Date.now()}`,
                'text/plain'
            );
            await StorageAccessFramework.writeAsStringAsync(testUri, 'ok');
            return;
        } catch (error) {
            if (existingFileUri) {
                await StorageAccessFramework.writeAsStringAsync(existingFileUri, existingContent ?? '');
                return;
            }
            throw error;
        }
    } catch (error) {
        if (isReadOnlyError(error)) {
            throw new Error(READONLY_FOLDER_MESSAGE);
        }
        throw error;
    } finally {
        if (testUri && StorageAccessFramework?.deleteAsync) {
            try {
                await StorageAccessFramework.deleteAsync(testUri, { idempotent: true });
            } catch {
                // Ignore cleanup failures for the temp file.
            }
        }
    }
};

const assertIosDirectoryWritable = async (
    directoryUri: string,
): Promise<void> => {
    const testFileUri = buildSyncFileUri(directoryUri, `mindwtr-write-test-${Date.now()}.txt`);
    try {
        writeWithModernFileApi(testFileUri, 'ok');
    } catch (error) {
        if (isReadOnlyError(error)) {
            throw new Error(READONLY_FOLDER_MESSAGE);
        }
        throw error;
    } finally {
        try {
            const file = new ExpoFile(testFileUri);
            if (file.exists) {
                file.delete();
            }
        } catch {
            // Ignore cleanup failures for test file.
        }
    }
};

const pickAndParseIosSyncFolder = async (): Promise<PickResult | null> => {
    try {
        const directory = await ExpoDirectory.pickDirectoryAsync();
        const directoryUri = directory?.uri;
        if (!directoryUri) return null;

        await assertIosDirectoryWritable(directoryUri);

        const primaryFileUri = buildSyncFileUri(directoryUri, SYNC_FILE_NAME);
        const legacyFileUri = buildSyncFileUri(directoryUri, LEGACY_SYNC_FILE_NAME);
        let fileUri = primaryFileUri;
        let fileContent = await readFileText(primaryFileUri);
        if (fileContent === null) {
            const legacyContent = await readFileText(legacyFileUri);
            if (legacyContent !== null) {
                fileUri = legacyFileUri;
                fileContent = legacyContent;
            }
        }

        if (!fileContent) {
            return {
                tasks: [],
                projects: [],
                sections: [],
                areas: [],
                settings: {},
                __fileUri: primaryFileUri,
            };
        }
        const data = parseAppData(fileContent);
        return { ...data, __fileUri: fileUri };
    } catch (error) {
        if (isPickerCanceledError(error)) {
            return null;
        }
        throw error;
    }
};

export const pickAndParseSyncFolder = async (): Promise<PickResult | null> => {
    if (Platform.OS === 'ios' && typeof ExpoDirectory.pickDirectoryAsync === 'function') {
        try {
            return await pickAndParseIosSyncFolder();
        } catch (error) {
            void logError(error, { scope: 'sync', extra: { operation: 'import', message: 'Failed to import data from iOS folder' } });
            throw error;
        }
    }
    if (Platform.OS !== 'android' || !StorageAccessFramework?.requestDirectoryPermissionsAsync) {
        return pickAndParseSyncFile();
    }
    try {
        const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permissions.granted) return null;
        const directoryUri = permissions.directoryUri;
        let fileUri = await resolveSyncFileUri(directoryUri, { createIfMissing: true });
        let fileContent: string | null = null;
        if (fileUri) {
            fileContent = await readFileText(fileUri);
        }
        await assertDirectoryWritable(directoryUri, fileUri ?? undefined, fileContent ?? undefined);
        if (!fileUri) {
            throw new Error('Unable to create sync file in selected folder');
        }
        if (fileContent === null) {
            fileContent = await readFileText(fileUri);
        }
        if (!fileContent) {
            return {
                tasks: [],
                projects: [],
                sections: [],
                areas: [],
                settings: {},
                __fileUri: fileUri,
            };
        }
        const data = parseAppData(fileContent);
        return { ...data, __fileUri: fileUri };
    } catch (error) {
        void logError(error, { scope: 'sync', extra: { operation: 'import', message: 'Failed to import data from folder' } });
        throw error;
    }
};

// Read sync file from a stored path
export const readSyncFile = async (fileUri: string): Promise<AppData | null> => {
    try {
        const resolvedUri = await resolveSyncFileUri(fileUri, { createIfMissing: false });
        if (resolvedUri !== fileUri) {
            void logInfo('Resolved sync path from directory URI to file URI', { scope: 'sync' });
        }
        // Syncthing (or other tools) can replace files while we're reading. Retry a few times.
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            try {
                const fileContent = await readFileText(resolvedUri);
                if (!fileContent) return null;
                return parseAppData(fileContent);
            } catch (error) {
                lastError = error;
                // Small backoff to allow file writes to finish.
                await sleep(120 + attempt * 80);
            }
        }
        throw lastError;
    } catch (error) {
        const message = String(error);
        // Provide a clearer UX-oriented error.
        if (fileUri.startsWith('content://') && /Invalid URI|IllegalArgumentException/i.test(message)) {
            throw new Error('Cannot access the selected sync file. Please re-select it in Settings → Data & Sync.');
        }
        if (/JSON|Unexpected token|trailing characters|Invalid data format|Sync file is empty/i.test(message)) {
            void logWarn('[Sync] Invalid JSON in sync file. Using local data and repairing file.', { scope: 'sync' });
            void logInfo('Invalid JSON in sync file; using local data.', { scope: 'sync', extra: { operation: 'read' } });
            return null;
        }
        void logError(error, { scope: 'sync', extra: { operation: 'read', message: 'Failed to read sync file' } });
        throw error;
    }
};

// Write merged data back to sync file
export const writeSyncFile = async (fileUri: string, data: AppData): Promise<void> => {
    try {
        const content = JSON.stringify(data, null, 2);
        const resolvedUri = await resolveSyncFileUri(fileUri, { createIfMissing: true });
        // SAF URIs (content://) require special handling on Android
        if (resolvedUri.startsWith('content://') && StorageAccessFramework) {
            await StorageAccessFramework.writeAsStringAsync(resolvedUri, content);
            void logInfo('Written sync file via SAF', { scope: 'sync', extra: { fileUri: resolvedUri } });
        } else {
            if (Platform.OS === 'ios' && resolvedUri.startsWith('file://')) {
                try {
                    writeWithModernFileApi(resolvedUri, content);
                    void logInfo('Written sync file via modern iOS File API', { scope: 'sync', extra: { fileUri: resolvedUri } });
                    return;
                } catch (error) {
                    void logWarn('Modern iOS sync write failed; falling back to legacy path', {
                        scope: 'sync',
                        extra: { error: error instanceof Error ? error.message : String(error) },
                    });
                }
            }
            const tempUri = `${resolvedUri}.tmp`;
            await FileSystem.writeAsStringAsync(tempUri, content);
            const existing = await FileSystem.getInfoAsync(resolvedUri);
            if (existing.exists) {
                await FileSystem.deleteAsync(resolvedUri, { idempotent: true });
            }
            await FileSystem.moveAsync({ from: tempUri, to: resolvedUri });
            void logInfo('Written sync file', { scope: 'sync', extra: { fileUri: resolvedUri } });
        }
    } catch (error) {
        void logError(error, { scope: 'sync', extra: { operation: 'write', message: 'Failed to write sync file' } });
        throw error;
    }
};

// Export data for backup - allows saving to local directory on Android
export const exportData = async (data: AppData): Promise<void> => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `mindwtr-backup-${timestamp}.json`;
        const jsonContent = JSON.stringify(data, null, 2);

        // On Android, try SAF to let user pick save location
        if (Platform.OS === 'android' && StorageAccessFramework) {
            try {
                void logInfo('Export attempting SAF', { scope: 'sync' });
                // Request permission to a directory
                const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
                void logInfo('Export SAF permissions', {
                    scope: 'sync',
                    extra: {
                        granted: String(Boolean(permissions?.granted)),
                    },
                });

                if (permissions.granted) {
                    // Create the file in the selected directory
                    const fileUri = await StorageAccessFramework.createFileAsync(
                        permissions.directoryUri,
                        filename,
                        'application/json'
                    );

                    await StorageAccessFramework.writeAsStringAsync(fileUri, jsonContent);
                    void logInfo('Export saved via SAF', { scope: 'sync', extra: { fileUri } });
                    return;
                }
            } catch (safError) {
                void logWarn('Export SAF unavailable; falling back to share', {
                    scope: 'sync',
                    extra: { error: safError instanceof Error ? safError.message : String(safError) },
                });
            }
        } else {
            void logInfo('Export SAF unavailable on this platform', {
                scope: 'sync',
                extra: {
                    platform: Platform.OS,
                    hasSaf: String(Boolean(StorageAccessFramework)),
                },
            });
        }

        // Fallback: Use cache + share sheet
        const fileUri = FileSystem.cacheDirectory + filename;
        void logInfo('Export writing backup to cache before share', { scope: 'sync', extra: { fileUri } });
        await FileSystem.writeAsStringAsync(fileUri, jsonContent);

        const sharingAvailable = await Sharing.isAvailableAsync();
        if (sharingAvailable) {
            await Sharing.shareAsync(fileUri, {
                UTI: 'public.json',
                mimeType: 'application/json',
                dialogTitle: 'Export Mindwtr Data',
            });
        } else {
            throw new Error('Sharing is not available on this device');
        }
    } catch (error) {
        void logError(error, { scope: 'sync', extra: { operation: 'export', message: 'Failed to export data' } });
        throw error;
    }
};
