import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageAdapter } from './storage';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { buildEntityMap } from './store-helpers';
import type { Area, Project, Task } from './types';

const CAPTURE_ID = '123e4567-e89b-12d3-a456-426614174000';
const SECOND_CAPTURE_ID = 'a987f654-e21b-34d5-b678-123456789abc';
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

const createTask = (id: string, overrides: Partial<Task> = {}): Task => ({
    id,
    title: `Task ${id}`,
    status: 'inbox',
    tags: [],
    contexts: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    rev: 1,
    revBy: 'device-a',
    ...overrides,
});

const createArea = (id: string): Area => ({
    id,
    name: 'Work',
    order: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    rev: 1,
    revBy: 'device-a',
});

const createProject = (id: string, areaId: string): Project => ({
    id,
    title: 'Ship release',
    status: 'active',
    color: '#2563EB',
    order: 0,
    tagIds: [],
    areaId,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    rev: 1,
    revBy: 'device-a',
});

describe('capture task idempotency', () => {
    let storage: StorageAdapter;

    beforeEach(() => {
        storage = {
            getData: vi.fn().mockResolvedValue({
                tasks: [],
                projects: [],
                sections: [],
                areas: [],
                people: [],
                settings: {},
            }),
            saveData: vi.fn().mockResolvedValue(undefined),
        };
        setStorageAdapter(storage);
        useTaskStore.setState({
            tasks: [],
            projects: [],
            sections: [],
            areas: [],
            people: [],
            settings: {},
            isLoading: false,
            error: null,
            persistenceFailure: null,
            _allTasks: [],
            _allProjects: [],
            _allSections: [],
            _allAreas: [],
            _allPeople: [],
            _tasksById: new Map(),
            _projectsById: new Map(),
            _sectionsById: new Map(),
            _areasById: new Map(),
            _peopleById: new Map(),
            lastDataChangeAt: 0,
        });
        vi.useFakeTimers();
    });

    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('uses a normalized capture UUID through the normal task factory and persistence pipeline', async () => {
        const area = createArea('area-work');
        const project = createProject('project-release', area.id);
        useTaskStore.setState({
            areas: [area],
            projects: [project],
            settings: { deviceId: 'device-capture' },
            _allAreas: [area],
            _allProjects: [project],
            _areasById: buildEntityMap([area]),
            _projectsById: buildEntityMap([project]),
        });

        const result = await useTaskStore.getState().addTask(
            '  Recorded thought  ',
            {
                id: 'initial-props-id-must-not-win',
                projectId: project.id,
                rev: 99,
                revBy: 'other-device',
                createdAt: '2000-01-01T00:00:00.000Z',
                updatedAt: '2000-01-01T00:00:00.000Z',
                deletedAt: '2000-01-02T00:00:00.000Z',
                purgedAt: '2000-01-03T00:00:00.000Z',
            },
            { captureId: CAPTURE_ID.toUpperCase() },
        );

        expect(result).toMatchObject({ success: true, id: CAPTURE_ID });
        const task = useTaskStore.getState()._allTasks[0];
        expect(task).toMatchObject({
            id: CAPTURE_ID,
            title: 'Recorded thought',
            status: 'inbox',
            taskMode: 'task',
            tags: [],
            contexts: [],
            pushCount: 0,
            rev: 1,
            revBy: 'device-capture',
            isFocusedToday: false,
            suppressMindwtrReminders: false,
            projectId: project.id,
            areaId: undefined,
        });
        expect(task.createdAt).toBe(task.updatedAt);
        expect(task.deletedAt).toBeUndefined();
        expect(task.purgedAt).toBeUndefined();

        await flushPendingSave();
        expect(storage.saveData).toHaveBeenCalledTimes(1);
        expect(vi.mocked(storage.saveData).mock.calls[0]?.[0].tasks).toContainEqual(task);
    });

    it('coalesces simultaneous and later replays of one capture into one task', async () => {
        const { addTask } = useTaskStore.getState();
        const [first, simultaneousReplay] = await Promise.all([
            addTask('First delivery', { description: 'original' }, { captureId: CAPTURE_ID }),
            addTask('Simultaneous replay', { status: 'next' }, { captureId: CAPTURE_ID.toUpperCase() }),
        ]);
        const laterReplay = await useTaskStore.getState().addTask(
            'Later replay',
            { status: 'archived' },
            { captureId: CAPTURE_ID },
        );

        expect(first).toMatchObject({ success: true, id: CAPTURE_ID });
        expect(simultaneousReplay).toMatchObject({ success: true, id: CAPTURE_ID });
        expect(laterReplay).toMatchObject({ success: true, id: CAPTURE_ID });
        expect(useTaskStore.getState()._allTasks).toHaveLength(1);
        expect(useTaskStore.getState()._allTasks[0]).toMatchObject({
            id: CAPTURE_ID,
            title: 'First delivery',
            description: 'original',
            status: 'inbox',
            rev: 1,
        });

        await flushPendingSave();
        expect(storage.saveData).toHaveBeenCalledTimes(1);
    });

    it('returns ids in input order when a capture repeats within one batch', async () => {
        const result = await useTaskStore.getState().addTasks([
            { title: 'First item wins', captureId: SECOND_CAPTURE_ID.toUpperCase() },
            { title: 'Repeated item is a no-op', captureId: SECOND_CAPTURE_ID },
        ]);

        expect(result).toMatchObject({
            success: true,
            id: SECOND_CAPTURE_ID,
            ids: [SECOND_CAPTURE_ID, SECOND_CAPTURE_ID],
        });
        expect(useTaskStore.getState()._allTasks).toHaveLength(1);
        expect(useTaskStore.getState()._allTasks[0].title).toBe('First item wins');
    });

    it.each([
        ['edited', { title: 'User edited title', description: 'Keep me', rev: 7 }],
        ['deleted', { title: 'Deleted capture', deletedAt: '2026-09-02T00:00:00.000Z', rev: 8 }],
        ['purged', {
            title: 'Purged capture',
            deletedAt: '2026-09-02T00:00:00.000Z',
            purgedAt: '2026-09-03T00:00:00.000Z',
            rev: 9,
        }],
    ] as const)('leaves the %s captured task unchanged on replay', async (_state, overrides) => {
        const existing = createTask(CAPTURE_ID, overrides);
        const isVisible = !existing.deletedAt && !existing.purgedAt;
        useTaskStore.setState({
            tasks: isVisible ? [existing] : [],
            settings: {},
            _allTasks: [existing],
            _tasksById: buildEntityMap([existing]),
            lastDataChangeAt: 42,
        });
        const before = structuredClone(useTaskStore.getState()._allTasks);
        const listener = vi.fn();
        const unsubscribe = useTaskStore.subscribe(listener);

        try {
            const result = await useTaskStore.getState().addTask(
                'Replay must not recreate',
                { status: 'next', description: 'Replay payload' },
                { captureId: CAPTURE_ID.toUpperCase() },
            );

            expect(result).toMatchObject({ success: true, id: CAPTURE_ID });
            expect(useTaskStore.getState()._allTasks).toEqual(before);
            expect(useTaskStore.getState().settings).toEqual({});
            expect(useTaskStore.getState().lastDataChangeAt).toBe(42);
            expect(listener).not.toHaveBeenCalled();
            await flushPendingSave();
            expect(storage.saveData).not.toHaveBeenCalled();
        } finally {
            unsubscribe();
        }
    });

    it('rejects an invalid capture id before mutating any item in the batch', async () => {
        const existing = createTask(CAPTURE_ID, { title: 'Existing' });
        useTaskStore.setState({
            tasks: [existing],
            _allTasks: [existing],
            _tasksById: buildEntityMap([existing]),
            lastDataChangeAt: 77,
        });
        const before = structuredClone(useTaskStore.getState()._allTasks);
        const listener = vi.fn();
        const unsubscribe = useTaskStore.subscribe(listener);

        try {
            const result = await useTaskStore.getState().addTasks([
                { title: 'Would otherwise be created', captureId: SECOND_CAPTURE_ID },
                { title: 'Invalid', captureId: `${CAPTURE_ID} trailing-data` },
            ]);

            expect(result).toEqual({ success: false, error: 'Capture ID must be a UUID' });
            expect(useTaskStore.getState()._allTasks).toEqual(before);
            expect(useTaskStore.getState().lastDataChangeAt).toBe(77);
            expect(listener).not.toHaveBeenCalled();
            await flushPendingSave();
            expect(storage.saveData).not.toHaveBeenCalled();
        } finally {
            unsubscribe();
        }
    });

    it('still ignores initialProps.id and generates a fresh UUID for ordinary task creation', async () => {
        const { addTask } = useTaskStore.getState();
        const first = await addTask('Ordinary one', { id: CAPTURE_ID });
        const second = await addTask('Ordinary two', { id: CAPTURE_ID });

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(first.id).toMatch(UUID_PATTERN);
        expect(second.id).toMatch(UUID_PATTERN);
        expect(first.id).not.toBe(CAPTURE_ID);
        expect(second.id).not.toBe(CAPTURE_ID);
        expect(second.id).not.toBe(first.id);
        expect(useTaskStore.getState()._allTasks).toHaveLength(2);
    });
});
