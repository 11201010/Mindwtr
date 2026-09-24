import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadTranslations } from './i18n/i18n-loader';
import { createNativeHostContract } from './native-host-contract';
import {
    loadQuickCaptureFixture,
    projectQuickCaptureObservation,
    replayQuickCaptureScenario,
    seedQuickCaptureStore,
} from './quick-capture-model.replay';
import {
    applyQuickCaptureEdit,
    createQuickCaptureOptions,
    normalizeQuickCaptureContext,
    parseQuickCaptureContextQuery,
    type QuickCaptureEdit,
    type QuickCaptureOptions,
} from './quick-capture-model';
import { resetForTests } from './store';

const fixture = loadQuickCaptureFixture();
// The contract serves the tab bar's popup, which opens with no preset.
const contractScenarios = fixture.scenarios.filter((scenario) => !scenario.initialProps && scenario.initialValue === undefined);

describe('capture popup parity with the frozen React Native fixture', () => {
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

    const expected = (name: string) => fixture.observations[name].map(projectQuickCaptureObservation);

    it('was captured from React Native before the popup changed', () => {
        expect(fixture.provenance.capturedAt).toMatch(/^[0-9a-f]{40}$/);
        expect(fixture.scenarios.length).toBe(Object.keys(fixture.observations).length);
        // Only scenarios the tab bar cannot open (a preset from another screen) skip the contract.
        expect(contractScenarios.length).toBeGreaterThanOrEqual(fixture.scenarios.length - 6);
    });

    for (const scenario of fixture.scenarios) {
        it(`core reproduces "${scenario.name}"`, async () => {
            const recorder = await seedQuickCaptureStore(fixture, scenario);
            const observed = await replayQuickCaptureScenario({ fixture, scenario, recorder, t });
            expect(observed).toEqual(expected(scenario.name));
        });
    }

    for (const scenario of contractScenarios) {
        it(`the native host contract reproduces "${scenario.name}"`, async () => {
            const recorder = await seedQuickCaptureStore(fixture, scenario);
            const contract = createNativeHostContract();
            expect((await contract.setLanguage({ storedLanguage: 'en', systemLocale: null })).ok).toBe(true);
            expect((await contract.activate({ writeSafetyReady: true })).ok).toBe(true);
            recorder.log.splice(0);
            const observed = await replayQuickCaptureScenario({ fixture, scenario, recorder, t, contract });
            expect(observed).toEqual(expected(scenario.name));
        });
    }
});

describe('capture popup model', () => {
    const context = {
        settings: {}, focusedCount: 0, defaultAreaId: 'a-home', contextChoices: ['@Phone'], t: (key: string) => key, now: new Date(2026, 8, 23, 10, 0),
    };
    const options = createQuickCaptureOptions({ projects: [], defaultAreaId: null });
    const edit = (current: QuickCaptureOptions, change: QuickCaptureEdit) => applyQuickCaptureEdit(current, change, context)!.options;

    it('normalizes picker contexts and splits the query on commas', () => {
        expect(normalizeQuickCaptureContext(' @Work ')).toBe('@Work');
        expect(normalizeQuickCaptureContext('＠home')).toBe('@home');
        expect(normalizeQuickCaptureContext('@@')).toBe('');
        expect(parseQuickCaptureContextQuery(' @work,home,@Work,, ＠errands ')).toEqual(['@work', '@home', '@errands']);
        // "Add" keeps a choice's spelling and skips what is already chosen.
        expect(edit({ ...options, contexts: ['@home'] }, { type: 'addContexts', query: 'phone, HOME, desk' }).contexts)
            .toEqual(['@home', '@Phone', '@desk']);
    });

    it('keeps a chosen time when the day changes, and clears it to local midnight', () => {
        const timed = edit(edit(options, { type: 'setDueDay', day: '2026-10-05' }), { type: 'setDueTime', time: '15:30' });
        expect(timed).toMatchObject({ dueDate: new Date(2026, 9, 5, 15, 30).toISOString(), dueDateHasTime: true });
        expect(edit(timed, { type: 'setDueDay', day: '2026-10-09' }).dueDate).toBe(new Date(2026, 9, 9, 15, 30).toISOString());
        expect(edit(timed, { type: 'clearDueTime' })).toMatchObject({ dueDate: new Date(2026, 9, 5).toISOString(), dueDateHasTime: false });
        expect(edit(options, { type: 'setDueTime', time: '07:00' }).dueDate).toBe(new Date(2026, 8, 23, 7, 0).toISOString());
        expect(applyQuickCaptureEdit(options, { type: 'setDueTime', time: '7:00' }, context)).toBeNull();
    });

    it('keeps one container: a project clears the area, and resetting the project restores the default area', () => {
        const inProject = edit({ ...options, areaId: 'a-work' }, { type: 'selectProject', projectId: 'p-launch' });
        expect(inProject).toMatchObject({ projectId: 'p-launch', areaId: null });
        expect(edit(inProject, { type: 'resetProject' })).toMatchObject({ projectId: null, areaId: 'a-home' });
        expect(edit(inProject, { type: 'selectArea', areaId: 'a-work' })).toMatchObject({ projectId: null, areaId: 'a-work' });
        expect(edit(inProject, { type: 'selectArea', areaId: null })).toMatchObject({ projectId: 'p-launch', areaId: null });
    });
});
