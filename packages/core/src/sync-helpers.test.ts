import { describe, expect, it } from 'vitest';
import { assertNoPendingAttachmentUploads, findPendingAttachmentUploads } from './sync-helpers';
import type { AppData, Attachment } from './types';

const now = '2026-02-19T00:00:00.000Z';

const fileAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
    id: 'att-1',
    kind: 'file',
    title: 'photo.jpg',
    uri: '/tmp/photo.jpg',
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

const createData = (attachments: Attachment[]): AppData => ({
    tasks: [
        {
            id: 'task-1',
            title: 'Task',
            status: 'inbox',
            tags: [],
            contexts: [],
            attachments,
            createdAt: now,
            updatedAt: now,
        },
    ],
    projects: [],
    sections: [],
    areas: [],
    settings: {},
});

describe('sync-helpers pending attachment uploads', () => {
    it('detects file attachments with local uri and missing cloud key', () => {
        const data = createData([fileAttachment()]);
        const pending = findPendingAttachmentUploads(data);

        expect(pending).toEqual([
            {
                ownerType: 'task',
                ownerId: 'task-1',
                attachmentId: 'att-1',
                title: 'photo.jpg',
            },
        ]);
    });

    it('ignores attachments that are already uploaded, remote links, or marked missing', () => {
        const data = createData([
            fileAttachment({ id: 'uploaded', cloudKey: 'attachments/uploaded.jpg' }),
            fileAttachment({ id: 'remote', uri: 'https://example.com/photo.jpg' }),
            fileAttachment({ id: 'missing', localStatus: 'missing' }),
            {
                id: 'link-1',
                kind: 'link',
                title: 'Web',
                uri: 'https://example.com',
                createdAt: now,
                updatedAt: now,
            },
        ]);

        expect(findPendingAttachmentUploads(data)).toHaveLength(0);
    });

    it('throws a clear error when pending uploads remain before remote write', () => {
        const data = createData([
            fileAttachment({ id: 'att-1' }),
            fileAttachment({ id: 'att-2', uri: 'content://attachment/att-2' }),
        ]);

        expect(() => assertNoPendingAttachmentUploads(data)).toThrow(
            'Attachment upload incomplete: 2 file attachment(s) are still pending upload'
        );
    });
});
