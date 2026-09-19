import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTaskStore, flushPendingSave, resetForTests, setStorageAdapter } from './store';
import type { StorageAdapter } from './storage';
import type { Area, Project, Section, Task } from './types';

// The project counterpart to local-api-action-parity.test.ts: the same shared
// fixture also carries `kind: "project-action"` cases, asserted on the Rust
// side by local_api.rs's
// `local_api_project_delete_or_restore_matches_core_fixture`. The rule both
// engines implement - delete detaches live tasks and soft-deletes live
// sections, restore revives only the rows from the same cascade, repairs the
// area link and stamps a fresh revision on every row it touches - is stated
// once, here, instead of in two hand-written sets of assertions.
type ProjectActionParityCase = {
    kind: 'project-action';
    name: string;
    action: 'delete' | 'restore';
    projectId: string;
    now: string;
    deviceId: string;
    expectRefusal?: boolean;
    data: {
        projects?: Project[];
        sections?: Section[];
        tasks?: Task[];
        areas?: Area[];
    };
    /** Only the rows that changed, each in full. */
    expected: {
        projects?: Record<string, unknown>[];
        sections?: Record<string, unknown>[];
        tasks?: Record<string, unknown>[];
    };
};

const allCases = JSON.parse(
    readFileSync(new URL('./recurrence-local-api-parity.fixtures.json', import.meta.url), 'utf8')
) as Array<{ kind?: string } & Record<string, unknown>>;

const projectActionCases = allCases.filter(
    (testCase): testCase is ProjectActionParityCase => testCase.kind === 'project-action'
);

// Consolidation-law pin (COMMON-20260730.md), same as the action-kind roster:
// a test that just iterates the cases cannot notice the fixture shrinking.
const PINNED_PROJECT_ACTION_CASE_NAMES = [
    'delete: detaches live tasks, soft-deletes live sections, leaves deleted rows alone',
    'restore: revives the same cascade and leaves other deletions alone',
    'restore: task drops a sectionId whose section did not come back',
    'restore: a deleted area drops areaId and areaTitle',
    'restore: a live area fills an empty areaTitle from the area name',
    'delete: an already-deleted project changes no rows',
    'restore: a live project changes no rows',
    'restore: a purged task stays out of the cascade',
    'restore: a purged project is refused',
].sort();

// JSON round-trip so `deletedAt: undefined` (how the store clears a field)
// compares equal to the Rust engine's key removal.
const toPlainRow = (row: unknown): Record<string, unknown> =>
    JSON.parse(JSON.stringify(row)) as Record<string, unknown>;

const changedRows = (before: readonly unknown[], after: readonly unknown[]): Record<string, unknown>[] => {
    const beforeById = new Map(
        before.map((row) => {
            const plain = toPlainRow(row);
            return [String(plain.id), JSON.stringify(plain)] as const;
        })
    );
    return after
        .map(toPlainRow)
        .filter((row) => beforeById.get(String(row.id)) !== JSON.stringify(row));
};

describe('local API project write-action parity fixture (kind: project-action)', () => {
    let mockStorage: StorageAdapter;

    beforeEach(() => {
        mockStorage = {
            getData: vi.fn().mockResolvedValue({ tasks: [], projects: [], sections: [], areas: [], settings: {} }),
            saveData: vi.fn().mockResolvedValue(undefined),
        };
        setStorageAdapter(mockStorage);
        vi.useFakeTimers();
    });

    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('covers exactly the pinned project-action case roster', () => {
        expect(projectActionCases.map((testCase) => testCase.name).sort())
            .toEqual(PINNED_PROJECT_ACTION_CASE_NAMES);
    });

    it.each(projectActionCases.map((testCase) => [testCase.name, testCase] as const))(
        '%s',
        async (_name, testCase) => {
            const seed = {
                projects: testCase.data.projects ?? [],
                sections: testCase.data.sections ?? [],
                tasks: testCase.data.tasks ?? [],
                areas: testCase.data.areas ?? [],
            };
            // Seeded straight into the store's canonical arrays: the fixture
            // rows are what both engines read, so a load-time normalization
            // pass would only add fields the Rust side never sees.
            useTaskStore.setState({
                tasks: [],
                projects: [],
                sections: [],
                areas: [],
                settings: { deviceId: testCase.deviceId },
                isLoading: false,
                error: null,
                persistenceFailure: null,
                _allTasks: seed.tasks,
                _allProjects: seed.projects,
                _allSections: seed.sections,
                _allAreas: seed.areas,
                _tasksById: new Map(seed.tasks.map((task) => [task.id, task])),
                _projectsById: new Map(seed.projects.map((project) => [project.id, project])),
                _sectionsById: new Map(seed.sections.map((section) => [section.id, section])),
                _areasById: new Map(seed.areas.map((area) => [area.id, area])),
                lastDataChangeAt: 0,
            });
            vi.setSystemTime(new Date(testCase.now));

            const { deleteProject, restoreProject } = useTaskStore.getState();
            const result = testCase.action === 'delete'
                ? await deleteProject(testCase.projectId)
                : await restoreProject(testCase.projectId);

            if (testCase.expectRefusal) {
                expect(result).toEqual({ success: false, error: 'Project not found' });
            }

            const after = useTaskStore.getState();
            expect(changedRows(seed.projects, after._allProjects))
                .toEqual(testCase.expected.projects ?? []);
            expect(changedRows(seed.sections, after._allSections))
                .toEqual(testCase.expected.sections ?? []);
            expect(changedRows(seed.tasks, after._allTasks))
                .toEqual(testCase.expected.tasks ?? []);
        }
    );
});
