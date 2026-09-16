/**
 * The Focus derivation now lives in `@mindwtr/core` (`focus-sections.ts`). This
 * file is a temporary adapter for `lib/widget-data.ts`, which still calls the
 * old flat-argument shape. Delete it — and fold that call into `buildFocusPools`
 * / `deriveFocusTaskLists` — once that file can be edited again.
 */
import {
    deriveFocusTaskLists as deriveFocusTaskListsFromPools,
    type FocusTaskLists,
    type Project,
    type Section,
    type SortField,
    type Task,
} from '@mindwtr/core';

export {
    buildFocusTaskSections,
    DEFAULT_FOCUS_SORT_BY,
    type FocusTaskLists,
    type FocusTaskSection,
    type FocusTaskSectionKey,
} from '@mindwtr/core';

export interface DeriveFocusTaskListsInput {
    now: Date;
    focusedPool: Task[];
    filteredActiveTasks: Task[];
    scheduleCandidates: Task[];
    upcomingCandidates: Task[];
    baseActiveTasks: Task[];
    projects: Project[];
    sections: Section[];
    /** Ignored: the core module derives both sets from `projects`. */
    sequentialProjectIds?: Set<string>;
    sequentialWithinSectionProjectIds?: Set<string>;
    sortBy: SortField;
    prioritiesEnabled: boolean;
    sortBySavedPerspective: (items: Task[]) => Task[];
}

export function deriveFocusTaskLists(input: DeriveFocusTaskListsInput): FocusTaskLists {
    return deriveFocusTaskListsFromPools({
        focused: input.focusedPool,
        active: input.filteredActiveTasks,
        schedule: input.scheduleCandidates,
        // The caller resolved the reveal dates already and kept only the tasks;
        // the derivation reads nothing but the task off each entry.
        upcoming: input.upcomingCandidates.map((task) => ({ task, appearsAt: input.now })),
        base: input.baseActiveTasks,
    }, {
        now: input.now,
        projects: input.projects,
        sections: input.sections,
        sortBy: input.sortBy,
        prioritiesEnabled: input.prioritiesEnabled,
        sortBySavedPerspective: input.sortBySavedPerspective,
    });
}
