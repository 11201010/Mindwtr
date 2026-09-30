import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract } from './native-host-contract';
import { canStarNewCapture } from './focus-star';
import { normalizeFocusTaskLimit } from './focus-utils';
import { getProcessInboxDefaultScheduleTime } from './process-inbox-model';
import { createQuickCaptureOptions, resolveQuickCaptureDefaultAreaId } from './quick-capture-model';
import type { GtdWorkflowEdit, NativeGtdWorkflowRequest } from './native-host-contract-gtd-workflow';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Area, Task } from './types';
import { generateUUID } from './uuid';

const ID = '00000000-0000-4000-8000-000000000103';
const AT = '2026-09-01T00:00:00.000Z';
const terminal: Task = { id: 'gtd-terminal', title: 'Terminal', status: 'done', tags: [], contexts: [],
    focusOrder: 9, deletedAt: AT, createdAt: AT, updatedAt: AT, rev: 7 };
const workArea: Area = { id: 'area-work', name: 'Work', order: 0, createdAt: AT, updatedAt: AT, rev: 1, revBy: 'gtd-device' };
const homeArea: Area = { id: 'area-home', name: 'Home', order: 1, createdAt: AT, updatedAt: AT };
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

type InboxType = 'inboxTwoMinute' | 'inboxProjectFirst' | 'inboxContextStep' | 'inboxSchedule';
const inboxField: Record<InboxType, string> = {
    inboxTwoMinute: 'twoMinuteEnabled', inboxProjectFirst: 'projectFirst',
    inboxContextStep: 'contextStepEnabled', inboxSchedule: 'scheduleEnabled',
};
const inboxToggle = { inboxTwoMinute: 'twoMinute', inboxProjectFirst: 'projectFirst',
    inboxContextStep: 'contextStep', inboxSchedule: 'schedule' } as const;
async function plannedInbox(env: Awaited<ReturnType<typeof open>>,
    edit: { type: InboxType; value: boolean }) {
    const options = await env.host.getGtdInboxOptions({});
    if (!options.ok) throw new Error(JSON.stringify(options));
    const request: NativeGtdWorkflowRequest = { requestId: ID, edit, expected: options.value.expected[edit.type] };
    const plan = await env.host.prepareGtdWorkflow(request);
    if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
    return { options: options.value, request, prepared: plan.value.prepared,
        envelope: { request, prepared: plan.value.prepared } };
}

async function plannedArea(env: Awaited<ReturnType<typeof open>>, value: string) {
    const options = await env.host.getGtdCaptureAreaOptions({ offset: 0, limit: 50 });
    if (!options.ok) throw new Error(JSON.stringify(options));
    const request: NativeGtdWorkflowRequest = { requestId: ID, edit: { type: 'defaultArea', value },
        expected: options.value.expected };
    const plan = await env.host.prepareGtdWorkflow(request);
    if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
    return { options: options.value, request, prepared: plan.value.prepared,
        envelope: { request, prepared: plan.value.prepared } };
}

type CaptureParseType = 'quickAddAutoClean' | 'naturalLanguageDates';
async function plannedCaptureParse(env: Awaited<ReturnType<typeof open>>,
    edit: { type: CaptureParseType; value: boolean }) {
    const options = await env.host.getGtdCaptureParseOptions({});
    if (!options.ok) throw new Error(JSON.stringify(options));
    const request: NativeGtdWorkflowRequest = { requestId: ID, edit, expected: options.value.expected[edit.type] };
    const plan = await env.host.prepareGtdWorkflow(request);
    if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
    return { options: options.value, request, prepared: plan.value.prepared,
        envelope: { request, prepared: plan.value.prepared } };
}

type EditorSection = 'scheduling' | 'organization' | 'details';
async function plannedEditorSection(env: Awaited<ReturnType<typeof open>>, section: EditorSection, value: boolean) {
    const options = await env.host.getGtdTaskEditorOpenOptions({});
    if (!options.ok) throw new Error(JSON.stringify(options));
    const request: NativeGtdWorkflowRequest = { requestId: ID,
        edit: { type: 'taskEditorSectionOpen', section, value }, expected: options.value.expected[section] };
    const plan = await env.host.prepareGtdWorkflow(request);
    if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
    return { options: options.value, request, prepared: plan.value.prepared,
        envelope: { request, prepared: plan.value.prepared } };
}

async function plannedPreset(env: Awaited<ReturnType<typeof open>>, value: 'simple' | 'standard' | 'full') {
    const options = await env.host.getGtdTaskEditorPresetOptions({});
    if (!options.ok) throw new Error(JSON.stringify(options));
    const request: NativeGtdWorkflowRequest = { requestId: ID,
        edit: { type: 'taskEditorPreset', value }, expected: options.value.expected };
    const plan = await env.host.prepareGtdWorkflow(request);
    if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
    return { options: options.value, request, prepared: plan.value.prepared,
        envelope: { request, prepared: plan.value.prepared } };
}

afterEach(async () => { vi.useRealTimers(); await flushPendingSave(); resetForTests(); });

describe('prepared GTD Task Editor presets', () => {
    it.each(['simple', 'standard', 'full'] as const)('uses shared %s preset layout and exact composite receipt', async (value) => {
        const start = initial();
        start.tasks.push({ id: 'preset-editor', title: 'Preset editor', status: 'next', tags: [], contexts: [],
            createdAt: AT, updatedAt: AT });
        start.settings.features = { priorities: false, timeEstimates: false };
        const env = await open(start);
        const { options, envelope, prepared } = await plannedPreset(env, value);
        expect(options.taskEditor.presets.options).toHaveLength(3);
        expect(options.taskEditor.presets.options.find((option) => option.value === value)?.edit)
            .toEqual({ type: 'taskEditorPreset', value });
        expect(options.expected).toMatchObject({ taskEditorPresent: false, featuresPresent: true,
            priorities: { present: true, value: false }, timeEstimates: { present: true, value: false } });
        expect(Object.keys(prepared.after).sort()).toEqual(['selected', 'stamp', 'value']);
        expect(prepared.after.selected).toMatchObject({ taskEditorPresent: true, featuresPresent: true,
            priorities: { present: true, value: false }, timeEstimates: { present: true, value: false },
            order: { present: true }, hidden: { present: true }, sections: { present: true },
            sectionOpen: { present: true } });
        expect(env.host.validatePreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(JSON.stringify(envelope)).not.toContain('private-value');
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(env.data().settings.features).toEqual(start.settings.features);
        expect(env.data().settings.gtd?.taskEditor).toMatchObject({
            order: prepared.after.selected?.order.value, hidden: prepared.after.selected?.hidden.value,
            sections: prepared.after.selected?.sections.value, sectionOpen: prepared.after.selected?.sectionOpen.value });
        expect(env.data().tasks).toEqual(start.tasks);
        const editor = env.host.getTaskEditorModel({ id: 'preset-editor' });
        if (!editor.ok) throw new Error(JSON.stringify(editor));
        const visible = editor.value.layout.sections.flatMap((section) => section.fields);
        expect(visible.includes('description')).toBe(value !== 'simple');
        expect(visible).not.toContain('priority');
        const cold = await env.reopen();
        expect(await cold.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(cold.saves()).toBe(0);
    });

    it('preserves unknown siblings, exposes custom layout, and rejects forged composite receipts', async () => {
        const start = initial();
        start.settings.gtd = { ...start.settings.gtd, taskEditor: { order: ['description'],
            hidden: ['tags'], sections: {}, sectionOpen: {}, legacy: 'keep' } as never };
        start.settings.features = { priorities: false, timeEstimates: true, legacy: 'keep' } as never;
        const env = await open(start);
        const { options, envelope, prepared } = await plannedPreset(env, 'full');
        expect(options.taskEditor.presets.custom).toBeTruthy();
        const forged = structuredClone(envelope);
        forged.prepared.after.selected!.hidden.value = ['tags'];
        expect(env.host.validatePreparedGtdWorkflow(forged)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(env.data().settings.gtd?.taskEditor).toMatchObject({ legacy: 'keep' });
        expect(env.data().settings.features).toEqual(start.settings.features);
    });

    it('distinguishes absent feature flags from explicit false and rejects every forged layout field', async () => {
        const env = await open(initial());
        const { options, envelope } = await plannedPreset(env, 'full');
        expect(options.expected).toMatchObject({ featuresPresent: false,
            priorities: { present: false, value: null }, timeEstimates: { present: false, value: null } });
        for (const field of ['order', 'hidden', 'sections', 'sectionOpen'] as const) {
            const forged = structuredClone(envelope);
            forged.prepared.after.selected![field].present = false;
            expect(env.host.validatePreparedGtdWorkflow(forged)).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
        }
        const forgedFeature = structuredClone(envelope);
        forgedFeature.request.expected.featuresPresent = true;
        expect(env.host.validatePreparedGtdWorkflow(forgedFeature)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(env.saves()).toBe(0);
    });

    it('keeps no-op and raw validation exact without reading unrelated GTD siblings', async () => {
        const malformed = await open(initial());
        malformed.changeSaved((data) => ({ ...data, settings: { ...data.settings,
            gtd: { ...data.settings.gtd, taskEditor: { order: 'malformed-relevant' } as never } } }));
        expect(await malformed.host.getGtdTaskEditorPresetOptions({})).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(malformed.saves()).toBe(0);
        const env = await open(initial());
        const first = await plannedPreset(env, 'standard');
        expect(await env.host.commitPreparedGtdWorkflow(first.envelope)).toMatchObject({ ok: true });
        const options = await env.host.getGtdTaskEditorPresetOptions({});
        if (!options.ok) throw new Error(JSON.stringify(options));
        expect(options.value.taskEditor.presets.options.find((option) => option.value === 'standard')?.selected).toBe(true);
        expect(await env.host.prepareGtdWorkflow({ requestId: ID,
            edit: { type: 'taskEditorPreset', value: 'standard' }, expected: options.value.expected })).toMatchObject({ ok: true,
            value: { kind: 'noop', result: { changed: false } } });
        expect(env.saves()).toBe(1);
    });
});

describe('prepared GTD workflow defaults', () => {
    it.each(['scheduling', 'organization', 'details'] as const)('uses the shared $section section default and a selected-key receipt', async (section) => {
        const start = initial();
        start.tasks.push({ id: 'editor-empty', title: 'Empty editor', status: 'next', tags: [], contexts: [],
            createdAt: AT, updatedAt: AT });
        const env = await open(start);
        const { options, envelope, prepared } = await plannedEditorSection(env, section, true);
        expect(Object.keys(options.expected).sort()).toEqual(['scheduling', 'organization', 'details'].sort());
        expect(options.expected[section]).toEqual({ taskEditorPresent: false, sectionOpenPresent: false,
            present: false, value: null, stampPresent: true, stamp: AT });
        const row = options.taskEditor.groups.find((group) => group.id === section);
        expect(row?.defaultOpen).toMatchObject({ value: false,
            edit: { type: 'taskEditorSectionOpen', section, value: true } });
        expect(prepared.after).toMatchObject({ value: true,
            selected: { taskEditorPresent: true, sectionOpenPresent: true, present: true, value: true } });
        expect(prepared.result).toEqual({ type: 'taskEditorSectionOpen', section, value: true, changed: true });
        expect(env.host.validatePreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(JSON.stringify(envelope)).not.toContain('private-value');
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(env.data().settings.gtd?.taskEditor?.sectionOpen?.[section]).toBe(true);
        expect(env.data().settings.gtd).toMatchObject({ focusGroupBy: 'project', legacySibling: { marker: 103 } });
        expect(env.data().tasks).toEqual(start.tasks);
        const editor = env.host.getTaskEditorModel({ id: 'editor-empty' });
        if (!editor.ok) throw new Error(JSON.stringify(editor));
        expect(editor.value.layout.sections.find((group) => group.id === section)?.open).toBe(true);
        const cold = await env.reopen();
        expect(await cold.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(cold.saves()).toBe(0);
    });

    it('deletes the selected default key via the shared update while retaining sibling layout', async () => {
        const start = initial();
        start.settings.gtd = { ...start.settings.gtd, taskEditor: { sectionOpen: { scheduling: true,
            organization: true, legacy: 'keep' } } as never };
        const env = await open(start);
        const { envelope, prepared } = await plannedEditorSection(env, 'scheduling', false);
        expect(prepared.after.selected).toEqual({ taskEditorPresent: true, sectionOpenPresent: true,
            present: false, value: null });
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(env.data().settings.gtd?.taskEditor?.sectionOpen).toEqual({ organization: true, legacy: 'keep' });
        const cold = await env.reopen();
        expect(await cold.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(cold.saves()).toBe(0);
    });

    it('rejects unoffered and forged section plans without saving', async () => {
        const env = await open(initial());
        const options = await env.host.getGtdTaskEditorOpenOptions({});
        if (!options.ok) throw new Error(JSON.stringify(options));
        const request: NativeGtdWorkflowRequest = { requestId: ID,
            edit: { type: 'taskEditorSectionOpen', section: 'details', value: false },
            expected: options.value.expected.details };
        expect(await env.host.prepareGtdWorkflow(request)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const { envelope } = await plannedEditorSection(env, 'details', true);
        const wrongSection = structuredClone(envelope); wrongSection.prepared.result = {
            type: 'taskEditorSectionOpen', section: 'scheduling', value: true, changed: true };
        expect(env.host.validatePreparedGtdWorkflow(wrongSection)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const wrongParent = structuredClone(envelope); wrongParent.prepared.after.selected!.taskEditorPresent = false;
        expect(env.host.validatePreparedGtdWorkflow(wrongParent)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const wrongMap = structuredClone(envelope); wrongMap.prepared.after.selected!.sectionOpenPresent = false;
        expect(env.host.validatePreparedGtdWorkflow(wrongMap)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const wrongKey = structuredClone(envelope); wrongKey.prepared.after.selected!.present = false;
        expect(env.host.validatePreparedGtdWorkflow(wrongKey)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(env.saves()).toBe(0);
    });

    it('keeps shared exact no-op behavior and refuses malformed relevant raw section values', async () => {
        const empty = initial(); empty.settings.gtd = { ...empty.settings.gtd,
            taskEditor: { sectionOpen: {} } };
        const env = await open(empty);
        const options = await env.host.getGtdTaskEditorOpenOptions({});
        if (!options.ok) throw new Error(JSON.stringify(options));
        expect(await env.host.prepareGtdWorkflow({ requestId: ID,
            edit: { type: 'taskEditorSectionOpen', section: 'details', value: false },
            expected: options.value.expected.details })).toMatchObject({ ok: true,
            value: { kind: 'noop', result: { type: 'taskEditorSectionOpen', section: 'details', value: false, changed: false } } });
        expect(env.saves()).toBe(0);
        for (const bad of [
            { taskEditor: 'bad-parent' },
            { taskEditor: { sectionOpen: 'bad-map' } },
            { taskEditor: { sectionOpen: { details: 'false' } } },
        ]) {
            const start = initial(); start.settings.gtd = { ...start.settings.gtd, ...bad } as never;
            const malformed = await open(start);
            expect(await malformed.host.getGtdTaskEditorOpenOptions({})).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
            expect(malformed.saves()).toBe(0);
        }
        const unrelated = initial(); unrelated.settings.gtd = { ...unrelated.settings.gtd,
            taskEditor: { order: 'bad-legacy-order', sectionOpen: { details: false } } as never };
        const preserved = await open(unrelated);
        const { envelope } = await plannedEditorSection(preserved, 'details', true);
        expect(await preserved.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: true });
        expect(preserved.data().settings.gtd?.taskEditor).toMatchObject({ order: 'bad-legacy-order',
            sectionOpen: { details: true } });
    });

    it('opens a filled Details section despite its closed default without writing a Task', async () => {
        const start = initial(); start.tasks.push({ id: 'editor-filled', title: 'Filled editor', status: 'next',
            description: 'Already has content', tags: [], contexts: [], createdAt: AT, updatedAt: AT });
        const env = await open(start);
        const editor = env.host.getTaskEditorModel({ id: 'editor-filled' });
        if (!editor.ok) throw new Error(JSON.stringify(editor));
        expect(editor.value.layout.sections.find((group) => group.id === 'details')).toMatchObject({ open: true });
        expect(env.saves()).toBe(0);
        expect(env.data().tasks).toEqual(start.tasks);
    });
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

describe('GTD Capture Default Area in the v1 workflow journal', () => {
    it('pages shared choices with an Area-sensitive revision and a coherent saved pair witness', async () => {
        const start = initial(); start.areas = [homeArea, workArea];
        const env = await open(start);
        const first = await env.host.getGtdCaptureAreaOptions({ offset: 0, limit: 2 });
        if (!first.ok) throw new Error(JSON.stringify(first));
        expect(first.value).toMatchObject({ offset: 0, total: 4,
            expected: { modePresent: false, mode: null, idPresent: false, id: null, stampPresent: true, stamp: AT },
            capture: { defaultArea: { value: expect.any(String), options: [
                { value: '', edit: { type: 'defaultArea', value: '' } },
                { value: '__active-area__', edit: { type: 'defaultArea', value: '__active-area__' } }] } } });
        const next = await env.host.getGtdCaptureAreaOptions({ offset: 2, limit: 2, revision: first.value.revision });
        expect(next).toMatchObject({ ok: true, value: { offset: 2, total: 4,
            expected: first.value.expected, capture: { defaultArea: { options: [
                { value: 'area-work' }, { value: 'area-home' }] } } } });
        expect(await env.host.getGtdCaptureAreaOptions({ offset: 2, limit: 2 })).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        env.changeSaved((data) => ({ ...data, areas: data.areas.map((area) => area.id === 'area-home'
            ? { ...area, order: -1, updatedAt: '2026-09-02T00:00:00.000Z' } : area) }));
        expect(await env.host.getGtdCaptureAreaOptions({ offset: 2, limit: 2, revision: first.value.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });

    it('writes only the raw pair/stamp, cold-replays, and changes a fresh Quick Capture default', async () => {
        const start = initial(); start.areas = [workArea, homeArea];
        start.settings.gtd = { ...start.settings.gtd, taskEditor: { order: 'bad-legacy' } as never };
        const env = await open(start);
        const beforeDraft = env.host.openQuickCapture();
        expect(beforeDraft).toMatchObject({ ok: true, value: { options: { areaId: null } } });
        const { envelope, prepared } = await plannedArea(env, 'area-work');
        expect(prepared.targetArea).toEqual({ id: 'area-work', createdAt: AT, updatedAt: AT,
            revPresent: true, rev: 1, revByPresent: true, revBy: 'gtd-device' });
        expect(Object.keys(prepared.request.expected).sort()).toEqual([
            'modePresent', 'mode', 'idPresent', 'id', 'stampPresent', 'stamp'].sort());
        expect(env.host.validatePreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(JSON.stringify(envelope)).not.toContain('bad-legacy');
        expect(JSON.stringify(envelope)).not.toContain('Work');
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(env.saves()).toBe(1);
        expect(env.data().settings.gtd).toEqual({ ...start.settings.gtd,
            defaultAreaMode: 'fixed', defaultAreaId: 'area-work' });
        expect(env.data().settings.syncPreferencesUpdatedAt?.gtd).toBe(prepared.after.stamp);
        expect(env.data().tasks).toEqual(start.tasks);
        expect(beforeDraft).toMatchObject({ ok: true, value: { options: { areaId: null } } });
        expect(env.host.openQuickCapture()).toMatchObject({ ok: true, value: { options: { areaId: 'area-work' } } });
        const cold = await env.reopen();
        expect(await cold.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(cold.saves()).toBe(0);
        expect(cold.host.openQuickCapture()).toMatchObject({ ok: true, value: { options: { areaId: 'area-work' } } });
    });

    it('uses Active filter only for a fresh capture and explicitly clears a stale fixed Area', async () => {
        const start = initial(); start.areas = [workArea, homeArea];
        start.settings.filters = { areaId: 'area-home' };
        const env = await open(start);
        const active = await plannedArea(env, '__active-area__');
        expect(active.prepared.targetArea).toBeNull();
        expect(await env.host.commitPreparedGtdWorkflow(active.envelope)).toMatchObject({ ok: true });
        expect(env.data().settings.gtd).toMatchObject({ defaultAreaMode: 'active', defaultAreaId: null });
        expect(env.host.openQuickCapture()).toMatchObject({ ok: true, value: { options: { areaId: 'area-home' } } });
        const cold = await env.reopen();
        expect(cold.host.openQuickCapture()).toMatchObject({ ok: true, value: { options: { areaId: 'area-home' } } });

        const gone = initial(); gone.areas = [{ ...workArea, deletedAt: AT }];
        gone.settings.gtd = { ...gone.settings.gtd, defaultAreaMode: 'fixed', defaultAreaId: 'area-work' };
        const missing = await open(gone);
        const page = await missing.host.getGtdCaptureAreaOptions({ offset: 0, limit: 10 });
        expect(page).toMatchObject({ ok: true, value: { expected: { modePresent: true, mode: 'fixed',
            idPresent: true, id: 'area-work' }, capture: { defaultArea: { options: [
                { value: '', selected: true }, { value: '__active-area__', selected: false }] } } } });
        const clear = await plannedArea(missing, '');
        expect(await missing.host.commitPreparedGtdWorkflow(clear.envelope)).toMatchObject({ ok: true });
        expect(missing.data().settings.gtd).toMatchObject({ defaultAreaMode: 'none', defaultAreaId: null });
    });

    it('refuses forged plans, stale selected Areas, and independent same-destination pair writes', async () => {
        const start = initial(); start.areas = [workArea, homeArea];
        const env = await open(start);
        const { envelope } = await plannedArea(env, 'area-work');
        for (const change of [
            (copy: typeof envelope) => { copy.prepared.targetArea = null; },
            (copy: typeof envelope) => { copy.prepared.targetArea = { ...copy.prepared.targetArea!, id: 'area-home' }; },
            (copy: typeof envelope) => { copy.prepared.after.stamp = AT; },
            (copy: typeof envelope) => { copy.prepared.result.changed = false; },
            (copy: typeof envelope) => { delete copy.prepared.targetArea; },
        ]) {
            const forged = structuredClone(envelope); change(forged);
            expect(env.host.validatePreparedGtdWorkflow(forged)).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
        }
        env.changeSaved((data) => ({ ...data, areas: data.areas.map((area) => area.id === 'area-work'
            ? { ...area, updatedAt: '2026-09-02T00:00:00.000Z', rev: 2 } : area) }));
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(env.saves()).toBe(0);
        env.changeSaved((data) => ({ ...data, areas: start.areas,
            settings: { ...data.settings, gtd: { ...data.settings.gtd,
                defaultAreaMode: 'fixed', defaultAreaId: 'area-work' },
                syncPreferencesUpdatedAt: { ...data.settings.syncPreferencesUpdatedAt,
                    gtd: '2026-09-03T00:00:00.000Z' } } }));
        const cold = await env.reopen();
        expect(await cold.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(cold.saves()).toBe(0);
    });

    it('keeps raw absence/null/unknown distinct and ignores malformed unrelated GTD siblings', async () => {
        const start = initial(); start.areas = [workArea];
        start.settings.gtd = { ...start.settings.gtd, defaultAreaMode: 'legacy-unknown' as never,
            defaultAreaId: null, pomodoro: 7 as never };
        const env = await open(start);
        const options = await env.host.getGtdCaptureAreaOptions({ offset: 0, limit: 10 });
        expect(options).toMatchObject({ ok: true, value: { expected: { modePresent: true,
            mode: 'legacy-unknown', idPresent: true, id: null } } });
        const plan = await plannedArea(env, 'area-work');
        expect(await env.host.commitPreparedGtdWorkflow(plan.envelope)).toMatchObject({ ok: true });
        expect(env.data().settings.gtd?.pomodoro).toBe(7);
        for (const bad of [{ defaultAreaMode: {} }, { defaultAreaId: 9 }, { defaultAreaId: [] }]) {
            const malformed = initial(); malformed.settings.gtd = { ...malformed.settings.gtd, ...bad } as never;
            const other = await open(malformed);
            expect(await other.host.getGtdCaptureAreaOptions({ offset: 0, limit: 10 })).toMatchObject({
                ok: false, error: { code: 'INVALID_INPUT' } });
        }
        const storedNone = initial(); storedNone.settings.gtd = { defaultAreaMode: 'none', defaultAreaId: null };
        const none = await open(storedNone);
        const read = await none.host.getGtdCaptureAreaOptions({ offset: 0, limit: 10 });
        if (!read.ok) throw new Error(JSON.stringify(read));
        expect(await none.host.prepareGtdWorkflow({ requestId: ID, edit: { type: 'defaultArea', value: '' },
            expected: read.value.expected })).toMatchObject({ ok: true,
                value: { kind: 'noop', result: { type: 'defaultArea', value: '', changed: false } } });
    });

    it('resolves Active from live/All/None filters without overriding an explicit capture preset', async () => {
        for (const [filter, expected] of [
            ['area-work', 'area-work'], ['__all__', null], ['__none__', null],
        ] as const) {
            const start = initial(); start.areas = [workArea, homeArea];
            start.settings.gtd = { ...start.settings.gtd, defaultAreaMode: 'active', defaultAreaId: null };
            start.settings.filters = { areaId: filter };
            const env = await open(start);
            expect(env.host.openQuickCapture()).toMatchObject({ ok: true, value: { options: { areaId: expected } } });
            const resolved = resolveQuickCaptureDefaultAreaId(env.data().settings, env.data().areas);
            expect(resolved).toBe(expected);
            expect(createQuickCaptureOptions({ projects: [], defaultAreaId: resolved,
                initialProps: { areaId: 'area-home' } }).areaId).toBe('area-home');
        }
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

describe('GTD Inbox variants in the original v1 workflow journal', () => {
    it.each([
        { type: 'inboxTwoMinute', value: false, defaultValue: true },
        { type: 'inboxProjectFirst', value: true, defaultValue: false },
        { type: 'inboxContextStep', value: false, defaultValue: true },
        { type: 'inboxSchedule', value: true, defaultValue: false },
    ] as const)('saves $type with its shared default and only selected raw field', async (edit) => {
        const start = initial();
        start.settings.gtd = { ...start.settings.gtd,
            inboxProcessing: { legacyInbox: { marker: 105 } } as never,
            pomodoro: 'malformed-unrelated' as never };
        const env = await open(start);
        const { options, envelope, prepared } = await plannedInbox(env, { type: edit.type, value: edit.value });
        expect(Object.keys(options.expected).sort()).toEqual(Object.keys(inboxField).sort());
        expect(options.expected[edit.type]).toEqual({ parentPresent: true, present: false,
            value: null, stampPresent: true, stamp: AT });
        expect(options.inbox[inboxToggle[edit.type]]).toMatchObject({ value: edit.defaultValue,
            edit: { type: edit.type, value: edit.value } });
        expect(prepared.version).toBe(1);
        expect(Object.keys(envelope.request.expected).sort()).toEqual([
            'parentPresent', 'present', 'stamp', 'stampPresent', 'value']);
        expect(JSON.stringify(envelope)).not.toContain('legacyInbox');
        expect(env.host.validatePreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        const saved = env.data();
        expect((saved.settings.gtd?.inboxProcessing as Record<string, unknown>)[inboxField[edit.type]]).toBe(edit.value);
        expect(saved.settings.gtd?.inboxProcessing).toMatchObject({ legacyInbox: { marker: 105 } });
        expect(saved.settings.syncPreferencesUpdatedAt?.gtd).toBe(prepared.after.stamp);
        expect(saved.tasks).toEqual(start.tasks);
        const cold = await env.reopen();
        expect(await cold.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(cold.saves()).toBe(0);
    });

    it('applies the two on and two off defaults as offered flips, refusing absent materialization', async () => {
        for (const type of Object.keys(inboxField) as InboxType[]) {
            const env = await open(initial());
            const options = await env.host.getGtdInboxOptions({});
            if (!options.ok) throw new Error(JSON.stringify(options));
            const offered = options.value.inbox[inboxToggle[type]].edit;
            expect(options.value.expected[type]).toEqual({ parentPresent: false, present: false,
                value: null, stampPresent: true, stamp: AT });
            expect(await env.host.prepareGtdWorkflow({ requestId: ID,
                edit: { type, value: !offered.value }, expected: options.value.expected[type] }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            const { envelope } = await plannedInbox(env, { type, value: offered.value });
            const forged = structuredClone(envelope);
            forged.request.edit.value = !offered.value;
            forged.prepared.request.edit.value = !offered.value;
            forged.prepared.after.value = !offered.value;
            forged.prepared.result.value = !offered.value;
            expect(env.host.validatePreparedGtdWorkflow(forged)).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
            expect(env.saves()).toBe(0);
            for (const value of [true, false]) {
                const start = initial();
                start.settings.gtd = { ...start.settings.gtd,
                    inboxProcessing: { [inboxField[type]]: value } };
                const present = await open(start);
                const current = await present.host.getGtdInboxOptions({});
                if (!current.ok) throw new Error(JSON.stringify(current));
                expect(await present.host.prepareGtdWorkflow({ requestId: ID,
                    edit: { type, value }, expected: current.value.expected[type] }))
                    .toMatchObject({ ok: true, value: { kind: 'noop', result: { changed: false } } });
                expect(present.saves()).toBe(0);
            }
        }
    });

    it('refuses malformed relevant rows and a changed parent, field, or GTD stamp', async () => {
        for (const bad of [null, [], 'bad', { twoMinuteEnabled: 'false' }, { scheduleEnabled: 1 }]) {
            const start = initial(); start.settings.gtd = { ...start.settings.gtd, inboxProcessing: bad as never };
            const env = await open(start);
            expect(await env.host.getGtdInboxOptions({})).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
        }
        for (const change of [
            (data: AppData) => ({ ...data, settings: { ...data.settings,
                gtd: { ...data.settings.gtd, inboxProcessing: {} } } }),
            (data: AppData) => ({ ...data, settings: { ...data.settings,
                gtd: { ...data.settings.gtd, inboxProcessing: { scheduleEnabled: true } } } }),
            (data: AppData) => ({ ...data, settings: { ...data.settings,
                syncPreferencesUpdatedAt: { ...data.settings.syncPreferencesUpdatedAt,
                    gtd: '2026-09-02T00:00:00.000Z' } } }),
        ]) {
            const env = await open(initial());
            const { envelope } = await plannedInbox(env, { type: 'inboxSchedule', value: true });
            env.changeSaved(change);
            expect(await env.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
                error: { code: 'STALE_REVISION' } });
            expect(env.saves()).toBe(0);
        }
    });

    it('makes all four saved choices visible in a fresh real Process Inbox session', async () => {
        const start = initial();
        start.tasks.push({ ...terminal, id: 'gtd-inbox-candidate', title: 'Sort mail', status: 'inbox',
            deletedAt: undefined, focusOrder: undefined });
        const env = await open(start);
        const baseline = env.host.startInboxProcessing({ mode: 'quick' });
        if (!baseline.ok || !baseline.value.view) throw new Error(JSON.stringify(baseline));
        expect(baseline.value.view.choices.map((choice) => choice.id)).toContain('done');
        expect(baseline.value.view.projectFirst).toBe(false);
        for (const edit of [
            { type: 'inboxTwoMinute', value: false }, { type: 'inboxProjectFirst', value: true },
            { type: 'inboxContextStep', value: false }, { type: 'inboxSchedule', value: true },
        ] as const) {
            const { envelope } = await plannedInbox(env, edit);
            expect(await env.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: true });
        }
        const cold = await env.reopen();
        const quick = cold.host.startInboxProcessing({ mode: 'quick' });
        if (!quick.ok || !quick.value.view) throw new Error(JSON.stringify(quick));
        expect(quick.value.view.choices.map((choice) => choice.id)).not.toContain('done');
        expect(quick.value.view.projectFirst).toBe(true);
        const guided = cold.host.startInboxProcessing({ mode: 'guided' });
        if (!guided.ok || !guided.value.view) throw new Error(JSON.stringify(guided));
        const sessionId = guided.value.sessionId!;
        let view = guided.value.view;
        const choose = async (choice: string) => {
            const next = await cold.host.commitInboxProcessingStep({ sessionId, taskId: view.taskId,
                step: view.step, decision: { choice }, requestId: generateUUID() });
            if (!next.ok || !next.value.view) throw new Error(JSON.stringify(next));
            view = next.value.view;
        };
        expect(view.step).toBe('actionable');
        await choose('actionable');
        expect(view.step).toBe('execution');
        await choose('defer');
        await choose('single');
        expect(view.step).toBe('file');
        expect(view.contexts).toBeNull();
        expect(view.projectFirst).toBe(true);
        const expanded = cold.host.getInboxProcessingStep({ sessionId, taskId: view.taskId,
            step: view.step, edit: { type: 'toggleAdvancedOptions' } });
        if (!expanded.ok) throw new Error(JSON.stringify(expanded));
        expect(expanded.value.moreOptions?.scheduling?.rows.map((row) => row.field))
            .toEqual(['startTime', 'dueDate', 'reviewAt']);
    });
});

describe('GTD Capture parser toggles in the original v1 workflow journal', () => {
    it.each([
        { type: 'naturalLanguageDates', value: false, shown: true },
        { type: 'quickAddAutoClean', value: true, shown: false },
    ] as const)('saves $type and preserves unrelated raw siblings', async (edit) => {
        const start = initial();
        start.settings.gtd = { ...start.settings.gtd, taskEditor: 'malformed-unrelated' as never };
        const env = await open(start);
        const { options, envelope, prepared } = await plannedCaptureParse(env,
            { type: edit.type, value: edit.value });
        expect(Object.keys(options.capture).sort()).toEqual([
            'title', 'description', 'quickAddAutoClean', 'naturalLanguageDates'].sort());
        expect(Object.keys(options.expected).sort()).toEqual(['naturalLanguageDates', 'quickAddAutoClean']);
        expect(options.capture[edit.type]).toMatchObject({ value: edit.shown, edit: { type: edit.type, value: edit.value } });
        expect(options.expected[edit.type]).toEqual({ present: false, value: null, stampPresent: true, stamp: AT });
        expect(Object.keys(envelope.request.expected).sort()).toEqual(['present', 'stamp', 'stampPresent', 'value']);
        expect(Object.keys(prepared).sort()).toEqual([
            'version', 'request', 'preparedAt', 'deviceIdBefore', 'deviceIdToInitialize', 'after', 'result'].sort());
        expect(JSON.stringify(envelope)).not.toContain('legacySibling');
        expect(env.host.validatePreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(await env.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        const saved = env.data();
        expect(edit.type === 'naturalLanguageDates'
            ? saved.settings.gtd?.naturalLanguageDates : saved.settings.quickAddAutoClean).toBe(edit.value);
        expect(saved.settings.gtd).toMatchObject({ legacySibling: { marker: 103 }, taskEditor: 'malformed-unrelated' });
        expect(saved.settings.syncPreferencesUpdatedAt?.gtd).toBe(prepared.after.stamp);
        expect(saved.tasks).toEqual(start.tasks);
        const cold = await env.reopen();
        expect(await cold.host.commitPreparedGtdWorkflow(envelope)).toEqual({ ok: true, value: prepared.result });
        expect(cold.saves()).toBe(0);
    });

    it('uses shared displayed defaults, refusing absent materialization and present no-ops', async () => {
        for (const type of ['naturalLanguageDates', 'quickAddAutoClean'] as const) {
            const absent = await open(initial());
            const options = await absent.host.getGtdCaptureParseOptions({});
            if (!options.ok) throw new Error(JSON.stringify(options));
            const offered = options.value.capture[type].edit as { type: CaptureParseType; value: boolean };
            expect(await absent.host.prepareGtdWorkflow({ requestId: ID,
                edit: { type, value: !offered.value }, expected: options.value.expected[type] }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            const { envelope } = await plannedCaptureParse(absent, { type, value: offered.value });
            const forged = structuredClone(envelope);
            forged.request.edit.value = !offered.value;
            forged.prepared.request.edit.value = !offered.value;
            forged.prepared.after.value = !offered.value;
            forged.prepared.result.value = !offered.value;
            expect(absent.host.validatePreparedGtdWorkflow(forged)).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
            expect(absent.saves()).toBe(0);
            for (const value of [true, false]) {
                const start = initial();
                if (type === 'quickAddAutoClean') start.settings.quickAddAutoClean = value;
                else start.settings.gtd = { ...start.settings.gtd, naturalLanguageDates: value };
                const present = await open(start);
                const current = await present.host.getGtdCaptureParseOptions({});
                if (!current.ok) throw new Error(JSON.stringify(current));
                expect(await present.host.prepareGtdWorkflow({ requestId: ID,
                    edit: { type, value }, expected: current.value.expected[type] }))
                    .toMatchObject({ ok: true, value: { kind: 'noop', result: { changed: false } } });
                expect(present.saves()).toBe(0);
            }
        }
    });

    it('separates relevant malformed fields from unrelated GTD data and checks field/group CAS', async () => {
        for (const type of ['naturalLanguageDates', 'quickAddAutoClean'] as const) {
            for (const bad of [null, 'yes', 1]) {
                const start = initial();
                if (type === 'quickAddAutoClean') start.settings.quickAddAutoClean = bad as never;
                else start.settings.gtd = { ...start.settings.gtd, naturalLanguageDates: bad as never };
                const env = await open(start);
                expect(await env.host.getGtdCaptureParseOptions({})).toMatchObject({ ok: false,
                    error: { code: 'INVALID_INPUT' } });
            }
        }
        const malformed = initial(); malformed.settings.gtd = 'bad-unrelated' as never;
        const top = await open(malformed);
        expect(await top.host.getGtdCaptureParseOptions({})).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const request: NativeGtdWorkflowRequest = { requestId: ID,
            edit: { type: 'quickAddAutoClean', value: true },
            expected: { present: false, value: null, stampPresent: true, stamp: AT } };
        const plan = await top.host.prepareGtdWorkflow(request);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
        expect(await top.host.commitPreparedGtdWorkflow({ request, prepared: plan.value.prepared }))
            .toMatchObject({ ok: true });
        expect(top.data().settings.gtd).toBe('bad-unrelated');
        expect(top.data().settings.quickAddAutoClean).toBe(true);

        for (const type of ['naturalLanguageDates', 'quickAddAutoClean'] as const) {
            for (const change of [
                (data: AppData) => ({ ...data, settings: { ...data.settings,
                    ...(type === 'quickAddAutoClean' ? { quickAddAutoClean: true }
                        : { gtd: { ...data.settings.gtd, naturalLanguageDates: false } }) } }),
                (data: AppData) => ({ ...data, settings: { ...data.settings,
                    syncPreferencesUpdatedAt: { ...data.settings.syncPreferencesUpdatedAt,
                        gtd: '2026-09-02T00:00:00.000Z' } } }),
            ]) {
                const env = await open(initial());
                const { envelope } = await plannedCaptureParse(env,
                    { type, value: type === 'quickAddAutoClean' });
                env.changeSaved(change);
                expect(await env.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: false,
                    error: { code: 'STALE_REVISION' } });
                expect(env.saves()).toBe(0);
            }
        }
    });

    it.each([
        { dates: true, clean: false, bareDue: true, bareTitle: 'Task107 parser tomorrow' },
        { dates: true, clean: true, bareDue: true, bareTitle: 'Task107 parser' },
        { dates: false, clean: false, bareDue: false, bareTitle: 'Task107 parser tomorrow' },
        { dates: false, clean: true, bareDue: false, bareTitle: 'Task107 parser tomorrow' },
    ])('applies saved parser flags to a fresh Quick Capture ($dates, $clean)', async (row) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));
        const env = await open(initial());
        if (!row.dates) {
            const { envelope } = await plannedCaptureParse(env, { type: 'naturalLanguageDates', value: false });
            expect(await env.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: true });
        }
        if (row.clean) {
            const { envelope } = await plannedCaptureParse(env, { type: 'quickAddAutoClean', value: true });
            expect(await env.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: true });
        }
        const cold = await env.reopen();
        const opened = cold.host.openQuickCapture();
        if (!opened.ok) throw new Error(JSON.stringify(opened));
        const text = 'Task107 parser tomorrow';
        const preview = cold.host.getQuickCaptureView({ text, options: opened.value.options });
        if (!preview.ok) throw new Error(JSON.stringify(preview));
        expect(preview.value.preview.some((chip) => chip.kind === 'due')).toBe(row.bareDue);
        const captureId = generateUUID();
        expect(await cold.host.submitQuickCapture({ text, options: opened.value.options, captureId }))
            .toMatchObject({ ok: true, value: { kind: 'saved', taskId: captureId } });
        const task = cold.data().tasks.find((entry) => entry.id === captureId);
        expect(task?.title).toBe(row.bareTitle);
        expect(Boolean(task?.dueDate)).toBe(row.bareDue);
        if (row.bareDue) expect(task?.dueDate).toContain('2026-10-01');

        const explicit = cold.host.openQuickCapture();
        if (!explicit.ok) throw new Error(JSON.stringify(explicit));
        const explicitId = generateUUID();
        expect(await cold.host.submitQuickCapture({ text: 'Explicit /due:tomorrow',
            options: explicit.value.options, captureId: explicitId })).toMatchObject({ ok: true,
            value: { kind: 'saved', taskId: explicitId } });
        const explicitTask = cold.data().tasks.find((entry) => entry.id === explicitId);
        expect(explicitTask?.title).toBe('Explicit');
        expect(explicitTask?.dueDate).toContain('2026-10-01');
    });

    it('keeps an open draft and prepared capture bound to their original parse options', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));
        const env = await open(initial());
        const opened = env.host.openQuickCapture();
        if (!opened.ok) throw new Error(JSON.stringify(opened));
        const text = 'Task107 parser tomorrow';
        const request = { text, options: opened.value.options, captureId: generateUUID() };
        const prepared = env.host.prepareQuickCapture(request);
        if (!prepared.ok || prepared.value.kind !== 'prepared') throw new Error(JSON.stringify(prepared));
        const taskCount = env.data().tasks.length;
        for (const edit of [
            { type: 'naturalLanguageDates', value: false },
            { type: 'quickAddAutoClean', value: true },
        ] as const) {
            const { envelope } = await plannedCaptureParse(env, edit);
            expect(await env.host.commitPreparedGtdWorkflow(envelope)).toMatchObject({ ok: true });
        }
        expect(env.data().tasks).toHaveLength(taskCount);
        const retained = env.host.getQuickCaptureView({ text, options: opened.value.options });
        if (!retained.ok) throw new Error(JSON.stringify(retained));
        expect(retained.value.preview.some((chip) => chip.kind === 'due')).toBe(true);
        expect(await env.host.commitPreparedQuickCapture({ request, prepared: prepared.value.prepared }))
            .toMatchObject({ ok: true });
        const saved = env.data().tasks.find((task) => task.id === request.captureId);
        expect(saved?.title).toBe(text);
        expect(saved?.dueDate).toContain('2026-10-01');
        const cold = await env.reopen();
        const fresh = cold.host.openQuickCapture();
        if (!fresh.ok) throw new Error(JSON.stringify(fresh));
        const after = cold.host.getQuickCaptureView({ text, options: fresh.value.options });
        if (!after.ok) throw new Error(JSON.stringify(after));
        expect(after.value.preview.some((chip) => chip.kind === 'due')).toBe(false);
    });
});
