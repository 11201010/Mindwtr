import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOCUS_CONTROL_STATE, type FocusControlState } from './focus-controls';
import { focusControlsWrites, loadFocusControlsFixture, seedFocusControlsStore } from './focus-controls.replay';
import { loadTranslations } from './i18n/i18n-loader';
import { createNativeHostContract } from './native-host-contract';
import { flushPendingSave, resetForTests, useTaskStore } from './store';
import { generateUUID } from './uuid';

const fixture = loadFocusControlsFixture();
const scenario = (settings: string) => fixture.scenarios.find((entry) => entry.settings === settings && !entry.taskIds)!;
type Host = ReturnType<typeof createNativeHostContract>;
type Request = Parameters<Host['setFocusGroupChecked']>[0];
const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

describe('native checked Focus grouping', () => {
    let english: Record<string, string>;
    beforeAll(async () => { english = await loadTranslations('en'); });
    afterEach(async () => {
        vi.useRealTimers();
        await flushPendingSave();
        resetForTests();
        vi.restoreAllMocks();
    });

    const open = async (settings = 'base', saveData?: (data: unknown) => Promise<void>) => {
        await seedFocusControlsStore(fixture, scenario(settings), { saveData });
        const host = createNativeHostContract();
        expect(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' })).toMatchObject({ ok: true });
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
        focusControlsWrites().length = 0;
        return host;
    };
    const request = (host: Host, groupBy: Request['groupBy'], controls: FocusControlState = DEFAULT_FOCUS_CONTROL_STATE): Request => {
        const options = value(host.getFocusGroupOptions({ controls }));
        return { requestId: generateUUID(), controls: options.controls, groupBy, expected: options.expected };
    };

    it('offers the RN choices and preserves raw missing and legacy values', async () => {
        const host = await open('prioritiesOff');
        const options = value(host.getFocusGroupOptions({ controls: DEFAULT_FOCUS_CONTROL_STATE }));
        expect(options.expected).toEqual({ groupBy: 'priority', updatedAt: null });
        expect(options.choices.map(({ value: choice }) => choice)).not.toContain('priority');
        expect(options.choices.find((choice) => choice.value === 'none')?.selected).toBe(true);
        expect(options.choices.find((choice) => choice.value === 'context')?.label).toBe(english['focus.group.context']);
        expect(value(await host.setFocusGroupChecked(request(host, 'priority'))).groupBy).toBe('priority');
        const effectiveNoop = request(host, 'none');
        expect(host.probeFocusGroupOutcome(effectiveNoop)).toMatchObject({ ok: true, value: { groupBy: 'none' } });
        expect(value(await host.setFocusGroupChecked(effectiveNoop)).groupBy).toBe('none');
        expect(useTaskStore.getState().settings.gtd?.focusGroupBy).toBe('priority');
        useTaskStore.setState((state) => ({ settings: { ...state.settings, gtd: { ...state.settings.gtd, focusGroupBy: 'none' } } }));
        const invalid = request(host, 'priority');
        expect(await host.setFocusGroupChecked(invalid)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        useTaskStore.setState((state) => ({ settings: { ...state.settings, gtd: { ...state.settings.gtd, focusGroupBy: 'legacy' as never } } }));
        expect(value(host.getFocusGroupOptions({ controls: DEFAULT_FOCUS_CONTROL_STATE })).expected.groupBy).toBe('legacy');
        useTaskStore.setState((state) => ({ settings: { ...state.settings, gtd: { ...state.settings.gtd, focusGroupBy: 9 as never } } }));
        expect(host.getFocusGroupOptions({ controls: DEFAULT_FOCUS_CONTROL_STATE })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('writes one GTD scalar, detaches a saved filter, and preserves unrelated data', async () => {
        const host = await open();
        const state = useTaskStore.getState();
        const before = structuredClone({ tasks: state._allTasks, projects: state._allProjects, sections: state._allSections,
            areas: state._allAreas, people: state._allPeople, savedFilters: state.settings.savedFilters });
        const controls = { ...DEFAULT_FOCUS_CONTROL_STATE, sortBy: 'due' as const, savedFilterId: 'sf-phone' };
        const input = request(host, 'context', controls);
        expect(value(await host.setFocusGroupChecked(input))).toEqual({ groupBy: 'context', controls: { ...controls, savedFilterId: null } });
        expect(await host.setFocusGroupChecked({ ...input, controls: { ...controls, savedFilterId: 'sf-work' } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(useTaskStore.getState().settings.gtd?.focusGroupBy).toBe('context');
        const after = useTaskStore.getState();
        expect({ tasks: after._allTasks, projects: after._allProjects, sections: after._allSections,
            areas: after._allAreas, people: after._allPeople, savedFilters: after.settings.savedFilters }).toEqual(before);
        expect(focusControlsWrites()).toHaveLength(1);
        expect(value(await host.setFocusGroupChecked({ ...input, requestId: generateUUID() })).groupBy).toBe('context');
        expect(focusControlsWrites()).toHaveLength(1);
        expect(host.probeFocusGroupOutcome(input)).toEqual({ ok: true, value: { groupBy: 'context', controls: { ...controls, savedFilterId: null } } });
    });

    it('validates the exact bounded request without opening the store', async () => {
        const host = createNativeHostContract();
        const input: Request = { requestId: generateUUID(), controls: DEFAULT_FOCUS_CONTROL_STATE,
            groupBy: 'area', expected: { groupBy: null, updatedAt: null } };
        expect(host.validateFocusGroupWrite(input)).toEqual({ ok: true, value: { groupBy: 'area', controls: DEFAULT_FOCUS_CONTROL_STATE } });
        for (const bad of [
            { ...input, extra: true }, { ...input, requestId: 'bad' }, { ...input, groupBy: 'bogus' },
            { ...input, expected: { ...input.expected, extra: true } },
            { ...input, expected: { groupBy: 3, updatedAt: null } },
            { ...input, controls: { ...input.controls, sortBy: 'bogus' } },
            { ...input, controls: { ...input.controls, filters: { searchQuery: 'forbidden' } } },
            { ...input, controls: { ...input.controls, filters: { tokens: ['x'.repeat(33_000)] } } },
        ]) {
            expect(host.validateFocusGroupWrite(bad)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        expect(await host.setFocusGroupChecked(input)).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    });

    it('rejects present null stored fields but acknowledges an already stored target before checking the stamp', async () => {
        const host = await open();
        const input = request(host, 'area');
        useTaskStore.setState((state) => ({ settings: { ...state.settings,
            gtd: { ...state.settings.gtd, focusGroupBy: null as never } } }));
        expect(host.getFocusGroupOptions({ controls: DEFAULT_FOCUS_CONTROL_STATE })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.setFocusGroupChecked(input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.probeFocusGroupOutcome(input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

        useTaskStore.setState((state) => {
            const gtd = { ...state.settings.gtd };
            delete gtd.focusGroupBy;
            return { settings: { ...state.settings, gtd,
                syncPreferencesUpdatedAt: { ...state.settings.syncPreferencesUpdatedAt, gtd: null as never } } };
        });
        expect(host.getFocusGroupOptions({ controls: DEFAULT_FOCUS_CONTROL_STATE })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.setFocusGroupChecked(input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.probeFocusGroupOutcome(input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

        useTaskStore.setState((state) => ({ settings: { ...state.settings,
            gtd: { ...state.settings.gtd, focusGroupBy: 'area' } } }));
        expect(value(await host.setFocusGroupChecked(input)).groupBy).toBe('area');
        expect(host.probeFocusGroupOutcome(input)).toMatchObject({ ok: true, value: { groupBy: 'area' } });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('rejects stale group and GTD stamp, including A to B to A, without writing', async () => {
        const host = await open();
        const input = request(host, 'tag');
        useTaskStore.setState((state) => ({ settings: { ...state.settings, gtd: { ...state.settings.gtd, focusGroupBy: 'area' } } }));
        expect(await host.setFocusGroupChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        useTaskStore.setState((state) => {
            const gtd = { ...state.settings.gtd };
            delete gtd.focusGroupBy;
            return { settings: { ...state.settings, gtd,
                syncPreferencesUpdatedAt: { ...state.settings.syncPreferencesUpdatedAt, gtd: '2026-09-29T00:00:00.000Z' } } };
        });
        expect(await host.setFocusGroupChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.probeFocusGroupOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('retries a failed save without reapplying and serializes duplicate UUIDs', async () => {
        let failSave = false;
        const host = await open('base', async () => { if (failSave) throw new Error('disk unavailable'); });
        const input = request(host, 'person');
        failSave = true;
        const [first, same] = await Promise.all([host.setFocusGroupChecked(input), host.setFocusGroupChecked(input)]);
        expect(first).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(same).toEqual(first);
        expect(focusControlsWrites()).toHaveLength(1);
        expect(await host.setFocusGroupChecked({ ...input, groupBy: 'tag' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        failSave = false;
        expect(value(await host.setFocusGroupChecked(input)).groupBy).toBe('person');
        expect(focusControlsWrites()).toHaveLength(1);
    });

    it('replays the original UUID after host recreation without reverting intervening settings', async () => {
        const host = await open();
        const input = request(host, 'energy');
        value(await host.setFocusGroupChecked(input));
        const changed = useTaskStore.getState();
        await changed.updateSettings({ gtd: { ...changed.settings.gtd, focusTaskLimit: 7 } });
        await flushPendingSave();
        const restarted = createNativeHostContract();
        expect(await restarted.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' })).toMatchObject({ ok: true });
        expect(await restarted.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
        focusControlsWrites().length = 0;
        expect(restarted.probeFocusGroupOutcome(input)).toMatchObject({ ok: true, value: { groupBy: 'energy' } });
        expect(value(await restarted.setFocusGroupChecked(input)).groupBy).toBe('energy');
        expect(useTaskStore.getState().settings.gtd).toMatchObject({ focusGroupBy: 'energy', focusTaskLimit: 7 });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('refuses the applied UUID after a newer group and after A to B to A', async () => {
        const host = await open('groupProject');
        const input = request(host, 'energy');
        expect(input.expected.groupBy).toBe('project');
        value(await host.setFocusGroupChecked(input));

        const changeGroup = async (groupBy: 'area' | 'project') => {
            const store = useTaskStore.getState();
            await store.updateSettings({ gtd: { ...store.settings.gtd, focusGroupBy: groupBy } });
            await flushPendingSave();
        };
        const restarted = async () => {
            const fresh = createNativeHostContract();
            expect(await fresh.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' })).toMatchObject({ ok: true });
            expect(await fresh.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
            focusControlsWrites().length = 0;
            return fresh;
        };
        await changeGroup('area');
        const newer = await restarted();
        expect(await newer.setFocusGroupChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(useTaskStore.getState().settings.gtd?.focusGroupBy).toBe('area');
        expect(focusControlsWrites()).toEqual([]);

        await changeGroup('project');
        const aba = await restarted();
        expect(useTaskStore.getState().settings.syncPreferencesUpdatedAt?.gtd).not.toBe(input.expected.updatedAt);
        expect(await aba.setFocusGroupChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(useTaskStore.getState().settings.gtd?.focusGroupBy).toBe('project');
        expect(focusControlsWrites()).toEqual([]);
    });
});
