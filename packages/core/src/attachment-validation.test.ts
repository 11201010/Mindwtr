import { describe, expect, it } from 'vitest';
import { preserveRefusedAttachmentContentUpload, validateAttachmentForUpload } from './attachment-validation';
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

describe('preserveRefusedAttachmentContentUpload', () => {
    const reUpload = (): Attachment => ({
        ...baseAttachment,
        cloudKey: 'attachments/att-1.txt',
        fileHash: 'a'.repeat(64),
        localStatus: 'available',
        pendingContentUpload: true,
    });

    it('keeps the pending candidate, server copy and local file unchanged', () => {
        const attachment = reUpload();
        const before = { ...attachment };

        expect(preserveRefusedAttachmentContentUpload(attachment)).toBe(true);

        expect(attachment).toEqual(before);
    });

    it('does not classify an attachment without a pending replacement', () => {
        const attachment = { ...baseAttachment, cloudKey: 'attachments/att-1.txt' };

        expect(preserveRefusedAttachmentContentUpload(attachment)).toBe(false);
        expect(attachment).toEqual({ ...baseAttachment, cloudKey: 'attachments/att-1.txt' });
    });

    it('does not classify a first upload without a proven server copy', () => {
        const attachment = { ...reUpload(), cloudKey: undefined };

        expect(preserveRefusedAttachmentContentUpload(attachment)).toBe(false);
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
