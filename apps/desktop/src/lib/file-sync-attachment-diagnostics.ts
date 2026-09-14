export type FileSyncAttachmentFailureStage =
    | 'local-source-stat'
    | 'local-source-read'
    | 'snapshot-prepare'
    | 'wire-encryption'
    | 'generation-presence'
    | 'generation-reserve'
    | 'scratch-open'
    | 'scratch-write'
    | 'scratch-close'
    | 'existing-generation-read'
    | 'existing-generation-verify'
    | 'native-publication';

type FileSyncAttachmentFailureLogger = (
    message: string,
    error?: unknown,
    extra?: Record<string, string>,
) => void;

const FILE_SYNC_ATTACHMENT_FAILURE_MESSAGE = 'File Sync attachment operation failed';
const FILE_SYNC_ATTACHMENT_FAILURE_RELEASE_CHECK = 'v1.3.1/file-sync-attachment-failure';
const MAX_CAUSE_DEPTH = 4;
const MAX_WINDOWS_ERROR_CODE = 0xffff_ffff;
const ALLOWED_ERRNOS = new Set([
    'EACCES',
    'EBUSY',
    'EEXIST',
    'EFBIG',
    'EIO',
    'EISDIR',
    'EMFILE',
    'ENAMETOOLONG',
    'ENFILE',
    'ENOENT',
    'ENOSPC',
    'ENOTDIR',
    'ENOTEMPTY',
    'EPERM',
    'EROFS',
    'EXDEV',
]);

type ObservedNativeFailure = {
    errorType: 'native-os-error' | 'native-errno' | 'error' | 'string' | 'unknown';
    nativeCode: string;
};

const readCause = (value: unknown): unknown => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined;
    try {
        return Reflect.get(value, 'cause');
    } catch {
        return undefined;
    }
};

const readSymbolicErrno = (value: unknown): string | null => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return null;
    try {
        const code = Reflect.get(value, 'code');
        return typeof code === 'string' && ALLOWED_ERRNOS.has(code) ? code : null;
    } catch {
        return null;
    }
};

const readErrorText = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message;
    return null;
};

const readWindowsOsErrorCode = (value: unknown): string | null => {
    const text = readErrorText(value);
    if (!text) return null;
    const match = /\bos error\s+(\d+)\b/i.exec(text);
    if (!match) return null;
    const code = Number(match[1]);
    return Number.isSafeInteger(code) && code >= 0 && code <= MAX_WINDOWS_ERROR_CODE
        ? String(code)
        : null;
};

const observeNativeFailure = (error: unknown): ObservedNativeFailure => {
    const seen = new Set<unknown>();
    let current: unknown = error;
    let fallbackType: ObservedNativeFailure['errorType'] = 'unknown';

    for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined; depth += 1) {
        if (seen.has(current)) break;
        seen.add(current);

        if (current instanceof Error) fallbackType = 'error';
        else if (typeof current === 'string' && fallbackType === 'unknown') fallbackType = 'string';

        const windowsCode = readWindowsOsErrorCode(current);
        if (windowsCode !== null) {
            return { errorType: 'native-os-error', nativeCode: windowsCode };
        }
        const errno = readSymbolicErrno(current);
        if (errno !== null) {
            return { errorType: 'native-errno', nativeCode: errno };
        }
        current = readCause(current);
    }

    return { errorType: fallbackType, nativeCode: 'unknown' };
};

export const buildFileSyncAttachmentFailureExtra = (
    stage: FileSyncAttachmentFailureStage,
    error: unknown,
): Record<string, string> => ({
    releaseCheck: FILE_SYNC_ATTACHMENT_FAILURE_RELEASE_CHECK,
    backend: 'file',
    operation: 'upload',
    stage,
    ...observeNativeFailure(error),
});

export const reportFileSyncAttachmentFailure = (
    stage: FileSyncAttachmentFailureStage,
    error: unknown,
    logSyncWarning: FileSyncAttachmentFailureLogger,
): void => {
    try {
        logSyncWarning(
            FILE_SYNC_ATTACHMENT_FAILURE_MESSAGE,
            undefined,
            buildFileSyncAttachmentFailureExtra(stage, error),
        );
    } catch {
        // Diagnostics are best effort and must never replace the transfer result.
    }
};

export const runFileSyncAttachmentStage = async <T>(
    stage: FileSyncAttachmentFailureStage,
    logSyncWarning: FileSyncAttachmentFailureLogger,
    operation: () => Promise<T>,
): Promise<T> => {
    try {
        return await operation();
    } catch (error) {
        reportFileSyncAttachmentFailure(stage, error, logSyncWarning);
        throw error;
    }
};
