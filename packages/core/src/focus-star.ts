import type { Project, Section, Task } from './types';
import {
    FOCUS_ELIGIBILITY_ACTIVE_STATUSES,
    getTaskFocusEligibility,
} from './task-utils';
import { formatFocusTaskLimitText } from './focus-utils';
import { tFallback } from './i18n';

/**
 * The Today's Focus star as one module: every surface that toggles a task's
 * star (row star, quick-action menu, editor, review modals, mobile swipe)
 * resolves the same action here, so eligibility, the cap, labels, and the
 * update patch cannot drift per surface. Status promotion on starring is NOT
 * part of the patch — the store's star↔status rules own it at the write path.
 */
export type FocusStarBlockedReason = 'deferred' | 'sequential' | 'clarify' | 'limit' | null;

export type FocusStarContext = {
    tasks: Task[];
    projects: readonly Project[] | Map<string, Project>;
    sections: readonly Section[];
    focusedCount: number;
    focusTaskLimit: number;
    sequentialProjectIds?: Set<string>;
    sectionScopedProjectIds?: Set<string>;
    now?: Date;
    /** The task editor is a clarifying surface: it may star unclarified tasks. */
    allowUnclarified?: boolean;
};

export type FocusStarAction = {
    isFocused: boolean;
    /** False only when adding is blocked; removing a star is always allowed. */
    canToggle: boolean;
    blockedReason: FocusStarBlockedReason;
    /** i18n key for the control label. */
    labelKey: 'agenda.addToFocus' | 'agenda.removeFromFocus';
    /** Patch to apply when toggling; store rules handle status promotion. */
    patch: Pick<Task, 'isFocusedToday'>;
};

export type TaskFocusCreationOutcome =
    | 'not-requested'
    | 'focused'
    | 'refused-ineligible'
    | 'refused-limit';

export type TaskFocusCreationDecision = {
    status: Task['status'];
    isFocusedToday: boolean;
    outcome: TaskFocusCreationOutcome;
};

export function resolveFocusStarAction(task: Task, context: FocusStarContext): FocusStarAction {
    const isFocused = task.isFocusedToday === true;
    if (isFocused) {
        return {
            isFocused,
            canToggle: true,
            blockedReason: null,
            labelKey: 'agenda.removeFromFocus',
            patch: { isFocusedToday: false },
        };
    }

    const eligibility = getTaskFocusEligibility(task, {
        tasks: context.tasks,
        projects: context.projects,
        now: context.now,
        sequentialProjectIds: context.sequentialProjectIds,
        sectionScopedProjectIds: context.sectionScopedProjectIds,
        sections: context.sections,
    });
    const eligible = eligibility.eligible
        || (context.allowUnclarified === true && eligibility.reason === 'clarify');

    const blockedReason: FocusStarBlockedReason = !eligible
        ? (eligibility.reason === 'eligible' ? 'clarify' : eligibility.reason)
        : context.focusedCount >= context.focusTaskLimit
            ? 'limit'
            : null;

    return {
        isFocused,
        canToggle: blockedReason === null,
        blockedReason,
        labelKey: 'agenda.addToFocus',
        patch: { isFocusedToday: true },
    };
}

/**
 * Resolve a task's initial Focus state before it is persisted. A starred Inbox
 * capture is evaluated as Next, but that promotion is committed only when the
 * star is accepted. This keeps a refused capture at its requested status.
 */
export function resolveTaskFocusCreation(
    task: Task,
    context: Pick<FocusStarContext, 'tasks' | 'projects' | 'sections' | 'focusedCount' | 'focusTaskLimit'>,
): TaskFocusCreationDecision {
    if (task.isFocusedToday !== true) {
        return {
            status: task.status,
            isFocusedToday: false,
            outcome: 'not-requested',
        };
    }

    const promotedStatus: Task['status'] = task.status === 'inbox' ? 'next' : task.status;
    const candidate: Task = {
        ...task,
        status: promotedStatus,
        isFocusedToday: false,
    };
    const eligibility = getTaskFocusEligibility(candidate, {
        tasks: [...context.tasks, candidate],
        projects: context.projects,
        sections: context.sections,
    });

    if (!eligibility.eligible) {
        return {
            status: task.status,
            isFocusedToday: false,
            outcome: 'refused-ineligible',
        };
    }
    if (context.focusedCount >= context.focusTaskLimit) {
        return {
            status: task.status,
            isFocusedToday: false,
            outcome: 'refused-limit',
        };
    }

    return {
        status: promotedStatus,
        isFocusedToday: true,
        outcome: 'focused',
    };
}

/** Quick-add capture star: no task exists yet, only the cap applies. */
export function canStarNewCapture(context: Pick<FocusStarContext, 'focusedCount' | 'focusTaskLimit'>): boolean {
    return context.focusedCount < context.focusTaskLimit;
}

/**
 * Human text for a blocked star (tooltip or toast), or null when not blocked.
 * Keys live in the core locales, so both platforms resolve them with their t.
 */
export function getFocusStarBlockedText(
    t: (key: string) => string,
    action: Pick<FocusStarAction, 'blockedReason'>,
    focusTaskLimit: number,
): string | null {
    switch (action.blockedReason) {
        case 'limit':
            return formatFocusTaskLimitText(
                tFallback(t, 'agenda.maxFocusItems', 'Max {{count}} focus items.'),
                focusTaskLimit,
            );
        case 'deferred':
            return tFallback(t, 'agenda.focusUnavailableDeferred', 'This task is deferred; change its start date before focusing it.');
        case 'sequential':
            return tFallback(t, 'agenda.focusUnavailableSequential', 'Complete the earlier sequential action before focusing this task.');
        case 'clarify':
            return tFallback(t, 'agenda.focusUnavailableClarifyFirst', 'Clarify this task before adding it to Focus.');
        default:
            return null;
    }
}

/** The active-status pool eligibility is judged against. */
export function collectFocusEligibilityTasks(activeTasksByStatus: Map<Task['status'], Task[]>): Task[] {
    return FOCUS_ELIGIBILITY_ACTIVE_STATUSES.flatMap((status) => activeTasksByStatus.get(status) ?? []);
}
