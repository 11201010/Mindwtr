import { collectBulkTaskTokens, type BulkTaskTokenField, type BulkTaskTokenMode } from './bulk-task-tokens';
import { taskMatchesContextOrTagSelection, type ContextOrTagMatchMode } from './hierarchy-utils';
import { tFallback } from './i18n';
import { resolveNonDoneTaskSortBy } from './task-list-sort-options';
import { isTaskFinished } from './task-status';
import { getFrequentTaskTokens, getUsedTaskTokens } from './task-token-usage';
import { sortTasksBy } from './task-utils';
import type { AppSettings, Task, TaskSortBy, TaskStatus } from './types';

/**
 * The React Native Contexts screen: which active tasks it lists for the chosen
 * contexts and tags, its chips and their counts, the All/Any switch, the empty
 * state, and the bulk token pickers. The screen keeps only React state.
 */

/** The No context chip's selection value. */
export const CONTEXTS_NO_CONTEXT_TOKEN = '__no_context__';

/** The statuses the bulk bar offers, in its order. */
export const CONTEXTS_BULK_STATUSES = ['inbox', 'next', 'waiting', 'someday', 'done', 'reference'] as const satisfies readonly TaskStatus[];

export type ContextsViewFilterSection = {
    kind: 'contexts' | 'tags';
    tokens: string[];
};

const matchesSearch = (token: string, query: string): boolean => {
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery.length === 0 || token.toLowerCase().includes(normalizedQuery);
};

/** The chip sections the search box leaves: contexts, then tags; an empty section is dropped. */
export const buildContextsViewFilterSections = ({
    contextTokens,
    searchQuery,
    tagTokens,
}: {
    contextTokens: string[];
    searchQuery: string;
    tagTokens: string[];
}): ContextsViewFilterSection[] => {
    const contexts = contextTokens.filter((token) => matchesSearch(token, searchQuery));
    const tags = tagTokens.filter((token) => matchesSearch(token, searchQuery));
    return [
        ...(contexts.length > 0 ? [{ kind: 'contexts' as const, tokens: contexts }] : []),
        ...(tags.length > 0 ? [{ kind: 'tags' as const, tokens: tags }] : []),
    ];
};

export const taskHasContextOrTag = (task: Task): boolean => (
    (task.contexts?.length ?? 0) > 0 || (task.tags?.length ?? 0) > 0
);

/** The tokens a Contexts route parameter asks for. */
export function getContextsRouteTokens(token: string | string[] | undefined): string[] {
    if (Array.isArray(token)) return token.filter(Boolean);
    if (typeof token === 'string' && token.trim()) return [token];
    return [];
}

/** The selection a route opens with: No context alone, or each token once. */
export function selectContextsRouteTokens(requested: string[]): string[] {
    return requested.includes(CONTEXTS_NO_CONTEXT_TOKEN)
        ? [CONTEXTS_NO_CONTEXT_TOKEN]
        : Array.from(new Set(requested));
}

/** A token chip press: it replaces No context, otherwise toggles itself. */
export function toggleContextsToken(selected: string[], token: string): string[] {
    if (selected.includes(CONTEXTS_NO_CONTEXT_TOKEN)) return [token];
    return selected.includes(token) ? selected.filter((item) => item !== token) : [...selected, token];
}

/** The No context chip press: it turns itself on alone, or off. */
export function toggleContextsNoContext(selected: string[]): string[] {
    return selected.includes(CONTEXTS_NO_CONTEXT_TOKEN) ? [] : [CONTEXTS_NO_CONTEXT_TOKEN];
}

/** An empty selection matches with All. */
export function resolveContextsMatchMode(selected: string[], matchMode: ContextOrTagMatchMode): ContextOrTagMatchMode {
    return selected.length === 0 ? 'all' : matchMode;
}

export type ContextsViewModel = {
    /** The unfinished tasks the screen counts and lists from. */
    activeTasks: Task[];
    contextTokens: string[];
    tagTokens: string[];
    /** Every context and tag in use; none means the "No contexts found" empty state. */
    hasTokens: boolean;
    filterSections: ContextsViewFilterSection[];
    noContextSelected: boolean;
    /** The All chip's count. */
    allCount: number;
    /** The No context chip's count. */
    noContextCount: number;
    /** The token chips the search leaves, in order, with their counts. */
    tokenChips: { token: string; kind: ContextsViewFilterSection['kind']; count: number; selected: boolean }[];
    /** The All/Any switch shows for two or more tokens, never with No context. */
    showMatchMode: boolean;
    sortBy: TaskSortBy;
    /** The listed tasks, sorted. */
    tasks: Task[];
};

export function buildContextsViewModel({
    visibleTasks,
    settings,
    selectedTokens,
    matchMode,
    searchQuery,
}: {
    /** The area-visible store tasks (mobile's useVisibleTaskContext). */
    visibleTasks: Task[];
    settings: AppSettings | undefined;
    selectedTokens: string[];
    matchMode: ContextOrTagMatchMode;
    searchQuery: string;
}): ContextsViewModel {
    const activeTasks = visibleTasks.filter((task) => !isTaskFinished(task));
    const contextTokens = getUsedTaskTokens(activeTasks, (task) => task.contexts, { prefix: '@' });
    const tagTokens = getUsedTaskTokens(activeTasks, (task) => task.tags, { prefix: '#' });
    const filterSections = buildContextsViewFilterSections({ contextTokens, searchQuery, tagTokens });
    const noContextSelected = selectedTokens.includes(CONTEXTS_NO_CONTEXT_TOKEN);
    const filtered = noContextSelected
        ? activeTasks.filter((task) => !taskHasContextOrTag(task))
        : selectedTokens.length > 0
            ? activeTasks.filter((task) => taskMatchesContextOrTagSelection(task, selectedTokens, matchMode))
            : activeTasks;
    const sortBy = resolveNonDoneTaskSortBy(settings?.taskSortBy, settings);
    return {
        activeTasks,
        contextTokens,
        tagTokens,
        hasTokens: contextTokens.length + tagTokens.length > 0,
        filterSections,
        noContextSelected,
        allCount: activeTasks.length,
        noContextCount: activeTasks.filter((task) => !taskHasContextOrTag(task)).length,
        tokenChips: filterSections.flatMap((section) => section.tokens.map((token) => ({
            token,
            kind: section.kind,
            count: activeTasks.filter((task) => taskMatchesContextOrTagSelection(task, [token])).length,
            selected: selectedTokens.includes(token),
        }))),
        showMatchMode: selectedTokens.length > 1 && !noContextSelected,
        sortBy,
        tasks: sortTasksBy(filtered, sortBy),
    };
}

/** What the list shows when it has no rows. */
export function getContextsEmptyState(
    { hasTokens, selectedTokens }: { hasTokens: boolean; selectedTokens: string[] },
    t: (key: string) => string,
): { icon: 'tag' | 'check'; title: string; message: string } {
    if (!hasTokens) {
        return { icon: 'tag', title: t('contexts.noContexts').split('.')[0], message: t('contexts.noContexts') };
    }
    // ponytail: mobile names the No context selection by its internal token here; kept for parity.
    return {
        icon: 'check',
        title: t('contexts.noTasks'),
        message: selectedTokens.length > 0 ? `${t('contexts.noTasks')} ${selectedTokens.join(', ')}` : t('contexts.noTasks'),
    };
}

/** The All/Any switch: its label and option labels. */
export function getContextsMatchModeLabels(t: (key: string) => string): { label: string; all: string; any: string } {
    return {
        label: `${t('contexts.title')} & ${t('tags.title')}`,
        all: tFallback(t, 'common.all', 'All'),
        any: tFallback(t, 'filters.matchAny', 'Any'),
    };
}

/** Tokens the add pickers offer: the 12 most used, then every other one in use. */
export function getContextsAddTokenOptions(activeTasks: Task[], field: BulkTaskTokenField): string[] {
    const prefix = field === 'tags' ? '#' : '@';
    return Array.from(new Set([
        ...getFrequentTaskTokens(activeTasks, (task) => task[field], 12, { prefix }),
        ...getUsedTaskTokens(activeTasks, (task) => task[field], { prefix }),
    ]));
}

export type ContextsTokenPicker = {
    title: string;
    placeholder: string;
    tokens: string[];
    allowCustomValue: boolean;
    multiSelect: boolean;
};

/** The bulk bar button, and the picker title, for one token action. */
export function getContextsTokenPickerTitle(field: BulkTaskTokenField, action: BulkTaskTokenMode, t: (key: string) => string): string {
    if (field === 'contexts') return action === 'add' ? t('bulk.addContext') : t('bulk.removeContext');
    if (action === 'add') return t('bulk.addTag');
    const removeTag = t('bulk.removeTag');
    return removeTag === 'bulk.removeTag' ? 'Remove tag' : removeTag;
}

/** The bulk token picker for adding or removing tags or contexts on the selected tasks. */
export function getContextsTokenPicker({
    field,
    action,
    activeTasks,
    selectedIds,
    tasksById,
    t,
}: {
    field: BulkTaskTokenField;
    action: BulkTaskTokenMode;
    activeTasks: Task[];
    selectedIds: string[];
    tasksById: Record<string, Task>;
    t: (key: string) => string;
}): ContextsTokenPicker {
    return {
        title: getContextsTokenPickerTitle(field, action, t),
        placeholder: field === 'tags' ? t('taskEdit.tagsPlaceholder') : t('taskEdit.contextsPlaceholder'),
        tokens: action === 'add'
            ? getContextsAddTokenOptions(activeTasks, field)
            : collectBulkTaskTokens(selectedIds, tasksById, field),
        allowCustomValue: action === 'add',
        multiSelect: action === 'remove',
    };
}
