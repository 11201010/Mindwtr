/**
 * A saved search's screen as React Native shows it (the More sheet's saved
 * searches): the tasks its query finds in the chosen areas, sorted as the task
 * lists sort, its header, its delete confirmation and its empty state. Mobile's
 * saved-search/[id].tsx renders this model, and the native host contract serves
 * it (native-host-contract-saved-search.ts).
 */
import { taskMatchesAreaFilterSelection, type AreaFilterSelection } from './area-filter';
import { tFallback } from './i18n';
import { filterTasksBySearch } from './search';
import { useTaskStore } from './store';
import { sortTasksBy } from './task-utils';
import type { Area, Project, SavedSearch, Task, TaskSortBy } from './types';

type Translate = (key: string) => string;

export type SavedSearchScreenText = {
    /** The saved search's name; "Saved Searches" when it is gone (or has no name). */
    title: string;
    /** The query under the title; empty when there is none to show. */
    query: string;
    /** Delete asks first; null when the saved search is gone. */
    deleteAction: {
        label: string;
        confirm: { title: string; message: string; cancelLabel: string; confirmLabel: string };
    } | null;
    /** The empty list's line; `actions` (go to the Inbox, go back) only when the saved search is gone. */
    empty: { message: string; actions: { inboxLabel: string; backLabel: string } | null };
};

export function findSavedSearch(savedSearches: readonly SavedSearch[] | undefined, id: string): SavedSearch | undefined {
    return savedSearches?.find((search) => search.id === id);
}

/** The saved searches without `id`: what Delete stores. */
export function removeSavedSearch(savedSearches: readonly SavedSearch[] | undefined, id: string): SavedSearch[] {
    return (savedSearches || []).filter((search) => search.id !== id);
}

/**
 * Delete a saved search by its ID, against the saved searches as they are when the
 * write runs: every other one stays the stored object. False, with nothing written,
 * when no saved search has that ID.
 */
export async function deleteSavedSearchById(id: string): Promise<boolean> {
    const { settings, updateSettings } = useTaskStore.getState();
    if (!findSavedSearch(settings.savedSearches, id)) return false;
    // updateSettings applies its change before its first await: nothing lands between this read and the write.
    await updateSettings({ savedSearches: removeSavedSearch(settings.savedSearches, id) });
    return true;
}

/**
 * The tasks a saved search's query finds among the visible tasks, in the chosen
 * areas, sorted by `sortBy`. A blank query finds nothing.
 */
export function selectSavedSearchTasks(input: {
    query: string;
    tasks: Task[];
    projects: Project[];
    areaFilter: AreaFilterSelection;
    areaById: Map<string, Area>;
    sortBy: TaskSortBy;
}): Task[] {
    if (!input.query) return [];
    const projectMap = new Map(input.projects.map((project) => [project.id, project]));
    return sortTasksBy(
        filterTasksBySearch(input.tasks, input.projects, input.query).filter((task) => (
            taskMatchesAreaFilterSelection(task, input.areaFilter, projectMap, input.areaById)
        )),
        input.sortBy,
    );
}

export function buildSavedSearchScreenText(input: {
    savedSearch: SavedSearch | undefined;
    savedSearches: readonly SavedSearch[] | undefined;
    t: Translate;
}): SavedSearchScreenText {
    const { savedSearch, t } = input;
    const hasAnySavedSearches = (input.savedSearches?.length ?? 0) > 0;
    return {
        title: savedSearch?.name || t('search.savedSearches'),
        query: savedSearch?.query || '',
        deleteAction: savedSearch ? {
            label: t('common.delete'),
            confirm: {
                title: t('common.delete'),
                message: tFallback(t, 'search.deleteConfirm', `Delete "${savedSearch.name}"?`),
                cancelLabel: t('common.cancel'),
                confirmLabel: t('common.delete'),
            },
        } : null,
        empty: {
            message: savedSearch || hasAnySavedSearches ? t('search.noResults') : t('search.noSavedSearches'),
            actions: savedSearch ? null : { inboxLabel: t('nav.inbox'), backLabel: t('common.back') },
        },
    };
}
