import {
    markAttachmentUnrecoverable,
    stopRefusedAttachmentContentUpload,
    type Attachment,
} from '@mindwtr/core';

const ATTACHMENT_VALIDATION_MAX_ATTEMPTS = 3;
const attachmentValidationFailures = new Map<string, number>();

export { markAttachmentUnrecoverable };

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
): { attempts: number; reachedLimit: boolean; mutated: boolean; message: string; logMessage: string } => {
    const attempts = (attachmentValidationFailures.get(attachment.id) || 0) + 1;
    attachmentValidationFailures.set(attachment.id, attempts);
    const reason = error || 'unknown';
    const message = `Attachment validation failed (${reason}) for ${attachment.title} [attempt ${attempts}/${ATTACHMENT_VALIDATION_MAX_ATTEMPTS}]`;
    if (attempts < ATTACHMENT_VALIDATION_MAX_ATTEMPTS) {
        return { attempts, reachedLimit: false, mutated: false, message, logMessage: message };
    }
    attachmentValidationFailures.delete(attachment.id);
    // A refused RE-UPLOAD of edited content keeps its record: the other devices hold the
    // server copy this cloudKey names, and a tombstone would make them delete it. Core's
    // stopRefusedAttachmentContentUpload explains the trade.
    const keepsRemoteCopy = attachment.pendingContentUpload === true && attachment.cloudKey !== undefined;
    const mutated = keepsRemoteCopy
        ? stopRefusedAttachmentContentUpload(attachment)
        : markAttachmentUnrecoverable(attachment);
    const logMessage = keepsRemoteCopy
        ? `${message}; keeping the attachment, dropping only the edited content`
        : `${message}; marking attachment unrecoverable`;
    return { attempts, reachedLimit: true, mutated, message, logMessage };
};
