import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Project, Task } from './types';
import { createTaskDraft } from './task-draft';

const clock = '2026-09-27T15:00:00.000Z';
const item = (id: string, title: string, isCompleted = false) => ({ id, title, isCompleted });
const source = (overrides: Partial<Task> = {}): Task => ({
    id: 'checklist-task', title: 'Before', status: 'next', taskMode: 'list',
    createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
    rev: 3, revBy: 'device-a', tags: [], contexts: [],
    checklist: [item('one', 'First'), item('two', 'Second')], ...overrides,
});
const unwrap = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
async function open(task: Task = source(), options: {
    tasks?: Task[]; projects?: Project[]; saveData?: (next: AppData) => Promise<void>;
} = {}) {
    await flushPendingSave();
    resetForTests();
    let data: AppData = { tasks: [task, ...(options.tasks ?? [])], projects: options.projects ?? [],
        sections: [], areas: [], people: [], settings: { deviceId: 'device-a' } };
    let saves = 0;
    setStorageAdapter({ getData: async () => data, saveData: async (next) => {
        await options.saveData?.(next);
        data = JSON.parse(JSON.stringify(next)) as AppData;
        saves++;
    } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    await flushPendingSave();
    const host = createNativeHostContract();
    expect(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' })).toMatchObject({ ok: true });
    expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
    return { host, saved: () => data, saves: () => saves };
}
const savedTask = () => useTaskStore.getState()._tasksById.get('checklist-task')!;
const scheduleBase = { startTime: null, dueDate: null, relativeStartOffset: null, reviewAt: null };
const id = '00000000-0000-4000-8000-000000000321';

afterEach(async () => {
    vi.useRealTimers();
    await flushPendingSave();
    resetForTests();
});

describe('prepared native checklist Save and Reset', () => {
    it('saves Location together with a checklist edit through the existing combined writer', async () => {
        const original = source();
        const { host } = await open(original);
        const request = { id: original.id, requestId: id,
            base: { location: '' }, patch: { location: '  Clinic B  ' }, scheduleBase,
            checklist: { base: original.checklist!, value: [item('one', 'Revised'), item('two', 'Second')] } };
        const plan = unwrap(host.prepareTaskChecklistSave(request));
        expect(plan.kind).toBe('prepared');
        if (plan.kind !== 'prepared') return;
        expect(unwrap(await host.commitPreparedTaskChecklistWrite({ request, prepared: plan.prepared })))
            .toEqual({ id: original.id });
        expect(savedTask()).toMatchObject({ location: 'Clinic B', rev: 4,
            checklist: [item('one', 'Revised'), item('two', 'Second')] });
    });

    it('saves Assigned To with a checklist edit as one prepared effect', async () => {
        const original = source({ assignedTo: 'Old person' });
        const { host } = await open(original);
        const request = { id: original.id, requestId: id,
            base: { assignedTo: 'Old person' }, patch: { assignedTo: '  New person  ' }, scheduleBase,
            checklist: { base: original.checklist!, value: [item('one', 'Revised'), item('two', 'Second')] } };
        const plan = unwrap(host.prepareTaskChecklistSave(request));
        expect(plan.kind).toBe('prepared');
        if (plan.kind !== 'prepared') return;
        expect(unwrap(host.validatePreparedTaskChecklistWrite({ request, prepared: plan.prepared })))
            .toEqual({ id: original.id });
        expect(unwrap(await host.commitPreparedTaskChecklistWrite({ request, prepared: plan.prepared })))
            .toEqual({ id: original.id });
        expect(savedTask()).toMatchObject({ assignedTo: 'New person', rev: 4,
            checklist: [item('one', 'Revised'), item('two', 'Second')] });
    });

    it('projects an unsaved checklist into editor layout without changing the saved edit source', async () => {
        const { host } = await open(source({ checklist: [] }));
        const draft = createTaskDraft(savedTask());
        const saved = unwrap(host.editTaskDraft({ id: savedTask().id, draft }));
        const projected = unwrap(host.editTaskDraft({ id: savedTask().id, draft,
            checklist: [item('new', 'Unsaved item')] }));
        expect(projected.layout.sections.find((section) => section.fields.includes('checklist'))?.filledCount)
            .toBeGreaterThan(saved.layout.sections.find((section) => section.fields.includes('checklist'))?.filledCount ?? 0);
        expect(savedTask().checklist).toEqual([]);
        expect(projected.scheduleBase).toEqual(saved.scheduleBase);
        expect(host.editTaskDraft({ id: savedTask().id, draft,
            checklist: [{ id: 'x', title: 'item', isCompleted: false, leaked: true }] as never }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('saves a status-only final diff after checklist edits cancel out', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(clock));
        const { host } = await open(source({ checklist: [item('one', 'First', true)], status: 'next' }));
        const request = { id: 'checklist-task', requestId: id, base: { status: 'next' }, patch: { status: 'done' },
            scheduleBase, checklist: { base: savedTask().checklist, value: savedTask().checklist } };
        const prepared = unwrap(host.prepareTaskChecklistSave(request));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        expect(prepared.prepared.effect.tasks.find((row) => row.after.id === request.id)?.after.checklist)
            .toEqual([item('one', 'First', true)]);
        expect(unwrap(host.validatePreparedTaskChecklistWrite({ request, prepared: prepared.prepared }))).toEqual({ id: 'checklist-task' });
        expect(unwrap(await host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared }))).toEqual({ id: 'checklist-task' });
        expect(savedTask()).toMatchObject({ status: 'done', checklist: [item('one', 'First', true)], rev: 4 });
        const rev = savedTask().rev;
        expect(unwrap(await host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared }))).toEqual({ id: 'checklist-task' });
        expect(savedTask().rev).toBe(rev);
    });

    it('writes a nonempty already-open Reset and returns an empty saved-list no-write result', async () => {
        const { host, saves } = await open();
        const request = { id: 'checklist-task', requestId: id, checklistBase: savedTask().checklist };
        const prepared = unwrap(host.prepareTaskChecklistReset(request));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        const before = saves();
        const result = unwrap(await host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared }));
        expect(result).toMatchObject({ id: 'checklist-task', status: 'next', checklistBase: source().checklist });
        expect(savedTask().rev).toBe(4);
        expect(saves()).toBeGreaterThan(before);
        const empty = await open(source({ checklist: [] }));
        expect(unwrap(empty.host.prepareTaskChecklistReset({ id: 'checklist-task', requestId: id, checklistBase: [] }))).toMatchObject({
            kind: 'unchanged', result: { id: 'checklist-task', checklistBase: [] },
        });
    });

    it('saves a title, checklist, date, and list completion with exactly one recurring child', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(clock));
        const original = source({ recurrence: { rule: 'daily', strategy: 'strict', rrule: 'FREQ=DAILY' },
            dueDate: '2026-09-27', checklist: [item('one', 'First', true), item('two', 'Second')] });
        const { host } = await open(original);
        const request = { id: original.id, requestId: id, base: { title: 'Before', status: 'next', dueDate: '2026-09-27' },
            patch: { title: 'After', status: 'done', dueDate: '2026-09-28' },
            scheduleBase: { ...scheduleBase, dueDate: '2026-09-27' },
            checklist: { base: original.checklist!, value: original.checklist!.map((entry) => ({ ...entry, isCompleted: true })) } };
        const prepared = unwrap(host.prepareTaskChecklistSave(request));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        expect(prepared.prepared.effect.tasks).toHaveLength(2);
        const child = prepared.prepared.effect.tasks.find((row) => row.before === null)?.after;
        expect(child?.checklist?.every((entry) => !entry.isCompleted)).toBe(true);
        expect(child?.id).not.toBe(original.id);
        expect(unwrap(await host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared }))).toEqual({ id: original.id });
        expect(savedTask()).toMatchObject({ title: 'After', status: 'done', dueDate: '2026-09-28', rev: 4 });
        expect(useTaskStore.getState()._allTasks.filter((entry) => entry.id === child?.id)).toHaveLength(1);
        expect(unwrap(await host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared }))).toEqual({ id: original.id });
        expect(useTaskStore.getState()._allTasks.filter((entry) => entry.id === child?.id)).toHaveLength(1);
    });

    it('acknowledges exact date-only and timed recurring rows after a cold timezone and clock change', async () => {
        const priorZone = process.env.TZ;
        try {
            for (const timed of [false, true]) {
                process.env.TZ = 'America/New_York';
                vi.useFakeTimers({ toFake: ['Date'] });
                vi.setSystemTime(new Date(clock));
                expect(new Date(clock).getTimezoneOffset()).toBe(240);
                const original = source({
                    recurrence: { rule: 'daily', strategy: 'strict', rrule: 'FREQ=DAILY' },
                    dueDate: timed ? '2026-09-27T18:00:00.000Z' : '2026-09-27',
                    ...(timed ? { startTime: '2026-09-27T17:00:00.000Z',
                        relativeStartOffset: { amount: -1, unit: 'hour' as const } } : {}),
                    checklist: [item('one', 'First', true)],
                });
                const initial = await open(original);
                const request = { id: original.id,
                    requestId: timed ? '00000000-0000-4000-8000-000000000323' : id,
                    base: { status: 'next' }, patch: { status: 'done' },
                    scheduleBase: { startTime: original.startTime ?? null, dueDate: original.dueDate ?? null,
                        relativeStartOffset: original.relativeStartOffset ?? null, reviewAt: null },
                    checklist: { base: original.checklist!, value: original.checklist! } };
                const prepared = unwrap(initial.host.prepareTaskChecklistSave(request));
                expect(prepared.kind).toBe('prepared');
                if (prepared.kind !== 'prepared') continue;
                const plannedRows = structuredClone(prepared.prepared.effect.tasks.map((row) => row.after));
                expect(plannedRows).toHaveLength(2);
                const childId = plannedRows.find((row) => row.id !== original.id)!.id;
                expect(unwrap(await initial.host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared })))
                    .toEqual({ id: original.id });
                const durable = initial.saved();
                const durableRows = structuredClone(durable.tasks.filter((row) => row.id === original.id || row.id === childId));
                expect(durableRows).toEqual(plannedRows);

                process.env.TZ = 'America/Los_Angeles';
                vi.setSystemTime(new Date('2026-09-28T16:00:00.000Z'));
                expect(new Date(clock).getTimezoneOffset()).toBe(420);
                const reloaded = await open(durableRows.find((row) => row.id === original.id)!, {
                    tasks: durableRows.filter((row) => row.id === childId),
                });
                const beforeRetry = structuredClone(useTaskStore.getState()._allTasks);
                const savesBeforeRetry = reloaded.saves();
                expect(unwrap(reloaded.host.validatePreparedTaskChecklistWrite({ request, prepared: prepared.prepared })))
                    .toEqual({ id: original.id });
                expect(unwrap(await reloaded.host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared })))
                    .toEqual({ id: original.id });
                expect(useTaskStore.getState()._allTasks).toEqual(beforeRetry);
                expect(useTaskStore.getState()._allTasks).toEqual(durableRows);
                expect(reloaded.saves()).toBe(savesBeforeRetry);
                expect(useTaskStore.getState()._allTasks.filter((row) => row.id === childId)).toHaveLength(1);
            }
        } finally {
            vi.useRealTimers();
            if (priorZone === undefined) delete process.env.TZ;
            else process.env.TZ = priorZone;
        }
    });

    it('keeps a manual final status override and Reference bullets', async () => {
        const { host } = await open(source({ status: 'reference', checklist: [item('one', 'Bullet')] }));
        const request = { id: 'checklist-task', requestId: id, base: {}, patch: {}, scheduleBase,
            checklist: { base: savedTask().checklist!, value: [item('one', 'Edited bullet')] } };
        const prepared = unwrap(host.prepareTaskChecklistSave(request));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        expect(unwrap(await host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared }))).toEqual({ id: request.id });
        expect(savedTask()).toMatchObject({ status: 'reference', checklist: [item('one', 'Edited bullet')] });
        expect(host.prepareTaskChecklistSave({ ...request, requestId: '00000000-0000-4000-8000-000000000322',
            base: { priority: '' }, patch: { priority: 'high' },
            checklist: { base: savedTask().checklist!, value: savedTask().checklist! } })).toMatchObject({ ok: false });

        const normal = await open(source({ checklist: [item('one', 'First', true)], status: 'next' }));
        const override = { id: 'checklist-task', requestId: id, base: {}, patch: {}, scheduleBase,
            checklist: { base: savedTask().checklist!, value: [item('one', 'Changed', true)] } };
        const planned = unwrap(normal.host.prepareTaskChecklistSave(override));
        expect(planned.kind).toBe('prepared');
        if (planned.kind !== 'prepared') return;
        unwrap(await normal.host.commitPreparedTaskChecklistWrite({ request: override, prepared: planned.prepared }));
        expect(savedTask().status).toBe('next');
    });

    it('refuses a coherently rebound Reference priority even when status is omitted', async () => {
        const original = source({ status: 'reference', checklist: [item('one', 'Bullet')] });
        const { host, saves } = await open(original);
        const request = { id: original.id, requestId: id, base: {}, patch: {}, scheduleBase,
            checklist: { base: original.checklist!, value: [item('one', 'Edited bullet')] } };
        const prepared = unwrap(host.prepareTaskChecklistSave(request));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        const forged = structuredClone(prepared.prepared);
        const forbidden = { ...request, base: { priority: '' }, patch: { priority: 'high' } };
        forged.request = forbidden;
        forged.witness.direct.priority = 'high';
        const before = saves();
        expect(host.validatePreparedTaskChecklistWrite({ request: forbidden, prepared: forged }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.commitPreparedTaskChecklistWrite({ request: forbidden, prepared: forged }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saves()).toBe(before);
    });

    it('validates a frozen terminal envelope before any write and refuses a partial child receipt', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(clock));
        const original = source({ recurrence: { rule: 'daily', strategy: 'strict', rrule: 'FREQ=DAILY' },
            dueDate: '2026-09-27' });
        const { host, saves } = await open(original);
        const request = { id: original.id, requestId: id, base: { status: 'next' }, patch: { status: 'done' },
            scheduleBase: { ...scheduleBase, dueDate: '2026-09-27' },
            checklist: { base: original.checklist!, value: original.checklist! } };
        const prepared = unwrap(host.prepareTaskChecklistSave(request));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        const tampered = structuredClone(prepared.prepared);
        tampered.effect.tasks.find((row) => row.after.id === original.id)!.after.status = 'archived';
        const before = saves();
        expect(host.validatePreparedTaskChecklistWrite({ request, prepared: tampered })).toMatchObject({ ok: false });
        expect(await host.commitPreparedTaskChecklistWrite({ request, prepared: tampered })).toMatchObject({ ok: false });
        expect(saves()).toBe(before);
        unwrap(await host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared }));
        const child = prepared.prepared.effect.tasks.find((row) => !row.before)!.after;
        useTaskStore.setState({ _allTasks: useTaskStore.getState()._allTasks.filter((entry) => entry.id !== child.id) });
        expect(await host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });

    it('retries an owed persistence failure with the same frozen UUID and no second task revision', async () => {
        let failSave = false;
        const { host, saved, saves } = await open(source(), { saveData: async () => {
            if (failSave) throw new Error('disk unavailable');
        } });
        const request = { id: 'checklist-task', requestId: id, base: { title: 'Before' },
            patch: { title: 'After' }, scheduleBase,
            checklist: { base: savedTask().checklist!, value: [item('one', 'First'), item('two', 'Second', true)] } };
        const prepared = unwrap(host.prepareTaskChecklistSave(request));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        failSave = true;
        expect(await host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared }))
            .toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(savedTask().rev).toBe(4);
        expect(saved().tasks.find((task) => task.id === request.id)?.title).toBe('Before');
        failSave = false;
        expect(unwrap(await host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared })))
            .toEqual({ id: request.id });
        expect(savedTask()).toMatchObject({ title: 'After', rev: 4 });
        expect(saved().tasks.find((task) => task.id === request.id)).toMatchObject({ title: 'After', rev: 4 });
        const count = saves();
        useTaskStore.setState({ settings: { ...useTaskStore.getState().settings,
            gtd: { ...useTaskStore.getState().settings.gtd, autoArchiveDays: 7 } } });
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2031-01-02T10:00:00.000Z'));
        expect(unwrap(await host.commitPreparedTaskChecklistWrite({ request, prepared: prepared.prepared })))
            .toEqual({ id: request.id });
        expect(savedTask().rev).toBe(4);
        expect(saves()).toBe(count);
    });

    it('refuses forged source, direct checklist/date fields and result before publication', async () => {
        const original = source({ dueDate: '2026-09-29' });
        const { host, saves } = await open(original);
        const request = { id: original.id, requestId: id, base: { dueDate: '2026-09-29' },
            patch: { dueDate: '2026-10-01' }, scheduleBase: { ...scheduleBase, dueDate: '2026-09-29' },
            checklist: { base: original.checklist!, value: [item('one', 'Changed'), item('two', 'Second')] } };
        const prepared = unwrap(host.prepareTaskChecklistSave(request));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        const variants = [
            (value: typeof prepared.prepared) => { value.witness.source.title = 'Forged'; },
            (value: typeof prepared.prepared) => { value.witness.direct.checklist = [item('forged', 'Forged')]; },
            (value: typeof prepared.prepared) => { value.witness.direct.dueDate = '2031-01-01';
                value.effect.tasks.find((row) => row.after.id === original.id)!.after.dueDate = '2031-01-01'; },
            (value: typeof prepared.prepared) => { value.result.id = 'wrong-task'; },
        ];
        const before = saves();
        for (const mutate of variants) {
            const forged = structuredClone(prepared.prepared);
            mutate(forged);
            expect(host.validatePreparedTaskChecklistWrite({ request, prepared: forged })).toMatchObject({ ok: false });
            expect(await host.commitPreparedTaskChecklistWrite({ request, prepared: forged })).toMatchObject({ ok: false });
            expect(saves()).toBe(before);
        }
        expect(savedTask().rev).toBe(3);
    });

    it('refuses an archived parent before any checklist write', async () => {
        const archived: Project = { id: 'project-archived', title: 'Old', status: 'archived', color: '#94a3b8',
            order: 0, tagIds: [], createdAt: clock, updatedAt: clock };
        const { host, saves } = await open(source({ projectId: archived.id }), { projects: [archived] });
        const request = { id: 'checklist-task', requestId: id, base: {}, patch: {}, scheduleBase,
            checklist: { base: savedTask().checklist!, value: [item('one', 'Edited'), item('two', 'Second')] } };
        const before = saves();
        expect(host.prepareTaskChecklistSave(request)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.prepareTaskChecklistReset({ id: request.id, requestId: id, checklistBase: savedTask().checklist! }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saves()).toBe(before);

        const active = { ...archived, status: 'active' as const };
        const fresh = await open(source({ projectId: active.id }), { projects: [active] });
        const resetRequest = { id: request.id, requestId: id, checklistBase: savedTask().checklist! };
        const reset = unwrap(fresh.host.prepareTaskChecklistReset(resetRequest));
        expect(reset.kind).toBe('prepared');
        if (reset.kind !== 'prepared') return;
        const forged = structuredClone(reset.prepared);
        forged.witness.lists.projects[0].status = 'archived';
        expect(fresh.host.validatePreparedTaskChecklistWrite({ request: resetRequest, prepared: forged }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('accepts more than 1,000 legitimate items but refuses an oversized whole request without writing', async () => {
        const list = Array.from({ length: 1_001 }, (_, index) => item(`item-${index}`, `Item ${index}`));
        const { host, saves } = await open(source({ checklist: list }));
        const edit = unwrap(host.editTaskChecklist({ id: 'checklist-task', draft: createTaskDraft(savedTask()),
            checklist: list, edit: { kind: 'toggle', index: 1_000 } }));
        expect(edit.checklist[1_000].isCompleted).toBe(true);
        const request = { id: 'checklist-task', requestId: id, base: {}, patch: {}, scheduleBase,
            checklist: { base: list, value: edit.checklist } };
        expect(unwrap(host.prepareTaskChecklistSave(request)).kind).toBe('prepared');
        const before = saves();
        expect(host.prepareTaskChecklistSave({ ...request, checklist: {
            base: list, value: [item('oversized', 'x'.repeat(2 * 1024 * 1024 + 1))] } })).toMatchObject({ ok: false });
        expect(host.prepareTaskChecklistSave({ ...request, checklist: {
            base: list, value: Array.from({ length: 100 }, (_, index) => item(`unicode-${index}`, '漢'.repeat(8_000)))
        } })).toMatchObject({ ok: false });
        const malformed = [item('bad', 'Bad') as Record<string, unknown>];
        malformed[0].unexpected = 1n;
        expect(host.editTaskChecklist({ id: request.id, draft: createTaskDraft(savedTask()),
            checklist: malformed as never, edit: { kind: 'toggle', index: 0 } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saves()).toBe(before);
    });
});
