import { describe, it, expect } from 'vitest';
import { mergeAppData, mergeAppDataWithStats, filterDeleted, appendSyncHistory, performSyncCycle } from './sync';
import { AppData, Task, Project, Attachment, Section, Area } from './types';

describe('Sync Logic', () => {
    const createMockTask = (id: string, updatedAt: string, deletedAt?: string): Task => ({
        id,
        title: `Task ${id}`,
        status: 'inbox',
        updatedAt,
        createdAt: '2023-01-01T00:00:00.000Z',
        tags: [],
        contexts: [],
        deletedAt
    });

    const createMockProject = (id: string, updatedAt: string, deletedAt?: string): Project => ({
        id,
        title: `Project ${id}`,
        status: 'active',
        color: '#000000',
        tagIds: [],
        updatedAt,
        createdAt: '2023-01-01T00:00:00.000Z',
        deletedAt
    });

    const createMockSection = (id: string, projectId: string, updatedAt: string, deletedAt?: string): Section => ({
        id,
        projectId,
        title: `Section ${id}`,
        description: '',
        order: 0,
        isCollapsed: false,
        updatedAt,
        createdAt: '2023-01-01T00:00:00.000Z',
        deletedAt
    });

    const createMockArea = (id: string, updatedAt: string, deletedAt?: string): Area => ({
        id,
        name: `Area ${id}`,
        order: 0,
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt,
        deletedAt,
    });

    const mockAppData = (tasks: Task[] = [], projects: Project[] = [], sections: Section[] = []): AppData => ({
        tasks,
        projects,
        sections,
        areas: [],
        settings: {}
    });

    describe('mergeAppData', () => {
        it('should merge attachments across devices', () => {
            const localAttachment: Attachment = {
                id: 'att-local',
                kind: 'file',
                title: 'local.txt',
                uri: '/tmp/local.txt',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-02T00:00:00.000Z',
            };
            const incomingAttachment: Attachment = {
                id: 'att-incoming',
                kind: 'link',
                title: 'example',
                uri: 'https://example.com',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-02T00:00:00.000Z',
            };

            const localTask: Task = {
                ...createMockTask('1', '2023-01-02'),
                attachments: [localAttachment],
            };
            const incomingTask: Task = {
                ...createMockTask('1', '2023-01-03'), // incoming wins task conflict
                attachments: [incomingAttachment],
            };

            const merged = mergeAppData(mockAppData([localTask]), mockAppData([incomingTask]));

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].updatedAt).toBe('2023-01-03');
            expect((merged.tasks[0].attachments || []).map(a => a.id).sort()).toEqual(['att-incoming', 'att-local']);
        });

        it('uses winner attachment uri when incoming wins and has a usable uri', () => {
            const localAttachment: Attachment = {
                id: 'att-1',
                kind: 'file',
                title: 'doc.txt',
                uri: '/local/doc.txt',
                localStatus: 'available',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-02T00:00:00.000Z',
            };
            const incomingAttachment: Attachment = {
                id: 'att-1',
                kind: 'file',
                title: 'doc.txt',
                uri: '/incoming/doc.txt',
                cloudKey: 'attachments/att-1.txt',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-03T00:00:00.000Z',
            };

            const localTask: Task = {
                ...createMockTask('1', '2023-01-02'),
                attachments: [localAttachment],
            };
            const incomingTask: Task = {
                ...createMockTask('1', '2023-01-03'),
                attachments: [incomingAttachment],
            };

            const merged = mergeAppData(mockAppData([localTask]), mockAppData([incomingTask]));
            const attachment = merged.tasks[0].attachments?.find(a => a.id === 'att-1');

            expect(attachment?.uri).toBe('/incoming/doc.txt');
            expect(attachment?.localStatus).toBe('available');
            expect(attachment?.cloudKey).toBe('attachments/att-1.txt');
        });

        it('marks attachment as available when local URI exists without localStatus', () => {
            const localAttachment: Attachment = {
                id: 'att-available',
                kind: 'file',
                title: 'doc.txt',
                uri: '/local/doc.txt',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-02T00:00:00.000Z',
            };
            const incomingAttachment: Attachment = {
                id: 'att-available',
                kind: 'file',
                title: 'doc.txt',
                uri: '',
                cloudKey: 'attachments/att-available.txt',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-03T00:00:00.000Z',
            };

            const localTask: Task = {
                ...createMockTask('1', '2023-01-02'),
                attachments: [localAttachment],
            };
            const incomingTask: Task = {
                ...createMockTask('1', '2023-01-03'),
                attachments: [incomingAttachment],
            };

            const merged = mergeAppData(mockAppData([localTask]), mockAppData([incomingTask]));
            const attachment = merged.tasks[0].attachments?.find((item) => item.id === 'att-available');

            expect(attachment?.uri).toBe('/local/doc.txt');
            expect(attachment?.localStatus).toBe('available');
        });

        it('should retain local cloudKey when incoming lacks it', () => {
            const localAttachment: Attachment = {
                id: 'att-2',
                kind: 'file',
                title: 'note.txt',
                uri: '/local/note.txt',
                cloudKey: 'attachments/att-2.txt',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-02T00:00:00.000Z',
            };
            const incomingAttachment: Attachment = {
                id: 'att-2',
                kind: 'file',
                title: 'note.txt',
                uri: '',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-03T00:00:00.000Z',
            };

            const localTask: Task = {
                ...createMockTask('1', '2023-01-02'),
                attachments: [localAttachment],
            };
            const incomingTask: Task = {
                ...createMockTask('1', '2023-01-03'),
                attachments: [incomingAttachment],
            };

            const merged = mergeAppData(mockAppData([localTask]), mockAppData([incomingTask]));
            const attachment = merged.tasks[0].attachments?.find(a => a.id === 'att-2');

            expect(attachment?.cloudKey).toBe('attachments/att-2.txt');
        });

        it('falls back to incoming URI when local attachment is missing', () => {
            const localAttachment: Attachment = {
                id: 'att-missing',
                kind: 'file',
                title: 'doc.txt',
                uri: '/local/doc.txt',
                localStatus: 'missing',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-02T00:00:00.000Z',
            };
            const incomingAttachment: Attachment = {
                id: 'att-missing',
                kind: 'file',
                title: 'doc.txt',
                uri: '/incoming/doc.txt',
                cloudKey: 'attachments/att-missing.txt',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-03T00:00:00.000Z',
            };
            const localTask: Task = {
                ...createMockTask('1', '2023-01-02'),
                attachments: [localAttachment],
            };
            const incomingTask: Task = {
                ...createMockTask('1', '2023-01-03'),
                attachments: [incomingAttachment],
            };

            const merged = mergeAppData(mockAppData([localTask]), mockAppData([incomingTask]));
            const attachment = merged.tasks[0].attachments?.find((item) => item.id === 'att-missing');
            expect(attachment?.uri).toBe('/incoming/doc.txt');
            expect(attachment?.cloudKey).toBe('attachments/att-missing.txt');
        });

        it('enriches incoming-only attachments with localStatus when uri exists', () => {
            const incomingAttachment: Attachment = {
                id: 'att-incoming-only',
                kind: 'file',
                title: 'incoming-only.txt',
                uri: '/incoming/incoming-only.txt',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-03T00:00:00.000Z',
            };

            const localTask: Task = {
                ...createMockTask('1', '2023-01-02'),
                attachments: [],
            };
            const incomingTask: Task = {
                ...createMockTask('1', '2023-01-03'),
                attachments: [incomingAttachment],
            };

            const merged = mergeAppData(mockAppData([localTask]), mockAppData([incomingTask]));
            const attachment = merged.tasks[0].attachments?.find((item) => item.id === 'att-incoming-only');

            expect(attachment?.uri).toBe('/incoming/incoming-only.txt');
            expect(attachment?.localStatus).toBe('available');
        });

        it('should preserve attachment deletions using attachment timestamps', () => {
            const localAttachment: Attachment = {
                id: 'att-1',
                kind: 'file',
                title: 'local.txt',
                uri: '/tmp/local.txt',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-04T00:00:00.000Z',
                deletedAt: '2023-01-04T00:00:00.000Z',
            };
            const incomingAttachment: Attachment = {
                id: 'att-1',
                kind: 'file',
                title: 'local.txt',
                uri: '/tmp/local.txt',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-02T00:00:00.000Z',
            };

            const localTask: Task = {
                ...createMockTask('1', '2023-01-03'),
                attachments: [localAttachment],
            };
            const incomingTask: Task = {
                ...createMockTask('1', '2023-01-03'),
                attachments: [incomingAttachment],
            };

            const merged = mergeAppData(mockAppData([localTask]), mockAppData([incomingTask]));
            const attachment = merged.tasks[0].attachments?.find(a => a.id === 'att-1');
            expect(attachment?.deletedAt).toBe('2023-01-04T00:00:00.000Z');
        });

        it('should merge unique items from both sources', () => {
            const local = mockAppData([createMockTask('1', '2023-01-01')]);
            const incoming = mockAppData([createMockTask('2', '2023-01-01')]);

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(2);
            expect(merged.tasks.find(t => t.id === '1')).toBeDefined();
            expect(merged.tasks.find(t => t.id === '2')).toBeDefined();
        });

        it('should merge sections from both sources', () => {
            const local = mockAppData([], [], [createMockSection('s1', 'p1', '2023-01-01')]);
            const incoming = mockAppData([], [], [createMockSection('s2', 'p1', '2023-01-01')]);

            const merged = mergeAppData(local, incoming);

            expect(merged.sections).toHaveLength(2);
            expect(merged.sections.find((s) => s.id === 's1')).toBeDefined();
            expect(merged.sections.find((s) => s.id === 's2')).toBeDefined();
        });

        it('should update section when incoming is newer', () => {
            const local = mockAppData([], [], [createMockSection('s1', 'p1', '2023-01-01')]);
            const incoming = mockAppData([], [], [createMockSection('s1', 'p1', '2023-01-02')]);

            const merged = mergeAppData(local, incoming);

            expect(merged.sections).toHaveLength(1);
            expect(merged.sections[0].updatedAt).toBe('2023-01-02');
        });

        it('should preserve section deletion when incoming delete is newer', () => {
            const local = mockAppData([], [], [createMockSection('s1', 'p1', '2023-01-01')]);
            const incoming = mockAppData([], [], [createMockSection('s1', 'p1', '2023-01-02', '2023-01-02')]);

            const merged = mergeAppData(local, incoming);

            expect(merged.sections).toHaveLength(1);
            expect(merged.sections[0].deletedAt).toBe('2023-01-02');
        });

        it('should update local item if incoming is newer', () => {
            const local = mockAppData([createMockTask('1', '2023-01-01')]);
            const incoming = mockAppData([createMockTask('1', '2023-01-02')]); // Newer

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].updatedAt).toBe('2023-01-02');
        });

        it('should keep local item if local is newer', () => {
            const local = mockAppData([createMockTask('1', '2023-01-02')]); // Newer
            const incoming = mockAppData([createMockTask('1', '2023-01-01')]);

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].updatedAt).toBe('2023-01-02');
        });

        it('should handle soft deletions correctly (incoming delete wins if newer)', () => {
            const local = mockAppData([createMockTask('1', '2023-01-01')]);
            const incoming = mockAppData([createMockTask('1', '2023-01-02', '2023-01-02')]); // Deleted and Newer

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].deletedAt).toBe('2023-01-02');
        });

        it('should handle soft deletions correctly (local delete wins if newer)', () => {
            const local = mockAppData([createMockTask('1', '2023-01-02', '2023-01-02')]); // Deleted and Newer
            const incoming = mockAppData([createMockTask('1', '2023-01-01')]);

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].deletedAt).toBe('2023-01-02');
        });

        it('prefers deletion when delete time is newer within skew threshold', () => {
            const local = mockAppData([createMockTask('1', '2023-01-02T00:00:00.000Z')]);
            const incoming = mockAppData([createMockTask('1', '2023-01-02T00:04:00.000Z', '2023-01-02T00:04:00.000Z')]);

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].deletedAt).toBe('2023-01-02T00:04:00.000Z');
            expect(merged.tasks[0].updatedAt).toBe('2023-01-02T00:04:00.000Z');
        });

        it('uses strict last operation time for delete-vs-live conflicts', () => {
            const local = mockAppData([createMockTask('1', '2023-01-02T00:00:00.000Z', '2023-01-02T00:00:00.000Z')]);
            const incoming = mockAppData([createMockTask('1', '2023-01-02T00:03:00.000Z')]);

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].deletedAt).toBeUndefined();
            expect(merged.tasks[0].updatedAt).toBe('2023-01-02T00:03:00.000Z');
        });

        it('uses strict last operation time for delete-vs-live conflicts with revisions', () => {
            const localTask = {
                ...createMockTask('1', '2023-01-02T00:00:00.000Z', '2023-01-02T00:00:00.000Z'),
                rev: 10,
                revBy: 'device-a',
            } satisfies Task;
            const incomingTask = {
                ...createMockTask('1', '2023-01-02T00:03:00.000Z'),
                rev: 9,
                revBy: 'device-b',
            } satisfies Task;
            const local = mockAppData([localTask]);
            const incoming = mockAppData([incomingTask]);

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].deletedAt).toBeUndefined();
            expect(merged.tasks[0].updatedAt).toBe('2023-01-02T00:03:00.000Z');
        });

        it('prefers newer timestamp when revisions tie but revBy differs', () => {
            const localTask = {
                ...createMockTask('1', '2023-01-02T00:05:00.000Z'),
                title: 'local newer',
                rev: 7,
                revBy: 'device-z',
            } satisfies Task;
            const incomingTask = {
                ...createMockTask('1', '2023-01-02T00:01:00.000Z'),
                title: 'incoming older',
                rev: 7,
                revBy: 'device-a',
            } satisfies Task;

            const merged = mergeAppData(mockAppData([localTask]), mockAppData([incomingTask]));

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].title).toBe('local newer');
            expect(merged.tasks[0].updatedAt).toBe('2023-01-02T00:05:00.000Z');
        });

        it('uses revBy tie-break only when revision and timestamp are equal', () => {
            const localTask = {
                ...createMockTask('1', '2023-01-02T00:05:00.000Z'),
                title: 'local',
                rev: 7,
                revBy: 'device-a',
            } satisfies Task;
            const incomingTask = {
                ...createMockTask('1', '2023-01-02T00:05:00.000Z'),
                title: 'incoming',
                rev: 7,
                revBy: 'device-z',
            } satisfies Task;

            const merged = mergeAppData(mockAppData([localTask]), mockAppData([incomingTask]));

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].title).toBe('incoming');
        });

        it('counts a conflict when revision metadata matches but content differs', () => {
            const localTask = {
                ...createMockTask('1', '2023-01-02T00:05:00.000Z'),
                title: 'omega',
                rev: 7,
                revBy: 'device-a',
            } satisfies Task;
            const incomingTask = {
                ...createMockTask('1', '2023-01-02T00:05:00.000Z'),
                title: 'alpha',
                rev: 7,
                revBy: 'device-a',
            } satisfies Task;

            const result = mergeAppDataWithStats(mockAppData([localTask]), mockAppData([incomingTask]));

            expect(result.data.tasks).toHaveLength(1);
            expect(result.data.tasks[0].title).toBe('omega');
            expect(result.stats.tasks.conflicts).toBe(1);
            expect(result.stats.tasks.conflictIds).toContain('1');
        });

        it('does not count conflict when only purgedAt differs', () => {
            const localTask = {
                ...createMockTask('1', '2023-01-02T00:05:00.000Z'),
                rev: 7,
                revBy: 'device-a',
                purgedAt: '2023-01-03T00:00:00.000Z',
            } satisfies Task;
            const incomingTask = {
                ...createMockTask('1', '2023-01-02T00:05:00.000Z'),
                rev: 7,
                revBy: 'device-a',
            } satisfies Task;

            const result = mergeAppDataWithStats(mockAppData([localTask]), mockAppData([incomingTask]));

            expect(result.data.tasks).toHaveLength(1);
            expect(result.stats.tasks.conflicts).toBe(0);
            expect(result.stats.tasks.conflictIds).toHaveLength(0);
        });

        it('resolves equal revision/timestamp conflicts consistently across sync direction', () => {
            const localTask = {
                ...createMockTask('1', '2023-01-02T00:05:00.000Z'),
                title: 'omega',
                rev: 7,
                revBy: 'device-a',
            } satisfies Task;
            const incomingTask = {
                ...createMockTask('1', '2023-01-02T00:05:00.000Z'),
                title: 'alpha',
                rev: 7,
                revBy: 'device-a',
            } satisfies Task;

            const forward = mergeAppData(mockAppData([localTask]), mockAppData([incomingTask]));
            const reverse = mergeAppData(mockAppData([incomingTask]), mockAppData([localTask]));

            expect(forward.tasks[0].title).toBe('omega');
            expect(reverse.tasks[0].title).toBe('omega');
        });

        it('resolves legacy equal-timestamp conflicts consistently across sync direction', () => {
            const localTask = {
                ...createMockTask('1', '2023-01-02T00:05:00.000Z'),
                title: 'omega',
            } satisfies Task;
            const incomingTask = {
                ...createMockTask('1', '2023-01-02T00:05:00.000Z'),
                title: 'alpha',
            } satisfies Task;

            const forward = mergeAppData(mockAppData([localTask]), mockAppData([incomingTask]));
            const reverse = mergeAppData(mockAppData([incomingTask]), mockAppData([localTask]));

            expect(forward.tasks[0].title).toBe('omega');
            expect(reverse.tasks[0].title).toBe('omega');
        });

        it('prefers tombstone when delete-vs-live operation times are equal', () => {
            const local = mockAppData([
                createMockTask('1', '2023-01-02T00:00:00.000Z', '2023-01-02T00:05:00.000Z'),
            ]);
            const incoming = mockAppData([
                createMockTask('1', '2023-01-02T00:05:00.000Z'),
            ]);

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].deletedAt).toBe('2023-01-02T00:05:00.000Z');
            expect(merged.tasks[0].updatedAt).toBe('2023-01-02T00:00:00.000Z');
        });

        it('treats invalid deletedAt as a conservative deletion timestamp', () => {
            const local = mockAppData([
                createMockTask('1', '2023-01-01T00:00:00.000Z', 'invalid-date'),
            ]);
            const incoming = mockAppData([
                createMockTask('1', '2023-01-02T00:00:00.000Z'),
            ]);

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].deletedAt).toBeUndefined();
            expect(merged.tasks[0].updatedAt).toBe('2023-01-02T00:00:00.000Z');
        });

        it('uses max(deletedAt, updatedAt) for delete operation time', () => {
            const local = mockAppData([
                createMockTask('1', '2023-01-02T00:06:00.000Z', '2023-01-02T00:05:00.000Z'),
            ]);
            const incoming = mockAppData([
                createMockTask('1', '2023-01-02T00:05:30.000Z'),
            ]);

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].deletedAt).toBe('2023-01-02T00:05:00.000Z');
            expect(merged.tasks[0].updatedAt).toBe('2023-01-02T00:06:00.000Z');
        });

        it('prefers newer item when timestamps are within skew threshold', () => {
            const local = mockAppData([createMockTask('1', '2023-01-02T00:00:00.000Z')]);
            const incoming = mockAppData([createMockTask('1', '2023-01-02T00:04:00.000Z')]);

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].updatedAt).toBe('2023-01-02T00:04:00.000Z');
        });

        it('treats empty updatedAt as older than a valid epoch timestamp', () => {
            const local = mockAppData([], [
                {
                    ...createMockProject('p1', ''),
                    title: 'Zulu',
                },
            ]);
            const incoming = mockAppData([], [
                {
                    ...createMockProject('p1', '1970-01-01T00:00:00.000Z'),
                    title: 'Alpha',
                },
            ]);

            const merged = mergeAppData(local, incoming);

            expect(merged.projects).toHaveLength(1);
            expect(merged.projects[0].title).toBe('Alpha');
            expect(merged.projects[0].updatedAt).toBe('1970-01-01T00:00:00.000Z');
        });

        it('normalizes invalid createdAt without rewriting updatedAt', () => {
            const localProject: Project = {
                ...createMockProject('p1', '2023-01-02T00:01:00.000Z'),
                createdAt: '2023-01-02T00:05:00.000Z',
            };
            const { data, stats } = mergeAppDataWithStats(mockAppData([], [localProject]), mockAppData());

            expect(data.projects).toHaveLength(1);
            expect(data.projects[0].updatedAt).toBe('2023-01-02T00:01:00.000Z');
            expect(data.projects[0].createdAt).toBe('2023-01-02T00:01:00.000Z');
            expect(stats.projects.timestampAdjustments).toBe(1);
        });

        it('should revive item if update is newer than deletion', () => {
            // This case implies "undo delete" or "re-edit" happened after delete on another device
            const local = mockAppData([createMockTask('1', '2023-01-01', '2023-01-01')]); // Deleted
            const incoming = mockAppData([createMockTask('1', '2023-01-02')]); // Undone/Edited later

            const merged = mergeAppData(local, incoming);

            expect(merged.tasks).toHaveLength(1);
            expect(merged.tasks[0].deletedAt).toBeUndefined();
            expect(merged.tasks[0].updatedAt).toBe('2023-01-02');
        });

        it('should preserve local settings regardless of incoming settings', () => {
            const local: AppData = { ...mockAppData(), settings: { theme: 'dark' } };
            const incoming: AppData = { ...mockAppData(), settings: { theme: 'light' } };

            const merged = mergeAppData(local, incoming);

            expect(merged.settings.theme).toBe('dark');
        });

        it('merges synced language settings per field', () => {
            const local: AppData = {
                ...mockAppData(),
                settings: {
                    language: 'en',
                    weekStart: 'monday',
                    dateFormat: 'yyyy-MM-dd',
                    syncPreferences: { language: true },
                    syncPreferencesUpdatedAt: {
                        preferences: '2024-01-01T00:00:00.000Z',
                        language: '2024-01-01T00:00:00.000Z',
                    },
                },
            };
            const incoming: AppData = {
                ...mockAppData(),
                settings: {
                    language: 'es',
                    weekStart: 'monday',
                    syncPreferences: { language: true },
                    syncPreferencesUpdatedAt: {
                        preferences: '2024-01-02T00:00:00.000Z',
                        language: '2024-01-02T00:00:00.000Z',
                    },
                },
            };

            const merged = mergeAppData(local, incoming);

            expect(merged.settings.language).toBe('es');
            expect(merged.settings.weekStart).toBe('monday');
            expect(merged.settings.dateFormat).toBe('yyyy-MM-dd');
        });

        it('merges language settings even when sync preferences are empty', () => {
            const local: AppData = {
                ...mockAppData(),
                settings: {
                    language: 'en',
                    syncPreferences: {},
                    syncPreferencesUpdatedAt: {
                        language: '2024-01-01T00:00:00.000Z',
                    },
                },
            };
            const incoming: AppData = {
                ...mockAppData(),
                settings: {
                    language: 'es',
                    syncPreferences: {},
                    syncPreferencesUpdatedAt: {
                        language: '2024-01-02T00:00:00.000Z',
                    },
                },
            };

            const merged = mergeAppData(local, incoming);

            expect(merged.settings.language).toBe('es');
        });

        it('merges settings for disabled preference groups instead of dropping them', () => {
            const local: AppData = {
                ...mockAppData(),
                settings: {
                    theme: 'dark',
                    syncPreferences: { appearance: false },
                    syncPreferencesUpdatedAt: {
                        appearance: '2024-01-01T00:00:00.000Z',
                    },
                },
            };
            const incoming: AppData = {
                ...mockAppData(),
                settings: {
                    theme: 'light',
                    syncPreferences: { appearance: false },
                    syncPreferencesUpdatedAt: {
                        appearance: '2024-01-02T00:00:00.000Z',
                    },
                },
            };

            const merged = mergeAppData(local, incoming);

            expect(merged.settings.theme).toBe('light');
        });

        it('keeps area tombstones so deletions sync across devices', () => {
            const local: AppData = {
                ...mockAppData(),
                areas: [createMockArea('a1', '2023-01-01T00:00:00.000Z')],
            };
            const incoming: AppData = {
                ...mockAppData(),
                areas: [createMockArea('a1', '2023-01-03T00:00:00.000Z', '2023-01-03T00:00:00.000Z')],
            };

            const merged = mergeAppData(local, incoming);
            expect(merged.areas).toHaveLength(1);
            expect(merged.areas[0].deletedAt).toBe('2023-01-03T00:00:00.000Z');
        });

        it('does not globally re-sort areas after merge', () => {
            const local: AppData = {
                ...mockAppData(),
                areas: [
                    { ...createMockArea('a1', '2023-01-04T00:00:00.000Z'), order: 10 },
                    { ...createMockArea('a2', '2023-01-04T00:00:00.000Z'), order: 0 },
                ],
            };
            const incoming: AppData = {
                ...mockAppData(),
                areas: [],
            };

            const merged = mergeAppData(local, incoming);
            expect(merged.areas.map((area) => area.id)).toEqual(['a1', 'a2']);
            expect(merged.areas.map((area) => area.order)).toEqual([10, 0]);
        });
    });

    describe('mergeAppDataWithStats', () => {
        it('should report conflicts and resolution counts', () => {
            const local = mockAppData([
                createMockTask('1', '2023-01-02'),
                createMockTask('2', '2023-01-01'),
            ]);
            const incoming = mockAppData([
                createMockTask('1', '2023-01-01'), // older -> local wins conflict
                createMockTask('3', '2023-01-01'), // incoming only
            ]);

            const result = mergeAppDataWithStats(local, incoming);

            expect(result.data.tasks).toHaveLength(3);
            expect(result.stats.tasks.localOnly).toBe(1);
            expect(result.stats.tasks.incomingOnly).toBe(1);
            expect(result.stats.tasks.conflicts).toBe(1);
            expect(result.stats.tasks.resolvedUsingLocal).toBeGreaterThan(0);
        });
    });

    describe('performSyncCycle', () => {
        it('returns conflict status when merge finds conflicts', async () => {
            const local = mockAppData([createMockTask('1', '2023-01-02')]);
            const incoming = mockAppData([createMockTask('1', '2023-01-01')]);

            const result = await performSyncCycle({
                readLocal: async () => local,
                readRemote: async () => incoming,
                writeLocal: async () => undefined,
                writeRemote: async () => undefined,
            });

            expect(result.status).toBe('conflict');
            expect(result.stats.tasks.conflicts).toBe(1);
        });

        it('fails before writes when merged data is invalid', async () => {
            let wroteLocal = false;
            let wroteRemote = false;
            const invalidIncoming: AppData = {
                tasks: [],
                projects: [
                    {
                        // Missing id on purpose to simulate corrupted remote payload.
                        title: 'Broken',
                        status: 'active',
                        color: '#000000',
                        order: 0,
                        tagIds: [],
                        createdAt: '2024-01-01T00:00:00.000Z',
                        updatedAt: '2024-01-01T00:00:00.000Z',
                    } as unknown as Project,
                ],
                sections: [],
                areas: [],
                settings: {},
            };

            await expect(performSyncCycle({
                readLocal: async () => mockAppData(),
                readRemote: async () => invalidIncoming,
                writeLocal: async () => {
                    wroteLocal = true;
                },
                writeRemote: async () => {
                    wroteRemote = true;
                },
            })).rejects.toThrow('Sync validation failed');
            expect(wroteLocal).toBe(false);
            expect(wroteRemote).toBe(false);
        });

        it('fails before merge when remote payload shape is invalid', async () => {
            let wroteLocal = false;
            let wroteRemote = false;

            await expect(performSyncCycle({
                readLocal: async () => mockAppData(),
                readRemote: async () => ({
                    tasks: 'not-an-array',
                    projects: [],
                    sections: [],
                    areas: [],
                    settings: {},
                } as unknown as AppData),
                writeLocal: async () => {
                    wroteLocal = true;
                },
                writeRemote: async () => {
                    wroteRemote = true;
                },
            })).rejects.toThrow('Invalid remote sync payload');
            expect(wroteLocal).toBe(false);
            expect(wroteRemote).toBe(false);
        });

        it('drops empty task revBy values from incoming payloads', async () => {
            let saved: AppData | null = null;
            const incoming = mockAppData([
                {
                    ...createMockTask('legacy-task', '2024-01-01T00:00:00.000Z'),
                    rev: 2,
                    revBy: '',
                },
            ]);

            await performSyncCycle({
                readLocal: async () => mockAppData(),
                readRemote: async () => incoming,
                writeLocal: async (data) => {
                    saved = data;
                },
                writeRemote: async () => undefined,
            });

            expect(saved).not.toBeNull();
            expect(saved!.tasks).toHaveLength(1);
            expect(saved!.tasks[0].rev).toBe(2);
            expect(saved!.tasks[0].revBy).toBeUndefined();
        });

        it('drops invalid revBy values from projects, sections, and areas', async () => {
            let saved: AppData | null = null;
            const localData: AppData = {
                tasks: [],
                projects: [
                    {
                        ...createMockProject('project-local', '2024-01-01T00:00:00.000Z'),
                        revBy: '',
                    },
                ],
                sections: [
                    {
                        ...createMockSection('section-local', 'project-local', '2024-01-01T00:00:00.000Z'),
                        revBy: '   ',
                    },
                ],
                areas: [
                    {
                        ...createMockArea('area-local', '2024-01-01T00:00:00.000Z'),
                        revBy: '',
                    },
                ],
                settings: {},
            };
            const incomingData: AppData = {
                tasks: [],
                projects: [
                    {
                        ...createMockProject('project-incoming', '2024-01-01T00:00:00.000Z'),
                        revBy: '   ',
                    },
                ],
                sections: [
                    {
                        ...createMockSection('section-incoming', 'project-incoming', '2024-01-01T00:00:00.000Z'),
                        revBy: '',
                    },
                ],
                areas: [
                    {
                        ...createMockArea('area-incoming', '2024-01-01T00:00:00.000Z'),
                        revBy: '',
                    },
                ],
                settings: {},
            };

            await performSyncCycle({
                readLocal: async () => localData,
                readRemote: async () => incomingData,
                writeLocal: async (data) => {
                    saved = data;
                },
                writeRemote: async () => undefined,
            });

            expect(saved).not.toBeNull();
            expect(saved!.projects.every((project) => project.revBy === undefined)).toBe(true);
            expect(saved!.sections.every((section) => section.revBy === undefined)).toBe(true);
            expect(saved!.areas.every((area) => area.revBy === undefined)).toBe(true);
        });

        it('purges expired task tombstones and deleted attachment tombstones by default', async () => {
            let saved: AppData | null = null;
            const oldPurgedTask = {
                ...createMockTask('old-purged', '2025-06-01T00:00:00.000Z', '2025-06-01T00:00:00.000Z'),
                purgedAt: '2025-06-01T00:00:00.000Z',
            } as Task;
            const oldDeletedTask = createMockTask('old-deleted', '2025-06-01T00:00:00.000Z', '2025-06-01T00:00:00.000Z');
            const taskWithDeletedAttachment = {
                ...createMockTask('with-deleted-attachment', '2025-12-20T00:00:00.000Z'),
                attachments: [{
                    id: 'att-old-deleted',
                    kind: 'file',
                    title: 'old.txt',
                    uri: '/tmp/old.txt',
                    createdAt: '2025-01-01T00:00:00.000Z',
                    updatedAt: '2025-01-01T00:00:00.000Z',
                    deletedAt: '2025-01-01T00:00:00.000Z',
                }],
            } as Task;

            await performSyncCycle({
                readLocal: async () => mockAppData([oldPurgedTask, oldDeletedTask, taskWithDeletedAttachment]),
                readRemote: async () => null,
                writeLocal: async (data) => {
                    saved = data;
                },
                writeRemote: async () => undefined,
                now: () => '2026-01-01T00:00:00.000Z',
            });

            expect(saved).not.toBeNull();
            expect(saved!.tasks.some((task) => task.id === 'old-purged')).toBe(false);
            expect(saved!.tasks.some((task) => task.id === 'old-deleted')).toBe(true);
            const keptTask = saved!.tasks.find((task) => task.id === 'with-deleted-attachment');
            expect(keptTask).toBeTruthy();
            expect(keptTask!.attachments).toBeUndefined();
        });

        it('drops expired remote tombstones before merge so live tasks are preserved', async () => {
            let saved: AppData | null = null;
            const localLiveTask = createMockTask('task-1', '2025-10-01T00:00:00.000Z');
            const remoteExpiredTombstone = {
                ...createMockTask('task-1', '2025-11-01T00:00:00.000Z', '2025-11-01T00:00:00.000Z'),
                purgedAt: '2025-11-01T00:00:00.000Z',
            } as Task;

            await performSyncCycle({
                readLocal: async () => mockAppData([localLiveTask]),
                readRemote: async () => mockAppData([remoteExpiredTombstone]),
                writeLocal: async (data) => {
                    saved = data;
                },
                writeRemote: async () => undefined,
                now: () => '2026-03-15T00:00:00.000Z',
            });

            expect(saved).not.toBeNull();
            expect(saved!.tasks).toHaveLength(1);
            expect(saved!.tasks[0].id).toBe('task-1');
            expect(saved!.tasks[0].deletedAt).toBeUndefined();
        });

        it('respects custom tombstone retention window', async () => {
            let saved: AppData | null = null;
            const oldPurgedTask = {
                ...createMockTask('old-purged', '2025-06-01T00:00:00.000Z', '2025-06-01T00:00:00.000Z'),
                purgedAt: '2025-06-01T00:00:00.000Z',
            } as Task;

            await performSyncCycle({
                readLocal: async () => mockAppData([oldPurgedTask]),
                readRemote: async () => null,
                writeLocal: async (data) => {
                    saved = data;
                },
                writeRemote: async () => undefined,
                now: () => '2026-01-01T00:00:00.000Z',
                tombstoneRetentionDays: 220,
            });

            expect(saved).not.toBeNull();
            expect(saved!.tasks.some((task) => task.id === 'old-purged')).toBe(true);
        });

        it('keeps freshly purged tombstones so deletion can sync', async () => {
            let saved: AppData | null = null;
            const freshPurgedTask = {
                ...createMockTask('fresh-purged', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
                purgedAt: '2026-01-01T00:00:00.000Z',
            } as Task;

            await performSyncCycle({
                readLocal: async () => mockAppData([freshPurgedTask]),
                readRemote: async () => null,
                writeLocal: async (data) => {
                    saved = data;
                },
                writeRemote: async () => undefined,
                now: () => '2026-01-02T00:00:00.000Z',
            });

            expect(saved).not.toBeNull();
            expect(saved!.tasks.some((task) => task.id === 'fresh-purged')).toBe(true);
        });

        it('writes local before remote and surfaces remote failures', async () => {
            let wroteLocal = false;
            let wroteRemote = false;

            await expect(performSyncCycle({
                readLocal: async () => mockAppData([createMockTask('1', '2024-01-01T00:00:00.000Z')]),
                readRemote: async () => mockAppData(),
                writeLocal: async () => {
                    wroteLocal = true;
                },
                writeRemote: async () => {
                    wroteRemote = true;
                    throw new Error('remote write failed');
                },
            })).rejects.toThrow('remote write failed');

            expect(wroteRemote).toBe(true);
            expect(wroteLocal).toBe(true);
        });

        it('does not write remote when local write fails', async () => {
            let wroteRemote = false;
            await expect(performSyncCycle({
                readLocal: async () => mockAppData([createMockTask('1', '2024-01-01T00:00:00.000Z')]),
                readRemote: async () => mockAppData(),
                writeLocal: async () => {
                    throw new Error('local write failed');
                },
                writeRemote: async () => {
                    wroteRemote = true;
                },
            })).rejects.toThrow('local write failed');
            expect(wroteRemote).toBe(false);
        });

        it('reports orchestration steps in order', async () => {
            const steps: string[] = [];
            await performSyncCycle({
                readLocal: async () => mockAppData([createMockTask('1', '2024-01-01T00:00:00.000Z')]),
                readRemote: async () => mockAppData(),
                writeLocal: async () => undefined,
                writeRemote: async () => undefined,
                onStep: (step) => {
                    steps.push(step);
                },
            });
            expect(steps).toEqual([
                'read-local',
                'read-remote',
                'merge',
                'write-local',
                'write-remote',
            ]);
        });
    });

    describe('appendSyncHistory', () => {
        it('drops invalid entries and respects limits', () => {
            const entry = {
                at: '2024-01-01T00:00:00.000Z',
                status: 'success',
                conflicts: 0,
                conflictIds: [],
                maxClockSkewMs: 0,
                timestampAdjustments: 0,
            } as const;
            const settings: AppData['settings'] = {
                lastSyncHistory: [
                    entry,
                    { invalid: true } as any,
                ],
            };

            const next = appendSyncHistory(settings, {
                ...entry,
                at: '2024-01-02T00:00:00.000Z',
            }, 2);

            expect(next).toHaveLength(2);
            expect(next[0].at).toBe('2024-01-02T00:00:00.000Z');
            expect(next[1].at).toBe('2024-01-01T00:00:00.000Z');
        });
    });

    describe('filterDeleted', () => {
        it('should filter out items with deletedAt set', () => {
            const tasks = [
                createMockTask('1', '2023-01-01'),
                createMockTask('2', '2023-01-01', '2023-01-01')
            ];

            const filtered = filterDeleted(tasks);

            expect(filtered).toHaveLength(1);
            expect(filtered[0].id).toBe('1');
        });
    });
});
