import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract } from './native-host-contract';
import type { NativeCalendarPreferenceRequest } from './native-host-contract-calendar';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData } from './types';
import { generateUUID } from './uuid';
import * as logger from './logger';

const NOW = '2026-09-27T12:00:00.000Z';
const value = <T,>(reply: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!reply.ok) throw new Error(reply.error.message);
    return reply.value;
};
const expectedAnswer = (changed: boolean) => ({ changed, toast: null, next: null, scrollToMinutes: null, composer: null, taskId: null });

describe('native Calendar preference exact retries', () => {
    let durable: AppData;
    let saveData: ReturnType<typeof vi.fn>;
    let host: ReturnType<typeof createNativeHostContract>;
    const persist = async (data: AppData) => { durable = structuredClone(data); };
    const open = async () => {
        resetForTests();
        useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0 });
        host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true, recoveryLoad: true })).toEqual({ ok: true, value: null });
        await flushPendingSave();
        saveData.mockClear();
    };
    const seed = async (calendar?: AppData['settings']['calendar']) => {
        durable = {
            tasks: [{ id: 'keep', title: 'Keep task', description: 'Untouched notes', status: 'next', contexts: ['@home'], tags: ['#keep'],
                dueDate: '2026-10-01', recurrence: { rule: 'daily', seriesId: 'keep' },
                createdAt: NOW, updatedAt: NOW, rev: 9 }],
            projects: [], sections: [], areas: [], people: [],
            settings: { deviceId: 'native-calendar-preferences', language: 'en', theme: 'dark',
                syncPreferencesUpdatedAt: { language: NOW }, ...(calendar ? { calendar } : {}) },
        };
        await open();
    };
    const snapshot = () => structuredClone({ tasks: useTaskStore.getState()._allTasks, settings: useTaskStore.getState().settings });
    const diagnosticCalls = () => vi.mocked(logger.logInfo).mock.calls.filter(([, metadata]) =>
        metadata?.context?.releaseCheck === 'v1.3.3/native-calendar-preference');

    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(NOW));
        vi.spyOn(logger, 'logInfo').mockImplementation(() => {});
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
    });

    it('reads stored defaults without writing or using the transient period mode', () => {
        const before = snapshot();
        expect(host.getCalendarPreferences()).toEqual({ ok: true, value: {
            version: 1, values: { viewMode: 'month', showCompleted: false, weekVisibleDays: 5 },
        } });
        value(host.getCalendarView({ state: { viewMode: 'day', selectedDate: '2026-10-01', visibleMonth: '2026-10-01' }, offset: 0, limit: 50 }));
        expect(value(host.getCalendarPreferences()).values.viewMode).toBe('month');
        expect(snapshot()).toEqual(before);
        expect(saveData).not.toHaveBeenCalled();
        expect(diagnosticCalls()).toHaveLength(0);
    });

    it('uses existing canonical load defaults without rewriting legacy raw values', async () => {
        await seed({ viewMode: 'legacy', showCompleted: 1, weekVisibleDays: 4.6 } as never);
        const before = snapshot();
        expect(value(host.getCalendarPreferences()).values).toEqual({ viewMode: 'month', showCompleted: false, weekVisibleDays: 5 });
        for (const [field, desired] of [['viewMode', 'month'], ['showCompleted', false], ['weekVisibleDays', 5]] as const) {
            expect(value(await host.setCalendarPreference({ requestId: generateUUID(), field, before: desired, value: desired } as NativeCalendarPreferenceRequest)))
                .toEqual(expectedAnswer(false));
        }
        expect(snapshot()).toEqual(before);
        expect(saveData).not.toHaveBeenCalled();
    });

    const options = [
        ...(['month', 'day', 'week', 'schedule'] as const).map((desired) => ({ field: 'viewMode' as const, before: desired === 'month' ? 'week' as const : 'month' as const, value: desired })),
        ...[false, true].map((desired) => ({ field: 'showCompleted' as const, before: !desired, value: desired })),
        ...[2, 3, 4, 5, 6, 7].map((desired) => ({ field: 'weekVisibleDays' as const, before: desired === 5 ? 7 : 5, value: desired })),
    ];
    it.each(options)('saves only $field=$value and returns the standard answer', async (option) => {
        await seed({ viewMode: 'schedule', showCompleted: true, weekVisibleDays: 3, workdayStart: '07:15', ...{ [option.field]: option.before } } as never);
        const before = snapshot();
        expect(value(await host.setCalendarPreference({ requestId: generateUUID(), ...option }))).toEqual(expectedAnswer(true));
        const expected = { ...before.settings, calendar: { ...before.settings.calendar, [option.field]: option.value } };
        expect(useTaskStore.getState().settings).toEqual(expected);
        expect(durable.settings).toEqual(expected);
        expect(useTaskStore.getState()._allTasks).toEqual(before.tasks);
        expect(durable.tasks).toEqual(before.tasks);
        expect(saveData).toHaveBeenCalledTimes(1);
        expect(diagnosticCalls()).toEqual([['Native Calendar preference result', {
            scope: 'native-host', category: 'storage', context: { releaseCheck: 'v1.3.3/native-calendar-preference', outcome: 'applied' },
        }]]);
    });

    it('rejects malformed envelopes, UUIDs, fields and noncanonical values without writes', async () => {
        const valid = { requestId: generateUUID(), field: 'viewMode', before: 'month', value: 'week' };
        const malformed: unknown[] = [null, [], {}, ...['requestId', 'field', 'before', 'value'].map((field) => Object.fromEntries(Object.entries(valid).filter(([name]) => name !== field))),
            ...['state', 'calendar', 'feed', 'date', 'unknown'].map((field) => ({ ...valid, [field]: null })),
            ...['', 'not-a-uuid', 1, null].map((requestId) => ({ ...valid, requestId })),
            { ...valid, field: 'theme' }, { ...valid, field: '__proto__' }, { ...valid, before: 'invalid' }, { ...valid, value: true },
            ...[0, 1, 'true', null].flatMap((bad) => [
                { ...valid, field: 'showCompleted', before: false, value: bad }, { ...valid, field: 'showCompleted', before: bad, value: true },
            ]),
            ...[0, 1, 8, 2.5, NaN, Infinity, '5', true, null].flatMap((bad) => [
                { ...valid, field: 'weekVisibleDays', before: 5, value: bad }, { ...valid, field: 'weekVisibleDays', before: bad, value: 7 },
            ]),
        ];
        const before = snapshot();
        for (const input of malformed) expect(await host.setCalendarPreference(input as NativeCalendarPreferenceRequest)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(snapshot()).toEqual(before);
        expect(saveData).not.toHaveBeenCalled();
        expect(diagnosticCalls()).toHaveLength(0);
    });

    it('binds the UUID to field, before and value, including across the raw Calendar action route', async () => {
        const request = { requestId: generateUUID(), field: 'viewMode' as const, before: 'month' as const, value: 'week' as const };
        value(await host.setCalendarPreference(request));
        const before = snapshot();
        saveData.mockClear();
        for (const changed of [
            { ...request, before: 'day' as const }, { ...request, value: 'day' as const },
            { ...request, field: 'showCompleted' as const, before: false, value: true },
        ]) expect(await host.setCalendarPreference(changed)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.runCalendarAction({ requestId: request.requestId, action: { type: 'setShowCompleted', on: true } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(snapshot()).toEqual(before);
        expect(saveData).not.toHaveBeenCalled();
    });

    it('retries only persistence before checking a newer same-field value', async () => {
        const request = { requestId: generateUUID(), field: 'viewMode' as const, before: 'month' as const, value: 'week' as const };
        saveData.mockRejectedValue(new Error('calendar preference disk failure'));
        expect(await host.setCalendarPreference(request)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(useTaskStore.getState().settings.calendar?.viewMode).toBe('week');
        expect(durable.settings.calendar).toBeUndefined();
        expect(diagnosticCalls()).toHaveLength(0);
        useTaskStore.setState({ settings: { ...useTaskStore.getState().settings,
            calendar: { viewMode: 'day', showCompleted: true, weekVisibleDays: 7 }, theme: 'light' } });
        const newer = snapshot();
        saveData.mockImplementation(persist);
        saveData.mockClear();
        expect(value(await host.setCalendarPreference(request))).toEqual(expectedAnswer(true));
        expect(snapshot()).toEqual(newer);
        expect(saveData).toHaveBeenCalledTimes(1);
        expect(durable.settings).toEqual(newer.settings);
        expect(durable.tasks).toEqual(newer.tasks);
        expect(diagnosticCalls().map(([, metadata]) => metadata?.context?.outcome)).toEqual(['applied']);
    });

    it('coalesces concurrent exact retries and waits for durable acknowledgment', async () => {
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        saveData.mockImplementation(async (data: AppData) => { await held; await persist(data); });
        const request = { requestId: generateUUID(), field: 'showCompleted' as const, before: false, value: true };
        let settled = 0;
        const first = host.setCalendarPreference(request).then((reply) => { settled += 1; return reply; });
        const second = host.setCalendarPreference(request).then((reply) => { settled += 1; return reply; });
        await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
        expect(settled).toBe(0);
        expect(diagnosticCalls()).toHaveLength(0);
        release();
        expect(value(await first)).toEqual(expectedAnswer(true));
        expect(value(await second)).toEqual(expectedAnswer(true));
        expect(saveData).toHaveBeenCalledTimes(1);
    });

    it('replays a disk write whose acknowledgment was lost after a receipt-free restart', async () => {
        const request = { requestId: generateUUID(), field: 'weekVisibleDays' as const, before: 5, value: 7 };
        saveData.mockImplementation(async (data: AppData) => {
            await persist(data);
            throw new Error('calendar preference acknowledgment lost');
        });
        expect(await host.setCalendarPreference(request)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(durable.settings.calendar?.weekVisibleDays).toBe(7);
        expect(diagnosticCalls()).toHaveLength(0);
        saveData.mockImplementation(persist);
        await open();
        const before = snapshot();
        expect(value(await host.setCalendarPreference(request))).toEqual(expectedAnswer(false));
        expect(snapshot()).toEqual(before);
        expect(saveData).not.toHaveBeenCalled();
        expect(diagnosticCalls().map(([, metadata]) => metadata?.context?.outcome)).toEqual(['replayed']);
    });

    it.each([
        { field: 'viewMode' as const, before: 'month' as const, value: 'week' as const, newer: 'day' as const },
        { field: 'weekVisibleDays' as const, before: 5, value: 7, newer: 3 },
    ])('rejects receipt-free same-field $field conflicts without writes', async ({ newer, ...change }) => {
        const request = { requestId: generateUUID(), ...change };
        value(await host.setCalendarPreference(request));
        durable.settings.calendar = { ...durable.settings.calendar, [change.field]: newer };
        await open();
        const before = snapshot();
        expect(await host.setCalendarPreference(request)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(snapshot()).toEqual(before);
        expect(saveData).not.toHaveBeenCalled();
    });

    it('retains newer unrelated Calendar and settings edits on receipt-free apply', async () => {
        const request = { requestId: generateUUID(), field: 'weekVisibleDays' as const, before: 5, value: 7 };
        durable.settings.calendar = { viewMode: 'day', showCompleted: true, weekVisibleDays: 5 };
        durable.settings.theme = 'light';
        durable.settings.timeFormat = '24h';
        await open();
        const before = snapshot();
        expect(value(await host.setCalendarPreference(request))).toEqual(expectedAnswer(true));
        expect(durable.settings).toEqual({ ...before.settings, calendar: { ...before.settings.calendar, weekVisibleDays: 7 } });
        expect(durable.tasks).toEqual(before.tasks);
    });

    it.each([
        { field: 'viewMode' as const, before: 'month' as const, value: 'week' as const },
        { field: 'showCompleted' as const, before: false, value: true },
        { field: 'weekVisibleDays' as const, before: 5, value: 7 },
    ])('acknowledges lost-reply/restart $field retries without another write or stamp', async (change) => {
        const request = { requestId: generateUUID(), ...change };
        expect(value(await host.setCalendarPreference(request))).toEqual(expectedAnswer(true));
        const settings = useTaskStore.getState().settings;
        const stamp = useTaskStore.getState().lastDataChangeAt;
        saveData.mockClear();
        expect(value(await host.setCalendarPreference(request))).toEqual(expectedAnswer(true));
        expect(useTaskStore.getState().settings).toBe(settings);
        expect(useTaskStore.getState().lastDataChangeAt).toBe(stamp);
        expect(saveData).not.toHaveBeenCalled();
        await open();
        const loaded = useTaskStore.getState().settings;
        const loadedStamp = useTaskStore.getState().lastDataChangeAt;
        expect(value(await host.setCalendarPreference(request))).toEqual(expectedAnswer(false));
        expect(useTaskStore.getState().settings).toBe(loaded);
        expect(useTaskStore.getState().lastDataChangeAt).toBe(loadedStamp);
        expect(saveData).not.toHaveBeenCalled();
    });

    it('does not let a diagnostic sink turn a durable success into a rejection', async () => {
        vi.mocked(logger.logInfo).mockImplementation(() => { throw new Error('diagnostic sink unavailable'); });
        expect(value(await host.setCalendarPreference({ requestId: generateUUID(), field: 'showCompleted', before: false, value: true })))
            .toEqual(expectedAnswer(true));
        expect(durable.settings.calendar?.showCompleted).toBe(true);
    });

    it('requires activation for both the read and write', async () => {
        const inactive = createNativeHostContract();
        expect(inactive.getCalendarPreferences()).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await inactive.setCalendarPreference({ requestId: generateUUID(), field: 'showCompleted', before: false, value: true }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(saveData).not.toHaveBeenCalled();
    });
});
