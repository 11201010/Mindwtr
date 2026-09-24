/**
 * The native host contract for the Menu tab's More sheet and the Waiting,
 * Someday, Reference and Done screens. Kept in its own file and spread into
 * createNativeHostContract: other changes edit native-host-contract.ts in
 * parallel. Every view is the React Native screen's, from the same core models
 * (menu-views-model.ts, someday-sections-model.ts, more-menu-model.ts).
 *
 * Only functions read this module's imports from native-host-contract.ts, so
 * the import cycle between the two files is safe.
 */
import { isTaskVisibleInArea, resolveAreaFilterSelection } from './area-filter';
import type { DateFormatter } from './date';
import { formatTimeEstimateLabel, isCustomTimeEstimate, TIME_ESTIMATE_OPTIONS } from './calendar-scheduling';
import {
    applyListFilterEdit,
    EMPTY_LIST_FILTER_STATE,
    resolveListFilterState,
    type ListFilterEdit,
    type ListFilterState,
    type ResolvedListFilter,
} from './list-filter-state';
import {
    buildSomedayFilterOptions,
    buildSomedayViewModel,
    buildStatusListFilterOptions,
    buildStatusListFilterSummary,
    buildStatusListModel,
    buildWaitingViewModel,
    DONE_LIST_DEFAULT_GROUP_BY,
    DONE_LIST_GROUP_OPTIONS,
    getSomedayGroupSectionId,
    getStatusListScreenText,
    isStatusListTaskReadOnly,
    REFERENCE_LIST_DEFAULT_GROUP_BY,
    selectSomedayTasks,
    selectStatusListTasks,
    SOMEDAY_GROUP_OPTIONS,
    TASK_LIST_GROUP_OPTIONS,
    type DeferredProjectsSection,
    type ListFilterOptions,
    type SomedayGroupBy,
    type StatusListKind,
} from './menu-views-model';
import { buildMoreMenuModel, type MoreMenuModel } from './more-menu-model';
import {
    NATIVE_HOST_CONTRACT_VERSION,
    NATIVE_HOST_MAX_WINDOW,
    sortAreasForDisplay,
    type NativeHostResult,
    type NativeTaskRow,
} from './native-host-contract';
import {
    buildSomedaySectionManagerRows,
    buildSomedaySectionMoveDialog,
    buildSomedaySectionsSettingsUpdate,
    formatSomedaySectionMoved,
    getSomedaySectionManagerText,
    getSomedaySectionMoveTasks,
    getSomedaySectionMoveText,
    getSomedaySectionTaskText,
    moveSomedaySection,
    planSomedaySectionCreate,
    planSomedaySectionMove,
    planSomedaySectionTaskAdd,
    removeSomedaySection,
    renameSomedaySection,
    type SomedaySectionAssignment,
} from './someday-sections-model';
import { useTaskStore } from './store';
import { TASK_EDITOR_ENERGY_LEVEL_OPTIONS, TASK_EDITOR_PRIORITY_OPTIONS } from './task-editor-model';
import type { TaskGroupBy } from './task-group-sections';
import { DONE_TASK_LIST_SORT_OPTIONS, TASK_LIST_SORT_OPTIONS } from './task-list-sort-options';
import type { Task, TaskEnergyLevel, TaskPriority, TaskSortBy, TimeEstimate, ViewSectionDefinition } from './types';
import { buildTaskViewSectionUndoUpdates, sortViewSectionDefinitions } from './view-sections';

type NativeHostErrorCode = Extract<NativeHostResult<never>, { ok: false }>['error']['code'];

export type MenuViewDeps = {
    readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>;
    /** Data plus display revision: tasks, projects, settings, language and the minute. */
    revision: (now: Date) => string;
    t: () => (key: string) => string;
    /** The user's date formatting (createDateFormatter); the only formatter this block uses. */
    formatDate: () => DateFormatter;
    /** Rows with core meta, as the other contract lists build them. */
    rows: (tasks: readonly Task[], now: Date) => NativeTaskRow[];
    requestIdPattern: RegExp;
};

/** A user-visible refusal, shown the way mobile shows it (a toast or the dialog's error line). */
export type NativeMenuViewRefusal = { refused: { title: string | null; message: string } };

export type NativeSomedayMoveResult =
    | { moved: number; toast: { message: string; undoLabel: string } | null; undo: { previous: SomedaySectionAssignment[]; sectionId: string | null } | null }
    | NativeMenuViewRefusal;

export type NativeMoreMenu = MoreMenuModel & {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    revision: string;
};

/** The filter picker: options carry the exact edit to send back as `filterEdit`. */
export type NativeListFilterView = {
    /** The effective state; send it back as `filters` with the next read. */
    state: ListFilterState;
    activeCount: number;
    hasActive: boolean;
    clearEdit: ListFilterEdit;
    visibility: ListFilterOptions['visibility'];
    showContextMatchMode: boolean;
    showTagMatchMode: boolean;
    tokens: { value: string; state: 'included' | 'excluded' | 'none'; edit: ListFilterEdit }[];
    projects: { id: string; title: string; selected: boolean; edit: ListFilterEdit }[] | null;
    priorities: { value: TaskPriority; label: string; selected: boolean; edit: ListFilterEdit }[];
    energyLevels: { value: TaskEnergyLevel; label: string; selected: boolean; edit: ListFilterEdit }[];
    timeEstimates: { value: TimeEstimate; label: string; selected: boolean; edit: ListFilterEdit }[];
};

export type NativeListChip = {
    id: string;
    label: string;
    excluded: boolean;
    /** What removing the chip sends: a filter edit, or Reference's archived-projects toggle turned off. */
    action: { filterEdit: ListFilterEdit } | { includeArchivedProjects: false };
};

type Paged<T> = {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    /** Changes with the data, settings, language, minute and the view's own inputs. */
    revision: string;
    total: number;
} & T;

export type NativeWaitingView = Paged<{
    rows: NativeTaskRow[];
    /** The person in effect: '' when the one asked for is no longer offered. */
    person: string;
    /** "All" first, then each person; send `person` back to choose it. */
    people: { label: string; person: string; selected: boolean }[];
    filterLabel: string;
    /** Shown while a person is chosen; sending person '' clears it. */
    clearLabel: string | null;
    stats: { value: number; label: string }[];
    deferred: DeferredProjectsSection | null;
    empty: { title: string; hint: string } | null;
    /** Waiting rows show their detail parts. */
    showDetails: true;
}>;

export type NativeSomedayItem =
    | {
        type: 'heading';
        id: string;
        title: string;
        muted: boolean;
        /** Section grouping only: the section a new task goes to (null = No section). */
        addTask: { sectionId: string | null; label: string; accessibilityLabel: string } | null;
    }
    | { type: 'task'; row: NativeTaskRow; groupId: string | null };

export type NativeSomedayView = Paged<{
    items: NativeSomedayItem[];
    sortBy: TaskSortBy;
    groupBy: SomedayGroupBy;
    showDetails: boolean;
    stats: { value: number; label: string }[];
    /** The summary chip beside the stats while filters are on; its edit clears them. */
    filterChip: { label: string; removeLabel: string } | null;
    menu: {
        filters: { label: string; selected: boolean };
        sort: { label: string; accessibilityLabel: string; value: string; options: { value: TaskSortBy; label: string; accessibilityLabel: string; selected: boolean }[] };
        group: { label: string; accessibilityLabel: string; value: string; options: { value: SomedayGroupBy; label: string; accessibilityLabel: string; selected: boolean }[] };
        details: { label: string; selected: boolean };
        newSection: { label: string };
        backLabel: string;
        closeLabel: string;
        moreLabel: string;
    };
    filters: NativeListFilterView;
    chips: NativeListChip[];
    sections: ViewSectionDefinition[];
    deferred: DeferredProjectsSection | null;
    empty: { title: string; hint: string } | null;
    text: {
        moveToSection: string;
        undoLabel: string;
        errorTitle: string;
        moveFailed: string;
        undoFailed: string;
        /** The Add task dialog; its title is the heading's `addTask.accessibilityLabel`. */
        addTask: Omit<ReturnType<typeof getSomedaySectionTaskText>, 'title'>;
    };
}>;

export type NativeStatusListItem =
    | { type: 'section'; id: string; title: string; count: number; muted: boolean; collapsible: boolean; collapsed: boolean }
    | { type: 'task'; row: NativeTaskRow & { readOnly: boolean }; groupId: string | null };

export type NativeStatusListView = Paged<{
    kind: StatusListKind;
    title: string;
    items: NativeStatusListItem[];
    /** Tasks shown (the header count). */
    count: number;
    groupBy: TaskGroupBy;
    sortBy: TaskSortBy;
    includeArchivedProjects: boolean;
    collapsedGroupIds: string[];
    sort: { title: string; label: string; options: { value: TaskSortBy; label: string; selected: boolean }[] };
    group: { title: string; label: string; options: { value: TaskGroupBy; label: string; selected: boolean }[] };
    filters: NativeListFilterView;
    /** The header's active filters, Reference's archived-projects toggle included. */
    chips: NativeListChip[];
    filterActiveCount: number;
    hasActiveFilters: boolean;
    /** Reference only: the filter sheet's top switch. */
    archivedProjectsToggle: { label: string; value: boolean } | null;
    /** Shown when there are no items; `clear` is set when filters hide everything. */
    empty: { message: string; hint: string; actionLabel: string | null; clear: boolean };
}>;

const fail = (code: NativeHostErrorCode, message: string): NativeHostResult<never> => ({ ok: false, error: { code, message } });
const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);
// ponytail: id lists (a selection, an Undo) stop at 1000; raise with the selection UI if people select more.
const MAX_IDS = 1000;
const isText = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length <= max;
const isTextList = (value: unknown, max = MAX_IDS): value is string[] => (
    Array.isArray(value) && value.length <= max && value.every((entry) => isText(entry))
);
const MATCH_MODES = new Set(['all', 'any']);
const isTimeEstimate = (value: unknown): value is TimeEstimate => (
    typeof value === 'string' && (TIME_ESTIMATE_OPTIONS.includes(value as TimeEstimate) || isCustomTimeEstimate(value as TimeEstimate))
);
const FILTER_STATE_CHECKS: Record<keyof ListFilterState, (value: unknown) => boolean> = {
    searchQuery: (value) => isText(value, 2000),
    tokens: (value) => isTextList(value),
    excludedTokens: (value) => isTextList(value),
    projects: (value) => isTextList(value),
    priorities: (value) => Array.isArray(value) && value.every((entry) => TASK_EDITOR_PRIORITY_OPTIONS.includes(entry as TaskPriority)),
    energyLevels: (value) => Array.isArray(value) && value.every((entry) => TASK_EDITOR_ENERGY_LEVEL_OPTIONS.includes(entry as TaskEnergyLevel)),
    timeEstimates: (value) => Array.isArray(value) && value.length <= 50 && value.every(isTimeEstimate),
    location: (value) => isText(value, 500),
    contextMatchMode: (value) => MATCH_MODES.has(value as string),
    tagMatchMode: (value) => MATCH_MODES.has(value as string),
};

/** A partial state is completed from the empty one; unknown keys are refused. */
const readFilterState = (value: unknown): ListFilterState | null => {
    if (value === undefined) return EMPTY_LIST_FILTER_STATE;
    if (!isObjectRecord(value)) return null;
    for (const [key, entry] of Object.entries(value)) {
        const check = FILTER_STATE_CHECKS[key as keyof ListFilterState];
        if (!check || !check(entry)) return null;
    }
    return { ...EMPTY_LIST_FILTER_STATE, ...(value as Partial<ListFilterState>) };
};

const isFilterEdit = (edit: unknown): edit is ListFilterEdit => {
    if (!isObjectRecord(edit)) return false;
    switch (edit.type) {
        case 'toggleToken':
        case 'toggleProject':
            return isText(edit.value) && (edit.value as string).length > 0;
        case 'togglePriority':
            return TASK_EDITOR_PRIORITY_OPTIONS.includes(edit.value as TaskPriority);
        case 'toggleEnergyLevel':
            return TASK_EDITOR_ENERGY_LEVEL_OPTIONS.includes(edit.value as TaskEnergyLevel);
        case 'toggleTimeEstimate':
            return isTimeEstimate(edit.value);
        case 'setSearch':
            return isText(edit.value, 2000);
        case 'setLocation':
            return isText(edit.value, 500);
        case 'setMatchMode':
            return (edit.kind === 'context' || edit.kind === 'tag') && MATCH_MODES.has(edit.value as string);
        case 'clear':
            return true;
        default:
            return false;
    }
};

const isPaging = (input: Record<string, unknown>) => (
    Number.isSafeInteger(input.offset) && (input.offset as number) >= 0
    && Number.isSafeInteger(input.limit) && (input.limit as number) >= 1 && (input.limit as number) <= NATIVE_HOST_MAX_WINDOW
    && (input.revision === undefined || typeof input.revision === 'string')
    && ((input.offset as number) === 0 || typeof input.revision === 'string')
);

/** A short, stable key for a view's own inputs, so a page of one filter never continues another. */
const paramsKey = (params: unknown): string => {
    const text = JSON.stringify(params);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36);
};

const nativeFilterView = (resolved: ResolvedListFilter, options: ListFilterOptions, t: (key: string) => string): NativeListFilterView => {
    const { state } = resolved;
    return {
        state,
        activeCount: resolved.activeCount,
        hasActive: resolved.hasActive,
        clearEdit: { type: 'clear' },
        visibility: options.visibility,
        showContextMatchMode: resolved.showContextMatchMode,
        showTagMatchMode: resolved.showTagMatchMode,
        tokens: options.tokens.map((value) => ({
            value,
            state: state.tokens.includes(value) ? 'included' : state.excludedTokens.includes(value) ? 'excluded' : 'none',
            edit: { type: 'toggleToken', value },
        })),
        projects: options.projects?.map((project) => ({
            ...project,
            selected: state.projects.includes(project.id),
            edit: { type: 'toggleProject', value: project.id },
        })) ?? null,
        priorities: TASK_EDITOR_PRIORITY_OPTIONS.map((value) => ({
            value, label: t(`priority.${value}`), selected: state.priorities.includes(value), edit: { type: 'togglePriority', value },
        })),
        energyLevels: TASK_EDITOR_ENERGY_LEVEL_OPTIONS.map((value) => ({
            value, label: t(`energyLevel.${value}`), selected: state.energyLevels.includes(value), edit: { type: 'toggleEnergyLevel', value },
        })),
        timeEstimates: options.timeEstimates.map((value) => ({
            value, label: formatTimeEstimateLabel(value), selected: state.timeEstimates.includes(value), edit: { type: 'toggleTimeEstimate', value },
        })),
    };
};

const filterChips = (resolved: ResolvedListFilter): NativeListChip[] => resolved.chips.map((chip) => ({
    id: chip.id, label: chip.label, excluded: chip.excluded, action: { filterEdit: chip.edit },
}));

type Receipt<T> = { key: string; value: T; saved: boolean };

export function createMenuViewMethods(deps: MenuViewDeps) {
    // ponytail: keeps the 50 most recent requests; an older retry writes again, which the target-state checks absorb.
    const receipts = new Map<string, Receipt<unknown>>();
    const remember = <T,>(requestId: string, receipt: Receipt<T>) => {
        receipts.set(requestId, receipt as Receipt<unknown>);
        if (receipts.size > 50) receipts.delete(receipts.keys().next().value!);
    };
    const markAllSaved = () => {
        for (const receipt of receipts.values()) receipt.saved = true;
    };
    const writeFailure = (message: string | undefined): NativeHostResult<never> => {
        const failure = useTaskStore.getState().persistenceFailure;
        return fail(failure ? 'SAVE_FAILED' : 'ACTION_FAILED', failure?.message ?? message ?? 'Write failed');
    };
    const caught = (error: unknown) => writeFailure(error instanceof Error ? error.message : String(error));
    /** Nothing new to write: finish an earlier failed save, then acknowledge durably. */
    const settle = async <T,>(value: T): Promise<NativeHostResult<T>> => {
        if (useTaskStore.getState().persistenceFailure) await useTaskStore.getState().retryPersistence();
        const saved = await deps.save();
        if (!saved.ok) return saved;
        markAllSaved();
        return { ok: true, value };
    };
    /**
     * Run a request once. A retry with the same requestId and input writes nothing
     * again: it finishes the save and returns the first outcome.
     */
    const once = async <T,>(
        requestId: string,
        key: string,
        run: () => Promise<NativeHostResult<{ value: T; wrote: boolean }>>,
    ): Promise<NativeHostResult<T>> => {
        const done = receipts.get(requestId) as Receipt<T> | undefined;
        if (done && done.key !== key) return fail('INVALID_INPUT', 'Request ID already belongs to another action');
        if (done) {
            if (done.saved) return { ok: true, value: done.value };
            return settle(done.value);
        }
        const outcome = await run();
        if (!outcome.ok) return outcome;
        if (!outcome.value.wrote) return settle(outcome.value.value);
        remember(requestId, { key, value: outcome.value.value, saved: false });
        const saved = await deps.save();
        if (!saved.ok) return saved;
        markAllSaved();
        return { ok: true, value: outcome.value.value };
    };

    const visibleContext = () => {
        const state = useTaskStore.getState();
        const areas = sortAreasForDisplay(state.areas);
        const areaById = new Map(areas.map((area) => [area.id, area]));
        const resolvedAreaFilter = resolveAreaFilterSelection(state.settings.filters, areas);
        const projectById = new Map(state.projects.map((project) => [project.id, project]));
        const visibleTasks = state.tasks.filter((task) => isTaskVisibleInArea(task, { areaById, projectById, resolvedAreaFilter }));
        return { state, areas, areaById, resolvedAreaFilter, visibleTasks };
    };

    const page = <T,>(items: readonly T[], input: { offset: number; limit: number }) => items.slice(input.offset, input.offset + input.limit);

    // ponytail: one cached view per screen, keyed by revision; paging a large list rebuilds nothing.
    const cache = new Map<string, { revision: string; value: unknown }>();
    const cached = <T,>(screen: string, revision: string, build: () => T): T => {
        const hit = cache.get(screen);
        if (hit?.revision === revision) return hit.value as T;
        const value = build();
        cache.set(screen, { revision, value });
        return value;
    };

    const statusListView = (kind: StatusListKind, input: Record<string, unknown>): NativeHostResult<NativeStatusListView> => {
        const ready = deps.readiness();
        if (!ready.ok) return ready;
        const groupOptions: readonly string[] = kind === 'done' ? DONE_LIST_GROUP_OPTIONS : TASK_LIST_GROUP_OPTIONS;
        const filters = readFilterState(input?.filters);
        if (!isObjectRecord(input) || !isPaging(input) || !filters
            || (input.groupBy !== undefined && !groupOptions.includes(input.groupBy as string))
            || (input.sortBy !== undefined && (kind !== 'done' || !DONE_TASK_LIST_SORT_OPTIONS.includes(input.sortBy as TaskSortBy)))
            || (input.includeArchivedProjects !== undefined && (kind !== 'reference' || typeof input.includeArchivedProjects !== 'boolean'))
            || (input.collapsedGroupIds !== undefined && !isTextList(input.collapsedGroupIds, 200))
            || (input.filterEdit !== undefined && !isFilterEdit(input.filterEdit))) {
            return fail('INVALID_INPUT', 'A valid offset, bounded limit, revision for later pages, and this list\'s grouping, sort and filters are required');
        }
        const t = deps.t();
        const edit = input.filterEdit as ListFilterEdit | undefined;
        const filterState = edit ? applyListFilterEdit(filters, edit) : filters;
        // Mobile's Clear also turns archived projects off.
        const includeArchivedProjects = kind === 'reference' && input.includeArchivedProjects === true && edit?.type !== 'clear';
        const groupBy = (input.groupBy as TaskGroupBy | undefined) ?? (kind === 'done' ? DONE_LIST_DEFAULT_GROUP_BY : REFERENCE_LIST_DEFAULT_GROUP_BY);
        const viewSortBy = input.sortBy as TaskSortBy | undefined;
        const collapsedGroupIds = (input.collapsedGroupIds as string[] | undefined) ?? [];
        const now = new Date();
        const params = { kind, groupBy, viewSortBy, includeArchivedProjects, collapsedGroupIds, filterState };
        const revision = `${deps.revision(now)}:${paramsKey(params)}`;
        if (input.revision !== undefined && input.revision !== revision) {
            return fail('STALE_REVISION', 'The list changed; restart paging from offset zero');
        }
        const view = cached(kind, revision, () => {
            const { state, areaById, resolvedAreaFilter } = visibleContext();
            const tasks = selectStatusListTasks({
                kind, tasks: state.tasks, projects: state.projects, allProjects: state._allProjects,
                resolvedAreaFilter, areaById, includeArchivedProjects,
            });
            const options = buildStatusListFilterOptions({ kind, tasks, allProjects: state._allProjects, settings: state.settings, t });
            const resolved = resolveListFilterState(filterState, {
                visibility: options.visibility,
                retainProjects: options.retainProjects,
                getProjectLabel: options.getProjectLabel,
                t,
            });
            const model = buildStatusListModel({
                kind, tasks, projects: state.projects, areas: state.areas, settings: state.settings, groupBy, viewSortBy,
                criteria: resolved.criteria, searchQuery: resolved.searchQuery,
                collapsedGroupIds: new Set(collapsedGroupIds), t, now, formatDate: deps.formatDate(),
            });
            const summary = buildStatusListFilterSummary({
                kind, chips: resolved.chips, activeCount: resolved.activeCount, hasActive: resolved.hasActive, includeArchivedProjects, t,
            });
            const chips = [
                ...filterChips(resolved),
                ...(summary.chips.length > resolved.chips.length
                    ? [{ ...summary.chips[summary.chips.length - 1], action: { includeArchivedProjects: false as const } }]
                    : []),
            ];
            return {
                model,
                title: getStatusListScreenText(kind, t).title,
                filters: nativeFilterView(resolved, options, t),
                chips,
                summary,
                archivedProjectsToggle: kind === 'reference' ? { label: t('reference.includeArchivedProjects'), value: includeArchivedProjects } : null,
                readOnly: (task: Task) => isStatusListTaskReadOnly(task, state._allProjects),
            };
        });
        const { model } = view;
        const windowItems = page(model.items, input as { offset: number; limit: number });
        const rows = deps.rows(windowItems.flatMap((item) => (item.type === 'task' ? [item.task] : [])), now);
        let rowIndex = 0;
        return {
            ok: true,
            value: {
                version: NATIVE_HOST_CONTRACT_VERSION,
                revision,
                total: model.items.length,
                kind,
                title: view.title,
                items: windowItems.map((item): NativeStatusListItem => (item.type === 'section'
                    ? item
                    : { type: 'task', row: { ...rows[rowIndex++], readOnly: view.readOnly(item.task) }, groupId: item.groupId })),
                count: model.orderedTasks.length,
                groupBy,
                sortBy: model.sortBy,
                includeArchivedProjects,
                collapsedGroupIds,
                sort: { title: model.sortTitle, label: model.sortByLabel, options: model.sortOptions },
                group: { title: model.groupTitle, label: model.groupByLabel, options: model.groupOptions },
                filters: view.filters,
                chips: view.chips,
                filterActiveCount: view.summary.activeCount,
                hasActiveFilters: view.summary.hasActive,
                archivedProjectsToggle: view.archivedProjectsToggle,
                empty: { ...view.summary.empty, clear: view.filters.hasActive },
            },
        };
    };

    const somedaySections = () => useTaskStore.getState().settings.gtd?.viewSections?.someday;

    const updateSomedaySections = async (next: ViewSectionDefinition[]) => {
        const state = useTaskStore.getState();
        await state.updateSettings(buildSomedaySectionsSettingsUpdate(state.settings, next));
    };

    return {
        /** The Menu tab's More sheet. */
        getMoreMenu(): NativeHostResult<NativeMoreMenu> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const settings = useTaskStore.getState().settings;
            const now = new Date();
            return {
                ok: true,
                value: {
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision: deps.revision(now),
                    ...buildMoreMenuModel({
                        quickAccessView: settings.appearance?.mobileQuickAccessView,
                        savedSearches: settings.savedSearches,
                        t: deps.t(),
                    }),
                },
            };
        },

        /** Waiting For. `person` chooses one person's tasks ('' or absent = All). */
        getWaitingView(input: { person?: string; offset: number; limit: number; revision?: string }): NativeHostResult<NativeWaitingView> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !isPaging(input) || (input.person !== undefined && !isText(input.person, 200))) {
                return fail('INVALID_INPUT', 'A valid offset, bounded limit, revision for later pages, and person are required');
            }
            const t = deps.t();
            const now = new Date();
            const requested = input.person ?? '';
            const revision = `${deps.revision(now)}:${paramsKey(['waiting', requested])}`;
            if (input.revision !== undefined && input.revision !== revision) {
                return fail('STALE_REVISION', 'Waiting changed; restart paging from offset zero');
            }
            const model = cached('waiting', revision, () => {
                const { state, areaById, resolvedAreaFilter, visibleTasks } = visibleContext();
                const build = (person: string) => buildWaitingViewModel({
                    tasks: visibleTasks, projects: state.projects, resolvedAreaFilter, areaById, person, t,
                });
                const first = build(requested);
                // Mobile clears a person who is no longer offered.
                return first.personOffered ? { ...first, person: requested } : { ...build(''), person: '' };
            });
            const { labels, person } = model;
            return {
                ok: true,
                value: {
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision,
                    total: model.tasks.length,
                    rows: deps.rows(page(model.tasks, input), now),
                    person,
                    people: [
                        { label: labels.all, person: '', selected: !person },
                        ...model.people.map((entry) => ({ label: entry, person: entry, selected: person.toLowerCase() === entry.toLowerCase() })),
                    ],
                    filterLabel: labels.filter,
                    clearLabel: person ? labels.clear : null,
                    stats: [{ value: model.count, label: labels.count }, { value: model.withDeadlineCount, label: labels.withDeadline }],
                    deferred: model.deferred,
                    empty: model.showEmptyState ? { title: labels.emptyTitle, hint: labels.emptyHint } : null,
                    showDetails: true,
                },
            };
        },

        /**
         * Someday/Maybe. `sortBy`, `groupBy` and `showDetails` are the screen's
         * session choices (defaults: default, viewSection, off); send the returned
         * `filters.state` back with a control's `filterEdit`.
         */
        getSomedayView(input: {
            sortBy?: TaskSortBy;
            groupBy?: SomedayGroupBy;
            showDetails?: boolean;
            filters?: Partial<ListFilterState>;
            filterEdit?: ListFilterEdit;
            offset: number;
            limit: number;
            revision?: string;
        }): NativeHostResult<NativeSomedayView> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const filters = readFilterState(input?.filters);
            if (!isObjectRecord(input) || !isPaging(input) || !filters
                || (input.sortBy !== undefined && !TASK_LIST_SORT_OPTIONS.includes(input.sortBy))
                || (input.groupBy !== undefined && !SOMEDAY_GROUP_OPTIONS.includes(input.groupBy))
                || (input.showDetails !== undefined && typeof input.showDetails !== 'boolean')
                || (input.filterEdit !== undefined && !isFilterEdit(input.filterEdit))) {
                return fail('INVALID_INPUT', 'A valid offset, bounded limit, revision for later pages, sort, grouping and filters are required');
            }
            const t = deps.t();
            const sortBy = input.sortBy ?? 'default';
            const groupBy = input.groupBy ?? 'viewSection';
            const showDetails = input.showDetails === true;
            const filterState = input.filterEdit ? applyListFilterEdit(filters, input.filterEdit) : filters;
            const now = new Date();
            const revision = `${deps.revision(now)}:${paramsKey(['someday', sortBy, groupBy, showDetails, filterState])}`;
            if (input.revision !== undefined && input.revision !== revision) {
                return fail('STALE_REVISION', 'Someday changed; restart paging from offset zero');
            }
            const view = cached('someday', revision, () => {
                const { state, areaById, resolvedAreaFilter, visibleTasks } = visibleContext();
                const tasks = selectSomedayTasks(visibleTasks);
                const options = buildSomedayFilterOptions({ tasks, projects: state.projects, settings: state.settings, t });
                const resolved = resolveListFilterState(filterState, {
                    visibility: options.visibility,
                    retainTokens: options.retainTokens,
                    retainProjects: options.retainProjects,
                    getProjectLabel: options.getProjectLabel,
                    t,
                });
                const model = buildSomedayViewModel({
                    tasks, projects: state.projects, areaById, resolvedAreaFilter, settings: state.settings,
                    sortBy, groupBy, showDetails, criteria: resolved.criteria, searchQuery: resolved.searchQuery, t,
                });
                const items: ({ type: 'heading'; id: string; title: string; muted: boolean } | { type: 'task'; task: Task; groupId: string | null })[] = model.groups
                    ? model.groups.flatMap((group) => [
                        { type: 'heading' as const, id: group.id, title: group.title, muted: group.muted === true },
                        ...group.tasks.map((task) => ({ type: 'task' as const, task, groupId: group.id })),
                    ])
                    : model.tasks.map((task) => ({ type: 'task' as const, task, groupId: null }));
                return { model, resolved, options, items };
            });
            const { model, resolved, options } = view;
            const { labels } = model;
            const windowItems = page(view.items, input);
            const rows = deps.rows(windowItems.flatMap((item) => (item.type === 'task' ? [item.task] : [])), now);
            let rowIndex = 0;
            const moveText = getSomedaySectionMoveText(t);
            return {
                ok: true,
                value: {
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision,
                    total: view.items.length,
                    items: windowItems.map((item): NativeSomedayItem => {
                        if (item.type === 'task') return { type: 'task', row: rows[rowIndex++], groupId: item.groupId };
                        const sectionId = model.canAddTaskToGroup ? getSomedayGroupSectionId(item.id) : null;
                        return {
                            ...item,
                            addTask: sectionId === null ? null : {
                                sectionId: sectionId ?? null,
                                label: labels.addTask,
                                accessibilityLabel: getSomedaySectionTaskText(t, item.title).title,
                            },
                        };
                    }),
                    sortBy,
                    groupBy,
                    showDetails,
                    stats: [{ value: model.ideasCount, label: labels.ideas }, { value: model.inProjectsCount, label: labels.inProjects }],
                    filterChip: resolved.hasActive
                        ? { label: `${labels.filters} · ${resolved.activeCount}`, removeLabel: `${labels.filtersClear}: ${labels.filters}` }
                        : null,
                    menu: {
                        filters: { label: labels.filters, selected: resolved.hasActive },
                        sort: {
                            label: labels.sort,
                            accessibilityLabel: `${labels.sort}: ${model.menu.sortValue}`,
                            value: model.menu.sortValue,
                            options: model.menu.sortOptions.map((option) => ({ ...option, accessibilityLabel: `${labels.sort}: ${option.label}` })),
                        },
                        group: {
                            label: labels.group,
                            accessibilityLabel: `${labels.group}: ${model.menu.groupValue}`,
                            value: model.menu.groupValue,
                            options: model.menu.groupOptions.map((option) => ({ ...option, accessibilityLabel: `${labels.group}: ${option.label}` })),
                        },
                        details: { label: labels.details, selected: showDetails },
                        newSection: { label: labels.newSection },
                        backLabel: labels.back,
                        closeLabel: labels.close,
                        moreLabel: labels.more,
                    },
                    filters: nativeFilterView(resolved, options, t),
                    chips: filterChips(resolved),
                    sections: model.sections,
                    deferred: model.deferred,
                    empty: model.showEmptyState ? { title: labels.emptyTitle, hint: labels.emptyHint } : null,
                    text: {
                        moveToSection: labels.moveToSection,
                        undoLabel: moveText.undoLabel,
                        errorTitle: moveText.errorTitle,
                        moveFailed: moveText.moveFailed,
                        undoFailed: moveText.undoFailed,
                        addTask: (({ title: _title, ...rest }) => rest)(getSomedaySectionTaskText(t, '')),
                    },
                },
            };
        },

        /** Reference. Defaults: grouped by area, archived projects hidden. */
        getReferenceView(input: {
            groupBy?: TaskGroupBy;
            includeArchivedProjects?: boolean;
            filters?: Partial<ListFilterState>;
            filterEdit?: ListFilterEdit;
            collapsedGroupIds?: string[];
            offset: number;
            limit: number;
            revision?: string;
        }): NativeHostResult<NativeStatusListView> {
            return statusListView('reference', input as Record<string, unknown>);
        },

        /** Done. `groupBy` and `sortBy` are the device's saved view choices (defaults: none, the stored sort). */
        getDoneView(input: {
            groupBy?: TaskGroupBy;
            sortBy?: TaskSortBy;
            filters?: Partial<ListFilterState>;
            filterEdit?: ListFilterEdit;
            collapsedGroupIds?: string[];
            offset: number;
            limit: number;
            revision?: string;
        }): NativeHostResult<NativeStatusListView> {
            return statusListView('done', input as Record<string, unknown>);
        },

        /** Someday's sections as Settings › Manage lists them; `moveUp.ids` / `moveDown.ids` go to reorderSomedaySections. */
        getSomedaySections(): NativeHostResult<{
            version: typeof NATIVE_HOST_CONTRACT_VERSION;
            revision: string;
            text: ReturnType<typeof getSomedaySectionManagerText>;
            rows: (ReturnType<typeof buildSomedaySectionManagerRows>[number] & {
                moveUp: { ids: string[] | null };
                moveDown: { ids: string[] | null };
            })[];
        }> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const t = deps.t();
            const stored = somedaySections();
            const orderAfter = (id: string, offset: -1 | 1) => moveSomedaySection(stored, id, offset)?.map((section) => section.id) ?? null;
            return {
                ok: true,
                value: {
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision: deps.revision(new Date()),
                    text: getSomedaySectionManagerText(t),
                    rows: buildSomedaySectionManagerRows(stored, t).map((row) => ({
                        ...row,
                        moveUp: { ...row.moveUp, ids: orderAfter(row.id, -1) },
                        moveDown: { ...row.moveDown, ids: orderAfter(row.id, 1) },
                    })),
                },
            };
        },

        /** The Move to section dialog for these tasks: choices with the current one selected. */
        getSomedayMoveDialog(input: { taskIds: string[] }): NativeHostResult<ReturnType<typeof buildSomedaySectionMoveDialog>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !isTextList(input.taskIds) || input.taskIds.length === 0) {
                return fail('INVALID_INPUT', 'Task IDs are required');
            }
            const state = useTaskStore.getState();
            const taskById = new Map(state.tasks.map((task) => [task.id, task]));
            const ids = Array.from(new Set(input.taskIds));
            return { ok: true, value: buildSomedaySectionMoveDialog(ids.map((id) => taskById.get(id)), somedaySections(), deps.t()) };
        },

        /** Waiting and Someday's parked projects: swiping one makes it active. Target state; a retry writes nothing. */
        async activateProject(input: { projectId: string }): Promise<NativeHostResult<{ id: string; changed: boolean }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !isText(input.projectId) || !input.projectId) return fail('INVALID_INPUT', 'Project ID is required');
            const project = useTaskStore.getState()._projectsById.get(input.projectId);
            if (!project || project.deletedAt) return fail('INVALID_INPUT', 'Project is not available');
            if (project.status === 'active') return settle({ id: project.id, changed: false });
            if (project.status !== 'waiting' && project.status !== 'someday') return fail('INVALID_INPUT', 'Only a waiting or someday project can be activated');
            try {
                const result = await useTaskStore.getState().updateProject(project.id, { status: 'active' });
                if (!result.success) return writeFailure(result.error ?? 'Project activation failed');
            } catch (error) {
                return caught(error);
            }
            const saved = await deps.save();
            if (!saved.ok) return saved;
            markAllSaved();
            return { ok: true, value: { id: project.id, changed: true } };
        },

        /**
         * Move Someday tasks to a section (null = No section), as the move dialog
         * does. Reuse `requestId` to retry: the retry writes nothing again and
         * returns the same Undo. Send `undo` to undoSomedaySectionMove.
         */
        async moveSomedayTasksToSection(input: { taskIds: string[]; sectionId: string | null; requestId: string }): Promise<NativeHostResult<NativeSomedayMoveResult>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !isTextList(input.taskIds) || input.taskIds.length === 0
                || (input.sectionId !== null && !isText(input.sectionId))
                || typeof input.requestId !== 'string' || !deps.requestIdPattern.test(input.requestId)) {
                return fail('INVALID_INPUT', 'Task IDs, a section ID or null, and a request UUID are required');
            }
            const ids = Array.from(new Set(input.taskIds));
            const destination = input.sectionId ?? undefined;
            return once<NativeSomedayMoveResult>(input.requestId, JSON.stringify(['move', ids, input.sectionId]), async () => {
                const t = deps.t();
                const text = getSomedaySectionMoveText(t);
                const refuse = { value: { refused: { title: text.errorTitle, message: text.moveFailed } }, wrote: false };
                const state = useTaskStore.getState();
                const section = destination ? sortViewSectionDefinitions(somedaySections()).find((entry) => entry.id === destination) : undefined;
                if (destination && !section) return { ok: true, value: refuse };
                const { resolvedAreaFilter } = visibleContext();
                const tasks = getSomedaySectionMoveTasks({
                    tasks: state.tasks, projects: state.projects, areas: state.areas, ids, resolvedAreaFilter,
                });
                if (!tasks) return { ok: true, value: refuse };
                const { updates, previous } = planSomedaySectionMove({ ids, tasks, destination });
                if (previous.length === 0) return { ok: true, value: { value: { moved: 0, toast: null, undo: null }, wrote: false } };
                try {
                    const result = await state.batchUpdateTasks(updates);
                    if (!result.success) return writeFailure(result.error);
                } catch (error) {
                    return caught(error);
                }
                return {
                    ok: true,
                    value: {
                        value: {
                            moved: previous.length,
                            toast: { message: formatSomedaySectionMoved(t, previous.length, section?.title), undoLabel: text.undoLabel },
                            undo: { previous, sectionId: input.sectionId },
                        },
                        wrote: true,
                    },
                };
            });
        },

        /** Undo a section move: tasks still in the moved-to section go back; tasks moved since stay. */
        async undoSomedaySectionMove(input: {
            undo: { previous: SomedaySectionAssignment[]; sectionId: string | null };
            requestId: string;
        }): Promise<NativeHostResult<{ reverted: number }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const undo = isObjectRecord(input) ? input.undo : undefined;
            if (!isObjectRecord(undo) || !Array.isArray(undo.previous) || undo.previous.length === 0 || undo.previous.length > MAX_IDS
                || !undo.previous.every((entry) => isObjectRecord(entry) && isText(entry.id)
                    && (entry.sectionId === undefined || isText(entry.sectionId)))
                || (undo.sectionId !== null && !isText(undo.sectionId))
                || typeof input.requestId !== 'string' || !deps.requestIdPattern.test(input.requestId)) {
                return fail('INVALID_INPUT', 'The move\'s undo and a request UUID are required');
            }
            const previous = undo.previous as SomedaySectionAssignment[];
            return once<{ reverted: number }>(input.requestId, JSON.stringify(['undo', previous, undo.sectionId]), async () => {
                const state = useTaskStore.getState();
                const latest = previous
                    .map(({ id }) => state.tasks.find((task) => task.id === id))
                    .filter((task): task is Task => Boolean(task));
                const updates = buildTaskViewSectionUndoUpdates(latest, 'someday', previous, (undo.sectionId as string | null) ?? undefined);
                if (updates.length === 0) return { ok: true, value: { value: { reverted: 0 }, wrote: false } };
                try {
                    const result = await state.batchUpdateTasks(updates);
                    if (!result.success) return writeFailure(result.error);
                } catch (error) {
                    return caught(error);
                }
                return { ok: true, value: { value: { reverted: updates.length }, wrote: true } };
            });
        },

        /** Add a Someday task to a section (null = No section). Reuse `captureId` to retry without a duplicate. */
        async addSomedaySectionTask(input: { title: string; sectionId: string | null; captureId: string }): Promise<NativeHostResult<
            { id: string; toast: string } | NativeMenuViewRefusal
        >> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !isText(input.title, 10_000) || !input.title.trim()
                || (input.sectionId !== null && !isText(input.sectionId))
                || typeof input.captureId !== 'string' || !deps.requestIdPattern.test(input.captureId)) {
                return fail('INVALID_INPUT', 'A task title, a section ID or null, and a capture UUID are required');
            }
            const text = getSomedaySectionTaskText(deps.t(), '');
            // A retry after a failed save finds the task it created: finish the save only.
            const id = input.captureId.toLowerCase();
            if (useTaskStore.getState()._allTasks.some((task) => task.id === id)) return settle({ id, toast: text.created });
            const plan = planSomedaySectionTaskAdd({ title: input.title, sectionId: input.sectionId ?? undefined, stored: somedaySections() });
            if (plan.kind !== 'add') return { ok: true, value: { refused: { title: null, message: text.failed } } };
            try {
                const result = await useTaskStore.getState().addTask(plan.title, plan.props, { captureId: input.captureId });
                if (!result.success || !result.id) return writeFailure(result.error ?? 'Task creation failed');
                const saved = await deps.save();
                if (!saved.ok) return saved;
                markAllSaved();
                return { ok: true, value: { id: result.id, toast: text.created } };
            } catch (error) {
                return caught(error);
            }
        },

        /** New Someday section. A title that exists (any case) returns that section; a retry writes nothing again. */
        async createSomedaySection(input: { title: string }): Promise<NativeHostResult<{ id: string; existing: boolean }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !isText(input.title, 200) || !input.title.trim()) return fail('INVALID_INPUT', 'A section title is required');
            const plan = planSomedaySectionCreate(somedaySections(), input.title);
            if (plan.kind === 'blank') return fail('INVALID_INPUT', 'A section title is required');
            if (plan.kind === 'existing') return settle({ id: plan.id, existing: true });
            try {
                await updateSomedaySections(plan.sections);
            } catch (error) {
                return caught(error);
            }
            if (!sortViewSectionDefinitions(somedaySections()).some((section) => section.id === plan.id)) return writeFailure('Section creation failed');
            const saved = await deps.save();
            if (!saved.ok) return saved;
            markAllSaved();
            return { ok: true, value: { id: plan.id, existing: false } };
        },

        /** Rename a section. Target state; the same title again writes nothing. */
        async renameSomedaySection(input: { id: string; title: string }): Promise<NativeHostResult<{ id: string; changed: boolean }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !isText(input.id) || !isText(input.title, 200)) return fail('INVALID_INPUT', 'Section ID and title are required');
            const stored = somedaySections();
            const current = sortViewSectionDefinitions(stored).find((section) => section.id === input.id);
            if (!current) return fail('INVALID_INPUT', 'Section is not available');
            const next = renameSomedaySection(stored, input.id, input.title);
            if (!next) return fail('INVALID_INPUT', 'A section title is required');
            if (current.title === input.title.trim()) return settle({ id: input.id, changed: false });
            try {
                await updateSomedaySections(next);
            } catch (error) {
                return caught(error);
            }
            const saved = await deps.save();
            if (!saved.ok) return saved;
            markAllSaved();
            return { ok: true, value: { id: input.id, changed: true } };
        },

        /** Put the sections in this order (every section's id once), numbered from 0. Target state. */
        async reorderSomedaySections(input: { ids: string[] }): Promise<NativeHostResult<{ changed: boolean }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const sorted = sortViewSectionDefinitions(somedaySections());
            if (!isObjectRecord(input) || !isTextList(input.ids) || input.ids.length !== sorted.length
                || new Set(input.ids).size !== input.ids.length || !input.ids.every((id) => sorted.some((section) => section.id === id))) {
                return fail('INVALID_INPUT', 'Every section ID, once, is required');
            }
            if (sorted.every((section, index) => section.id === input.ids[index] && section.order === index)) return settle({ changed: false });
            const byId = new Map(sorted.map((section) => [section.id, section]));
            try {
                await updateSomedaySections(input.ids.map((id, order) => ({ ...byId.get(id)!, order })));
            } catch (error) {
                return caught(error);
            }
            const saved = await deps.save();
            if (!saved.ok) return saved;
            markAllSaved();
            return { ok: true, value: { changed: true } };
        },

        /**
         * Delete a section after the row's `deleteConfirm`. Its tasks keep their
         * stored assignment and show under "No section", as on mobile. Target state.
         */
        async deleteSomedaySection(input: { id: string }): Promise<NativeHostResult<{ id: string; changed: boolean }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !isText(input.id) || !input.id) return fail('INVALID_INPUT', 'Section ID is required');
            const stored = somedaySections();
            if (!sortViewSectionDefinitions(stored).some((section) => section.id === input.id)) return settle({ id: input.id, changed: false });
            try {
                await updateSomedaySections(removeSomedaySection(stored, input.id));
            } catch (error) {
                return caught(error);
            }
            const saved = await deps.save();
            if (!saved.ok) return saved;
            markAllSaved();
            return { ok: true, value: { id: input.id, changed: true } };
        },

        /** Reference's sort sheet: the stored task-list sort, shared with the other lists. Target state. */
        async setTaskListSort(input: { sortBy: TaskSortBy }): Promise<NativeHostResult<{ sortBy: TaskSortBy; changed: boolean }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !TASK_LIST_SORT_OPTIONS.includes(input.sortBy as TaskSortBy)) {
                return fail('INVALID_INPUT', 'A task-list sort is required');
            }
            const sortBy = input.sortBy as TaskSortBy;
            if (useTaskStore.getState().settings.taskSortBy === sortBy) return settle({ sortBy, changed: false });
            try {
                await useTaskStore.getState().updateSettings({ taskSortBy: sortBy });
            } catch (error) {
                return caught(error);
            }
            const saved = await deps.save();
            if (!saved.ok) return saved;
            markAllSaved();
            return { ok: true, value: { sortBy, changed: true } };
        },
    };
}
