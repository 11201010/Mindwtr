import {
    markAttachmentUnrecoverable,
    preserveRefusedAttachmentContentUpload,
    type Attachment,
} from '@mindwtr/core';

const ATTACHMENT_VALIDATION_MAX_ATTEMPTS = 3;
type AttachmentValidationFailure = { contentIdentity: string; attempts: number };
const attachmentValidationFailures = new Map<string, AttachmentValidationFailure>();

const attachmentContentIdentity = (attachment: Attachment): string => (
    attachment.pendingContentUpload === true
        ? attachment.fileHash?.trim().toLowerCase() ?? ''
        : ''
);

const matchingFailure = (attachment: Attachment): AttachmentValidationFailure | undefined => {
    const failure = attachmentValidationFailures.get(attachment.id);
    if (!failure || failure.contentIdentity === attachmentContentIdentity(attachment)) return failure;
    attachmentValidationFailures.delete(attachment.id);
    return undefined;
};

export { markAttachmentUnrecoverable };

export const clearAttachmentValidationFailure = (attachmentId: string): void => {
    attachmentValidationFailures.delete(attachmentId);
};

export const clearAttachmentValidationFailures = (): void => {
    attachmentValidationFailures.clear();
};

export const getAttachmentValidationFailureAttempts = (attachmentId: string): number => {
    return attachmentValidationFailures.get(attachmentId)?.attempts ?? 0;
};

export const shouldAttemptAttachmentUpload = (attachment: Attachment): boolean => (
    (matchingFailure(attachment)?.attempts ?? 0) < ATTACHMENT_VALIDATION_MAX_ATTEMPTS
);

export const handleAttachmentValidationFailure = (
    attachment: Attachment,
    error: string | undefined,
): { attempts: number; reachedLimit: boolean; mutated: boolean; message: string; logMessage: string } => {
    const contentIdentity = attachmentContentIdentity(attachment);
    const attempts = Math.min(
        (matchingFailure(attachment)?.attempts ?? 0) + 1,
        ATTACHMENT_VALIDATION_MAX_ATTEMPTS,
    );
    attachmentValidationFailures.set(attachment.id, { contentIdentity, attempts });
    const reason = error || 'unknown';
    const message = `Attachment validation failed (${reason}) for ${attachment.title} [attempt ${attempts}/${ATTACHMENT_VALIDATION_MAX_ATTEMPTS}]`;
    if (attempts < ATTACHMENT_VALIDATION_MAX_ATTEMPTS) {
        return { attempts, reachedLimit: false, mutated: false, message, logMessage: message };
    }
    const keepsRemoteCopy = preserveRefusedAttachmentContentUpload(attachment);
    if (keepsRemoteCopy) {
        return {
            attempts,
            reachedLimit: true,
            mutated: false,
            message,
            logMessage: `${message}; keeping the edited content pending and the remote copy unchanged`,
        };
    }
    attachmentValidationFailures.delete(attachment.id);
    const mutated = markAttachmentUnrecoverable(attachment);
    const logMessage = `${message}; marking attachment unrecoverable`;
    return { attempts, reachedLimit: true, mutated, message, logMessage };
};
