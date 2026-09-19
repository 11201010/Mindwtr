import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { applyTaskUpdates, normalizeTaskUpdate } from './store-helpers';
import { nextRevision } from './sync-revision';
import { sanitizeRestoredTaskContainerReferences } from './store-tasks';
import type { Area, Project, Section, Task, TaskStatus } from './types';
import type { TaskStore } from './store-types';

// This fixture is shared with apps/desktop/src-tauri/src/local_api.rs's
// `apply_task_action` test, which is the actual regression coverage for the
// four write-path divergences (#rust-write-parity): a recurring follow-up
// task written without rev/revBy, archived->done re-completing and spawning a
// duplicate occurrence, focusOrder never cleared, and restore skipping
// container sanitization. This TS side exists so the fixture's expectations
// stay tied to CORE's real behavior instead of being a hand-authored guess
// that could silently drift once core changes.
type ActionParityCase = {
    kind: 'action';
    name: string;
    action: 'complete' | 'archive' | 'restore';
    previousStatus: TaskStatus;
    now: string;
    deviceId: string;
    task: Task;
    containers?: {
        projects?: Array<Pick<Project, 'id' | 'deletedAt' | 'purgedAt'>>;
        sections?: Array<Pick<Section, 'id' | 'projectId' | 'deletedAt'>>;
        areas?: Array<Pick<Area, 'id' | 'deletedAt'>>;
    };
    expectedTask?: Record<string, unknown>;
    expectedFollowUp?: Record<string, unknown> | null;
    expectRefusal?: boolean;
};

const allCases = JSON.parse(
    readFileSync(new URL('./recurrence-local-api-parity.fixtures.json', import.meta.url), 'utf8')
) as Array<{ kind?: string } & Record<string, unknown>>;

const actionCases = allCases.filter((testCase): testCase is ActionParityCase => testCase.kind === 'action');

// Consolidation-law pin (COMMON-20260730.md): a test that just iterates
// actionCases can't catch the fixture shrinking - deleting a case would
// silently narrow the loop right along with the bug it stopped covering. This
// roster is the independent, hand-written list; removing a case from the JSON
// without removing it here fails the roster test below.
const PINNED_ACTION_CASE_NAMES = [
    'complete a non-recurring task',
    'complete a recurring task creates a follow-up with rev/revBy stamped',
    'completing an archived task is a correction, not a new completion',
    'archive a task',
    'restore drops a dangling projectId and sectionId but keeps a live areaId',
    'complete refuses recurrence the local API engine cannot compute (409)',
    'completing an already-done task is a full no-op',
    "complete refuses recurrence with a relativeStartOffset the local API can't recompute (409)",
    'restore: section adopts its project and clears area',
    'restore: section dropped when it belongs to another project',
    'restore: area dropped when project set',
].sort();

const isNoOpStatusResend = (testCase: ActionParityCase): boolean => (
    (testCase.action === 'complete' && testCase.previousStatus === 'done')
    || (testCase.action === 'archive' && testCase.previousStatus === 'archived')
);

describe('local API write-action parity fixture (kind: action)', () => {
    it('covers exactly the pinned action-kind case roster', () => {
        expect(actionCases.map((testCase) => testCase.name).sort()).toEqual(PINNED_ACTION_CASE_NAMES);
    });

    it.each(actionCases.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
        if (testCase.expectRefusal) {
            // The 409 refusal is local-API-engine-only: core's real recurrence
            // engine computes byDay/rrule/relativeStartOffset occurrences
            // correctly and never refuses, so there is nothing for core to
            // assert here - the Rust test (local_api.rs) owns this case end
            // to end.
            return;
        }

        if (isNoOpStatusResend(testCase)) {
            // Mirrors applyTaskUpdates's statusChanged gate (store-helpers.ts):
            // completing an already-done task (or archiving an already-archived
            // one) changes nothing, so the input task IS the expectation - no
            // core function call needed to derive "nothing happened".
            expect(testCase.task).toEqual(testCase.expectedTask);
            expect(testCase.expectedFollowUp ?? null).toBeNull();
            return;
        }

        let updatedTask: Task;
        let nextRecurringTask: Task | null = null;

        if (testCase.action === 'restore') {
            const containers = testCase.containers ?? {};
            const state = {
                _allProjects: containers.projects ?? [],
                _allSections: containers.sections ?? [],
                _allAreas: containers.areas ?? [],
            } as unknown as TaskStore;
            const sanitized = sanitizeRestoredTaskContainerReferences(testCase.task, state);
            updatedTask = {
                ...testCase.task,
                deletedAt: undefined,
                ...sanitized,
                updatedAt: testCase.now,
                rev: nextRevision(testCase.task.rev),
                revBy: testCase.deviceId,
            };
        } else {
            // Matches the store's real composition order for updateTask
            // (store-tasks.ts's prepareTaskUpdatesForStore, minus
            // buildTaskContainerMovePatch - irrelevant here since complete/
            // archive never touch projectId/sectionId/areaId): normalizeTaskUpdate
            // first (this is where boardOrder gets cleared on a status
            // change), merged with the revision stamp, THEN applyTaskUpdates.
            const status: TaskStatus = testCase.action === 'complete' ? 'done' : 'archived';
            const normalized = normalizeTaskUpdate(testCase.task, { status });
            const result = applyTaskUpdates(
                testCase.task,
                { ...normalized, rev: nextRevision(testCase.task.rev), revBy: testCase.deviceId },
                testCase.now
            );
            updatedTask = result.updatedTask;
            nextRecurringTask = result.nextRecurringTask
                ? { ...result.nextRecurringTask, rev: nextRevision(undefined), revBy: testCase.deviceId }
                : null;
        }

        expect(updatedTask).toEqual(testCase.expectedTask);

        if (nextRecurringTask) {
            // `id` is a fresh random uuid, the one legitimately platform/run-variant
            // field (mirrors the exclusion in local_api.rs's own comparator).
            const { id: _followUpId, ...followUpRest } = nextRecurringTask;
            expect(followUpRest).toEqual(testCase.expectedFollowUp);
        } else {
            expect(testCase.expectedFollowUp ?? null).toBeNull();
        }
    });
});
