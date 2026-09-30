import { afterEach, describe, expect, it } from 'vitest';
import { createNativeHostContract } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { NativeGeneralPreferenceRequest } from './native-host-contract-general-preference';
import type { AppData, Task } from './types';

const ID = '00000000-0000-4000-8000-000000000097';
const AT = '2026-09-01T00:00:00.000Z';
const terminal: Task = { id: 'terminal', title: 'Terminal', status: 'done', tags: [], contexts: [],
    focusOrder: 9, deletedAt: AT, createdAt: AT, updatedAt: AT, rev: 7 };
const initial = (): AppData => ({ tasks: [terminal], projects: [], sections: [], areas: [], people: [],
    settings: { deviceId: 'preferences-device', appearance: { density: 'compact' },
        syncPreferencesUpdatedAt: { appearance: AT, language: AT },
        ai: { apiKey: 'private-value', baseUrl: 'https://private.invalid/x' },
        gtd: { focusTaskLimit: 6 }, calendarSystem: 'gregorian' } as AppData['settings'] });

async function open(start: AppData, fail?: () => boolean) {
    await flushPendingSave(); resetForTests();
    let data = structuredClone(start);
    let saves = 0;
    const adapter = { getData: async () => structuredClone(data), saveData: async (next: AppData) => {
        if (fail?.()) throw new Error('disk unavailable');
        data = structuredClone(next); saves += 1;
    } };
    setStorageAdapter(adapter);
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true }); await flushPendingSave(); saves = 0;
    data = structuredClone(start);
    const host = createNativeHostContract();
    expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
    await flushPendingSave();
    data = structuredClone(start);
    saves = 0;
    return { host, data: () => data, saves: () => saves,
        changeSaved: (fn: (data: AppData) => AppData) => { data = fn(data); },
        reopen: async () => open(data, fail) };
}

async function planned(env: Awaited<ReturnType<typeof open>>,
    edit: NativeGeneralPreferenceRequest['edit']) {
    const options = await env.host.getGeneralPreferenceOptions({});
    if (!options.ok) throw new Error(JSON.stringify(options));
    const request: NativeGeneralPreferenceRequest = { requestId: ID, edit,
        expected: options.value.expected[edit.type] };
    const plan = await env.host.prepareGeneralPreference(request);
    if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
    return { options: options.value, request, prepared: plan.value.prepared,
        envelope: { request, prepared: plan.value.prepared } };
}

afterEach(async () => { await flushPendingSave(); resetForTests(); });

describe('prepared General preferences', () => {
    it.each([
        { type: 'showTaskAge', value: true, group: 'appearance' },
        { type: 'weekStart', value: 'monday', group: 'language' },
        { type: 'dateFormat', value: 'ymd', group: 'language' },
        { type: 'timeFormat', value: '24h', group: 'language' },
    ] as const)('applies and cold-replays $type preserving all unrelated raw rows and settings', async ({ type, value, group }) => {
        const env = await open(initial());
        const { options, envelope, prepared } = await planned(env, { type, value } as NativeGeneralPreferenceRequest['edit']);
        expect(options.model.appearance.showTaskAge.value).toBe(false);
        expect(env.host.validatePreparedGeneralPreference(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(JSON.stringify(envelope)).not.toContain('private-value');
        expect(await env.host.commitPreparedGeneralPreference(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(env.saves()).toBe(1);
        expect(env.data().tasks).toEqual(initial().tasks);
        // The store's existing secure-storage rule strips API keys on every SQLite save.
        expect(env.data().settings.ai).toEqual({ apiKey: undefined, baseUrl: 'https://private.invalid/x' });
        expect(env.data().settings.gtd).toEqual(initial().settings.gtd);
        expect(env.data().settings.calendarSystem).toBe('gregorian');
        expect(env.data().settings.syncPreferencesUpdatedAt?.[group]).toBe(prepared.after.stamp);
        expect(env.data().settings.syncPreferencesUpdatedAt?.[group === 'language' ? 'appearance' : 'language']).toBe(AT);
        const cold = await env.reopen();
        expect(await cold.host.commitPreparedGeneralPreference(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(cold.saves()).toBe(0);
    });

    it('keeps absent and explicit system distinct, and no-op writes nothing', async () => {
        const start = initial();
        start.settings.weekStart = undefined;
        start.settings.syncPreferencesUpdatedAt!.language = undefined;
        const env = await open(start);
        const options = await env.host.getGeneralPreferenceOptions({});
        if (!options.ok) throw new Error(JSON.stringify(options));
        expect(options.value.expected.weekStart).toMatchObject({ present: false, value: null,
            stampPresent: false, stamp: null });
        expect(options.value.model.regional.weekStart.options.find((row) => row.value === 'system')?.selected).toBe(true);
        const { envelope } = await planned(env, { type: 'weekStart', value: 'system' });
        expect((await env.host.commitPreparedGeneralPreference(envelope)).ok).toBe(true);
        expect(env.data().settings.weekStart).toBe('system');
        const fresh = await env.reopen();
        const newOptions = await fresh.host.getGeneralPreferenceOptions({});
        if (!newOptions.ok) throw new Error(JSON.stringify(newOptions));
        const noop = await fresh.host.prepareGeneralPreference({ requestId: ID, edit: { type: 'weekStart', value: 'system' },
            expected: newOptions.value.expected.weekStart });
        expect(noop).toMatchObject({ ok: true, value: { kind: 'noop', result: { changed: false } } });
        expect(fresh.saves()).toBe(0);
    });

    it('pins a bounded raw numeric legacy preference while editing another field and replacing it', async () => {
        const start = initial();
        start.settings = { ...start.settings, weekStart: 1 } as typeof start.settings;
        const env = await open(start);
        const options = await env.host.getGeneralPreferenceOptions({});
        if (!options.ok) throw new Error(JSON.stringify(options));
        expect(options.value.expected.weekStart).toMatchObject({ present: true, value: 1 });
        const other = await planned(env, { type: 'showTaskAge', value: true });
        expect(await env.host.commitPreparedGeneralPreference(other.envelope)).toMatchObject({ ok: true });
        expect(env.data().settings.weekStart).toBe(1);
        const replace = await planned(env, { type: 'weekStart', value: 'monday' });
        expect(replace.envelope.request.expected.value).toBe(1);
        expect(await env.host.commitPreparedGeneralPreference(replace.envelope)).toMatchObject({ ok: true });
        expect(env.data().settings.weekStart).toBe('monday');
        const cold = await env.reopen();
        expect(await cold.host.commitPreparedGeneralPreference(replace.envelope)).toMatchObject({ ok: true });
    });

    it('refreshes the observable Task View date and time labels after each regional choice', async () => {
        const start = initial();
        start.settings = { ...start.settings, dateFormat: 'ymd', timeFormat: '12h' };
        start.tasks.push({ id: 'timed', title: 'Timed', status: 'next', tags: [], contexts: [],
            dueDate: '2026-09-30T15:30:00.000Z', createdAt: AT, updatedAt: AT });
        const env = await open(start);
        const dueLabel = () => {
            const view = env.host.getTaskView({ id: 'timed' });
            if (!view.ok) throw new Error(JSON.stringify(view));
            const row = view.value.rows.find((item) => item.type === 'field' && item.field === 'dueDate');
            if (!row || row.type !== 'field') throw new Error('Due date row missing');
            return row.value;
        };
        const original = dueLabel();
        const date = await planned(env, { type: 'dateFormat', value: 'dmy' });
        expect(await env.host.commitPreparedGeneralPreference(date.envelope)).toMatchObject({ ok: true });
        const dateChanged = dueLabel();
        expect(dateChanged).not.toBe(original);
        const time = await planned(env, { type: 'timeFormat', value: '24h' });
        expect(await env.host.commitPreparedGeneralPreference(time.envelope)).toMatchObject({ ok: true });
        expect(dueLabel()).not.toBe(dateChanged);
    });

    it('builds options from one fresh saved Settings baseline and refreshes independent raw row changes on commit', async () => {
        const start = initial();
        start.tasks.push({ id: 'live', title: 'Live', status: 'next', contexts: [], tags: [],
            description: 'old', createdAt: AT, updatedAt: AT });
        start.projects.push({ id: 'project', title: 'Old project', status: 'active', color: '#abcdef',
            order: 0, tagIds: [], createdAt: AT, updatedAt: AT });
        const env = await open(start);
        env.changeSaved((data) => ({ ...data,
            tasks: data.tasks.map((row) => row.id === 'live' ? { ...row, description: 'fresh from disk' } : row),
            projects: data.projects.map((row) => row.id === 'project' ? { ...row, title: 'Fresh project' } : row),
            settings: { ...data.settings, weekStart: 'saturday' } }));
        const options = await env.host.getGeneralPreferenceOptions({});
        if (!options.ok) throw new Error(JSON.stringify(options));
        expect(options.value.expected.weekStart).toMatchObject({ present: true, value: 'saturday' });
        expect(options.value.model.regional.weekStart.options.find((row) => row.value === 'saturday')?.selected).toBe(true);
        const { envelope } = await planned(env, { type: 'showTaskAge', value: true });
        expect(await env.host.commitPreparedGeneralPreference(envelope)).toMatchObject({ ok: true });
        expect(useTaskStore.getState()._allTasks.find((row) => row.id === 'live')?.description).toBe('fresh from disk');
        expect(useTaskStore.getState()._allProjects.find((row) => row.id === 'project')?.title).toBe('Fresh project');
        expect(useTaskStore.getState()._allTasks.find((row) => row.id === 'terminal')?.focusOrder).toBeUndefined();
        expect(env.data().tasks.find((row) => row.id === 'terminal')?.focusOrder).toBe(9);
        expect(env.data().settings.weekStart).toBe('saturday');
    });

    it('refuses relevant field/group changes, including independent same-destination and ABA', async () => {
        const env = await open(initial());
        const { envelope, prepared } = await planned(env, { type: 'timeFormat', value: '24h' });
        const commit = () => env.host.commitPreparedGeneralPreference(envelope);
        env.changeSaved((data) => ({ ...data, settings: { ...data.settings, timeFormat: '24h',
            syncPreferencesUpdatedAt: { ...data.settings.syncPreferencesUpdatedAt, language: '2026-09-02T00:00:00.000Z' } } }));
        expect(await commit()).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        env.changeSaved((data) => ({ ...data, settings: { ...data.settings, timeFormat: undefined,
            syncPreferencesUpdatedAt: { ...data.settings.syncPreferencesUpdatedAt, language: '2026-09-02T00:00:00.000Z' } } }));
        expect(await commit()).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        env.changeSaved((data) => ({ ...data, settings: { ...data.settings, timeFormat: '24h',
            syncPreferencesUpdatedAt: { ...data.settings.syncPreferencesUpdatedAt, language: prepared.after.stamp } } }));
        // The exact planned scalar/stamp is the only persisted receipt the four-field scope permits.
        expect(await commit()).toMatchObject({ ok: true });
        expect(env.saves()).toBe(0);
    });

    it('rejects forged cold payloads and treats no-journal outcomes as unknown', async () => {
        const env = await open(initial());
        const { request, envelope } = await planned(env, { type: 'dateFormat', value: 'mdy' });
        const bad = structuredClone(envelope);
        bad.prepared.after.stamp = '2026-01-01T00:00:00.000Z';
        expect(env.host.validatePreparedGeneralPreference(bad)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const extra = { ...envelope, prepared: { ...envelope.prepared, extra: true } };
        expect(env.host.validatePreparedGeneralPreference(extra)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(env.host.probeGeneralPreferenceOutcome(request)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        const invalid = { ...request, edit: { type: 'calendarSystem', value: 'jalali' } };
        expect(await env.host.prepareGeneralPreference(invalid as never)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
    });

    it('retries the exact request after a failed save without changing the prepared time', async () => {
        let failing = false;
        const env = await open(initial(), () => failing);
        const { envelope } = await planned(env, { type: 'showTaskAge', value: true });
        failing = true;
        expect(await env.host.commitPreparedGeneralPreference(envelope)).toMatchObject({ ok: false,
            error: { code: 'SAVE_FAILED' } });
        failing = false;
        expect(await env.host.commitPreparedGeneralPreference(envelope)).toMatchObject({ ok: true });
        expect(env.data().settings.syncPreferencesUpdatedAt?.appearance).toBe(envelope.prepared.after.stamp);
        expect(env.data().tasks).toEqual(initial().tasks);
    });

    it.each(['synchronous', 'microtask'])('does not claim a %s foreign failed Task save', async (timing) => {
        let failing = false;
        const start = initial();
        start.tasks.push({ id: 'foreign', title: 'Foreign', status: 'next', contexts: [], tags: [],
            description: 'before', createdAt: AT, updatedAt: AT });
        const env = await open(start, () => failing);
        const { envelope } = await planned(env, { type: 'showTaskAge', value: true });
        const before = structuredClone(env.data());
        let armed = true;
        let foreign: Promise<unknown> | undefined;
        const unsubscribe = useTaskStore.subscribe((current, previous) => {
            if (!armed || current.settings === previous.settings) return;
            armed = false;
            const edit = () => { foreign = useTaskStore.getState().updateTask('foreign', { description: 'after' }); };
            if (timing === 'microtask') queueMicrotask(edit); else edit();
        });
        failing = true;
        try {
            expect(await env.host.commitPreparedGeneralPreference(envelope)).toMatchObject({ ok: false,
                error: { code: 'SAVE_FAILED' } });
        } finally { unsubscribe(); }
        expect(await foreign).toMatchObject({ success: true });
        expect(env.data()).toEqual(before);
        failing = false;
        expect(await env.host.commitPreparedGeneralPreference(envelope)).toMatchObject({ ok: false,
            error: { code: 'SAVE_FAILED' } });
    });
});
