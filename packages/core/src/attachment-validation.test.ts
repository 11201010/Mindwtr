import { describe, expect, it } from 'vitest';
import { stopRefusedAttachmentContentUpload, validateAttachmentForUpload } from './attachment-validation';
import type { Attachment } from './types';

const baseAttachment: Attachment = {
    id: 'att-1',
    kind: 'file',
    title: 'file.txt',
    uri: '/tmp/file.txt',
    mimeType: 'text/plain',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

describe('stopRefusedAttachmentContentUpload', () => {
    const reUpload = (): Attachment => ({
        ...baseAttachment,
        cloudKey: 'attachments/att-1.txt',
        fileHash: 'a'.repeat(64),
        localStatus: 'available',
        pendingContentUpload: true,
    });

    it('keeps the record, the server copy and the local file', () => {
        const attachment = reUpload();

        expect(stopRefusedAttachmentContentUpload(attachment)).toBe(true);

        expect(attachment.pendingContentUpload).toBeUndefined();
        expect(attachment.cloudKey).toBe('attachments/att-1.txt');
        expect(attachment.fileHash).toBe('a'.repeat(64));
        expect(attachment.localStatus).toBe('available');
        // The tombstone is the whole point: it would reach the other devices and make
        // them delete the good copy they still hold.
        expect(attachment.deletedAt).toBeUndefined();
    });

    it('changes nothing when no content upload is waiting', () => {
        const attachment = { ...baseAttachment, cloudKey: 'attachments/att-1.txt' };

        expect(stopRefusedAttachmentContentUpload(attachment)).toBe(false);
        expect(attachment).toEqual({ ...baseAttachment, cloudKey: 'attachments/att-1.txt' });
    });
});

describe('validateAttachmentForUpload', () => {
    it('enforces size limits', async () => {
        const small = await validateAttachmentForUpload(baseAttachment, 49, { maxFileSizeBytes: 50 });
        const large = await validateAttachmentForUpload(baseAttachment, 51, { maxFileSizeBytes: 50 });
        expect(small.valid).toBe(true);
        expect(large.valid).toBe(false);
        expect(large.error).toBe('file_too_large');
    });

    it('blocks disallowed mime types', async () => {
        const blockedAttachment = { ...baseAttachment, mimeType: 'application/x-executable' };
        const result = await validateAttachmentForUpload(blockedAttachment, 10, {});
        expect(result.valid).toBe(false);
        expect(result.error).toBe('mime_type_blocked');
    });

    it('respects allowed mime list', async () => {
        const allowedAttachment = { ...baseAttachment, mimeType: 'image/png' };
        const allowed = await validateAttachmentForUpload(allowedAttachment, 10, {
            allowedMimeTypes: ['image/png'],
        });
        const disallowed = await validateAttachmentForUpload(allowedAttachment, 10, {
            allowedMimeTypes: ['image/jpeg'],
        });
        expect(allowed.valid).toBe(true);
        expect(disallowed.valid).toBe(false);
        expect(disallowed.error).toBe('mime_type_not_allowed');
    });

    it('handles missing sizes and zero-size files', async () => {
        const missing = await validateAttachmentForUpload(baseAttachment, undefined, {});
        const zero = await validateAttachmentForUpload(baseAttachment, 0, { maxFileSizeBytes: 10 });
        expect(missing.valid).toBe(false);
        expect(missing.error).toBe('file_not_found');
        expect(zero.valid).toBe(true);
    });
});
