import type { Attachment } from '@mindwtr/core';

const ATTACHMENT_VALIDATION_MAX_ATTEMPTS = 3;
const attachmentValidationFailures = new Map<string, number>();

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

export const clearAttachmentValidationFailure = (attachmentId: string): void => {
    attachmentValidationFailures.delete(attachmentId);
};

export const clearAttachmentValidationFailures = (): void => {
    attachmentValidationFailures.clear();
};

export const getAttachmentValidationFailureAttempts = (attachmentId: string): number => {
    return attachmentValidationFailures.get(attachmentId) ?? 0;
};

export const handleAttachmentValidationFailure = (
    attachment: Attachment,
    error: string | undefined,
): { attempts: number; reachedLimit: boolean; mutated: boolean; message: string } => {
    const attempts = (attachmentValidationFailures.get(attachment.id) || 0) + 1;
    attachmentValidationFailures.set(attachment.id, attempts);
    const reason = error || 'unknown';
    const message = `Attachment validation failed (${reason}) for ${attachment.title} [attempt ${attempts}/${ATTACHMENT_VALIDATION_MAX_ATTEMPTS}]`;
    if (attempts < ATTACHMENT_VALIDATION_MAX_ATTEMPTS) {
        return { attempts, reachedLimit: false, mutated: false, message };
    }
    attachmentValidationFailures.delete(attachment.id);
    const mutated = markAttachmentUnrecoverable(attachment);
    return { attempts, reachedLimit: true, mutated, message };
};
