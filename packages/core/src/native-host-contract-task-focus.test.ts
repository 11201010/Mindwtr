import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Project, Section, Task } from './types';

const stamp = '2026-09-01T00:00:00.000Z';
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, status: 'next',
    tags: [], contexts: [], createdAt: stamp, updatedAt: stamp, ...extra });
const project = (extra: Partial<Project> = {}): Project => ({ id: 'p', title: 'Project', status: 'active',
    order: 0, color: '#123456', tagIds: [], createdAt: stamp, updatedAt: stamp, ...extra });
const section = (id: string, order: number): Section => ({ id, projectId: 'p', title: id, order,
    createdAt: stamp, updatedAt: stamp });
const saveData = vi.fn().mockResolvedValue(undefined);
const originalTimeZone = process.env.TZ;
const cloneSorted = (value: unknown): unknown => {
    const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
        : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item)
            .sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => [key, sort(part)])) : item;
    return JSON.parse(JSON.stringify(sort(value)));
};

describe('native prepared task Focus', () => {
    beforeEach(() => {
        saveData.mockReset().mockResolvedValue(undefined);
        setStorageAdapter({ getData: vi.fn().mockResolvedValue({ tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} }), saveData });
        useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0 });
    });
    afterEach(async () => { vi.useRealTimers(); process.env.TZ = originalTimeZone;
        await flushPendingSave(); resetForTests(); vi.restoreAllMocks(); });

    it('reads a bounded action and validates, commits, then replays the same sorted-key envelope', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
        useTaskStore.setState({ _allTasks: [task('a'), task('b')], settings: { deviceId: 'device' } });
        const options = host.getTaskFocusOptions({ taskId: 'a' });
        if (!options.ok) throw new Error(JSON.stringify(options));
        expect(options.value).toMatchObject({ canChange: true, action: { canToggle: true } });
        const { id: _id, ...expected } = options.value.task;
        const request = { requestId: '0f010290-15d9-49b6-b3d4-6bf9978f37d7', taskId: 'a', focused: true,
            expected };
        const planned = host.prepareTaskFocus(request);
        if (!planned.ok || planned.value.kind !== 'prepared') throw new Error(JSON.stringify(planned));
        const envelope = cloneSorted({ request, prepared: planned.value.prepared }) as {
            request: typeof request; prepared: typeof planned.value.prepared };
        expect(host.validatePreparedTaskFocus(envelope)).toEqual({ ok: true, value: { id: 'a', focused: true } });
        expect(await host.commitPreparedTaskFocus(envelope)).toEqual({ ok: true, value: { id: 'a', focused: true } });
        expect(useTaskStore.getState()._tasksById.get('a')?.isFocusedToday).toBe(true);
        const count = saveData.mock.calls.length;
        expect(await host.commitPreparedTaskFocus(envelope)).toEqual({ ok: true, value: { id: 'a', focused: true } });
        expect(saveData).toHaveBeenCalledTimes(count);
    });

    it('keeps Next, Waiting, and review-due Someday actions in the shared policy', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
        useTaskStore.setState({ _allTasks: [task('next'), task('waiting', { status: 'waiting', reviewAt: '2026-01-01' }),
            task('someday', { status: 'someday', reviewAt: '2026-01-01' })], settings: { deviceId: 'device' } });
        for (const [index, id] of ['next', 'waiting', 'someday'].entries()) {
            const options = host.getTaskFocusOptions({ taskId: id });
            if (!options.ok) throw new Error(JSON.stringify(options));
            const { id: _id, ...expected } = options.value.task;
            const planned = host.prepareTaskFocus({ requestId: `0f010290-15d9-49b6-b3d4-${String(index).padStart(12, '0')}`,
                taskId: id, focused: true, expected });
            expect(planned).toMatchObject({ ok: true, value: { kind: 'prepared' } });
        }
    });

    it.each([
        ['next', { status: 'next' as const, focusOrder: 4 }],
        ['waiting', { status: 'waiting' as const, reviewAt: '2026-09-20' }],
        ['someday', { status: 'someday' as const, reviewAt: '2026-09-20' }],
        ['queued', { status: 'next' as const, startTime: '2026-10-20', focusOrder: 4 }],
    ])('matches the complete RN updateTask row for %s', async (id, fields) => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00.000Z'));
        const source = task(id, fields);
        useTaskStore.setState({ _allTasks: [source], settings: { deviceId: 'device' } });
        const options = host.getTaskFocusOptions({ taskId: id });
        if (!options.ok) throw new Error(JSON.stringify(options));
        const { id: _id, ...expected } = options.value.task;
        const planned = host.prepareTaskFocus({ requestId: '0f010290-15d9-49b6-b3d4-6bf9978f37d7',
            taskId: id, focused: true, expected });
        if (!planned.ok || planned.value.kind !== 'prepared') throw new Error(JSON.stringify(planned));
        const actual = await useTaskStore.getState().updateTask(id, { isFocusedToday: true });
        expect(actual.success).toBe(true);
        expect(useTaskStore.getState()._tasksById.get(id))
            .toEqual(planned.value.prepared.effect.task.after);
        if (id === 'queued') {
            expect(planned.value.prepared.effect.task.after.focusOrder).toBeUndefined();
        }
    });

    it('blocks ineligible additions, allows unstar at cap, and gives no-op without a journal', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
        useTaskStore.setState({ _allTasks: [task('inbox', { status: 'inbox' }),
            task('deferred', { startTime: '2099-01-01', status: 'waiting' }),
            task('already', { isFocusedToday: true }), task('candidate')],
            settings: { deviceId: 'device', gtd: { focusTaskLimit: 1 } } });
        saveData.mockClear();
        const request = (id: string, focused: boolean, requestId: string) => {
            const options = host.getTaskFocusOptions({ taskId: id });
            if (!options.ok) throw new Error(JSON.stringify(options));
            const { id: _id, ...expected } = options.value.task;
            return { requestId, taskId: id, focused, expected };
        };
        for (const id of ['inbox', 'deferred', 'candidate']) {
            expect(host.prepareTaskFocus(request(id, true, '0f010290-15d9-49b6-b3d4-6bf9978f37d7')))
                .toMatchObject({ ok: true, value: { kind: 'blocked' } });
        }
        expect(host.prepareTaskFocus(request('already', true, '0f010290-15d9-49b6-b3d4-6bf9978f37d8')))
            .toEqual({ ok: true, value: { kind: 'noop', result: { id: 'already', focused: true } } });
        expect(host.prepareTaskFocus(request('already', false, '0f010290-15d9-49b6-b3d4-6bf9978f37d9')))
            .toMatchObject({ ok: true, value: { kind: 'prepared' } });
        expect(saveData).not.toHaveBeenCalled();
    });

    it('replays mixed floating/absolute sequential due dates across a DST zone change', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
        process.env.TZ = 'America/New_York';
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-08T15:00:00.000Z'));
        useTaskStore.setState({ _allProjects: [project({ isSequential: true })],
            _allSections: [section('s', 0)],
            _allTasks: [task('absolute', { projectId: 'p', sectionId: 's', order: 0,
                dueDate: '2026-03-08T01:00:00-05:00' }),
            task('floating', { projectId: 'p', sectionId: 's', order: 1,
                dueDate: '2026-03-07T23:30:00' })], settings: { deviceId: 'device' } });
        const options = host.getTaskFocusOptions({ taskId: 'floating' });
        if (!options.ok) throw new Error(JSON.stringify(options));
        const { id: _id, ...expected } = options.value.task;
        const request = { requestId: '0f010290-15d9-49b6-b3d4-6bf9978f37d7',
            taskId: 'floating', focused: true, expected };
        const planned = host.prepareTaskFocus(request);
        if (!planned.ok || planned.value.kind !== 'prepared') throw new Error(JSON.stringify(planned));
        const envelope = cloneSorted({ request, prepared: planned.value.prepared }) as {
            request: typeof request; prepared: typeof planned.value.prepared };
        expect(envelope.prepared.dates.find((row) => row.value === '2026-03-07T23:30:00')?.parsedAt)
            .toBe(Date.parse('2026-03-08T04:30:00.000Z'));
        process.env.TZ = 'UTC';
        expect(host.validatePreparedTaskFocus(envelope)).toEqual({ ok: true, value: { id: 'floating', focused: true } });
        expect(await host.commitPreparedTaskFocus(envelope)).toEqual({ ok: true, value: { id: 'floating', focused: true } });
    });

    it.each([
        ['spring gap', '2026-03-08T02:30:00', '2026-03-08T07:30:00.000Z', '2026-03-07T15:00:00.000Z'],
        ['fall fold', '2026-11-01T01:30:00', '2026-11-01T05:30:00.000Z', '2026-10-31T15:00:00.000Z'],
        ['hour-only local time', '2026-09-29T02', '2026-09-29T06:00:00.000Z', '2026-09-29T15:00:00.000Z'],
        ['rolled local hour', '2026-09-29T25', '2026-09-30T05:00:00.000Z', '2026-09-29T15:00:00.000Z'],
        ['transition date', '2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-08T15:00:00.000Z'],
        ['compact offset', '2026-09-29T02:30+0200', '2026-09-29T00:30:00.000Z', '2026-09-29T15:00:00.000Z'],
        ['hour offset', '2026-09-29T02:30+02', '2026-09-29T00:30:00.000Z', '2026-09-29T15:00:00.000Z'],
        ['offset without minutes', '2026-09-29T02+02', '2026-09-29T00:00:00.000Z', '2026-09-29T15:00:00.000Z'],
        ['extended fraction', '2026-09-29T02:30:00.1234+02', '2026-09-29T00:30:00.123Z', '2026-09-29T15:00:00.000Z'],
        ['midnight gap date', '2018-11-04', '2018-11-04T03:00:00.000Z', '2018-11-04T15:00:00.000Z'],
    ])('keeps the RN-selected epoch for a %s start', async (_name, startTime, parsedAt, now) => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
        process.env.TZ = _name === 'midnight gap date' ? 'America/Sao_Paulo' : 'America/New_York';
        vi.useFakeTimers(); vi.setSystemTime(new Date(now));
        useTaskStore.setState({ _allTasks: [task('scheduled', { startTime })], settings: { deviceId: 'device' } });
        const options = host.getTaskFocusOptions({ taskId: 'scheduled' });
        if (!options.ok) throw new Error(JSON.stringify(options));
        const { id: _id, ...expected } = options.value.task;
        const request = { requestId: '0f010290-15d9-49b6-b3d4-6bf9978f37d7',
            taskId: 'scheduled', focused: true, expected };
        const planned = host.prepareTaskFocus(request);
        if (!planned.ok || planned.value.kind !== 'prepared') throw new Error(JSON.stringify(planned));
        const envelope = cloneSorted({ request, prepared: planned.value.prepared }) as {
            request: typeof request; prepared: typeof planned.value.prepared };
        expect(envelope.prepared.dates.find((row) => row.value === startTime)?.parsedAt).toBe(Date.parse(parsedAt));
        if (_name === 'transition date') {
            expect(envelope.prepared.dates.find((row) => row.value === startTime))
                .toMatchObject({ parsedOffsetMinutes: 300, dueOffsetMinutes: 240 });
        }
        process.env.TZ = 'UTC';
        expect(host.validatePreparedTaskFocus(envelope)).toEqual({ ok: true, value: { id: 'scheduled', focused: true } });
    });

    it('ignores malformed dates unrelated to a Next star but rejects forged consumed epochs', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
        process.env.TZ = 'America/New_York';
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-08T15:00:00.000Z'));
        useTaskStore.setState({ _allTasks: [task('a', { dueDate: 'legacy not a date',
            reviewAt: '2026-02-30', startTime: '2026-03-07T23:30:00' })],
        settings: { deviceId: 'device' } });
        const options = host.getTaskFocusOptions({ taskId: 'a' });
        if (!options.ok) throw new Error(JSON.stringify(options));
        const { id: _id, ...expected } = options.value.task;
        const request = { requestId: '0f010290-15d9-49b6-b3d4-6bf9978f37d7',
            taskId: 'a', focused: true, expected };
        const planned = host.prepareTaskFocus(request);
        if (!planned.ok || planned.value.kind !== 'prepared') throw new Error(JSON.stringify(planned));
        expect(planned.value.prepared.dates.map((row) => row.value))
            .toEqual(['2026-02-30', '2026-03-07T23:30:00']);
        const forged = cloneSorted({ request, prepared: planned.value.prepared }) as {
            request: typeof request; prepared: typeof planned.value.prepared };
        const date = forged.prepared.dates.find((row) => row.value === '2026-03-07T23:30:00')!;
        date.parsedAt! += 30_000; date.dueAt! += 30_000;
        expect(host.validatePreparedTaskFocus(forged)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('keeps a large project witness compact and rejects an overbound source row', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
        useTaskStore.setState({ _allProjects: [project()],
            _allTasks: [task('source', { projectId: 'p' }),
                ...Array.from({ length: 4000 }, (_, index) => task(`peer-${index}`, {
                    projectId: 'p', description: 'notes'.repeat(200), order: index,
                }))], settings: { deviceId: 'device' } });
        const options = host.getTaskFocusOptions({ taskId: 'source' });
        if (!options.ok) throw new Error(JSON.stringify(options));
        const { id: _id, ...expected } = options.value.task;
        const request = { requestId: '0f010290-15d9-49b6-b3d4-6bf9978f37d7',
            taskId: 'source', focused: true, expected };
        const planned = host.prepareTaskFocus(request);
        if (!planned.ok || planned.value.kind !== 'prepared') throw new Error(JSON.stringify(planned));
        expect(JSON.stringify(planned.value.prepared).length).toBeLessThan(2_000_000);
        expect(JSON.stringify(planned.value.prepared)).not.toContain('notesnotes');
        useTaskStore.setState({ _allTasks: [task('source', { projectId: 'p', description: 'x'.repeat(2_100_000) })] });
        const oversized = host.getTaskFocusOptions({ taskId: 'source' });
        if (!oversized.ok) throw new Error(JSON.stringify(oversized));
        const { id: _oversizedId, ...oversizedExpected } = oversized.value.task;
        expect(host.prepareTaskFocus({ ...request, expected: oversizedExpected }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('prevents writes to archived or deleted containers and finished tasks', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
        useTaskStore.setState({ _allProjects: [project({ status: 'archived' })],
            _allTasks: [task('inArchived', { projectId: 'p' }), task('done', { status: 'done' }),
                task('reference', { status: 'reference' })] });
        saveData.mockClear();
        for (const id of ['inArchived', 'done', 'reference']) {
            const options = host.getTaskFocusOptions({ taskId: id });
            if (!options.ok) throw new Error(JSON.stringify(options));
            expect(options.value.canChange).toBe(false);
            const { id: _id, ...expected } = options.value.task;
            expect(host.prepareTaskFocus({ requestId: '0f010290-15d9-49b6-b3d4-6bf9978f37d7',
                taskId: id, focused: true, expected }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        expect(saveData).not.toHaveBeenCalled();
    });
});
