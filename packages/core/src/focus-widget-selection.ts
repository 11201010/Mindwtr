/**
 * The one home for the "Today" list the widget payload builders render:
 * `apps/mobile/lib/widget-data.ts` (Android widget, iOS widget, and the
 * Shortcuts snapshot's "focus" list, #980) and
 * `apps/desktop/src/lib/macos-widget-data.ts` (the macOS WidgetKit widget,
 * #1054). Both used to carry their own copy of this selection, and the copies
 * picked a sequential project's one slot with the order-only
 * `getSequentialFirstTaskIds` while the Focus screens picked it with the
 * schedule-ranked `getFocusSequentialFirstTaskIds` -- so a project whose
 * step 3 was due today showed step 3 in Focus and step 1 on the widget.
 *
 * Focus order is ONE contract across surfaces (#1090): this module applies the
 * Focus screens' rule, and the builders keep only their payload shaping (which
 * needs `react-native-android-widget` / AsyncStorage on mobile and neither on
 * desktop, hence no shared builder).
 *
 * `now` is a parameter, never `Date.now()`, so the selection is deterministic
 * in tests and one payload build sees one instant.
 */
import { safeParseDate, safeParseDueDate } from './date';
import { deriveFocusTaskLists, type FocusPools } from './focus-sections';
import { TASK_LIST_SORT_OPTIONS } from './task-list-sort-options';
import { shouldShowTaskForStart, sortTasksBy } from './task-utils';
import type { Project, Section, Task, TaskSortBy } from './types';


export interface TodayFocusSelectionInput {
    /**
     * The caller's already-narrowed pool: undeleted, actionable, in an active
     * project. This is the widget's equivalent of the Focus screens'
     * `baseActiveTasks` -- deliberately NOT start-time filtered, because
     * `getFocusSequentialFirstTaskIds` must see a step that is deferred to a
     * future date to know it still holds its project's slot.
     */
    activeTasks: Task[];
    projects: Project[];
    sections: Section[];
    sortBy: TaskSortBy;
    now: Date;
}

export interface TodayFocusSelection {
    /** Starred tasks, sorted; they lead the widget list. */
    starredTasks: Task[];
    /** Everything else that belongs in today's list, sorted; starred excluded. */
    focusTasks: Task[];
}

/**
 * Starred tasks first, then next actions due or starting today, then the rest
 * of today's actionable next actions -- with a sequential project contributing
 * at most the one step the Focus screen would show for it.
 *
 * The buckets come from the shared Focus derivation (`focus-sections.ts`); this
 * function only shapes the widget's pools and flattens the result into the two
 * lists the payload builders render. Three widget-only rules survive here
 * because the widget shows ONE list where the screens show five sections:
 *
 * 1. The Today pool is not narrowed to today's starts. The widget has no
 *    Upcoming section, so a task that is due today but deferred to a later day
 *    would simply vanish; on the screens it moves to Upcoming instead.
 * 2. A starred task planned for a future day is left out unless it is also due
 *    or starting today. The screens keep every starred task because Today's
 *    Focus is its own labelled section; a bare "Today" list must not lead with
 *    a task that starts next week.
 * 3. Review Due rejoins the one list, next actions only. The screens split a
 *    next action that is also due for review into its own section; here that
 *    would drop it from the widget altogether. Waiting and someday tasks stay
 *    out of the list, as they always have.
 */
export function computeTodayFocusTasks({
    activeTasks,
    projects,
    sections,
    sortBy,
    now,
}: TodayFocusSelectionInput): TodayFocusSelection {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const isPlannedForFuture = (task: Task) => {
        const start = safeParseDate(task.startTime);
        return Boolean(start && start > endOfToday);
    };
    const isScheduleCandidate = (task: Task) => {
        const due = safeParseDueDate(task.dueDate);
        const start = safeParseDate(task.startTime);
        const startsToday = Boolean(start && start >= startOfToday && start <= endOfToday);
        return Boolean(due && due <= endOfToday) || startsToday;
    };

    const pools: FocusPools = {
        focused: activeTasks.filter((task) => (
            task.isFocusedToday === true
            && (!isPlannedForFuture(task) || isScheduleCandidate(task))
        )),
        active: activeTasks.filter((task) => shouldShowTaskForStart(task, { now, granularity: 'time' })),
        schedule: activeTasks,
        upcoming: [],
        base: activeTasks,
    };
    const lists = deriveFocusTaskLists(pools, {
        now,
        projects,
        sections,
        // The widget applies its own flat sort below, so the sections' internal
        // order never reaches the payload; only their membership does.
        sortBy: 'default',
        prioritiesEnabled: false,
    });

    // Membership comes from the shared buckets; the ORDER is the payload's own
    // flat sort over the caller's pool order. Reading the buckets' own order
    // would leak the screens' section sort into every tie the widget's sort
    // leaves open.
    const scheduled = new Set(lists.schedule.map((task) => task.id));
    const listed = new Set(
        [...lists.reviewDue, ...lists.nextActions]
            .filter((task) => task.status === 'next')
            .map((task) => task.id),
    );
    return {
        starredTasks: sortTasksBy(pools.focused, sortBy),
        focusTasks: sortTasksBy([
            ...activeTasks.filter((task) => scheduled.has(task.id)),
            ...activeTasks.filter((task) => listed.has(task.id) && !scheduled.has(task.id)),
        ], sortBy),
    };
}

/**
 * The widget payload builders' sort resolver: a stored widget sort that is not
 * on the task-list roster falls back to the default. One home so a new sort key
 * cannot reach one widget and miss the other. The caller still applies
 * `resolveTaskSortByForFeatures` — widgets follow the feature toggles (#1107).
 */
export function resolveWidgetTaskSort(stored: unknown): TaskSortBy {
    return TASK_LIST_SORT_OPTIONS.includes(stored as TaskSortBy) ? stored as TaskSortBy : 'default';
}
