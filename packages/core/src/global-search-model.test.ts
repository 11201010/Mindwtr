import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { computeGlobalSearchResults } from './global-search-filter';
import { createSearchHighlighter } from './search-highlight';
import { getGlobalSearchResultDate } from './global-search-model';
import { clearGlobalSearchActiveChip, fetchGlobalSearchAdapterResults, getGlobalSearchActiveChips, getGlobalSearchFilterOptions, getGlobalSearchTaskListTarget, resolveSavedSearch, shouldRequestGlobalSearchFts, DEFAULT_GLOBAL_SEARCH_FILTERS, type GlobalSearchFilterState } from './global-search-model';
import type { Area, Project, Task } from './types';

const fixture = JSON.parse(readFileSync(new URL('./global-search-model-parity.fixtures.json', import.meta.url), 'utf8')) as {
    now: string;
    tasks: Task[];
    projects: Project[];
    areas: Area[];
    optionLabels: string[];
    cases: Record<string, unknown>;
    extendedCases: Record<string, any>;
};
const t = (key: string) => ({
    'search.includeCompleted': 'search.includeCompleted',
    'search.includeReference': 'search.includeReference',
}[key] ?? key);
const filters = (patch: Partial<GlobalSearchFilterState> = {}): GlobalSearchFilterState => ({
    ...DEFAULT_GLOBAL_SEARCH_FILTERS, ...patch,
});
const results = (query: string, state: GlobalSearchFilterState, ftsResults?: { tasks: Task[]; projects: Project[] }) =>
    computeGlobalSearchResults({ query, tasks: fixture.tasks, projects: fixture.projects, areas: fixture.areas,
        ...state, ftsResults, ftsQuery: query.trim() }).results;

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(fixture.now));
});
afterAll(() => vi.useRealTimers());

it('matches the frozen HEAD RN result list for text, empty query, and every filter family', () => {
    expect(results('Launch', filters())).toEqual(fixture.cases.query);
    expect(results('', filters())).toEqual(fixture.cases.empty);
    expect(results('Launch', filters({ selectedStatuses: ['done'] }))).toEqual(fixture.cases.status);
    expect(results('', filters({ selectedTokens: ['#client'] }))).toEqual(fixture.cases.token);
    expect(results('', filters({ duePreset: 'today' }))).toEqual(fixture.cases.due);
    expect(results('Launch', filters({ scope: 'projects' }))).toEqual(fixture.cases.scope);
    expect(results('Launch', filters({ selectedArea: 'area-work' }))).toEqual(fixture.cases.area);
    expect(results('Launch', filters({ includeCompleted: true }))).toEqual(fixture.cases.includeCompleted);
    expect(results('Launch', filters({ includeReference: false }))).toEqual(fixture.cases.hideReference);
    expect(results('', filters({ locationQuery: 'Office' }))).toEqual(fixture.cases.location);
    expect(results('', filters({ hideFutureTasks: true }))).toEqual(fixture.cases.hideFuture);
    expect(results('Launch', filters())).toEqual(fixture.cases.noAdapter);
    expect(results('Launch', filters(), { tasks: [fixture.tasks[5], fixture.tasks[0]], projects: [] })[1])
        .toMatchObject({ type: 'task', item: { id: 'home' } });
});

it('shares RN filter options, token order, active chips, and adapter fallback', async () => {
    const options = getGlobalSearchFilterOptions(fixture.tasks, fixture.areas, t);
    expect([
        ...options.due.map(({ label }) => label),
        ...options.tokens,
        options.include.completed, options.include.reference, options.include.hideFutureTasks,
        ...options.statuses.map(({ label }) => label),
        ...options.scope.map(({ label }) => label),
        ...options.areas.map(({ label }) => label),
    ]).toEqual(fixture.optionLabels);
    expect(options.statuses.map(({ value }) => value)).toEqual(['inbox', 'next', 'waiting', 'someday', 'done', 'reference', 'archived']);
    expect(options.due.map(({ value }) => value)).toEqual(['any', 'overdue', 'today', 'tomorrow', 'this_week', 'next_week', 'none']);
    expect(options.scope.map(({ value }) => value)).toEqual(['all', 'projects', 'tasks', 'project_tasks']);
    expect(options.areas.map(({ value }) => value)).toEqual(['all', 'none', 'area-work']);
    expect(options.tokens).toContain('#client');
    expect(options.tokens).toContain('@office');
    expect(options.tokens).toEqual([...options.tokens].sort());
    expect(getGlobalSearchActiveChips(filters({ selectedStatuses: ['done'], selectedTokens: ['#client'],
        selectedArea: 'area-work', duePreset: 'today', scope: 'tasks', hideFutureTasks: true }), fixture.areas, t)
        .map(({ key }) => key)).toEqual(['status:done', 'area:area-work', 'token:#client', 'due:today', 'scope:tasks', 'hideFutureTasks']);
    const selected = filters({ selectedStatuses: ['done'], selectedTokens: ['#client'] });
    expect(clearGlobalSearchActiveChip(selected, 'status:done').selectedStatuses).toEqual([]);
    expect(clearGlobalSearchActiveChip(selected, 'token:#client').selectedTokens).toEqual([]);
    expect(getGlobalSearchTaskListTarget({ id: 'missing', title: 'Missing', status: 'done' })).toEqual({ route: '/done', projectId: null });
    expect(getGlobalSearchTaskListTarget({ id: 'missing', title: 'Missing', status: 'next', projectId: 'project-launch' }))
        .toEqual({ route: '/projects-screen', projectId: 'project-launch' });
    expect(shouldRequestGlobalSearchFts('Launch')).toBe(true);
    expect(shouldRequestGlobalSearchFts('status:done')).toBe(false);
    expect(await fetchGlobalSearchAdapterResults('Launch')).toBeNull();
    expect(await fetchGlobalSearchAdapterResults('Launch', async () => { throw Error('offline'); })).toBeNull();
});

it('reuses an exact saved query and trims a new search', () => {
    const saved = [{ id: 'old', name: 'Custom name', query: 'Launch' }];
    expect(resolveSavedSearch(saved, ' Launch ', 'Another name', 'new'))
        .toEqual({ search: saved[0], existing: true });
    expect(resolveSavedSearch(saved, ' Home ', '  My home  ', 'new'))
        .toEqual({ search: { id: 'new', name: 'My home', query: 'Home' }, existing: false });
});

it('matches the extended HEAD RN fixture for adapter order, presets, scopes, chips, dates, highlights, and the 50-row window', () => {
    const summary = (query: string, patch: Partial<GlobalSearchFilterState> = {}, extra = {}) => {
        const result = computeGlobalSearchResults({ query, tasks: fixture.tasks, projects: fixture.projects,
            areas: fixture.areas, ...filters(patch), ...extra });
        return { ids: result.results.map((entry) => `${entry.type}:${entry.item.id}`),
            totalResults: result.totalResults, totalResultsLabel: result.totalResultsLabel,
            isTruncated: result.isTruncated, hiddenCompletedCount: result.hiddenCompletedCount,
            hasActiveFilters: result.hasActiveFilters };
    };
    const captured = fixture.extendedCases;
    expect(summary('Launch', {}, { ftsResults: { tasks: [fixture.tasks[5], fixture.tasks[0]], projects: [] }, ftsQuery: 'Launch' }))
        .toEqual(captured.adapter);
    expect(summary('Launch', {}, { ftsResults: { tasks: [fixture.tasks[0]], projects: [], limited: true, limit: 200 }, ftsQuery: 'Launch' }))
        .toMatchObject({ totalResultsLabel: '200+', isTruncated: true });
    for (const duePreset of ['any', 'overdue', 'today', 'tomorrow', 'this_week', 'next_week', 'none'] as const) {
        expect(summary('', { duePreset })).toEqual(captured.duePresets[duePreset]);
    }
    for (const scope of ['all', 'projects', 'tasks', 'project_tasks'] as const) {
        expect(summary('Launch', { scope })).toEqual(captured.scopes[scope]);
    }
    expect(summary('Launch', { selectedArea: 'none' })).toEqual(captured.areaNone);
    expect(summary('id:launch-done')).toEqual(captured.idOperator);
    expect(summary('status:done')).toEqual(captured.statusOperator);
    const labels = {
        'taskEdit.areaLabel': 'Area', 'taskEdit.noAreaOption': 'No Area',
        'taskEdit.locationLabel': 'Location', 'status.done': 'Done',
        'search.includeCompleted': 'Include completed', 'search.includeReference': 'Include reference',
        'search.completedDate': 'Completed {date}', 'search.cancelledDate': 'Cancelled {date}',
        'search.dueDate': 'Due {date}',
    } as Record<string, string>;
    const translate = (key: string) => labels[key] ?? key;
    expect(getGlobalSearchActiveChips(filters({ selectedStatuses: ['done'], selectedArea: 'area-work',
        selectedTokens: ['#client'], locationQuery: 'Office', duePreset: 'today', scope: 'tasks',
        includeCompleted: true, includeReference: false, hideFutureTasks: true }), fixture.areas, translate)
        .map(({ label }) => label)).toEqual(captured.allChips);
    const dated = [
        { ...fixture.tasks[0], id: 'overdue-date', dueDate: '2020-01-01' },
        { ...fixture.tasks[1], id: 'done-date', completedAt: '2026-06-01T12:00:00.000Z' },
        { ...fixture.tasks[1], id: 'done-no-date', completedAt: undefined },
        { ...fixture.tasks[1], id: 'cancelled-date', status: 'archived' as const, cancelledAt: '2026-06-02T12:00:00.000Z' },
    ];
    expect(Object.fromEntries(dated.map((task) => [task.id, getGlobalSearchResultDate(task, translate, (value) => value)])))
        .toEqual(captured.dates);
    expect(createSearchHighlighter('Launch plan')('Launch plan')).toEqual(captured.highlights);
    const bulkTasks = Array.from({ length: 55 }, (_, index) => ({ ...fixture.tasks[0], id: `bulk-${index}`, title: `Bulk ${index}` }));
    const bulk = computeGlobalSearchResults({ query: 'Bulk', tasks: bulkTasks, projects: [], areas: [], ...filters() });
    expect({ ids: bulk.results.map((entry) => entry.item.id), totalResults: bulk.totalResults,
        totalResultsLabel: bulk.totalResultsLabel, isTruncated: bulk.isTruncated }).toEqual(captured.overFifty);
});
