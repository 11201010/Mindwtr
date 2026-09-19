import type { Attachment } from './types';

export type AttachmentValidationError =
    | 'file_too_large'
    | 'mime_type_blocked'
    | 'mime_type_not_allowed'
    | 'file_not_found';

export interface AttachmentValidationConfig {
    maxFileSizeBytes: number;
    allowedMimeTypes?: string[];
    blockedMimeTypes?: string[];
}

export interface ValidationResult {
    valid: boolean;
    error?: AttachmentValidationError;
    details?: string;
}

export const DEFAULT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const DEFAULT_BLOCKED_MIME_TYPES = [
    'application/x-executable',
    'application/x-msdos-program',
    'application/x-msdownload',
];

const normalizeMimeType = (value?: string): string => (value || '').trim().toLowerCase();

export const markAttachmentUnrecoverable = (attachment: Attachment): boolean => {
    const now = new Date().toISOString();
    let mutated = false;
    if (attachment.cloudKey !== undefined) {
        attachment.cloudKey = undefined;
        mutated = true;
    }
    if (attachment.fileHash !== undefined) {
        attachment.fileHash = undefined;
        mutated = true;
    }
    if (attachment.localStatus !== 'missing') {
        attachment.localStatus = 'missing';
        mutated = true;
    }
    if (!attachment.deletedAt) {
        attachment.deletedAt = now;
        mutated = true;
    }
    if (attachment.updatedAt !== now) {
        attachment.updatedAt = now;
        mutated = true;
    }
    return mutated;
};

/**
 * Terminal step for a refused CONTENT RE-UPLOAD, where the attachment already has a server
 * copy that the other devices hold and only the edited bytes were refused.
 *
 * `markAttachmentUnrecoverable` must not be used here: its tombstone would reach the other
 * devices and their cleanup pass would delete the good copy they still have. So the record,
 * its `cloudKey` and the local file all stay, and only the "waiting to re-upload" flag is
 * cleared — which is what stops this attachment blocking the document write. The edited
 * bytes then live on this device alone.
 */
export const stopRefusedAttachmentContentUpload = (attachment: Attachment): boolean => {
    if (attachment.pendingContentUpload !== true) return false;
    attachment.pendingContentUpload = undefined;
    attachment.updatedAt = new Date().toISOString();
    return true;
};

export async function validateAttachmentForUpload(
    attachment: Attachment,
    fileSizeBytes: number | null | undefined,
    config?: Partial<AttachmentValidationConfig>
): Promise<ValidationResult> {
    const maxFileSizeBytes = config?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    const blockedMimeTypes = (config?.blockedMimeTypes ?? DEFAULT_BLOCKED_MIME_TYPES).map(normalizeMimeType);
    const allowedMimeTypes = config?.allowedMimeTypes?.map(normalizeMimeType);

    if (!Number.isFinite(fileSizeBytes ?? NaN)) {
        return { valid: false, error: 'file_not_found', details: 'Missing file size.' };
    }

    if (fileSizeBytes! > maxFileSizeBytes) {
        return { valid: false, error: 'file_too_large', details: `Max ${maxFileSizeBytes} bytes.` };
    }

    const mimeType = normalizeMimeType(attachment.mimeType);
    if (mimeType && blockedMimeTypes.includes(mimeType)) {
        return { valid: false, error: 'mime_type_blocked', details: mimeType };
    }

    if (allowedMimeTypes && allowedMimeTypes.length > 0) {
        if (!mimeType || !allowedMimeTypes.includes(mimeType)) {
            return { valid: false, error: 'mime_type_not_allowed', details: mimeType || 'unknown' };
        }
    }

    return { valid: true };
}
