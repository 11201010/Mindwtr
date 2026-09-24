import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadTranslations } from './i18n/i18n-loader';
import {
    createWriteRecorder,
    loadMenuViewsFixture,
    projectObservation,
    replayMenuViewsScenario,
    seedMenuViewsStore,
} from './menu-views-model.replay';
import { applyListFilterEdit, EMPTY_LIST_FILTER_STATE, resolveListFilterState } from './list-filter-state';
import { buildMoreMenuModel, resolveMobileQuickAccessView } from './more-menu-model';
import { createNativeHostContract } from './native-host-contract';
import { moveSomedaySection, planSomedaySectionCreate, planSomedaySectionMove, renameSomedaySection } from './someday-sections-model';
import { resetForTests } from './store';
import type { Task } from './types';

const fixture = loadMenuViewsFixture();

describe('list views parity with the frozen React Native fixture', () => {
    const originalTz = process.env.TZ;
    let t: (key: string) => string = (key) => key;
    beforeAll(async () => {
        process.env.TZ = fixture.timeZone;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(fixture.now));
        const strings = await loadTranslations('en');
        t = (key) => strings[key] ?? key;
    });
    afterAll(() => {
        vi.useRealTimers();
        resetForTests();
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });

    const expected = (name: string, screen: Parameters<typeof projectObservation>[0]) => (
        fixture.observations[name].map((observation) => projectObservation(screen, observation, t))
    );

    it('was captured from React Native before the screens changed', () => {
        expect(fixture.provenance.capturedAt).toMatch(/^[0-9a-f]{40}$/);
        expect(fixture.scenarios.length).toBe(Object.keys(fixture.observations).length);
    });

    for (const scenario of fixture.scenarios) {
        it(`core reproduces "${scenario.name}"`, async () => {
            const recorder = createWriteRecorder();
            await seedMenuViewsStore(fixture, scenario, recorder);
            const observed = await replayMenuViewsScenario({ fixture, scenario, recorder, t });
            expect(observed.map((observation) => projectObservation(scenario.screen, observation, t)))
                .toEqual(expected(scenario.name, scenario.screen));
        });
    }

    for (const scenario of fixture.scenarios) {
        it(`the native host contract reproduces "${scenario.name}"`, async () => {
            const recorder = createWriteRecorder();
            await seedMenuViewsStore(fixture, scenario, recorder);
            const contract = createNativeHostContract();
            expect((await contract.setLanguage({ storedLanguage: 'en', systemLocale: null })).ok).toBe(true);
            expect((await contract.activate({ writeSafetyReady: true })).ok).toBe(true);
            recorder.log.splice(0);
            const observed = await replayMenuViewsScenario({ fixture, scenario, recorder, t, contract });
            expect(observed.map((observation) => projectObservation(scenario.screen, observation, t)))
                .toEqual(expected(scenario.name, scenario.screen));
        });
    }
});

describe('list view models', () => {
    const t = (key: string) => key;

    it('resolves an unknown quick-access view to Review and gives its tile to Projects', () => {
        expect(resolveMobileQuickAccessView('trash')).toBe('review');
        const menu = buildMoreMenuModel({ quickAccessView: 'calendar', savedSearches: [], t });
        expect(menu.primary.map((item) => item.id)).toEqual(['waiting', 'someday', 'review', 'reference', 'contexts', 'projects']);
    });

    it('cycles a token through included, excluded and neutral, and prunes what the view stops offering', () => {
        const included = applyListFilterEdit(EMPTY_LIST_FILTER_STATE, { type: 'toggleToken', value: '#a' });
        const excluded = applyListFilterEdit(included, { type: 'toggleToken', value: '#a' });
        expect([included.tokens, excluded.excludedTokens]).toEqual([['#a'], ['#a']]);
        expect(applyListFilterEdit(excluded, { type: 'toggleToken', value: '#a' })).toEqual(EMPTY_LIST_FILTER_STATE);
        const resolved = resolveListFilterState(
            { ...EMPTY_LIST_FILTER_STATE, tokens: ['#gone'], priorities: ['high'] },
            { visibility: { energyLevel: false, location: false, priority: false, timeEstimate: false }, retainTokens: ['#a'], t },
        );
        expect(resolved.state.tokens).toEqual([]);
        expect(resolved.state.priorities).toEqual([]);
        expect(resolved.activeCount).toBe(0);
    });

    it('plans Someday section edits without touching other definitions', () => {
        const stored = [{ id: 'b', title: 'B', order: 1 }, { id: 'a', title: 'A', order: 0 }];
        expect(planSomedaySectionCreate(stored, ' a ')).toEqual({ kind: 'existing', id: 'a' });
        expect(planSomedaySectionCreate(stored, 'C', () => 'c')).toEqual({
            kind: 'create', id: 'c', sections: [...[...stored].reverse(), { id: 'c', title: 'C', order: 2 }],
        });
        expect(renameSomedaySection(stored, 'a', '  ')).toBeNull();
        expect(moveSomedaySection(stored, 'a', -1)).toBeNull();
        expect(moveSomedaySection(stored, 'a', 1)?.map(({ id, order }) => [id, order])).toEqual([['b', 0], ['a', 1]]);
    });

    it('keeps the first attempt\'s Undo when a failed move is retried', () => {
        const task = { id: 's', title: 'S', status: 'someday', tags: [], contexts: [], createdAt: '', updatedAt: '' } as Task;
        const moved = { ...task, viewSectionIds: { someday: 'x' } };
        const pending = { ids: ['s'], destination: 'x', previous: [{ id: 's', sectionId: 'old' }] };
        expect(planSomedaySectionMove({ ids: ['s'], tasks: [moved], destination: 'x', pending }))
            .toEqual({ updates: [], previous: [{ id: 's', sectionId: 'old' }], resumed: true });
        expect(planSomedaySectionMove({ ids: ['s'], tasks: [task], destination: 'x' }).previous).toEqual([{ id: 's', sectionId: undefined }]);
    });
});
