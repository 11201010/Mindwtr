import { afterEach, expect, it, vi } from 'vitest';
import { createCalendarRecorder, loadCalendarViewsFixture, seedCalendarStore } from './calendar-view-model.replay';
import { createNativeHostContract } from './native-host-contract';
import { flushPendingSave, resetForTests, useTaskStore } from './store';
import { generateUUID } from './uuid';

const fixture = loadCalendarViewsFixture();
const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
const open = async (linked = false, saveData?: (data: unknown) => Promise<void>, focused = false) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(fixture.now));
    const tasks = fixture.tasks.map((task) => task.id === 'n-email'
        ? { ...task, ...(linked ? { dueDate: '2026-11-02T15:00:00.000Z', startTime: '2026-11-01T15:00:00.000Z',
            relativeStartOffset: { unit: 'day' as const, amount: -1 } } : {}),
            ...(focused ? { isFocusedToday: true, focusOrder: 2 } : {}) } : task);
    await seedCalendarStore({ ...fixture, tasks }, { name: 'prepared-calendar', settings: 'month', actions: [] }, createCalendarRecorder(), { saveData });
    const host = createNativeHostContract();
    value(await host.setLanguage({ storedLanguage: 'en', systemLocale: fixture.deviceLocale }));
    value(await host.activate({ writeSafetyReady: true }));
    const composer = value(host.openCalendarComposer({ scheduleTaskId: 'n-email', day: '2026-10-31' })).composer!.composer;
    return { host, composer };
};
afterEach(async () => {
    vi.useRealTimers();
    await flushPendingSave();
    resetForTests();
});

it('validates immutable row authority without activation, store, current clock or timezone', async () => {
    const { host, composer } = await open();
    const prepared = value(await host.prepareCalendarComposerSave({ requestId: generateUUID(), composer }));
    expect(prepared.kind).toBe('prepared');
    if (prepared.kind !== 'prepared') return;
    const command = JSON.parse(JSON.stringify({ request: prepared.prepared.request, prepared: prepared.prepared }));
    resetForTests();
    vi.setSystemTime(new Date('2037-01-01T01:00:00.000Z'));
    const originalZone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
        const detached = createNativeHostContract();
        expect(value(detached.validatePreparedCalendarComposerSave(command))).toEqual(prepared.prepared.result);
        for (const mutate of [
            (copy: typeof command) => { copy.prepared.after.description = 'forged'; },
            (copy: typeof command) => { copy.prepared.after.rev += 1; },
            (copy: typeof command) => { copy.prepared.request.requestId = generateUUID(); },
            (copy: typeof command) => { copy.prepared.result.next.selectedDate = '2037-01-01'; },
            (copy: typeof command) => { copy.prepared.projection.offsetMinutes += 60; },
            (copy: typeof command) => { copy.prepared.policy.normalizedUpdates.status = 'done'; },
        ]) {
            const tampered = JSON.parse(JSON.stringify(command));
            mutate(tampered);
            expect(detached.validatePreparedCalendarComposerSave(tampered)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
    } finally {
        if (originalZone === undefined) delete process.env.TZ;
        else process.env.TZ = originalZone;
    }
});

it('requires a full stamped after-row receipt, including an edit reverted to the old values', async () => {
    const { host, composer } = await open();
    const prepared = value(await host.prepareCalendarComposerSave({ requestId: generateUUID(), composer }));
    expect(prepared.kind).toBe('prepared');
    if (prepared.kind !== 'prepared') return;
    const command = { request: prepared.prepared.request, prepared: prepared.prepared };
    const first = value(await host.commitPreparedCalendarComposerSave(command));
    expect(value(await host.commitPreparedCalendarComposerSave(command))).toEqual(first);
    const start = useTaskStore.getState()._tasksById.get('n-email')!.startTime;
    await useTaskStore.getState().updateTask('n-email', { startTime: '2026-11-02T17:00:00.000Z' });
    await useTaskStore.getState().updateTask('n-email', { startTime: start });
    const newer = useTaskStore.getState()._tasksById.get('n-email')!;
    expect(newer.rev).toBeGreaterThan(prepared.prepared.after.rev);
    expect(await host.commitPreparedCalendarComposerSave(command)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    expect(useTaskStore.getState()._tasksById.get('n-email')?.rev).toBe(newer.rev);
});

it('keeps a later task edit on exact prepared replay after restart', async () => {
    const { host, composer } = await open();
    const request = { requestId: generateUUID(), composer };
    const prepared = value(await host.prepareCalendarComposerSave(request));
    expect(prepared.kind).toBe('prepared');
    if (prepared.kind !== 'prepared') return;
    const command = JSON.parse(JSON.stringify({ request: prepared.prepared.request, prepared: prepared.prepared }));
    const first = value(await host.commitPreparedCalendarComposerSave(command));
    const scheduled = useTaskStore.getState()._tasksById.get('n-email')!;
    expect(first).toMatchObject({ changed: true, taskId: scheduled.id });
    await useTaskStore.getState().updateTask(scheduled.id, { description: 'newer edit' });
    await flushPendingSave();
    const restarted = createNativeHostContract();
    value(await restarted.setLanguage({ storedLanguage: 'en', systemLocale: fixture.deviceLocale }));
    value(await restarted.activate({ writeSafetyReady: true }));
    expect(await restarted.commitPreparedCalendarComposerSave(command)).toMatchObject({ ok: false });
    expect(useTaskStore.getState()._tasksById.get(scheduled.id)?.description).toBe('newer edit');
});

it('uses RN update policy to keep the selected slot and clear a due-linked offset', async () => {
    const { host, composer } = await open(true);
    const request = { requestId: generateUUID(), composer };
    const prepared = value(await host.prepareCalendarComposerSave(request));
    expect(prepared.kind).toBe('prepared');
    if (prepared.kind !== 'prepared') return;
    value(await host.commitPreparedCalendarComposerSave({ request: prepared.prepared.request, prepared: prepared.prepared }));
    const saved = useTaskStore.getState()._tasksById.get('n-email')!;
    expect(saved.startTime).toBe(composer.startAt);
    expect(saved.relativeStartOffset).toBeUndefined();
});

it('freezes the future Focus effect and retries a failed save without restamping', async () => {
    const saveData = vi.fn().mockResolvedValue(undefined);
    const { host, composer } = await open(false, saveData, true);
    const prepared = value(await host.prepareCalendarComposerSave({ requestId: generateUUID(), composer }));
    expect(prepared.kind).toBe('prepared');
    if (prepared.kind !== 'prepared') return;
    const command = { request: prepared.prepared.request, prepared: prepared.prepared };
    saveData.mockRejectedValue(new Error('disk unavailable'));
    expect(await host.commitPreparedCalendarComposerSave(command)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
    const optimistic = useTaskStore.getState()._tasksById.get('n-email')!;
    expect(optimistic.focusOrder).toBeUndefined();
    expect(optimistic.isFocusedToday).toBe(true);
    expect(optimistic.rev).toBe(prepared.prepared.after.rev);
    saveData.mockResolvedValue(undefined);
    expect(value(await host.commitPreparedCalendarComposerSave(command))).toEqual(prepared.prepared.result);
    expect(useTaskStore.getState()._tasksById.get('n-email')?.rev).toBe(optimistic.rev);
});

it('returns a no-write navigation result after an already saved target', async () => {
    const { host, composer } = await open();
    const first = value(await host.prepareCalendarComposerSave({ requestId: generateUUID(), composer }));
    expect(first.kind).toBe('prepared');
    if (first.kind !== 'prepared') return;
    value(await host.commitPreparedCalendarComposerSave({ request: first.prepared.request, prepared: first.prepared }));
    const rev = useTaskStore.getState()._tasksById.get('n-email')?.rev;
    const second = value(await host.prepareCalendarComposerSave({ requestId: generateUUID(), composer }));
    expect(second).toMatchObject({ kind: 'noop', result: { changed: false, taskId: 'n-email', next: { viewMode: 'day' } } });
    expect(useTaskStore.getState()._tasksById.get('n-email')?.rev).toBe(rev);
});
