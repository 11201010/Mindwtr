import { afterEach, describe, expect, it } from 'vitest';
import { AREA_PRESET_COLORS, DEFAULT_AREA_COLOR } from './color-constants';
import { createUnassignedAreaColorMethods, validateUnassignedAreaColorWrite,
    type NativeUnassignedAreaColorRequest } from './native-host-contract-unassigned-area-color';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { resetNativeRequestReceipts } from './native-request-receipts';
import type { AppData } from './types';

const requestId = '00000000-0000-4000-8000-000000000386';
const otherId = '00000000-0000-4000-8000-000000000387';
const stamp = '2026-09-29T12:00:00.000Z';
const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

async function open(settings: AppData['settings'] = { deviceId: 'loaded-device' }, fail?: () => boolean) {
    await flushPendingSave();
    resetForTests();
    resetNativeRequestReceipts();
    let saved: AppData = { tasks: [], projects: [], sections: [], areas: [], people: [], settings };
    let writes = 0;
    setStorageAdapter({ getData: async () => saved, saveData: async (next) => {
        if (fail?.()) throw new Error('disk unavailable');
        saved = structuredClone(next);
        writes++;
    } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    await flushPendingSave();
    writes = 0;
    const make = () => createUnassignedAreaColorMethods({
        readiness: () => ({ ok: true, value: null }), revision: () => 'revision',
        save: async () => {
            try { await flushPendingSave(); return { ok: true as const, value: null }; }
            catch (error) { return { ok: false as const, error: { code: 'SAVE_FAILED' as const,
                message: error instanceof Error ? error.message : String(error) } }; }
        },
    });
    return { make, saved: () => saved, writes: () => writes };
}

afterEach(async () => { await flushPendingSave().catch(() => {}); resetForTests(); resetNativeRequestReceipts(); });

describe('checked unassigned Area color', () => {
    it('offers raw absence, explicit default, imported custom and empty baselines', async () => {
        for (const raw of [undefined, DEFAULT_AREA_COLOR, '#custom', '']) {
            const settings: AppData['settings'] = { deviceId: 'loaded-device',
                appearance: raw === undefined ? undefined : { unassignedAreaColor: raw } };
            const { make } = await open(settings);
            const options = value(make().getUnassignedAreaColorOptions({}));
            expect(options).toEqual({ revision: 'revision', color: raw || DEFAULT_AREA_COLOR,
                colors: [...AREA_PRESET_COLORS], expected: { color: raw ?? null, updatedAt: null } });
        }
    });

    it('writes explicit default over absence and preserves unrelated settings and domain rows', async () => {
        const settings = { deviceId: 'loaded-device', appearance: { density: 'compact' as const, futurePeer: { keep: true } },
            syncPreferencesUpdatedAt: { gtd: stamp }, quickAddAutoClean: true } as AppData['settings'];
        const { make, saved, writes } = await open(settings);
        const methods = make();
        const request: NativeUnassignedAreaColorRequest = { requestId, color: DEFAULT_AREA_COLOR,
            expected: value(methods.getUnassignedAreaColorOptions({})).expected };
        const before = structuredClone(saved());
        expect(value(await methods.setUnassignedAreaColorChecked(request))).toEqual({ color: DEFAULT_AREA_COLOR, changed: true });
        expect(writes()).toBe(1);
        expect(saved().settings.appearance).toEqual({ ...before.settings.appearance, unassignedAreaColor: DEFAULT_AREA_COLOR });
        expect(saved().settings.syncPreferencesUpdatedAt?.gtd).toBe(stamp);
        expect(saved().settings.syncPreferencesUpdatedAt?.appearance).toEqual(expect.any(String));
        expect(saved().settings.quickAddAutoClean).toBe(true);
        for (const table of ['tasks', 'projects', 'sections', 'areas', 'people'] as const) expect(saved()[table]).toEqual(before[table]);
        await useTaskStore.getState().updateSettings({ appearance: {
            ...useTaskStore.getState().settings.appearance, unassignedAreaColor: AREA_PRESET_COLORS[2],
        } });
        await flushPendingSave();
        expect(methods.probeUnassignedAreaColorOutcome(request)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await methods.setUnassignedAreaColorChecked(request))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });

    it('writes displayed default over an empty raw baseline', async () => {
        const { make, saved, writes } = await open({ deviceId: 'loaded-device', appearance: { unassignedAreaColor: '' } });
        const methods = make();
        const request = { requestId, color: DEFAULT_AREA_COLOR,
            expected: value(methods.getUnassignedAreaColorOptions({})).expected };
        expect(await methods.setUnassignedAreaColorChecked(request)).toEqual({ ok: true,
            value: { color: DEFAULT_AREA_COLOR, changed: true } });
        expect(saved().settings.appearance?.unassignedAreaColor).toBe(DEFAULT_AREA_COLOR);
        expect(writes()).toBe(1);
    });

    it('keeps exact no-op writes empty, and permits unchanged imported custom colors', async () => {
        const { make, writes } = await open({ deviceId: 'loaded-device', appearance: { unassignedAreaColor: '#custom' } });
        const methods = make();
        const expected = value(methods.getUnassignedAreaColorOptions({})).expected;
        const request = { requestId, color: '#custom', expected };
        expect(methods.probeUnassignedAreaColorOutcome(request)).toEqual({ ok: true, value: { color: '#custom', changed: false } });
        expect(await methods.setUnassignedAreaColorChecked(request)).toEqual({ ok: true, value: { color: '#custom', changed: false } });
        expect(writes()).toBe(0);
        expect(await methods.setUnassignedAreaColorChecked({ ...request, color: '#other' }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('refuses malformed requests and unsupported stored appearance and timestamp', async () => {
        const input: NativeUnassignedAreaColorRequest = { requestId, color: AREA_PRESET_COLORS[1],
            expected: { color: null, updatedAt: null } };
        expect(validateUnassignedAreaColorWrite(input)).toEqual({ ok: true, value: { color: input.color, changed: true } });
        for (const bad of [{ ...input, extra: true }, { ...input, requestId: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA' },
            { ...input, color: '#custom' }, { ...input, color: 'x'.repeat(4096) },
            { ...input, color: DEFAULT_AREA_COLOR, expected: { color: '#custom', updatedAt: null } },
            { ...input, expected: { color: null, updatedAt: null, extra: true } },
            { ...input, expected: { color: '', updatedAt: 3 } },
            { ...input, expected: { color: '😃'.repeat(1020), updatedAt: null } }]) {
            expect(validateUnassignedAreaColorWrite(bad)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        const { make, writes } = await open();
        for (const settings of [
            { appearance: null }, { appearance: { unassignedAreaColor: null } },
            { appearance: { unassignedAreaColor: 3 } },
            { appearance: { unassignedAreaColor: 'x'.repeat(501) } },
            { syncPreferencesUpdatedAt: null }, { syncPreferencesUpdatedAt: { appearance: 1 } },
            { syncPreferencesUpdatedAt: { appearance: 'x'.repeat(501) } },
        ]) {
            useTaskStore.setState({ settings: { deviceId: 'loaded-device', ...settings } as never });
            expect(make().getUnassignedAreaColorOptions({})).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        expect(writes()).toBe(0);
    });

    it('checks both raw color and appearance stamp, but recognizes exact target after method recreation', async () => {
        const { make, writes } = await open({ deviceId: 'loaded-device', appearance: { unassignedAreaColor: '#custom' },
            syncPreferencesUpdatedAt: { appearance: stamp } });
        const methods = make();
        const request: NativeUnassignedAreaColorRequest = { requestId, color: AREA_PRESET_COLORS[1],
            expected: value(methods.getUnassignedAreaColorOptions({})).expected };
        useTaskStore.setState((state) => ({ settings: { ...state.settings,
            syncPreferencesUpdatedAt: { appearance: 'later' } } }));
        expect(await methods.setUnassignedAreaColorChecked(request)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        useTaskStore.setState((state) => ({ settings: { ...state.settings,
            appearance: { unassignedAreaColor: AREA_PRESET_COLORS[2] }, syncPreferencesUpdatedAt: { appearance: stamp } } }));
        expect(await methods.setUnassignedAreaColorChecked(request)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(writes()).toBe(0);
        useTaskStore.setState((state) => ({ settings: { ...state.settings,
            appearance: { unassignedAreaColor: request.color } } }));
        expect(make().probeUnassignedAreaColorOutcome(request)).toEqual({ ok: true, value: { color: request.color, changed: true } });
        expect(await make().setUnassignedAreaColorChecked(request)).toEqual({ ok: true, value: { color: request.color, changed: true } });
        expect(writes()).toBe(0);
        useTaskStore.setState((state) => ({ settings: { ...state.settings,
            appearance: { unassignedAreaColor: AREA_PRESET_COLORS[3] } } }));
        expect(methods.probeUnassignedAreaColorOutcome(request)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });

    it('retries uncertain saves without a second write and rejects a conflicting UUID payload', async () => {
        let fail = false;
        const { make, writes } = await open({ deviceId: 'loaded-device' }, () => fail);
        const methods = make();
        const request: NativeUnassignedAreaColorRequest = { requestId, color: AREA_PRESET_COLORS[1],
            expected: value(methods.getUnassignedAreaColorOptions({})).expected };
        fail = true;
        expect(await methods.setUnassignedAreaColorChecked(request)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(await methods.setUnassignedAreaColorChecked({ ...request, requestId: otherId, color: AREA_PRESET_COLORS[2] }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await methods.setUnassignedAreaColorChecked(request)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(await methods.setUnassignedAreaColorChecked({ ...request, color: AREA_PRESET_COLORS[2] }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        fail = false;
        expect(await methods.setUnassignedAreaColorChecked(request)).toEqual({ ok: true, value: { color: request.color, changed: true } });
        expect(writes()).toBe(1);
    }, 20_000);
});
