import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract } from './native-host-contract';
import type { NativePreparedTaskDraftSave, NativeTaskDraftSaveRequest } from './native-host-contract-task-save';
import { normalizeTaskUpdate } from './store-helpers';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { TaskDraft } from './task-draft';
import type { AppData, Project, Recurrence, Task } from './types';
import * as logger from './logger';

const NOW = '2026-09-27T12:00:00.000Z';
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const FIELDS = ['recurrence', 'recurrenceStrategy', 'recurrenceRRule', 'showFutureRecurrence'] as const;
type RecurrenceDraft = Pick<TaskDraft, typeof FIELDS[number]>;
const task = (extra: Partial<Task> = {}): Task => ({
    id: 'edit', title: 'Recurrence recovery', status: 'next', contexts: [], tags: [],
    description: 'Keep these notes', createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z', rev: 7, ...extra,
});
const canonical = (recurrence: Recurrence) => normalizeTaskUpdate(task(), { recurrence }).recurrence;
const rules = [
    ['daily', 'daily', 'FREQ=DAILY;INTERVAL=2'],
    ['weekly', 'weekly', 'FREQ=WEEKLY;BYDAY=MO,WE;WKST=SU'],
    ['monthly date', 'monthly', 'FREQ=MONTHLY;BYMONTHDAY=31'],
    ['monthly custom', 'monthly', 'FREQ=MONTHLY;BYDAY=-1FR;INTERVAL=2'],
    ['yearly', 'yearly', 'FREQ=YEARLY;UNTIL=20281231'],
    ['count', 'daily', 'FREQ=DAILY;COUNT=8'],
] as const;
const matrix = (['strict', 'fluid'] as const).flatMap((strategy) =>
    (['neither', 'start', 'due', 'both'] as const).flatMap((schedule) =>
        (['date', 'datetime'] as const).flatMap((representation) => rules.map(([name, rule, rrule]) =>
            ({ name, rule, rrule, strategy, schedule, representation })))));

describe('native recurrence draft recovery', () => {
    const originalTZ = process.env.TZ;
    let durable: AppData;
    let saveData: ReturnType<typeof vi.fn>;
    let host: ReturnType<typeof createNativeHostContract>;
    const stored = () => useTaskStore.getState()._tasksById.get('edit')!;
    const saved = () => json(durable.tasks.find(({ id }) => id === 'edit')!);
    const persist = async (data: AppData) => { durable = structuredClone(data); };
    const open = async (timezone = 'America/New_York') => {
        process.env.TZ = timezone;
        resetForTests();
        useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0 });
        host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true, recoveryLoad: true })).toMatchObject({ ok: true });
        await flushPendingSave();
        saveData.mockClear();
    };
    const seed = async (extra: Partial<Task> = {}, projects: Project[] = []) => {
        durable = { tasks: [task(extra)], projects, sections: [], areas: [], people: [],
            settings: { deviceId: 'native-recurrence-recovery-test' } };
        await open();
    };
    const model = () => {
        const result = host.getTaskEditorModel({ id: 'edit' });
        if (!result.ok) throw new Error(result.error.message);
        return json(result.value);
    };
    const request = (edits: Partial<RecurrenceDraft>, dates: NativeTaskDraftSaveRequest['patch'] = {}): NativeTaskDraftSaveRequest => {
        const opening = model();
        const base = Object.fromEntries([...FIELDS, ...Object.keys(dates)].map((field) =>
            [field, opening.draft[field as keyof TaskDraft] ?? null]));
        return { id: 'edit', base, patch: { ...base, ...edits, ...dates },
            scheduleBase: opening.scheduleBase, recurrenceBase: opening.recurrenceBase };
    };
    const prepare = (edits: Partial<RecurrenceDraft>, dates: NativeTaskDraftSaveRequest['patch'] = {}) => {
        const result = host.prepareTaskDraftSave(request(edits, dates));
        expect(result).toMatchObject({ ok: true });
        if (!result.ok) throw new Error(result.error.message);
        return json(result.value);
    };
    const commit = (prepared: NativePreparedTaskDraftSave) => host.commitPreparedTaskDraftSave({ request: prepared.request, prepared });
    const expectUnchanged = (before: Task, durableBefore: Task) => {
        expect(stored()).toBe(before);
        expect(saved()).toEqual(durableBefore);
        expect(saveData).not.toHaveBeenCalled();
    };

    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(NOW));
        saveData = vi.fn(persist);
        setStorageAdapter({ getData: async () => structuredClone(durable), saveData });
        await seed();
    });
    afterEach(async () => {
        saveData.mockImplementation(persist);
        await flushPendingSave();
        resetForTests();
        vi.useRealTimers();
        vi.restoreAllMocks();
        if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ;
    });

    it.each(matrix)('enables $strategy $name with $schedule $representation without preparing writes or creating children', async ({ rule, rrule, strategy, schedule, representation }) => {
        const value = representation === 'date' ? '2026-10-31' : '2026-10-31T14:00:00.000Z';
        await seed({ ...(schedule === 'start' || schedule === 'both' ? { startTime: value } : {}),
            ...(schedule === 'due' || schedule === 'both' ? { dueDate: value } : {}),
            isFocusedToday: true, focusOrder: 4 });
        const before = stored();
        const durableBefore = saved();
        const prepared = prepare({ recurrence: rule, recurrenceRRule: rrule, recurrenceStrategy: strategy, showFutureRecurrence: true });
        expect(prepared.changes.recurrence).toMatchObject({ rule, strategy, seriesId: 'edit' });
        expect(prepared.changes.showFutureRecurrence).toBe(true);
        expectUnchanged(before, durableBefore);
        expect(await commit(prepared)).toMatchObject({ ok: true });
        expect(stored()).toMatchObject({ recurrence: prepared.changes.recurrence, showFutureRecurrence: true, rev: 8 });
        expect(stored().startTime).toBe(before.startTime);
        expect(stored().dueDate).toBe(before.dueDate);
        expect(useTaskStore.getState()._allTasks).toHaveLength(1);
        expect(saved()).toEqual(json(stored()));
    });

    it('exposes detached raw opening recurrence metadata from reads and draft edits', async () => {
        const recurrence = canonical({ rule: 'monthly', strategy: 'strict', count: 8, completedOccurrences: 3,
            anchorDay: 31, startAnchorDay: 30, dueAnchorDay: 31, reviewAnchorDay: 29, seriesId: 'original-series' });
        await seed({ recurrence, showFutureRecurrence: false });
        const opening = model();
        expect(opening.recurrenceBase).toEqual({ recurrence, showFutureRecurrence: false });
        (opening.recurrenceBase.recurrence as Recurrence).anchorDay = 12;
        expect((stored().recurrence as Recurrence).anchorDay).toBe(31);
        const edited = host.editTaskDraft({ id: 'edit', draft: opening.draft, edit: { type: 'recurrence', edit: { kind: 'strategy' } } });
        expect(edited).toMatchObject({ ok: true, value: { recurrenceBase: { recurrence, showFutureRecurrence: false } } });
        expect(saveData).not.toHaveBeenCalled();
    });

    it.each(rules)('changes then clears %s while retaining same-rule metadata and the existing series', async (_name, rule, rrule) => {
        const recurrence = canonical({ rule, strategy: 'strict', count: 9, completedOccurrences: 3,
            anchorDay: 31, startAnchorDay: 30, dueAnchorDay: 31, reviewAnchorDay: 29, seriesId: 'original-series' });
        await seed({ recurrence, showFutureRecurrence: true });
        const prepared = prepare({ recurrence: rule, recurrenceRRule: rrule, recurrenceStrategy: 'fluid' });
        expect(prepared.changes.recurrence).toMatchObject({ rule, strategy: 'fluid', seriesId: 'original-series',
            completedOccurrences: 3, anchorDay: 31, startAnchorDay: 30, dueAnchorDay: 31, reviewAnchorDay: 29 });
        expect(await commit(prepared)).toMatchObject({ ok: true });
        const clear = prepare({ recurrence: '', recurrenceRRule: '', showFutureRecurrence: true });
        expect(clear.changes).toMatchObject({ recurrence: null, showFutureRecurrence: null });
        expect(await commit(clear)).toMatchObject({ ok: true });
        expect(stored().recurrence).toBeUndefined();
        expect(stored().showFutureRecurrence).toBeUndefined();
        expect(useTaskStore.getState()._allTasks).toHaveLength(1);
    });

    it('retains series and COUNT progress but drops old anchors when changing rules', async () => {
        await seed({ recurrence: canonical({ rule: 'monthly', strategy: 'strict', count: 8, completedOccurrences: 3,
            anchorDay: 31, dueAnchorDay: 31, seriesId: 'original-series' }) });
        const prepared = prepare({ recurrence: 'weekly', recurrenceRRule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=12' });
        expect(prepared.changes.recurrence).toMatchObject({ rule: 'weekly', count: 12, completedOccurrences: 3, seriesId: 'original-series', byDay: ['MO'] });
        expect(prepared.changes.recurrence).not.toHaveProperty('anchorDay');
        expect(prepared.changes.recurrence).not.toHaveProperty('dueAnchorDay');
        expect(await commit(prepared)).toMatchObject({ ok: true });
    });

    it.each([undefined, canonical({ rule: 'weekly', strategy: 'strict', count: 8, completedOccurrences: 3, seriesId: 'original-series' })])(
        'rejects an RRULE that forges hidden series identity from %j', async (recurrence) => {
            await seed({ recurrence });
            const before = stored();
            const durableBefore = saved();
            const input = request({ recurrence: 'weekly', recurrenceRRule: 'FREQ=WEEKLY;COUNT=8;X-MINDWTR-SERIES-ID=forged-series' });
            expect(host.prepareTaskDraftSave(input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expectUnchanged(before, durableBefore);
        },
    );

    it('preserves inherited series stamps and ignores opaque RRULE tokens as authority for hidden progress or anchors', async () => {
        const info = vi.spyOn(logger, 'logInfo');
        await seed({ recurrence: canonical({ rule: 'monthly', strategy: 'strict', count: 8, completedOccurrences: 3,
            anchorDay: 31, dueAnchorDay: 31, seriesId: 'original series' }) });
        const prepared = prepare({ recurrenceRRule: 'FREQ=MONTHLY;COUNT=12;X-MINDWTR-SERIES-ID=original%20series;COMPLETEDOCCURRENCES=99;ANCHORDAY=2;X-FOO=keep' });
        expect(prepared.changes.recurrence).toMatchObject({ seriesId: 'original series', count: 12, completedOccurrences: 3, anchorDay: 31, dueAnchorDay: 31 });
        expect(await commit(prepared)).toMatchObject({ ok: true });
        expect(info).toHaveBeenCalledWith('Native prepared recurrence save result', { scope: 'native-host', category: 'storage',
            context: { releaseCheck: 'v1.3.3/native-prepared-recurrence-save', outcome: 'applied' } });
    });

    it('refuses a forged series even when request and prepared output agree on it', async () => {
        const prepared = prepare({ recurrence: 'weekly', recurrenceRRule: 'FREQ=WEEKLY;COUNT=8' });
        prepared.request.patch.recurrenceRRule = 'FREQ=WEEKLY;COUNT=8;X-MINDWTR-SERIES-ID=forged-series';
        (prepared.changes.recurrence as Recurrence).seriesId = 'forged-series';
        (prepared.changes.recurrence as Recurrence).rrule = prepared.request.patch.recurrenceRRule;
        expect(await commit(prepared)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saveData).not.toHaveBeenCalled();
    });

    it.each([{ rule: 'weekly', rrule: { invalid: true } }, { rule: 'weekly', byDay: 'MO' }])('refuses a malformed raw recurrence journal %j without throwing or writing', async (recurrence) => {
        const prepared = prepare({ recurrence: 'weekly', recurrenceRRule: 'FREQ=WEEKLY;COUNT=8' });
        const broken = recurrence as unknown as Recurrence;
        prepared.before.recurrence = broken;
        prepared.request.recurrenceBase!.recurrence = broken;
        expect(await commit(prepared)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saveData).not.toHaveBeenCalled();
    });

    it('replays a JSON journal after restart, lost acknowledgement, and a same-value save without incrementing revision', async () => {
        const prepared = prepare({ recurrence: 'weekly', recurrenceRRule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=8' });
        await open('UTC');
        expect(await commit(prepared)).toMatchObject({ ok: true });
        const committed = saved();
        await open('America/Los_Angeles');
        const before = stored();
        expect(await commit(prepared)).toMatchObject({ ok: true });
        expectUnchanged(before, committed);
        const same = prepare({});
        expect(same.changes).toEqual({});
        expect(await commit(same)).toMatchObject({ ok: true });
        expectUnchanged(before, committed);
        expect(stored().rev).toBe(8);
    });

    it.each(['weekly', { rule: 'weekly' }, { rule: 'weekly', strategy: 'strict', seriesId: 'legacy-series' }] as const)(
        'preserves legitimate raw recurrence %j during preview-only and same-value requests', async (recurrence) => {
            await seed({ recurrence, showFutureRecurrence: false });
            const original = saved();
            const before = stored();
            const same = prepare({});
            expect(same.changes).toEqual({});
            expect(await commit(same)).toMatchObject({ ok: true });
            expectUnchanged(before, original);
            const preview = prepare({ showFutureRecurrence: true });
            expect(preview.changes).toEqual({ showFutureRecurrence: true });
            expect(await commit(preview)).toMatchObject({ ok: true });
            expect(saved().recurrence).toEqual(recurrence);
            const hide = prepare({ showFutureRecurrence: false });
            expect(hide.changes).toEqual({ showFutureRecurrence: null });
            expect(await commit(hide)).toMatchObject({ ok: true });
            expect(saved().recurrence).toEqual(recurrence);
        },
    );

    it('retries failed persistence using the exact prepared recurrence, with success-only diagnostics', async () => {
        const info = vi.spyOn(logger, 'logInfo');
        const prepared = prepare({ recurrence: 'daily', recurrenceRRule: 'FREQ=DAILY;COUNT=5' });
        const original = saved();
        saveData.mockRejectedValue(new Error('synthetic recurrence save failure'));
        expect(await commit(prepared)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        const intended = json(stored());
        expect(saved()).toEqual(original);
        expect(info).not.toHaveBeenCalledWith('Native prepared recurrence save result', expect.anything());
        saveData.mockImplementation(persist);
        saveData.mockClear();
        expect(await commit(prepared)).toMatchObject({ ok: true });
        expect(saved()).toEqual(intended);
        expect(json(stored())).toEqual(intended);
        expect(saveData).toHaveBeenCalledTimes(1);
        expect(info).toHaveBeenCalledWith('Native prepared recurrence save result', { scope: 'native-host', category: 'storage',
            context: { releaseCheck: 'v1.3.3/native-prepared-recurrence-save', outcome: 'replayed' } });
    }, 15_000);

    it('applies an uncommitted recurrence journal after a failed save and process restart', async () => {
        const prepared = prepare({ recurrence: 'monthly', recurrenceRRule: 'FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20281231' });
        saveData.mockRejectedValue(new Error('synthetic recurrence save failure'));
        expect(await commit(prepared)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        const intended = json(stored());
        saveData.mockImplementation(persist);
        await open('UTC');
        expect(stored().recurrence).toBeUndefined();
        expect(await commit(prepared)).toMatchObject({ ok: true });
        expect(saved()).toEqual(intended);
    }, 15_000);

    it.each([
        { recurrence: canonical({ rule: 'weekly', strategy: 'strict', count: 8, completedOccurrences: 4 }) },
        { recurrence: canonical({ rule: 'weekly', strategy: 'strict', count: 8, completedOccurrences: 3, seriesId: 'other-series' }) },
        { dueDate: '2026-11-02' },
        { showFutureRecurrence: true },
    ])('rejects hidden raw metadata and date conflicts before prepare or after preparation: %j', async (change) => {
        await seed({ recurrence: canonical({ rule: 'weekly', strategy: 'strict', count: 8, completedOccurrences: 3 }), dueDate: '2026-11-01' });
        const input = request({ recurrenceStrategy: 'fluid' });
        const prepared = prepare({ recurrenceStrategy: 'fluid' });
        await useTaskStore.getState().updateTask('edit', change);
        await flushPendingSave();
        saveData.mockClear();
        const before = stored();
        const durableBefore = saved();
        expect(host.prepareTaskDraftSave(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await commit(prepared)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expectUnchanged(before, durableBefore);
    });

    it('preserves unrelated concurrent notes before applying and when replaying', async () => {
        const prepared = prepare({ recurrence: 'daily', recurrenceRRule: 'FREQ=DAILY' });
        await useTaskStore.getState().updateTask('edit', { description: 'New notes' });
        await flushPendingSave();
        expect(await commit(prepared)).toMatchObject({ ok: true });
        expect(stored()).toMatchObject({ description: 'New notes', rev: 9 });
        await useTaskStore.getState().updateTask('edit', { description: 'Later notes' });
        await flushPendingSave();
        const committed = saved();
        await open('UTC');
        const before = stored();
        expect(await commit(prepared)).toMatchObject({ ok: true });
        expectUnchanged(before, committed);
    });

    it('freezes combined recurrence and relative date effects across a timezone restart', async () => {
        await seed({ dueDate: '2026-10-31T14:00:00.000Z', startTime: '2026-10-30T14:00:00.000Z',
            relativeStartOffset: { amount: -1, unit: 'day' }, isFocusedToday: true, focusOrder: 4 });
        const prepared = prepare({ recurrence: 'daily', recurrenceRRule: 'FREQ=DAILY;COUNT=8' }, { dueDate: '2026-11-01T15:00:00.000Z' });
        expect(prepared.changes.startTime).toBe('2026-10-31T14:00:00.000Z');
        await open('UTC');
        expect(await commit(prepared)).toMatchObject({ ok: true });
        expect(stored()).toMatchObject({ dueDate: '2026-11-01T15:00:00.000Z', startTime: '2026-10-31T14:00:00.000Z', recurrence: prepared.changes.recurrence });
        const committed = saved();
        await open('America/Los_Angeles');
        const before = stored();
        expect(await commit(prepared)).toMatchObject({ ok: true });
        expectUnchanged(before, committed);
    });

    it.each([
        ['draft strategy stored', (p: any) => { p.changes.recurrenceStrategy = 'fluid'; }],
        ['draft RRULE stored', (p: any) => { p.changes.recurrenceRRule = 'FREQ=YEARLY'; }],
        ['different rule', (p: any) => { p.changes.recurrence.rule = 'yearly'; }],
        ['series', (p: any) => { p.changes.recurrence.seriesId = 'forged-series'; }],
        ['series stamp', (p: any) => { p.changes.recurrence.rrule += ';X-MINDWTR-SERIES-ID=forged'; }],
        ['count', (p: any) => { p.changes.recurrence.count = -1; }],
        ['progress', (p: any) => { p.changes.recurrence.completedOccurrences = 99; }],
        ['anchor', (p: any) => { p.changes.recurrence.anchorDay = 2; }],
        ['unknown metadata', (p: any) => { p.changes.recurrence.extra = true; }],
        ['dropped recurrence', (p: any) => { delete p.changes.recurrence; }],
        ['forged clear', (p: any) => { p.changes.recurrence = null; }],
        ['future flag', (p: any) => { p.changes.showFutureRecurrence = false; }],
        ['missing raw baseline', (p: any) => { delete p.request.recurrenceBase; }],
        ['missing schedule baseline', (p: any) => { delete p.request.scheduleBase; }],
        ['extra envelope', (p: any) => { p.recurrence = p.changes.recurrence; }],
    ])('rejects a forged prepared %s before writing', async (_name, mutate) => {
        const prepared = prepare({ recurrence: 'weekly', recurrenceRRule: 'FREQ=WEEKLY;COUNT=8', showFutureRecurrence: true });
        mutate(prepared);
        const before = stored();
        const durableBefore = saved();
        expect(await commit(prepared)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expectUnchanged(before, durableBefore);
    });

    it('rejects incomplete recurrence tuples, invalid booleans and unsupported fields', () => {
        const valid = request({ recurrence: 'daily' });
        for (const field of FIELDS) {
            const partial = json(valid);
            delete partial.base[field];
            delete partial.patch[field];
            expect(host.prepareTaskDraftSave(partial)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        for (const input of [
            { ...valid, patch: { ...valid.patch, showFutureRecurrence: 'true' } },
            { ...valid, base: { ...valid.base, showFutureRecurrence: 'false' } },
            { ...valid, recurrenceBase: { recurrence: null } },
            { ...valid, recurrenceBase: { recurrence: null, showFutureRecurrence: 'false' } },
            { ...valid, patch: { ...valid.patch, status: 'done' }, base: { ...valid.base, status: 'next' } },
        ]) expect(host.prepareTaskDraftSave(input as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saveData).not.toHaveBeenCalled();
    });

    it('accepts old version-one date journals and preserves their untouched raw recurrence', async () => {
        await seed({ recurrence: { rule: 'weekly' } });
        const opening = model();
        const result = host.prepareTaskDraftSave({ id: 'edit', base: { dueDate: '' }, patch: { dueDate: '2026-10-05' }, scheduleBase: opening.scheduleBase });
        expect(result).toMatchObject({ ok: true });
        if (!result.ok) return;
        expect(result.value.version).toBe(1);
        expect(result.value.request).not.toHaveProperty('recurrenceBase');
        expect(result.value.changes).not.toHaveProperty('recurrence');
        expect(await commit(json(result.value))).toMatchObject({ ok: true });
        expect(saved().recurrence).toEqual({ rule: 'weekly' });
    });

    it('rejects Reference and unavailable parents before application, but acknowledges a saved result after its parent is archived', async () => {
        const parent: Project = { id: 'p', title: 'Parent', status: 'active', color: '#94a3b8', order: 0, createdAt: NOW, updatedAt: NOW };
        await seed({ status: 'reference' });
        expect(host.prepareTaskDraftSave(request({ recurrence: 'daily' }))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        await seed({ projectId: 'p' }, [parent]);
        const prepared = prepare({ recurrence: 'daily', recurrenceRRule: 'FREQ=DAILY' });
        useTaskStore.setState({ _allProjects: [{ ...parent, status: 'archived' }] });
        expect(host.prepareTaskDraftSave(prepared.request)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await commit(prepared)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saveData).not.toHaveBeenCalled();
        useTaskStore.setState({ _allProjects: [parent] });
        expect(await commit(prepared)).toMatchObject({ ok: true });
        const committed = saved();
        saveData.mockClear();
        useTaskStore.setState({ _allProjects: [{ ...parent, status: 'archived' }] });
        const before = stored();
        expect(await commit(prepared)).toMatchObject({ ok: true });
        expectUnchanged(before, committed);
    });
});
