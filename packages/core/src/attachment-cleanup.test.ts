import { describe, expect, it } from 'vitest';
import {
    findDeletedAttachmentsForFileCleanup,
    findOrphanedAttachments,
    removeOrphanedAttachmentsFromData,
} from './attachment-cleanup';
import type { AppData } from './types';

const buildData = (): AppData => ({
    tasks: [],
    projects: [],
    sections: [],
    areas: [],
    settings: {},
});

describe('findOrphanedAttachments', () => {
    it('treats deleted attachments on active tasks as orphaned cleanup candidates', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'inbox',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                },
            ],
        });

        const orphaned = findOrphanedAttachments(data);
        expect(orphaned.map((attachment) => attachment.id)).toEqual(['a1']);
    });

    it('detects attachments on deleted tasks', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'done',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
        });

        const orphaned = findOrphanedAttachments(data);
        expect(orphaned.map((a) => a.id)).toEqual(['a1']);
    });

    it('keeps attachments referenced by active tasks', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'inbox',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
        });

        const orphaned = findOrphanedAttachments(data);
        expect(orphaned).toHaveLength(0);
    });
});

describe('findDeletedAttachmentsForFileCleanup', () => {
    it('finds deleted attachments on active tasks and projects', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'inbox',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'audio',
                    uri: '',
                    cloudKey: 'attachments/a1.m4a',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                },
            ],
        });
        data.projects.push({
            id: 'p1',
            title: 'Project',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a2',
                    kind: 'file',
                    title: 'doc',
                    uri: '/tmp/doc',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                },
            ],
        });

        const deleted = findDeletedAttachmentsForFileCleanup(data);
        expect(deleted.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    });

    it('returns deleted attachments even when parents are deleted', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'done',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                },
            ],
        });

        const deleted = findDeletedAttachmentsForFileCleanup(data);
        expect(deleted.map((a) => a.id)).toEqual(['a1']);
    });
});

describe('removeOrphanedAttachmentsFromData', () => {
    it('removes orphaned attachments from tasks and projects', () => {
        const data: AppData = {
            tasks: [
                {
                    id: 't1',
                    title: 'Task',
                    status: 'done',
                    contexts: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                    attachments: [
                        {
                            id: 'a1',
                            kind: 'file',
                            title: 'file',
                            uri: '/tmp/file',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        },
                    ],
                },
            ],
            projects: [
                {
                    id: 'p1',
                    title: 'Project',
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                    attachments: [
                        {
                            id: 'a2',
                            kind: 'file',
                            title: 'file2',
                            uri: '/tmp/file2',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            deletedAt: new Date().toISOString(),
                        },
                    ],
                },
            ],
            sections: [],
            areas: [],
            settings: {},
        };

        const cleaned = removeOrphanedAttachmentsFromData(data);
        expect(cleaned.tasks[0].attachments).toHaveLength(0);
        expect(cleaned.projects[0].attachments).toHaveLength(0);
    });
});
