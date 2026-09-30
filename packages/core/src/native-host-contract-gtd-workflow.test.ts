import { afterEach, describe, expect, it } from 'vitest';
import { createNativeHostContract } from './native-host-contract';
import { canStarNewCapture } from './focus-star';
import { normalizeFocusTaskLimit } from './focus-utils';
import { getProcessInboxDefaultScheduleTime } from './process-inbox-model';
import type { NativeGtdWorkflowRequest } from './native-host-contract-gtd-workflow';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Task } from './types';

const ID = '00000000-0000-4000-8000-000000000103';
const AT = '2026-09-01T00:00:00.000Z';
const terminal: Task = { id: 'gtd-terminal', title: 'Terminal', status: 'done', tags: [], contexts: [],
    focusOrder: 9, deletedAt: AT, createdAt: AT, updatedAt: AT, rev: 7 };
const initial = (): AppData => ({ tasks: [terminal], projects: [], sections: [], areas: [], people: [],
    settings: { deviceId: 'gtd-device', gtd: { focusGroupBy: 'project', legacySibling: { marker: 103 } },
        syncPreferencesUpdatedAt: { gtd: AT, appearance: AT },
        ai: { apiKey: 'private-value', baseUrl: 'https://private.invalid/x' } } as AppData['settings'] });

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
    await flushPendingSave(); data = structuredClone(start); saves = 0;
    return { host, data: () => data, saves: () => saves,
        changeSaved: (fn: (data: AppData) => AppData) => { data = fn(data); },
        reopen: async () => open(data, fail) };
}

async function planned(env: Awaited<ReturnType<typeof open>>, edit: NativeGtdWorkflowRequest['edit']) {
    const options = await env.host.getGtdWorkflowOptions({});
    if (!options.ok) throw new Error(JSON.stringify(options));
    const request: NativeGtdWorkflowRequest = { requestId: ID, edit, expected: options.value.expected[edit.type] };
    const plan = await env.host.prepareGtdWorkflow(request);
    if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
    return { options: options.value, request, prepared: plan.value.prepared,
        envelope: { request, prepared: plan.value.prepared } };
}

afterEach(async () => { await flushPendingSave(); resetForTests(); });

describe('prepared GTD workflow defaults', () => {
    it.each([
        { type: 'defaultScheduleTime', value: '09:30' },
        { type: 'focusTaskLimit', value: 5 },
        { type: 'defaultProjectFlowMode', value: 'sequential' },
    ] as const)('saves and cold-replays $type with only the chosen raw field and GTD stamp', async (edit) => {
        const env = await open(initial());
        const { options, envelope, prepared } = await planned(env, edit);
        expect(Object.keys(options.expected).sort()).toEqual([
            'defaultScheduleTime', 'focusTaskLimit', 'defaultProjectFlowMode'].sort());
        expect(options.expected[edit.type]).toMatchObject({ present: false, value: null, stampPresent: true, stamp: AT });
        expect(options.hub[edit.type].label).toEqual(expect.any(String));
        expect(env.host.validatePreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(JSON.stringify(envelope)).not.toContain('private-value');
        expect(JSON.stringify(envelope)).not.toContain('legacySibling');
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(env.saves()).toBe(1);
        expect(env.data().settings.gtd?.[edit.type]).toBe(edit.value);
        expect(env.data().settings.gtd).toMatchObject({ focusGroupBy: 'project', legacySibling: { marker: 103 } });
        expect(env.data().settings.syncPreferencesUpdatedAt?.gtd).toBe(prepared.after.stamp);
        expect(env.data().settings.syncPreferencesUpdatedAt?.appearance).toBe(AT);
        expect(env.data().tasks).toEqual(initial().tasks);
        if (edit.type === 'defaultScheduleTime') {
            expect(getProcessInboxDefaultScheduleTime(env.data().settings)).toBe('09:30');
        } else if (edit.type === 'focusTaskLimit') {
            const limit = normalizeFocusTaskLimit(env.data().settings.gtd?.focusTaskLimit);
            expect(canStarNewCapture({ focusedCount: 4, focusTaskLimit: limit })).toBe(true);
            expect(canStarNewCapture({ focusedCount: 5, focusTaskLimit: limit })).toBe(false);
        } else {
            const project = env.host.prepareProjectCreate({ requestId: '10300000-0000-4000-8000-000000000103',
                title: 'Uses saved GTD flow', areaId: null });
            expect(project).toMatchObject({ ok: true, value: { kind: 'prepared',
                prepared: { defaultProjectFlowMode: 'sequential', project: { isSequential: true } } } });
        }
        const cold = await env.reopen();
        expect(await cold.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(cold.saves()).toBe(0);
    });

    it('uses the shared time parser for drafts and only accepts normalized time edits', async () => {
        const env = await open(initial());
        expect(env.host.normalizeGtdWorkflowDraft({ value: ' 7:05 ' })).toEqual({ ok: true,
            value: { valid: true, value: '07:05' } });
        expect(env.host.normalizeGtdWorkflowDraft({ value: '1745' })).toEqual({ ok: true,
            value: { valid: true, value: '17:45' } });
        expect(env.host.normalizeGtdWorkflowDraft({ value: '' })).toEqual({ ok: true,
            value: { valid: true, value: '' } });
        expect(env.host.normalizeGtdWorkflowDraft({ value: '25:00' })).toEqual({ ok: true,
            value: { valid: false, value: null } });
        expect(env.host.normalizeGtdWorkflowDraft({ value: 'x'.repeat(51) })).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const options = await env.host.getGtdWorkflowOptions({});
        if (!options.ok) throw new Error(JSON.stringify(options));
        for (const value of ['7:05', '25:00', 705, null])
            expect(await env.host.prepareGtdWorkflow({ requestId: ID,
                edit: { type: 'defaultScheduleTime', value }, expected: options.value.expected.defaultScheduleTime }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('uses shared offered choices and distinguishes stored defaults from absence', async () => {
        const env = await open(initial());
        const options = await env.host.getGtdWorkflowOptions({});
        if (!options.ok) throw new Error(JSON.stringify(options));
        for (const option of options.value.hub.focusTaskLimit.options) {
            expect(option.edit).toEqual({ type: 'focusTaskLimit', value: option.value });
        }
        expect(options.value.hub.defaultProjectFlowMode.options.map((row) => row.value))
            .toEqual(['parallel', 'sequential']);
        for (const value of [0, 6, 100, '5'])
            expect(await env.host.prepareGtdWorkflow({ requestId: ID,
                edit: { type: 'focusTaskLimit', value }, expected: options.value.expected.focusTaskLimit }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const absentDefault = await env.host.prepareGtdWorkflow({ requestId: ID,
            edit: { type: 'defaultScheduleTime', value: '' }, expected: options.value.expected.defaultScheduleTime });
        expect(absentDefault).toMatchObject({ ok: true, value: { kind: 'noop', result: { changed: false } } });
        expect(env.saves()).toBe(0);
        const start = initial(); start.settings.gtd = { ...start.settings.gtd, focusTaskLimit: 6 };
        const legacy = await open(start);
        const raw = await legacy.host.getGtdWorkflowOptions({});
        expect(raw).toMatchObject({ ok: true, value: { expected: { focusTaskLimit: { present: true, value: 6 } } } });
        const replacement = await planned(legacy, { type: 'focusTaskLimit', value: 5 });
        expect(await legacy.host.commitPreparedGtdWorkflow(replacement.envelope)).toMatchObject({ ok: true });
        expect(legacy.data().settings.gtd?.focusTaskLimit).toBe(5);
    });

    it('refuses malformed relevant raw fields and forged prepared effects before storage', async () => {
        const env = await open(initial());
        const { envelope } = await planned(env, { type: 'defaultProjectFlowMode', value: 'sequential' });
        for (const change of [
            (copy: typeof envelope) => { copy.prepared.after.stamp = AT; },
            (copy: typeof envelope) => { copy.prepared.after.value = 'parallel'; },
            (copy: typeof envelope) => { copy.prepared.result.changed = false; },
            (copy: typeof envelope) => { copy.prepared.request.requestId = '00000000-0000-4000-8000-000000000000'; },
        ]) {
            const forged = structuredClone(envelope); change(forged);
            expect(env.host.validatePreparedGtdWorkflow(forged)).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
            expect(await env.host.commitPreparedGtdWorkflow(forged)).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
        }
        for (const bad of [null, [], 1]) {
            const start = initial(); start.settings.gtd = bad as never;
            const other = await open(start);
            expect(await other.host.getGtdWorkflowOptions({})).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
        }
        for (const [type, bad] of [['focusTaskLimit', '5'], ['defaultScheduleTime', 930],
            ['defaultProjectFlowMode', null]] as const) {
            const start = initial(); start.settings.gtd = { ...start.settings.gtd, [type]: bad };
            const other = await open(start);
            expect(await other.host.getGtdWorkflowOptions({})).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
        }
    });

    it('refuses forged shared-policy no-ops and keeps malformed unrelated GTD siblings raw', async () => {
        const env = await open(initial());
        const { envelope } = await planned(env, { type: 'defaultScheduleTime', value: '09:30' });
        const absentDefault = structuredClone(envelope);
        absentDefault.request.edit.value = '';
        absentDefault.prepared.request.edit.value = '';
        absentDefault.prepared.after.value = '';
        absentDefault.prepared.result.value = '';
        expect(env.host.validatePreparedGtdWorkflow(absentDefault)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const normalizedNoop = structuredClone(envelope);
        normalizedNoop.request.expected = { ...normalizedNoop.request.expected, present: true, value: '930' };
        normalizedNoop.prepared.request.expected = normalizedNoop.request.expected;
        expect(env.host.validatePreparedGtdWorkflow(normalizedNoop)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(env.saves()).toBe(0);

        const start = initial(); start.settings.gtd = { ...start.settings.gtd,
            taskEditor: { order: 'bad-legacy-order' } as never, pomodoro: 'bad-legacy-pomodoro' as never };
        const other = await open(start);
        expect(await other.host.getGtdWorkflowOptions({})).toMatchObject({ ok: true,
            value: { expected: { defaultScheduleTime: { present: false } } } });
        const action = await planned(other, { type: 'focusTaskLimit', value: 5 });
        expect(await other.host.commitPreparedGtdWorkflow(action.envelope)).toMatchObject({ ok: true });
        expect(other.data().settings.gtd?.taskEditor).toEqual({ order: 'bad-legacy-order' });
        expect(other.data().settings.gtd?.pomodoro).toBe('bad-legacy-pomodoro');
    });

    it('refuses changed raw field or group stamp, including independently written same destination', async () => {
        const env = await open(initial());
        const { envelope } = await planned(env, { type: 'defaultProjectFlowMode', value: 'sequential' });
        env.changeSaved((data) => ({ ...data, settings: { ...data.settings,
            gtd: { ...data.settings.gtd, defaultProjectFlowMode: 'sequential' },
            syncPreferencesUpdatedAt: { ...data.settings.syncPreferencesUpdatedAt,
                gtd: '2026-09-02T00:00:00.000Z' } } }));
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        env.changeSaved((data) => ({ ...data, settings: { ...data.settings,
            gtd: { ...data.settings.gtd, defaultProjectFlowMode: undefined, focusTaskLimit: 3 } } }));
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(env.saves()).toBe(0);
        expect(env.host.probeGtdWorkflowOutcome(envelope.request)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
    });
});
