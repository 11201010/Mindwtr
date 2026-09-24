import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    buildContextsTokenIndex,
    buildContextsViewFilterSections,
    buildContextsViewModel,
    getContextsTokenCount,
    getContextsRouteTokens,
    selectContextsRouteTokens,
    taskHasContextOrTag,
    toggleContextsNoContext,
    toggleContextsToken,
} from './contexts-view-model';
import { configureDateFormatting } from './date';
import { taskMatchesContextOrTagSelection } from './hierarchy-utils';
import { loadTranslations } from './i18n/i18n-loader';
import {
    createArchiveCoreBackend,
    createContextsCoreBackend,
    createTrashCoreBackend,
    createWriteRecorder,
    loadListViewsFixture,
    observeHistory,
    readHistoryTabs,
    replayArchive,
    replayContexts,
    replayTrash,
    seedListViewsStore,
} from './list-views-model.replay';
import { flushPendingSave, resetForTests } from './store';
import type { Task } from './types';

const fixture = loadListViewsFixture();
/** The fixture minus the rendered text dump, which only the React Native capture checks. */
const frozen = (observations: Record<string, unknown>[]) => observations.map(({ text: _text, ...rest }) => rest);

describe('list views: core reproduces the React Native screens', () => {
    const originalTz = process.env.TZ;
    let t: (key: string) => string = (key) => key;
    beforeAll(async () => {
        process.env.TZ = fixture.contexts.timeZone;
        const english = await loadTranslations('en');
        t = (key) => english[key] ?? key;
    });
    afterAll(() => {
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });
    afterEach(async () => {
        vi.useRealTimers();
        configureDateFormatting();
        await flushPendingSave();
        resetForTests();
    });
    const freezeClock = (now: string) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(now));
    };

    it.each(fixture.contexts.scenarios.map((scenario) => [scenario.name, scenario] as const))('Contexts: "%s"', async (name, scenario) => {
        freezeClock(fixture.contexts.now);
        const recorder = createWriteRecorder();
        await seedListViewsStore(fixture.contexts, scenario, recorder);
        const observed = await replayContexts(createContextsCoreBackend(t), scenario, recorder);
        expect(observed).toEqual(frozen(fixture.contexts.observations[name]));
    });

    it.each(fixture.archive.scenarios.map((scenario) => [scenario.name, scenario] as const))('Archive: "%s"', async (name, scenario) => {
        freezeClock(fixture.archive.now);
        const recorder = createWriteRecorder();
        await seedListViewsStore(fixture.archive, scenario, recorder);
        const observed = await replayArchive(createArchiveCoreBackend(t), scenario, recorder, t);
        expect(observed).toEqual(frozen(fixture.archive.observations[name]));
    });

    it.each(fixture.trash.scenarios.map((scenario) => [scenario.name, scenario] as const))('Trash: "%s"', async (name, scenario) => {
        freezeClock(fixture.trash.now);
        const recorder = createWriteRecorder();
        await seedListViewsStore(fixture.trash, scenario, recorder);
        // What mobile's root layout applies; the capture pinned the device locale.
        const settings = fixture.trash.settings[scenario.settings];
        configureDateFormatting({ language: 'en', dateFormat: settings.dateFormat, calendarSystem: settings.calendarSystem, timeFormat: settings.timeFormat, systemLocale: 'en-US' });
        const observed = await replayTrash(createTrashCoreBackend(t), scenario, recorder);
        expect(observed).toEqual(frozen(fixture.trash.observations[name]));
    });

    it('History: opens and switches tabs as mobile does', () => {
        const tabs = readHistoryTabs((key) => ({ 'nav.done': 'Done', 'nav.archived': 'Archived' }[key] ?? key));
        expect(fixture.history.observations.map(({ tab }) => observeHistory(tab, tabs))).toEqual(fixture.history.observations);
    });
});

describe('contexts view filters', () => {
    const task = (overrides: Partial<Task> = {}): Task => ({
        id: 'task-1', title: 'Task', status: 'next', contexts: [], tags: [],
        createdAt: '2026-06-30T00:00:00.000Z', updatedAt: '2026-06-30T00:00:00.000Z', ...overrides,
    });

    it('keeps context and tag sections separate and filters each by the search', () => {
        expect(buildContextsViewFilterSections({ contextTokens: ['@home', '@work'], searchQuery: '', tagTokens: ['#errand'] })).toEqual([
            { kind: 'contexts', tokens: ['@home', '@work'] },
            { kind: 'tags', tokens: ['#errand'] },
        ]);
        expect(buildContextsViewFilterSections({ contextTokens: ['@home', '@work'], searchQuery: 'work', tagTokens: ['#workshop'] })).toEqual([
            { kind: 'contexts', tokens: ['@work'] },
            { kind: 'tags', tokens: ['#workshop'] },
        ]);
        expect(buildContextsViewFilterSections({ contextTokens: ['@home'], searchQuery: 'bug', tagTokens: ['#bug'] })).toEqual([
            { kind: 'tags', tokens: ['#bug'] },
        ]);
    });

    it('matches a chip against both token fields, with child tokens', () => {
        const item = task({ contexts: ['@work/deep'], tags: ['#client/acme'] });
        expect(taskHasContextOrTag(item)).toBe(true);
        expect(taskHasContextOrTag(task())).toBe(false);
        expect(taskMatchesContextOrTagSelection(item, ['@work'])).toBe(true);
        expect(taskMatchesContextOrTagSelection(item, ['#client'])).toBe(true);
        expect(taskMatchesContextOrTagSelection(item, ['@phone'])).toBe(false);
    });

    it('counts each chip like the chip filter, once per task', () => {
        const tasks = [
            task({ id: 'a', contexts: ['@work/deep', '@work'], tags: ['#a//b', '#x/'] }),
            task({ id: 'b', contexts: ['@work/deeper'], tags: ['#a'] }),
            task({ id: 'c', contexts: [], tags: ['#x'] }),
            task({ id: 'd', status: 'done', contexts: ['@work'] }),
        ];
        const index = buildContextsTokenIndex(tasks);
        const active = tasks.filter((entry) => entry.status !== 'done');
        for (const token of ['@work', '@work/', '@work/deep', '@work/dee', '#a', '#a/', '#a//b', '#x', '#x/', '@none']) {
            expect([token, getContextsTokenCount(index, token)])
                .toEqual([token, active.filter((entry) => taskMatchesContextOrTagSelection(entry, [token])).length]);
        }
    });

    // ponytail: one wall-clock bound on a busy machine; the growth it guards against was 17 s at 5,000 tasks.
    it('derives Contexts for 5,000 tasks with distinct tokens within the search/filter/sort budget', () => {
        const tasks = Array.from({ length: 5000 }, (_, index) => task({
            id: `perf-${index}`,
            title: `Task ${index}`,
            contexts: [`@place-${index}/room-${index % 7}`],
            tags: [`#tag-${index}`, `#area-${index % 50}/topic-${index}`],
        }));
        let best = Number.POSITIVE_INFINITY;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const started = performance.now();
            const index = buildContextsTokenIndex(tasks);
            for (const selectedTokens of [[], ['#tag-42'], ['#area-3', '@place-7']]) {
                const model = buildContextsViewModel({ index, settings: {}, selectedTokens, matchMode: 'any', searchQuery: '' });
                expect(model.tokenChips.length).toBe(15000);
            }
            best = Math.min(best, performance.now() - started);
        }
        // docs/performance/budgets.md: search/filter/sort derivation, 130 ms at 10k tasks.
        expect(best).toBeLessThan(130);
    });

    it('keeps No context exclusive and reads route tokens', () => {
        expect(toggleContextsToken(['__no_context__'], '@home')).toEqual(['@home']);
        expect(toggleContextsToken(['@home', '#a'], '@home')).toEqual(['#a']);
        expect(toggleContextsNoContext(['@home'])).toEqual(['__no_context__']);
        expect(toggleContextsNoContext(['__no_context__'])).toEqual([]);
        expect(getContextsRouteTokens(['@a', '', '@b'])).toEqual(['@a', '@b']);
        expect(getContextsRouteTokens('  ')).toEqual([]);
        expect(selectContextsRouteTokens(['@a', '@a', '#b'])).toEqual(['@a', '#b']);
        expect(selectContextsRouteTokens(['@a', '__no_context__'])).toEqual(['__no_context__']);
    });
});
