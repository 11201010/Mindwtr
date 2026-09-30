import { afterEach, describe, expect, it } from 'vitest';
import { createNativeHostContract } from './native-host-contract';
import { canStarNewCapture } from './focus-star';
import { normalizeFocusTaskLimit } from './focus-utils';
import { getProcessInboxDefaultScheduleTime } from './process-inbox-model';
import type { GtdWorkflowEdit, NativeGtdWorkflowRequest } from './native-host-contract-gtd-workflow';
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

async function planned(env: Awaited<ReturnType<typeof open>>,
    edit: Extract<GtdWorkflowEdit, { type: 'defaultScheduleTime' | 'focusTaskLimit' | 'defaultProjectFlowMode' }>) {
    const options = await env.host.getGtdWorkflowOptions({});
    if (!options.ok) throw new Error(JSON.stringify(options));
    const request: NativeGtdWorkflowRequest = { requestId: ID, edit, expected: options.value.expected[edit.type] };
    const plan = await env.host.prepareGtdWorkflow(request);
    if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
    return { options: options.value, request, prepared: plan.value.prepared,
        envelope: { request, prepared: plan.value.prepared } };
}

async function plannedReview(env: Awaited<ReturnType<typeof open>>,
    edit: { type: 'dailyReviewFocusStep' | 'weeklyReviewContextStep'; value: boolean }) {
    const options = await env.host.getGtdReviewOptions({});
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
        expect(Object.keys(envelope.request.expected).sort()).toEqual(['present', 'stamp', 'stampPresent', 'value']);
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

describe('GTD Review variants in the original v1 workflow journal', () => {
    it.each([
        { type: 'dailyReviewFocusStep', value: false, parent: 'dailyReview', field: 'includeFocusStep' },
        { type: 'weeklyReviewContextStep', value: false, parent: 'weeklyReview', field: 'includeContextStep' },
    ] as const)('saves $type and cold-replays only its nested boolean and stamp', async (edit) => {
        const start = initial();
        start.settings.gtd = { ...start.settings.gtd,
            dailyReview: { legacyDaily: 'keep' } as never,
            weeklyReview: { legacyWeekly: 'keep' } as never };
        const env = await open(start);
        const { options, envelope, prepared } = await plannedReview(env, { type: edit.type, value: edit.value });
        expect(Object.keys(options.expected).sort()).toEqual(['dailyReviewFocusStep', 'weeklyReviewContextStep']);
        expect(options.expected[edit.type]).toEqual({ parentPresent: true, present: false,
            value: null, stampPresent: true, stamp: AT });
        const toggle = edit.type === 'dailyReviewFocusStep' ? options.review.dailyFocusStep : options.review.weeklyContextStep;
        expect(toggle).toMatchObject({ value: true, edit: { type: edit.type, value: false } });
        expect(prepared.version).toBe(1);
        expect(Object.keys(envelope.request.expected).sort()).toEqual(['parentPresent', 'present', 'stamp', 'stampPresent', 'value']);
        expect(env.host.validatePreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(JSON.stringify(envelope)).not.toContain('legacyDaily');
        expect(JSON.stringify(envelope)).not.toContain('legacyWeekly');
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(env.saves()).toBe(1);
        const saved = env.data();
        expect((saved.settings.gtd?.[edit.parent] as Record<string, unknown>)[edit.field]).toBe(false);
        expect(saved.settings.gtd?.dailyReview).toMatchObject({ legacyDaily: 'keep' });
        expect(saved.settings.gtd?.weeklyReview).toMatchObject({ legacyWeekly: 'keep' });
        expect(saved.settings.syncPreferencesUpdatedAt?.gtd).toBe(prepared.after.stamp);
        expect(saved.tasks).toEqual(start.tasks);
        const cold = await env.reopen();
        expect(await cold.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(cold.saves()).toBe(0);
    });

    it('removes and restores real Daily focus and Weekly contexts steps, reconciling saved checkpoints', async () => {
        const start = initial();
        start.tasks.push({ ...terminal, id: 'gtd-action', title: 'Context action', status: 'next',
            contexts: ['@Home'], deletedAt: undefined, focusOrder: undefined });
        const env = await open(start);
        const startedAt = new Date().toISOString();
        const dailyCheckpoint = JSON.stringify({ step: 'focus', startedAt });
        const weeklyCheckpoint = JSON.stringify({ step: 'contexts', startedAt });
        expect(env.host.getDailyReview({ checkpoint: dailyCheckpoint, offset: 0, limit: 1 }))
            .toMatchObject({ ok: true, value: { step: { id: 'focus' } } });
        const beforeWeekly = env.host.getWeeklyReview({ checkpoint: weeklyCheckpoint, offset: 0, limit: 1 });
        expect(beforeWeekly).toMatchObject({ ok: true, value: { step: { id: 'contexts' } } });
        if (!beforeWeekly.ok) throw new Error(JSON.stringify(beforeWeekly));
        expect(beforeWeekly.value.rail.map((step) => step.id)).toContain('contexts');
        const daily = await plannedReview(env, { type: 'dailyReviewFocusStep', value: false });
        expect(await env.host.commitPreparedGtdWorkflow(daily.envelope)).toMatchObject({ ok: true });
        const weekly = await plannedReview(env, { type: 'weeklyReviewContextStep', value: false });
        expect(await env.host.commitPreparedGtdWorkflow(weekly.envelope)).toMatchObject({ ok: true });
        const noFocus = env.host.getDailyReview({ checkpoint: dailyCheckpoint, offset: 0, limit: 1 });
        expect(noFocus).toMatchObject({ ok: true });
        if (!noFocus.ok) throw new Error(JSON.stringify(noFocus));
        expect(noFocus.value.step.id).not.toBe('focus');
        const noContexts = env.host.getWeeklyReview({ checkpoint: weeklyCheckpoint, offset: 0, limit: 1 });
        expect(noContexts).toMatchObject({ ok: true });
        if (!noContexts.ok) throw new Error(JSON.stringify(noContexts));
        expect(noContexts.value.step.id).not.toBe('contexts');
        expect(noContexts.value.rail.map((step) => step.id)).not.toContain('contexts');
        const restoreDaily = await plannedReview(env, { type: 'dailyReviewFocusStep', value: true });
        expect(await env.host.commitPreparedGtdWorkflow(restoreDaily.envelope)).toMatchObject({ ok: true });
        const restoreWeekly = await plannedReview(env, { type: 'weeklyReviewContextStep', value: true });
        expect(await env.host.commitPreparedGtdWorkflow(restoreWeekly.envelope)).toMatchObject({ ok: true });
        expect(env.host.getDailyReview({ checkpoint: dailyCheckpoint, offset: 0, limit: 1 }))
            .toMatchObject({ ok: true, value: { step: { id: 'focus' } } });
        const restored = env.host.getWeeklyReview({ checkpoint: weeklyCheckpoint, offset: 0, limit: 1 });
        expect(restored).toMatchObject({ ok: true });
        if (!restored.ok) throw new Error(JSON.stringify(restored));
        expect(restored.value.rail.map((step) => step.id)).toContain('contexts');
    });

    it('binds absent parent, raw boolean and group stamp; malformed relevant rows refuse', async () => {
        const env = await open(initial());
        const option = await env.host.getGtdReviewOptions({});
        expect(option).toMatchObject({ ok: true, value: { expected: {
            dailyReviewFocusStep: { parentPresent: false, present: false, value: null },
            weeklyReviewContextStep: { parentPresent: false, present: false, value: null },
        } } });
        const { envelope } = await plannedReview(env, { type: 'dailyReviewFocusStep', value: false });
        env.changeSaved((data) => ({ ...data, settings: { ...data.settings,
            gtd: { ...data.settings.gtd, dailyReview: {} } } }));
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(env.saves()).toBe(0);
        for (const bad of [null, [], 'bad', { includeFocusStep: 'false' }]) {
            const start = initial(); start.settings.gtd = { ...start.settings.gtd, dailyReview: bad as never };
            const other = await open(start);
            expect(await other.host.getGtdReviewOptions({})).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
        }
        for (const bad of [null, [], 'bad', { includeContextStep: 'false' }]) {
            const start = initial(); start.settings.gtd = { ...start.settings.gtd, weeklyReview: bad as never };
            const other = await open(start);
            expect(await other.host.getGtdReviewOptions({})).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
        }
        const start = initial(); start.settings.gtd = { ...start.settings.gtd,
            taskEditor: { order: 'bad-order' } as never, pomodoro: 'bad-pomodoro' as never };
        const other = await open(start);
        expect(await other.host.getGtdReviewOptions({})).toMatchObject({ ok: true });
    });

    it('keeps shared Review default and exact stored no-write policy', async () => {
        for (const type of ['dailyReviewFocusStep', 'weeklyReviewContextStep'] as const) {
            const absent = await open(initial());
            const options = await absent.host.getGtdReviewOptions({});
            if (!options.ok) throw new Error(JSON.stringify(options));
            const toggle = type === 'dailyReviewFocusStep'
                ? options.value.review.dailyFocusStep : options.value.review.weeklyContextStep;
            expect(toggle).toMatchObject({ value: true, edit: { type, value: false } });
            // Materializing true from absence differs from raw storage and is
            // not the edit offered by RN's shared toggle model.
            expect(await absent.host.prepareGtdWorkflow({ requestId: ID,
                edit: { type, value: true }, expected: options.value.expected[type] }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(absent.saves()).toBe(0);
            for (const value of [true, false]) {
                const start = initial();
                start.settings.gtd = { ...start.settings.gtd,
                    [type === 'dailyReviewFocusStep' ? 'dailyReview' : 'weeklyReview']:
                        { [type === 'dailyReviewFocusStep' ? 'includeFocusStep' : 'includeContextStep']: value } };
                const env = await open(start);
                const current = await env.host.getGtdReviewOptions({});
                if (!current.ok) throw new Error(JSON.stringify(current));
                expect(await env.host.prepareGtdWorkflow({ requestId: ID,
                    edit: { type, value }, expected: current.value.expected[type] }))
                    .toMatchObject({ ok: true, value: { kind: 'noop', result: { changed: false } } });
                expect(env.saves()).toBe(0);
            }
        }
    });

    it('refuses an independently changed selected bool or GTD group stamp', async () => {
        for (const change of [
            (data: AppData) => ({ ...data, settings: { ...data.settings,
                gtd: { ...data.settings.gtd, dailyReview: { includeFocusStep: true } } } }),
            (data: AppData) => ({ ...data, settings: { ...data.settings,
                syncPreferencesUpdatedAt: { ...data.settings.syncPreferencesUpdatedAt,
                    gtd: '2026-09-02T00:00:00.000Z' } } }),
        ]) {
            const env = await open(initial());
            const { envelope } = await plannedReview(env, { type: 'dailyReviewFocusStep', value: false });
            env.changeSaved(change);
            expect(await env.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
                error: { code: 'STALE_REVISION' } });
            expect(env.saves()).toBe(0);
        }
    });

    it('rejects forged nested no-ops and changed field/group receipts', async () => {
        const env = await open(initial());
        const { envelope, request } = await plannedReview(env, { type: 'weeklyReviewContextStep', value: false });
        const unavailable = structuredClone(envelope);
        unavailable.request.edit.value = true;
        unavailable.prepared.request.edit.value = true;
        unavailable.prepared.after.value = true;
        unavailable.prepared.result.value = true;
        expect(env.host.validatePreparedGtdWorkflow(unavailable)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(await env.host.commitPreparedGtdWorkflow(unavailable)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const forged = structuredClone(envelope);
        forged.request.expected = { parentPresent: true, present: true, value: false,
            stampPresent: true, stamp: AT };
        forged.prepared.request.expected = forged.request.expected;
        expect(env.host.validatePreparedGtdWorkflow(forged)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const malformed = structuredClone(envelope);
        (malformed.request.expected as Record<string, unknown>).parentPresent = false;
        (malformed.request.expected as Record<string, unknown>).present = true;
        expect(env.host.validatePreparedGtdWorkflow(malformed)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        env.changeSaved((data) => ({ ...data, settings: { ...data.settings,
            gtd: { ...data.settings.gtd, weeklyReview: { includeContextStep: false } },
            syncPreferencesUpdatedAt: { ...data.settings.syncPreferencesUpdatedAt,
                gtd: '2026-09-02T00:00:00.000Z' } } }));
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(env.host.probeGtdWorkflowOutcome(request)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(env.saves()).toBe(0);
    });
});
