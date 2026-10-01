/**
 * The native host contract for the Board screen. Kept in its own file and spread
 * into createNativeHostContract: other changes edit native-host-contract.ts in
 * parallel. The view is the React Native Board's, from board-view-model.ts.
 *
 * getBoardView reads the five columns under one revision, each with its first
 * `limit` cards; getBoardList pages a column's cards, or the filter sheet's tokens
 * and projects (searched by a picker `query`), under that revision. The host keeps
 * the filter state the view returns and sends it back, with a `filterEdit` to change it.
 *
 * runBoardAction writes with a request UUID: while a save is owed, a retry only
 * saves (native-request-receipts.ts). A move and Delete are target-state and
 * compare-and-set on the revision the card showed, so a replay after a restart
 * writes nothing, and never undoes a later change (STALE_REVISION); Duplicate uses
 * its request UUID as the copy ID and checks unchanged copy fields. Success means
 * the change is saved.
 *
 * Only functions read this module's imports from native-host-contract.ts, so the
 * import cycle between the two files is safe.
 */
import {
    BOARD_CARD_SWIPES,
    BOARD_DUE_DATE_PRESETS,
    EMPTY_BOARD_FILTER_STATE,
    applyBoardFilterEdit,
    buildBoardColumns,
    getBoardCard,
    getBoardCardText,
    getBoardFilterOptions,
    getBoardFilterSummary,
    getBoardProjectBadges,
    isBoardStatus,
    planBoardDrop,
    resolveBoardFilterState,
    selectBoardTasks,
    type BoardCard,
    type BoardCardAction,
    type BoardColumnTone,
    type BoardDuePreset,
    type BoardFilterEdit,
    type BoardFilterState,
    type BoardStatus,
} from './board-view-model';
import { matchesPickerQuery } from './native-host-contract-menu-views';
import { createProjectOrderReserver, ensureDeviceId, matchesDuplicateSource, nextRevision } from './store-helpers';
import { buildDuplicateTask, sanitizeRestoredTaskContainerReferences, taskEditValuesEqual } from './store-tasks';
import { TASK_SYNC_FIELD_SCHEMA } from './task-sync-schema';
import { boardOrderForDuplicate } from './task-utils';
import { isTaskVisibleInArea, resolveAreaFilterSelection } from './area-filter';
import {
    NATIVE_HOST_CONTRACT_VERSION,
    NATIVE_HOST_MAX_WINDOW,
    sortAreasForDisplay,
    type NativeHostResult,
    type NativeTaskRow,
} from './native-host-contract';
import { createNativeRequestReceipts, isRevision, refuseStale, runStoreWrite, settleWrite, taskRevisionOf, type NativeUnsavedWrite } from './native-request-receipts';
import { isProjectedRecurringTaskId } from './recurrence';
import { isStatusListTaskReadOnly } from './menu-views-model';
import { resolveFeatureFlags } from './resolve-feature-flags';
import { useTaskStore } from './store';
import type { Area, Project, Section, Task } from './types';
import { resolveI18nText } from './i18n';

type NativeHostErrorCode = Extract<NativeHostResult<never>, { ok: false }>['error']['code'];
type Translate = (key: string) => string;

export type BoardViewDeps = {
    readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>;
    /** Data plus display revision: tasks, projects, settings, language and the minute. */
    revision: (now: Date) => string;
    t: () => Translate;
    /** Rows with core meta, as the other contract lists build them. */
    rows: (tasks: readonly Task[], now: Date) => NativeTaskRow[];
    requestIdPattern: RegExp;
};

/** The Board's filter state; missing keys are the empty state's. */
export type NativeBoardFilters = Partial<BoardFilterState>;
export type NativeBoardWindow<T> = { total: number; items: T[] };
export type NativeBoardCard = { row: NativeTaskRow; card: BoardCard; boardOrder: number | null };
export type NativeBoardColumn = {
    status: BoardStatus;
    label: string;
    tone: BoardColumnTone;
    /** The header badge: every card in the column. */
    count: number;
    /** The first `limit` cards; getBoardList pages the rest ('cards', status). */
    cards: NativeBoardCard[];
    /** "No tasks" in place of cards. */
    empty: string | null;
};
export type NativeBoardView = {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    revision: string;
    /** The effective filter state after `filterEdit`: send it back with reads, moves and paging. */
    filters: BoardFilterState;
    bar: {
        searchPlaceholder: string;
        searchQuery: string;
        /** The search box's clear button shows. */
        searchActive: boolean;
        /** The Clear button shows and the Filters button is tinted; Clear sends { type: 'clear' }. */
        active: boolean;
        clearLabel: string;
        /** "Filters" or "Filters (2)". */
        filterLabel: string;
    };
    sheet: {
        /** Tap sends { type: 'toggleToken', value } (none → included → excluded → none). */
        tokens: NativeBoardWindow<{ value: string; state: 'included' | 'excluded' | 'none' }>;
        /** Tap sends { type: 'toggleProject', value: id }. */
        projects: NativeBoardWindow<{ id: string; title: string; selected: boolean }>;
        /** The Any/All control shows once two tokens of a kind are included. */
        showContextMatchMode: boolean;
        showTagMatchMode: boolean;
        /** The sheet's chips (getBoardList pages 'chips'), then the Board's own (search and due date); pressing one sends its edit. */
        chips: NativeBoardWindow<NativeBoardChip>;
        additionalChips: { id: string; label: string; edit: BoardFilterEdit }[];
        /** The due-date section; a preset sends { type: 'toggleDuePreset', preset } and folds the section. */
        due: { label: string; summary: string; accessibilityLabel: string; presets: { preset: BoardDuePreset; label: string; selected: boolean }[] };
    };
    columns: NativeBoardColumn[];
    cardActions: {
        /** A tap opens the task editor on this tab. */
        editorTab: 'view';
        /** A swipe opens a panel and runs its actions in order, each as its own runBoardAction. */
        swipes: Record<'left' | 'right', { label: string; actions: readonly BoardCardAction[] }>;
        /** A failed duplicate's error toast: this title, the error's message. */
        errorTitle: string;
    };
};

export type NativeBoardChip = { id: string; label: string; excluded: boolean; edit: BoardFilterEdit };
export type NativeBoardList = 'cards' | 'tokens' | 'projects' | 'chips';

export type NativeBoardAction =
    /**
     * A drop. Into another column, leave `afterId` out: only the status changes and the
     * card keeps its board order, as on mobile. Inside its column, `afterId` is the card
     * it lands after (null: first) in the column as `filters` show it.
     * `taskRevision` is the card's `row.taskRevision`, as for Delete.
     */
    | { type: 'moveCard'; taskId: string; status: BoardStatus; afterId?: string | null; filters?: NativeBoardFilters; taskRevision: string }
    | { type: 'duplicateTask'; taskId: string }
    | { type: 'trashTask'; taskId: string; taskRevision: string };

/** Durable native stage: Move needs a separate frozen lifecycle/order planner. */
export type NativeBoardWriteRequest = {
    requestId: string;
    action: { type: 'duplicateTask' | 'trashTask'; taskId: string };
};
export type NativePreparedBoardAction = {
    version: 1;
    request: NativeBoardWriteRequest;
    /** Duplicate: a before-only source guard. Trash: the target preimage. */
    before: Task;
    /** The sole row written and checked before mutable source/container guards. */
    after: Task;
    deviceIdToInitialize: string | null;
    result: NativeBoardActionResult;
};
export type NativeBoardPrepareResult =
    | { kind: 'prepared'; prepared: NativePreparedBoardAction }
    | { kind: 'noop'; result: NativeBoardActionResult };

export type NativeBoardActionResult = {
    /** False when the action had nothing to write. */
    changed: boolean;
    /** Duplicate: open the copy in the task editor. */
    open: { taskId: string; projectId: string | null; tab: 'task' } | null;
};

export type NativeCalendarDeleteRequest = { requestId: string; taskId: string; taskRevision: string };
export type NativePreparedCalendarDelete = {
    version: 1;
    request: NativeCalendarDeleteRequest;
    board: { request: NativeBoardWriteRequest; prepared: NativePreparedBoardAction };
};
export type NativeCalendarDeletePreparation = { kind: 'prepared'; prepared: NativePreparedCalendarDelete };

export type NativeTaskDeleteRequest = { requestId: string; taskId: string; taskRevision: string };
export type NativeTaskDeleteResult = {
    id: string; deletion: { message: string; undoLabel: string; undoEnabled: true };
};
export type NativePreparedTaskDelete = {
    version: 1; request: NativeTaskDeleteRequest;
    board: { request: NativeBoardWriteRequest; prepared: NativePreparedBoardAction };
    result: NativeTaskDeleteResult;
};
export type NativeTaskDeletePreparation = { kind: 'prepared'; prepared: NativePreparedTaskDelete };
export type NativeTaskDeleteEnvelope = { request: NativeTaskDeleteRequest; prepared: NativePreparedTaskDelete };
export type NativeTaskDeleteUndoRequest = { requestId: string; deleteRequestId: string };
type NativeRestoreScope = { projects: Project[]; sections: Section[]; areas: Area[] };
export type NativePreparedTaskDeleteUndo = {
    version: 1; request: NativeTaskDeleteUndoRequest; delete: NativeTaskDeleteEnvelope;
    before: Task; after: Task; scope: NativeRestoreScope;
    deviceIdBefore: string | null; deviceIdToInitialize: string | null; result: { id: string };
};
export type NativeTaskDeleteUndoPreparation = { kind: 'prepared'; prepared: NativePreparedTaskDeleteUndo };
export type NativeTaskDeleteUndoEnvelope = { request: NativeTaskDeleteUndoRequest; prepared: NativePreparedTaskDeleteUndo };

const fail = (code: NativeHostErrorCode, message: string): NativeHostResult<never> => ({ ok: false, error: { code, message } });
const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);
const utf8Within = (text: string, limit: number): boolean => {
    let bytes = 0;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code < 0x80) bytes++;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
            && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
            bytes += 4;
            index++;
        } else bytes += 3;
        if (bytes > limit) return false;
    }
    return true;
};
const isText = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length <= max;
const isTextList = (value: unknown): value is string[] => (
    Array.isArray(value) && value.length <= NATIVE_HOST_MAX_WINDOW && value.every((entry) => isText(entry))
);
const isMatchMode = (value: unknown) => value === 'all' || value === 'any';
const isDuePreset = (value: unknown): value is BoardDuePreset => BOARD_DUE_DATE_PRESETS.includes(value as BoardDuePreset);
const FILTER_CHECKS: Record<keyof BoardFilterState, (value: unknown) => boolean> = {
    searchQuery: (value) => isText(value, 2000),
    tokens: isTextList,
    excludedTokens: isTextList,
    projects: isTextList,
    contextMatchMode: isMatchMode,
    tagMatchMode: isMatchMode,
    duePreset: (value) => value === null || isDuePreset(value),
};
/** A partial state is completed from the empty one; unknown keys are refused. */
const readFilters = (value: unknown): BoardFilterState | null => {
    if (value === undefined) return EMPTY_BOARD_FILTER_STATE;
    if (!isObjectRecord(value)) return null;
    for (const [key, entry] of Object.entries(value)) {
        const check = FILTER_CHECKS[key as keyof BoardFilterState];
        if (!check || !check(entry)) return null;
    }
    return { ...EMPTY_BOARD_FILTER_STATE, ...(value as NativeBoardFilters) };
};
const isFilterEdit = (edit: unknown): edit is BoardFilterEdit => {
    if (!isObjectRecord(edit)) return false;
    switch (edit.type) {
        case 'toggleToken':
        case 'removeToken':
        case 'toggleProject':
            return isText(edit.value) && (edit.value as string).length > 0;
        case 'setSearch':
            return isText(edit.value, 2000);
        case 'setMatchMode':
            return (edit.kind === 'context' || edit.kind === 'tag') && isMatchMode(edit.value);
        case 'toggleDuePreset':
            return isDuePreset(edit.preset);
        case 'clearDuePreset':
        case 'clear':
            return true;
        default:
            return false;
    }
};
const isWindow = (input: Record<string, unknown>) => (
    Number.isSafeInteger(input.offset) && (input.offset as number) >= 0
    && Number.isSafeInteger(input.limit) && (input.limit as number) >= 1 && (input.limit as number) <= NATIVE_HOST_MAX_WINDOW
);
/** A short, stable key for the view's filters, so a page of one filter never continues another. */
const paramsKey = (params: unknown): string => {
    const text = JSON.stringify(params);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36);
};
/** A list the view pages: its total, and one window built only for the items it holds. */
const pagedList = <T, Item>(all: readonly T[], toItem: (entry: T) => Item) => ({
    total: all.length,
    page: (offset: number, limit: number): Item[] => all.slice(offset, offset + limit).map(toItem),
});
const firstPage = <Item,>(list: { total: number; page: (offset: number, limit: number) => Item[] }): NativeBoardWindow<Item> => (
    { total: list.total, items: list.page(0, NATIVE_HOST_MAX_WINDOW) }
);
// ponytail: the last 200 request IDs that entered the receipts; the receipts keep 50.
const ENTERED_LIMIT = 200;

export function createBoardViewMethods(deps: BoardViewDeps) {
    // Exact retries through the shared helper: a retry finishes a failed save and never writes twice.
    const receipts = createNativeRequestReceipts({
        save: async () => {
            if (useTaskStore.getState().persistenceFailure) {
                try {
                    await useTaskStore.getState().retryPersistence();
                } catch (error) {
                    return fail('SAVE_FAILED', error instanceof Error ? error.message : String(error));
                }
            }
            return deps.save();
        },
    });
    // ponytail: one cached build, keyed by the revision and the filters; paging rebuilds nothing.
    let cache: { key: string; value: ReturnType<typeof buildBoard> } | null = null;

    /** The Board for a filter state, as mobile derives it from the store. */
    function buildBoard(input: BoardFilterState, now: Date) {
        const state = useTaskStore.getState();
        const t = deps.t();
        const areas = sortAreasForDisplay(state.areas);
        const areaById = new Map(areas.map((area) => [area.id, area]));
        const projectById = new Map(state.projects.map((project) => [project.id, project]));
        const resolvedAreaFilter = resolveAreaFilterSelection(state.settings.filters, areas);
        // What useVisibleTaskContext shows, without Reference.
        const tasks = selectBoardTasks(state.tasks.filter((task) => isTaskVisibleInArea(task, { areaById, projectById, resolvedAreaFilter })));
        const badges = getBoardProjectBadges(state.projects, areaById);
        const options = getBoardFilterOptions({ tasks, projects: state.projects, areaFilter: resolvedAreaFilter, areaById, badges, t });
        const resolved = resolveBoardFilterState(input, {
            tokens: options.tokens, projectIds: options.projects.map((project) => project.id), getProjectLabel: options.getProjectLabel, t,
        });
        const filters = resolved.state;
        const summary = getBoardFilterSummary({ criteria: resolved.criteria, searchQuery: filters.searchQuery, t });
        const columns = buildBoardColumns({ tasks, criteria: resolved.criteria, searchQuery: filters.searchQuery, projects: state.projects, now, t });
        const cardText = getBoardCardText(t);
        const timeEstimatesEnabled = resolveFeatureFlags(state.settings).timeEstimates;
        const tokenItem = (value: string) => ({
            value, state: filters.tokens.includes(value) ? 'included' as const : filters.excludedTokens.includes(value) ? 'excluded' as const : 'none' as const,
        });
        const projectItem = (project: (typeof options.projects)[number]) => ({ ...project, selected: filters.projects.includes(project.id) });
        const lists = {
            tokens: pagedList(options.tokens, tokenItem),
            projects: pagedList(options.projects, projectItem),
            chips: pagedList(resolved.chips, (chip): NativeBoardChip => ({ id: chip.id, label: chip.label, excluded: chip.excluded, edit: chip.edit as BoardFilterEdit })),
        };
        // The sheet's pickers narrowed by their search (the Inbox tokens' rule): a token by its text, a project by its title.
        const search = {
            tokens: (query: string) => pagedList(options.tokens.filter((value) => matchesPickerQuery(value, query)), tokenItem),
            projects: (query: string) => pagedList(options.projects.filter((project) => matchesPickerQuery(project.title, query)), projectItem),
        };
        const view: Omit<NativeBoardView, 'version' | 'revision' | 'columns'> = {
            filters,
            bar: {
                searchPlaceholder: summary.searchPlaceholder,
                searchQuery: filters.searchQuery,
                searchActive: summary.searchActive,
                active: summary.active,
                clearLabel: summary.clearLabel,
                filterLabel: summary.filterLabel,
            },
            sheet: {
                tokens: firstPage(lists.tokens),
                projects: firstPage(lists.projects),
                showContextMatchMode: resolved.showContextMatchMode,
                showTagMatchMode: resolved.showTagMatchMode,
                chips: firstPage(lists.chips),
                additionalChips: summary.chips.map((chip) => ({
                    ...chip, edit: chip.id === 'board-search' ? { type: 'setSearch', value: '' } : { type: 'clearDuePreset' },
                })),
                due: summary.due,
            },
            cardActions: {
                editorTab: 'view',
                swipes: {
                    left: { label: cardText.duplicate, actions: BOARD_CARD_SWIPES.left.actions },
                    right: { label: cardText.delete, actions: BOARD_CARD_SWIPES.right.actions },
                },
                errorTitle: cardText.errorTitle,
            },
        };
        return { view, columns, lists, search, badges, timeEstimatesEnabled };
    }

    /** The Board for these filters (after an edit), with its revision; null for invalid input. */
    const readBoard = (input: Record<string, unknown>) => {
        const read = readFilters(input.filters);
        if (!read || (input.filterEdit !== undefined && !isFilterEdit(input.filterEdit))) return null;
        const edited = input.filterEdit === undefined ? read : applyBoardFilterEdit(read, input.filterEdit as BoardFilterEdit);
        if (!readFilters(edited)) return null;
        const now = new Date();
        const base = deps.revision(now);
        const key = `${base}:${paramsKey(edited)}`;
        if (cache?.key !== key) cache = { key, value: buildBoard(edited, now) };
        // The resolved filters (selections no longer offered dropped) name the revision.
        return { now, board: cache.value, revision: `${base}:${paramsKey(cache.value.view.filters)}` };
    };

    const cards = (board: ReturnType<typeof buildBoard>, tasks: readonly Task[], now: Date): NativeBoardCard[] => {
        const rows = deps.rows(tasks, now);
        return tasks.map((task, index) => ({
            row: rows[index],
            card: getBoardCard(task, { badges: board.badges, timeEstimatesEnabled: board.timeEstimatesEnabled, t: deps.t() }),
            boardOrder: Number.isFinite(task.boardOrder) ? task.boardOrder as number : null,
        }));
    };

    // ---- Actions ---------------------------------------------------------------

    type Outcome = NativeHostResult<NativeBoardActionResult> | NativeUnsavedWrite<NativeBoardActionResult>;
    /** An action's checks: a refusal or nothing to write (`result`), or the write to run. */
    type Prepared = { result: Outcome } | { write: () => Promise<Outcome> };
    /** Nothing to write: the request's target state already holds (a replay after a restart lands here). */
    const unchanged: Prepared = { result: { ok: true, value: { changed: false, open: null } } };
    const refuse = (code: NativeHostErrorCode, message: string): Prepared => ({ result: fail(code, message) });
    /** Compare-and-set: a card that changed since the view showed it is not written. */
    const stale = (task: Task, taskRevision: string): Prepared | null => {
        const refused = refuseStale([task], [taskRevision], 'The card changed since the Board showed it; read the Board again');
        return refused ? { result: refused } : null;
    };
    const liveTask = (id: unknown) => {
        const task = typeof id === 'string' ? useTaskStore.getState()._tasksById.get(id) : undefined;
        return task && !task.deletedAt && !task.purgedAt ? task : undefined;
    };
    /**
     * Runs a store call. `changed` says whether the tasks changed: a reorder the store
     * reads as its current order writes nothing, and says so.
     */
    const written = async (call: Parameters<typeof runStoreWrite>[0], open: () => NativeBoardActionResult['open'] = () => null): Promise<Outcome> => {
        const before = useTaskStore.getState()._allTasks;
        const landed = await runStoreWrite(call);
        return settleWrite(landed, { changed: useTaskStore.getState()._allTasks !== before, open: open() });
    };

    const prepare = (action: NativeBoardAction, requestId: string): Prepared => {
        const store = useTaskStore.getState();
        switch (action.type) {
            case 'moveCard': {
                const filters = readFilters(action.filters);
                if (!isBoardStatus(action.status) || !filters || !isRevision(action.taskRevision)
                    || !(action.afterId === undefined || action.afterId === null || isText(action.afterId))) {
                    return refuse('INVALID_INPUT', 'A task, a Board column, an optional card to land after, valid filters and the revision the view showed are required');
                }
                const task = liveTask(action.taskId);
                if (!task) return refuse('TASK_NOT_FOUND', 'Task not found');
                if (!isBoardStatus(task.status)) return refuse('INVALID_INPUT', 'The card is not on the Board');
                let columnIds: string[] = [];
                if (task.status !== action.status) {
                    if (action.afterId !== undefined) return refuse('INVALID_INPUT', 'A drop into another column has no position');
                } else if (action.afterId !== undefined) {
                    const { board } = readBoard({ filters })!;
                    columnIds = board.columns.find((column) => column.status === action.status)!.tasks.map((entry) => entry.id);
                    if (!columnIds.includes(task.id) || (action.afterId !== null && (action.afterId === task.id || !columnIds.includes(action.afterId)))) {
                        return refuse('INVALID_INPUT', 'The card and the card it lands after must be shown in that column');
                    }
                }
                const plan = planBoardDrop({ task, status: action.status, columnIds, afterId: action.afterId });
                if (!plan) return unchanged;
                const refused = stale(task, action.taskRevision);
                if (refused) return refused;
                return {
                    write: () => written(() => (plan.kind === 'status'
                        ? store.updateTask(plan.taskId, { status: plan.status })
                        : store.reorderBoardTasks(plan.status, plan.orderedIds, plan.taskId))),
                };
            }
            case 'trashTask': {
                if (!isRevision(action.taskRevision)) return refuse('INVALID_INPUT', 'A task and the revision the view showed are required');
                const task = typeof action.taskId === 'string' ? store._tasksById.get(action.taskId) : undefined;
                if (!task || task.purgedAt) return refuse('TASK_NOT_FOUND', 'Task not found');
                if (task.deletedAt) return unchanged;
                return stale(task, action.taskRevision) ?? { write: () => written(() => store.deleteTask(task.id)) };
            }
            case 'duplicateTask': {
                const task = liveTask(action.taskId);
                if (!task) return refuse('TASK_NOT_FOUND', 'Task not found');
                const copy = store._tasksById.get(requestId);
                if (copy) {
                    // An edited copy cannot acknowledge a lost reply.
                    if (!matchesDuplicateSource(task, copy)) {
                        return refuse('INVALID_INPUT', 'The duplicate request ID does not match this source');
                    }
                    return { result: { ok: true, value: { changed: false, open: { taskId: copy.id, projectId: task.projectId ?? null, tab: 'task' } } } };
                }
                const { duplicateFailed } = getBoardCardText(deps.t());
                let createdId: string | undefined;
                // Mobile's toast: the store's refusal, else "could not duplicate".
                return {
                    write: () => written(async () => {
                        try {
                            const result = await store.duplicateTask(task.id, false, requestId);
                            createdId = result.id;
                            return result.success && result.id ? result : { success: false, error: result.error || duplicateFailed };
                        } catch {
                            return { success: false, error: duplicateFailed };
                        }
                    }, () => (createdId ? { taskId: createdId, projectId: task.projectId ?? null, tab: 'task' } : null)),
                };
            }
            default:
                return refuse('INVALID_INPUT', 'The Board does not offer that action');
        }
    };
    const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
        Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
    const detach = (input: unknown): unknown => {
        try {
            const json = JSON.stringify(input);
            return json.length <= 2_000_000 ? JSON.parse(json) : null;
        } catch { return null; }
    };
    const readWriteRequest = (input: unknown): NativeBoardWriteRequest | null => {
        if (!isObjectRecord(input) || !exactKeys(input, ['requestId', 'action'])
            || typeof input.requestId !== 'string' || !deps.requestIdPattern.test(input.requestId)
            || !isObjectRecord(input.action) || !exactKeys(input.action, ['type', 'taskId'])
            || !['duplicateTask', 'trashTask'].includes(input.action.type as string)
            || !isText(input.action.taskId) || !input.action.taskId) return null;
        return input as unknown as NativeBoardWriteRequest;
    };
    const taskRecord = (input: unknown): input is Task => isObjectRecord(input)
        && isText(input.id) && Boolean(input.id) && typeof input.title === 'string'
        && ['inbox', 'next', 'waiting', 'someday', 'reference', 'done', 'archived'].includes(input.status as string)
        && typeof input.createdAt === 'string' && typeof input.updatedAt === 'string'
        && Object.keys(input).every((name) => TASK_SYNC_FIELD_SCHEMA.some((field) => field.name === name));
    const readPrepared = (input: unknown): NativePreparedBoardAction | null => {
        const detached = detach(input);
        if (!isObjectRecord(detached) || !exactKeys(detached, ['version', 'request', 'before', 'after', 'deviceIdToInitialize', 'result'])
            || detached.version !== 1 || !taskRecord(detached.before) || !taskRecord(detached.after)) return null;
        const request = readWriteRequest(detached.request);
        if (!request) return null;
        const prepared = detached as unknown as NativePreparedBoardAction;
        const { before, after, deviceIdToInitialize } = prepared;
        try {
            if (before.id !== request.action.taskId || before.deletedAt || before.purgedAt
                || !isText(after.revBy) || !after.revBy || new Date(after.updatedAt).toISOString() !== after.updatedAt
                || (deviceIdToInitialize !== null && (deviceIdToInitialize !== after.revBy || !deps.requestIdPattern.test(deviceIdToInitialize)))) return null;
            let expected: Task;
            let result: NativeBoardActionResult;
            if (request.action.type === 'trashTask') {
                expected = { ...before, deletedAt: after.updatedAt, updatedAt: after.updatedAt, rev: nextRevision(before.rev), revBy: after.revBy };
                result = { changed: true, open: null };
            } else {
                if (after.id !== request.requestId || after.id === before.id || after.order !== after.orderNum
                    || (before.projectId ? typeof after.order !== 'number' || !Number.isFinite(after.order) : after.order !== undefined)
                    || (after.boardOrder !== undefined && (!Number.isSafeInteger(after.boardOrder)
                        || !Number.isSafeInteger(before.boardOrder) || after.boardOrder <= before.boardOrder!))) return null;
                const ids = [...(after.checklist ?? []).map((item) => item.id), ...(after.attachments ?? []).map((item) => item.id)];
                const sourceIds = new Set([before.id, ...(before.checklist ?? []).map((item) => item.id), ...(before.attachments ?? []).map((item) => item.id)]);
                if (!ids.every((id) => typeof id === 'string' && deps.requestIdPattern.test(id) && !sourceIds.has(id))
                    || new Set([after.id, ...ids]).size !== ids.length + 1) return null;
                let index = 0;
                expected = buildDuplicateTask({ sourceTask: before, copyId: request.requestId, now: after.createdAt, deviceId: after.revBy,
                    projectOrder: after.order, boardOrder: after.boardOrder, generateId: () => ids[index++] });
                if (index !== ids.length) return null;
                result = { changed: true, open: { taskId: after.id, projectId: after.projectId ?? null, tab: 'task' } };
            }
            return taskEditValuesEqual(after, expected) && taskEditValuesEqual(prepared.result, result) ? prepared : null;
        } catch { return null; }
    };
    const readPreparedCommand = (input: unknown): NativePreparedBoardAction | null => {
        if (!isObjectRecord(input) || !exactKeys(input, ['request', 'prepared'])) return null;
        const request = readWriteRequest(detach(input.request));
        const prepared = readPrepared(input.prepared);
        return request && prepared && taskEditValuesEqual(request, prepared.request) ? prepared : null;
    };
    const readCalendarDeleteRequest = (input: unknown): NativeCalendarDeleteRequest | null => (
        isObjectRecord(input) && exactKeys(input, ['requestId', 'taskId', 'taskRevision'])
        && typeof input.requestId === 'string' && deps.requestIdPattern.test(input.requestId)
        && typeof input.taskId === 'string' && input.taskId.length > 0 && input.taskId.length <= 200
        && typeof input.taskRevision === 'string' && input.taskRevision.length > 0 && input.taskRevision.length <= 200
            ? input as NativeCalendarDeleteRequest : null
    );
    const readPreparedCalendarDelete = (input: unknown): NativePreparedCalendarDelete | null => {
        try {
            const json = JSON.stringify(input);
            if (typeof json !== 'string' || !utf8Within(json, 2_000_000)
                || !isObjectRecord(input) || !exactKeys(input, ['request', 'prepared'])
                || !isObjectRecord(input.prepared) || !exactKeys(input.prepared, ['version', 'request', 'board'])
                || input.prepared.version !== 1 || !isObjectRecord(input.prepared.board)
                || !exactKeys(input.prepared.board, ['request', 'prepared'])) return null;
            const request = readCalendarDeleteRequest(input.request);
            const wrapped = readCalendarDeleteRequest(input.prepared.request);
            const board = readPreparedCommand(input.prepared.board);
            if (!request || !wrapped || !board || !taskEditValuesEqual(request, wrapped)
                || board.request.requestId !== request.requestId || board.request.action.type !== 'trashTask'
                || board.request.action.taskId !== request.taskId || board.before.id !== request.taskId
                || taskRevisionOf(board.before) !== request.taskRevision
                || board.before.deletedAt || board.before.purgedAt || board.before.status === 'reference'
                || isProjectedRecurringTaskId(request.taskId)
                || !taskEditValuesEqual(board.result, { changed: true, open: null })) return null;
            return input.prepared as NativePreparedCalendarDelete;
        } catch { return null; }
    };
    const bounded = (input: unknown): unknown => {
        try {
            const json = JSON.stringify(input);
            return typeof json === 'string' && utf8Within(json, 2_000_000) ? JSON.parse(json) : null;
        } catch { return null; }
    };
    const validNotice = (value: unknown, max: number): value is string => typeof value === 'string'
        && value.length > 0 && value.length <= max && value.trim() === value
        && Array.from(value).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
    const readTaskDeleteRequest = (input: unknown): NativeTaskDeleteRequest | null => isObjectRecord(input)
        && exactKeys(input, ['requestId', 'taskId', 'taskRevision'])
        && typeof input.requestId === 'string' && deps.requestIdPattern.test(input.requestId)
        && typeof input.taskId === 'string' && input.taskId.length > 0 && input.taskId.length <= 200
        && typeof input.taskRevision === 'string' && input.taskRevision.length > 0 && input.taskRevision.length <= 200
            ? input as NativeTaskDeleteRequest : null;
    const readPreparedTaskDelete = (input: unknown): NativeTaskDeleteEnvelope | null => {
        const envelope = bounded(input);
        if (!isObjectRecord(envelope) || !exactKeys(envelope, ['request', 'prepared'])
            || !isObjectRecord(envelope.prepared)
            || !exactKeys(envelope.prepared, ['version', 'request', 'board', 'result'])
            || envelope.prepared.version !== 1 || !isObjectRecord(envelope.prepared.board)
            || !exactKeys(envelope.prepared.board, ['request', 'prepared'])) return null;
        const request = readTaskDeleteRequest(envelope.request);
        const wrapped = readTaskDeleteRequest(envelope.prepared.request);
        const board = readPreparedCommand(envelope.prepared.board);
        const result = envelope.prepared.result;
        if (!request || !wrapped || !board || !taskEditValuesEqual(request, wrapped)
            || board.request.requestId !== request.requestId || board.request.action.type !== 'trashTask'
            || board.request.action.taskId !== request.taskId || board.before.id !== request.taskId
            || taskRevisionOf(board.before) !== request.taskRevision || board.before.deletedAt || board.before.purgedAt
            || isProjectedRecurringTaskId(request.taskId)
            || !taskEditValuesEqual(board.result, { changed: true, open: null })
            || !isObjectRecord(result) || !exactKeys(result, ['id', 'deletion']) || result.id !== request.taskId
            || !isObjectRecord(result.deletion) || !exactKeys(result.deletion, ['message', 'undoLabel', 'undoEnabled'])
            || !validNotice(result.deletion.message, 512) || !validNotice(result.deletion.undoLabel, 80)
            || result.deletion.undoEnabled !== true) return null;
        return envelope as NativeTaskDeleteEnvelope;
    };
    const readTaskDeleteUndoRequest = (input: unknown): NativeTaskDeleteUndoRequest | null => isObjectRecord(input)
        && exactKeys(input, ['requestId', 'deleteRequestId'])
        && typeof input.requestId === 'string' && deps.requestIdPattern.test(input.requestId)
        && typeof input.deleteRequestId === 'string' && deps.requestIdPattern.test(input.deleteRequestId)
        && input.requestId !== input.deleteRequestId ? input as NativeTaskDeleteUndoRequest : null;
    const restoreScope = (task: Task, state: Pick<ReturnType<typeof useTaskStore.getState>, '_allProjects' | '_allSections' | '_allAreas'>): NativeRestoreScope => {
        const section = state._allSections.find((entry) => entry.id === task.sectionId);
        const projects = new Set([task.projectId, section?.projectId]);
        return {
            projects: state._allProjects.filter((entry) => projects.has(entry.id)),
            sections: section ? [section] : [],
            areas: state._allAreas.filter((entry) => entry.id === task.areaId),
        };
    };
    const readPreparedTaskDeleteUndo = (input: unknown): NativeTaskDeleteUndoEnvelope | null => {
        const envelope = bounded(input);
        if (!isObjectRecord(envelope) || !exactKeys(envelope, ['request', 'prepared'])
            || !isObjectRecord(envelope.prepared)
            || !exactKeys(envelope.prepared, ['version', 'request', 'delete', 'before', 'after', 'scope',
                'deviceIdBefore', 'deviceIdToInitialize', 'result']) || envelope.prepared.version !== 1) return null;
        const request = readTaskDeleteUndoRequest(envelope.request);
        const raw = envelope.prepared;
        const wrapped = readTaskDeleteUndoRequest(raw.request);
        const deletion = readPreparedTaskDelete(raw.delete);
        if (!request || !wrapped || !taskEditValuesEqual(request, wrapped) || !deletion
            || request.deleteRequestId !== deletion.request.requestId || !taskEditValuesEqual(raw.delete, deletion)
            || !taskRecord(raw.before) || !taskRecord(raw.after) || !isObjectRecord(raw.scope)
            || !exactKeys(raw.scope, ['projects', 'sections', 'areas'])
            || !Array.isArray(raw.scope.projects) || !Array.isArray(raw.scope.sections) || !Array.isArray(raw.scope.areas)
            || raw.scope.projects.length > 2 || raw.scope.sections.length > 1 || raw.scope.areas.length > 1
            || !raw.scope.projects.every((entry) => isObjectRecord(entry) && typeof entry.id === 'string')
            || !raw.scope.sections.every((entry) => isObjectRecord(entry) && typeof entry.id === 'string'
                && typeof entry.projectId === 'string')
            || !raw.scope.areas.every((entry) => isObjectRecord(entry) && typeof entry.id === 'string')
            || !isObjectRecord(raw.result) || !exactKeys(raw.result, ['id'])) return null;
        const prepared = raw as unknown as NativePreparedTaskDeleteUndo;
        const { before, after, scope } = prepared;
        const section = scope.sections[0];
        const allowedProjects = new Set([before.projectId, section?.projectId]);
        if (!taskEditValuesEqual(before, deletion.prepared.board.prepared.after) || !before.deletedAt || before.purgedAt
            || before.id !== after.id || prepared.result.id !== before.id
            || scope.projects.some((entry) => !allowedProjects.has(entry.id))
            || scope.sections.some((entry) => entry.id !== before.sectionId)
            || scope.areas.some((entry) => entry.id !== before.areaId)
            || new Set(scope.projects.map((entry) => entry.id)).size !== scope.projects.length
            || !isText(after.revBy) || !after.revBy
            || typeof after.updatedAt !== 'string' || !Number.isFinite(Date.parse(after.updatedAt))
            || new Date(after.updatedAt).toISOString() !== after.updatedAt
            || prepared.deviceIdBefore !== null && typeof prepared.deviceIdBefore !== 'string'
            || (prepared.deviceIdBefore === null
                ? typeof prepared.deviceIdToInitialize !== 'string'
                    || !deps.requestIdPattern.test(prepared.deviceIdToInitialize)
                    || after.revBy !== prepared.deviceIdToInitialize
                : prepared.deviceIdToInitialize !== null || after.revBy !== prepared.deviceIdBefore)) return null;
        try {
            const expected = { ...before, deletedAt: undefined,
                ...sanitizeRestoredTaskContainerReferences(before, {
                    _allProjects: scope.projects, _allSections: scope.sections, _allAreas: scope.areas,
                }), updatedAt: after.updatedAt, rev: nextRevision(before.rev), revBy: after.revBy };
            return taskEditValuesEqual(after, expected) ? envelope as NativeTaskDeleteUndoEnvelope : null;
        } catch { return null; }
    };
    // Object order changes when a native host encodes its journal; array order never does.
    const canonicalJSON = (input: unknown): string => JSON.stringify(input, (_name, value) =>
        isObjectRecord(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);

    const prepareBoardActionBody = (input: NativeBoardWriteRequest): NativeHostResult<NativeBoardPrepareResult> => {
        const ready = deps.readiness();
        if (!ready.ok) return ready;
        const request = readWriteRequest(detach(input));
        if (!request) return fail('INVALID_INPUT', 'A request UUID and a supported Board action are required');
        const state = useTaskStore.getState();
        const source = state._tasksById.get(request.action.taskId);
        if (!source || source.purgedAt || (source.deletedAt && request.action.type === 'duplicateTask')) return fail('TASK_NOT_FOUND', 'Task not found');
        if (source.deletedAt) return { ok: true, value: { kind: 'noop', result: { changed: false, open: null } } };
        if (request.action.type === 'duplicateTask' && state._tasksById.has(request.requestId)) {
            return fail('INVALID_INPUT', 'The duplicate request ID is already in use; retry its prepared command');
        }
        const before = detach(source);
        if (!taskRecord(before)) return fail('INVALID_INPUT', 'Task cannot fit a valid bounded Board journal');
        const device = ensureDeviceId(state.settings);
        const now = new Date().toISOString();
        const after = request.action.type === 'trashTask'
            ? { ...before, deletedAt: now, updatedAt: now, rev: nextRevision(before.rev), revBy: device.deviceId }
            : buildDuplicateTask({ sourceTask: before, copyId: request.requestId, now, deviceId: device.deviceId,
                projectOrder: before.projectId ? createProjectOrderReserver(state._allTasks)(before.projectId) : undefined,
                boardOrder: boardOrderForDuplicate(before.boardOrder, state._allTasks.filter((task) => task.status === before.status && !task.deletedAt)) });
        const result: NativeBoardActionResult = { changed: true, open: request.action.type === 'duplicateTask'
            ? { taskId: after.id, projectId: after.projectId ?? null, tab: 'task' } : null };
        const prepared = readPrepared({ version: 1, request, before, after, deviceIdToInitialize: device.updated ? device.deviceId : null, result });
        return prepared ? { ok: true, value: { kind: 'prepared', prepared } }
            : fail('INVALID_INPUT', 'Board action cannot produce a valid bounded journal');
    };

    const commitPreparedBoard = (prepared: NativePreparedBoardAction, receiptKind: 'preparedBoard' | 'preparedCalendarDelete', respectReadOnly = false) => (
        receipts.run(prepared.request.requestId, canonicalJSON([receiptKind, prepared]), async () => {
            const result = await useTaskStore.getState().commitPreparedBoardTask({
                kind: prepared.request.action.type, before: prepared.before, after: prepared.after,
                deviceIdToInitialize: prepared.deviceIdToInitialize,
                ...(respectReadOnly ? { respectReadOnly: true as const } : {}),
            });
            if (!result.success) return fail(result.reason === 'conflict' ? 'STALE_REVISION' : 'INVALID_INPUT', result.error ?? 'Prepared Board action refused');
            return { ok: true as const, value: prepared.result };
        })
    );

    // Request IDs that entered the receipts, with their payloads, so a retry reaches its receipt first.
    const entered = new Map<string, string>();

    return {
        /**
         * The Board: five columns with their first `limit` cards, the filter bar and the
         * filter sheet. Send the returned `filters` back, with a `filterEdit` to change them.
         */
        getBoardView(input: { filters?: NativeBoardFilters; filterEdit?: BoardFilterEdit; limit: number }): NativeHostResult<NativeBoardView> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const read = isObjectRecord(input) && isWindow({ offset: 0, limit: input.limit }) ? readBoard(input) : null;
            if (!read) return fail('INVALID_INPUT', 'Valid filters, a filter edit and a bounded limit are required');
            const { now, board, revision } = read;
            const limit = input.limit;
            return {
                ok: true,
                value: {
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision,
                    ...board.view,
                    columns: board.columns.map((column) => ({
                        status: column.status,
                        label: column.label,
                        tone: column.tone,
                        count: column.tasks.length,
                        cards: cards(board, column.tasks.slice(0, limit), now),
                        empty: column.empty,
                    })),
                },
            };
        },

        /**
         * A later window of a column's cards ('cards' with its status), or of the filter
         * sheet's 'tokens', 'projects' or 'chips'. Send the view's filters and its revision.
         * A picker's search goes in as `query` ('tokens' and 'projects' only), from offset zero.
         */
        getBoardList(input: {
            filters?: NativeBoardFilters;
            list: NativeBoardList;
            status?: BoardStatus;
            query?: string;
            offset: number;
            limit: number;
            revision: string;
        }): NativeHostResult<{ version: typeof NATIVE_HOST_CONTRACT_VERSION; revision: string; list: NativeBoardList; total: number; items: unknown[] }> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const valid = isObjectRecord(input) && typeof input.revision === 'string' && isWindow(input)
                && (input.list === 'tokens' || input.list === 'projects' || input.list === 'chips' || (input.list === 'cards' && isBoardStatus(input.status)))
                && (input.query === undefined || (isText(input.query) && (input.list === 'tokens' || input.list === 'projects')));
            const read = valid ? readBoard({ filters: input.filters }) : null;
            if (!read) return fail('INVALID_INPUT', 'The view\'s filters, a list (a column\'s status for cards), a picker query only for tokens or projects, a valid window and its revision are required');
            if (read.revision !== input.revision) return fail('STALE_REVISION', 'The Board changed; read it again');
            const { board, now } = read;
            let total: number;
            let items: unknown[];
            if (input.list === 'cards') {
                const column = board.columns.find((entry) => entry.status === input.status)!;
                total = column.tasks.length;
                items = cards(board, column.tasks.slice(input.offset, input.offset + input.limit), now);
            } else {
                const list = input.query !== undefined && (input.list === 'tokens' || input.list === 'projects')
                    ? board.search[input.list](input.query)
                    : board.lists[input.list];
                total = list.total;
                items = list.page(input.offset, input.limit);
            }
            return { ok: true, value: { version: NATIVE_HOST_CONTRACT_VERSION, revision: read.revision, list: input.list, total, items } };
        },

        /** Pure planning for the bounded native Trash/Duplicate journal. */
        prepareBoardAction(input: NativeBoardWriteRequest): NativeHostResult<NativeBoardPrepareResult> {
            return prepareBoardActionBody(input);
        },

        /** Pure immutable authority check, including before activation/SQLite open.
         * Terminal cleanup must never rerun a mutation or mutable source checks. */
        validatePreparedBoardAction(input: { request: NativeBoardWriteRequest; prepared: NativePreparedBoardAction }): NativeHostResult<NativeBoardActionResult> {
            const prepared = readPreparedCommand(input);
            return prepared ? { ok: true, value: prepared.result } : fail('INVALID_INPUT', 'Prepared Board request or journal does not match');
        },

        async commitPreparedBoardAction(input: { request: NativeBoardWriteRequest; prepared: NativePreparedBoardAction }): Promise<NativeHostResult<NativeBoardActionResult>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const prepared = readPreparedCommand(input);
            if (!prepared) return fail('INVALID_INPUT', 'Prepared Board request or journal does not match');
            return commitPreparedBoard(prepared, 'preparedBoard');
        },

        /** Calendar's Delete uses the Board Trash journal, with a visible-row revision and read-only parent guard. */
        prepareCalendarDelete(input: NativeCalendarDeleteRequest): NativeHostResult<NativeCalendarDeletePreparation> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const request = readCalendarDeleteRequest(input);
            if (!request) return fail('INVALID_INPUT', 'A Calendar task and view revision are required');
            const state = useTaskStore.getState();
            const task = state._tasksById.get(request.taskId);
            if (!task || task.deletedAt || task.purgedAt || task.status === 'reference'
                || isProjectedRecurringTaskId(request.taskId) || isStatusListTaskReadOnly(task, state._allProjects)) {
                return fail('TASK_NOT_FOUND', 'Task is not deletable');
            }
            if (taskRevisionOf(task) !== request.taskRevision) return fail('STALE_REVISION', 'Task changed since the Calendar view');
            const boardRequest: NativeBoardWriteRequest = { requestId: request.requestId, action: { type: 'trashTask', taskId: request.taskId } };
            const board = prepareBoardActionBody(boardRequest);
            if (!board.ok) return board;
            if (board.value.kind !== 'prepared') return fail('TASK_NOT_FOUND', 'Task is not deletable');
            const prepared: NativePreparedCalendarDelete = { version: 1, request, board: { request: boardRequest, prepared: board.value.prepared } };
            return readPreparedCalendarDelete({ request, prepared })
                ? { ok: true, value: { kind: 'prepared', prepared } }
                : fail('INVALID_INPUT', 'Calendar Delete could not produce a valid prepared journal');
        },

        /** Pure authority check for the journal before native storage opens. */
        validatePreparedCalendarDelete(input: { request: NativeCalendarDeleteRequest; prepared: NativePreparedCalendarDelete }): NativeHostResult<NativeBoardActionResult> {
            const prepared = readPreparedCalendarDelete(input);
            return prepared ? { ok: true, value: prepared.board.prepared.result }
                : fail('INVALID_INPUT', 'Prepared Calendar Delete request or journal does not match');
        },

        async commitPreparedCalendarDelete(input: { request: NativeCalendarDeleteRequest; prepared: NativePreparedCalendarDelete }): Promise<NativeHostResult<NativeBoardActionResult>> {
            const prepared = readPreparedCalendarDelete(input);
            if (!prepared) return fail('INVALID_INPUT', 'Prepared Calendar Delete request or journal does not match');
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            return commitPreparedBoard(prepared.board.prepared, 'preparedCalendarDelete', true);
        },

        /** Task editor Delete ignores the unsaved draft and binds the saved row the editor showed. */
        prepareTaskDelete(input: NativeTaskDeleteRequest): NativeHostResult<NativeTaskDeletePreparation> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const request = readTaskDeleteRequest(input);
            if (!request) return fail('INVALID_INPUT', 'A Task Delete UUID, task and saved revision are required');
            const state = useTaskStore.getState();
            const task = state._tasksById.get(request.taskId);
            if (!task || task.deletedAt || task.purgedAt || isProjectedRecurringTaskId(request.taskId)
                || isStatusListTaskReadOnly(task, state._allProjects)) return fail('TASK_NOT_FOUND', 'Task is not deletable');
            if (taskRevisionOf(task) !== request.taskRevision) return fail('STALE_REVISION', 'Task changed since the editor opened');
            const boardRequest: NativeBoardWriteRequest = { requestId: request.requestId,
                action: { type: 'trashTask', taskId: request.taskId } };
            const board = prepareBoardActionBody(boardRequest);
            if (!board.ok) return board;
            if (board.value.kind !== 'prepared') return fail('TASK_NOT_FOUND', 'Task is not deletable');
            const t = deps.t();
            const prepared: NativePreparedTaskDelete = { version: 1, request,
                board: { request: boardRequest, prepared: board.value.prepared },
                result: { id: request.taskId, deletion: {
                    message: resolveI18nText(t, 'list.taskDeleted'),
                    undoLabel: resolveI18nText(t, 'common.undo'), undoEnabled: true,
                } } };
            return readPreparedTaskDelete({ request, prepared })
                ? { ok: true, value: { kind: 'prepared', prepared } }
                : fail('INVALID_INPUT', 'Task Delete could not produce a valid prepared journal');
        },

        validatePreparedTaskDelete(input: NativeTaskDeleteEnvelope): NativeHostResult<NativeTaskDeleteResult> {
            const envelope = readPreparedTaskDelete(input);
            return envelope ? { ok: true, value: envelope.prepared.result }
                : fail('INVALID_INPUT', 'Prepared Task Delete request or journal does not match');
        },

        async commitPreparedTaskDelete(input: NativeTaskDeleteEnvelope): Promise<NativeHostResult<NativeTaskDeleteResult>> {
            const envelope = readPreparedTaskDelete(input);
            if (!envelope) return fail('INVALID_INPUT', 'Prepared Task Delete request or journal does not match');
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            return receipts.run(envelope.request.requestId, canonicalJSON(['preparedTaskDelete', envelope]), async () => {
                const board = envelope.prepared.board.prepared;
                const applied = await useTaskStore.getState().commitPreparedBoardTask({
                    kind: 'trashTask', before: board.before, after: board.after,
                    deviceIdToInitialize: board.deviceIdToInitialize, respectReadOnly: true,
                });
                if (!applied.success) return fail('STALE_REVISION', applied.error ?? 'Prepared Task Delete conflicts with saved data');
                return { ok: true, value: envelope.prepared.result };
            });
        },

        prepareTaskDeleteUndo(input: { request: NativeTaskDeleteUndoRequest; delete: NativeTaskDeleteEnvelope }): NativeHostResult<NativeTaskDeleteUndoPreparation> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const request = readTaskDeleteUndoRequest(input?.request);
            const deletion = readPreparedTaskDelete(input?.delete);
            if (!request || !deletion || request.deleteRequestId !== deletion.request.requestId)
                return fail('INVALID_INPUT', 'A confirmed Delete and new Undo UUID are required');
            const state = useTaskStore.getState();
            const before = state._tasksById.get(deletion.request.taskId);
            if (!before || !taskEditValuesEqual(before, deletion.prepared.board.prepared.after)
                || !before.deletedAt || before.purgedAt) return fail('STALE_REVISION', 'Delete was superseded');
            const device = ensureDeviceId(state.settings);
            const scope = restoreScope(before, state);
            const after: Task = { ...before, deletedAt: undefined,
                ...sanitizeRestoredTaskContainerReferences(before, {
                    _allProjects: scope.projects, _allSections: scope.sections, _allAreas: scope.areas,
                }), updatedAt: new Date().toISOString(), rev: nextRevision(before.rev), revBy: device.deviceId };
            const prepared = bounded({ version: 1, request, delete: deletion, before, after, scope,
                deviceIdBefore: state.settings.deviceId ?? null,
                deviceIdToInitialize: device.updated ? device.deviceId : null, result: { id: before.id } }) as NativePreparedTaskDeleteUndo | null;
            return prepared && readPreparedTaskDeleteUndo({ request, prepared })
                ? { ok: true, value: { kind: 'prepared', prepared } }
                : fail('INVALID_INPUT', 'Task Delete Undo could not produce a valid prepared journal');
        },

        validatePreparedTaskDeleteUndo(input: NativeTaskDeleteUndoEnvelope): NativeHostResult<{ id: string }> {
            const envelope = readPreparedTaskDeleteUndo(input);
            return envelope ? { ok: true, value: envelope.prepared.result }
                : fail('INVALID_INPUT', 'Prepared Task Delete Undo is malformed');
        },

        async commitPreparedTaskDeleteUndo(input: NativeTaskDeleteUndoEnvelope): Promise<NativeHostResult<{ id: string }>> {
            const envelope = readPreparedTaskDeleteUndo(input);
            if (!envelope) return fail('INVALID_INPUT', 'Prepared Task Delete Undo is malformed');
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            return receipts.run(envelope.request.requestId, canonicalJSON(['preparedTaskDeleteUndo', envelope]), async () => {
                const { before, after, deviceIdBefore, deviceIdToInitialize, result } = envelope.prepared;
                const applied = await useTaskStore.getState().commitPreparedBoardTask({
                    kind: 'restoreTask', before, after, deviceIdBefore, deviceIdToInitialize,
                });
                if (!applied.success) return fail('STALE_REVISION', applied.error ?? 'Prepared Task Delete Undo conflicts with saved data');
                return { ok: true, value: result };
            });
        },

        /**
         * One Board action. Reuse `requestId` to retry: a completed request writes nothing
         * again. A move and Delete are target-state, so a replay after a restart finds the
         * card where it asked and writes nothing; they send the card's `row.taskRevision`,
         * and a card that changed since is refused (STALE_REVISION). `changed` is false when
         * the store did not change; a request with nothing to write neither saves nor keeps
         * a receipt.
         */
        async runBoardAction(input: { requestId: string; action: NativeBoardAction }): Promise<NativeHostResult<NativeBoardActionResult>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isObjectRecord(input) || !isObjectRecord(input.action) || typeof input.requestId !== 'string' || !deps.requestIdPattern.test(input.requestId)) {
                return fail('INVALID_INPUT', 'A request UUID and an action are required');
            }
            const action = input.action as NativeBoardAction;
            const requestId = input.requestId;
            const payload = JSON.stringify(['board', action]);
            // The receipts come first: a request that is running or owes its save only saves.
            // A new request that is refused or has nothing to write returns at once: no save, no receipt.
            const known = entered.get(requestId);
            if (known === undefined) {
                const prepared = prepare(action, requestId);
                if ('result' in prepared) return prepared.result as NativeHostResult<NativeBoardActionResult>;
                entered.set(requestId, payload);
                if (entered.size > ENTERED_LIMIT) entered.delete(entered.keys().next().value!);
            }
            const outcome = await receipts.run(requestId, payload, () => {
                const prepared = prepare(action, requestId);
                return 'result' in prepared ? Promise.resolve(prepared.result) : prepared.write();
            });
            // A write that did not land leaves no receipt; another payload under a known ID was refused and changes nothing.
            if (!outcome.ok && outcome.error.code !== 'SAVE_FAILED' && (known === undefined || known === payload)) entered.delete(requestId);
            return outcome;
        },
    };
}
