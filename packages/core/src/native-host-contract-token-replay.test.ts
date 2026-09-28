import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract } from './native-host-contract';
import * as logger from './logger';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Task } from './types';

const T0 = '2026-09-01T00:00:00.000Z';
const task = (id = 'edit'): Task => ({
    id, title: id, status: 'next', contexts: ['@old'], tags: ['#old'], description: 'Before',
    priority: 'urgent', energyLevel: 'high', timeEstimate: '30min', dueDate: '2026-10-01',
    createdAt: T0, updatedAt: T0, rev: 7,
});
const tokenCases = (['contexts', 'tags'] as const).flatMap((field) => {
    const prefix = field === 'contexts' ? '@' : '#';
    return [
        { field, raw: `${prefix}${prefix}office, ${prefix}office`, expected: [`${prefix}office`, `${prefix}office`] },
        { field, raw: '', expected: [] },
        { field, raw: ' , @#, ##, @, ', expected: [] },
        { field, raw: ' ## office , @#home, office,  , @@zoo ', expected: [`${prefix}office`, `${prefix}home`, `${prefix}office`, `${prefix}zoo`] },
        { field, raw: `${prefix}${prefix}zoo, ${prefix}office, ${prefix}office`, expected: [`${prefix}zoo`, `${prefix}office`, `${prefix}office`] },
    ];
});

describe('native token draft exact replay', () => {
    let durable: AppData;
    let saveData: ReturnType<typeof vi.fn>;
    let host: ReturnType<typeof createNativeHostContract>;
    const stored = () => useTaskStore.getState()._tasksById.get('edit')!;
    const persist = async (data: AppData) => { durable = structuredClone(data); };
    const open = async (recoveryLoad = false) => {
        resetForTests();
        useTaskStore.setState({
            _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
        });
        const next = createNativeHostContract();
        expect(await next.activate({ writeSafetyReady: true, recoveryLoad })).toMatchObject({ ok: true });
        await flushPendingSave();
        saveData.mockClear();
        return next;
    };

    beforeEach(async () => {
        durable = { tasks: [task()], projects: [], sections: [], areas: [], people: [], settings: {} };
        saveData = vi.fn(persist);
        setStorageAdapter({ getData: async () => structuredClone(durable), saveData });
        host = await open();
    });
    afterEach(async () => {
        saveData.mockImplementation(persist);
        await flushPendingSave();
        resetForTests();
        vi.restoreAllMocks();
    });

    it.each(tokenCases)('replays serialized $field "$raw" after restart without writing and retains an unrelated edit', async ({ field, raw, expected }) => {
        const info = vi.spyOn(logger, 'logInfo');
        const input = { id: 'edit', base: { [field]: stored()[field].join(', ') }, patch: { [field]: raw } };
        expect(await host.saveTaskDraft(input)).toMatchObject({ ok: true, value: { draft: { [field]: expected.join(', ') } } });
        expect(stored()[field]).toEqual(expected);
        expect(saveData).toHaveBeenCalledTimes(1);
        expect(info).not.toHaveBeenCalledWith('Native canonical token retry matched', expect.anything());
        expect((await useTaskStore.getState().updateTask('edit', { description: 'Other writer notes' })).success).toBe(true);
        await flushPendingSave();
        const saved = structuredClone(stored());

        const restarted = await open(true);
        const before = stored();
        expect(await restarted.saveTaskDraft(input)).toMatchObject({ ok: true, value: { draft: { [field]: expected.join(', ') } } });
        expect(stored()).toBe(before);
        expect(stored()).toEqual(saved);
        expect(stored()).toMatchObject({ description: 'Other writer notes', priority: 'urgent', energyLevel: 'high', timeEstimate: '30min', dueDate: '2026-10-01' });
        expect(saveData).not.toHaveBeenCalled();
        expect(info.mock.calls.filter(([message]) => message === 'Native canonical token retry matched')).toEqual(
            raw === expected.join(', ') ? [] : [[
                'Native canonical token retry matched',
                { scope: 'native-host', category: 'validation', context: { releaseCheck: 'v1.3.3/native-token-replay', outcome: 'matched' } },
            ]],
        );
    });

    it('replays both partial token fields after the process-local receipt is evicted', async () => {
        const input = { id: 'edit', base: { contexts: '@old', tags: '#old' }, patch: { contexts: '@@office, @office', tags: '##work, #work' } };
        expect(await host.saveTaskDraft(input)).toMatchObject({ ok: true });
        const saved = stored();
        useTaskStore.setState({ _allTasks: [...useTaskStore.getState()._allTasks, ...Array.from({ length: 50 }, (_, index) => task(`filler-${index}`))] });
        for (let index = 0; index < 50; index++) {
            const id = `filler-${index}`;
            expect(await host.saveTaskDraft({ id, base: { title: id }, patch: { title: `${id} edited` } })).toMatchObject({ ok: true });
        }
        saveData.mockClear();
        expect(await host.saveTaskDraft(input)).toMatchObject({ ok: true });
        expect(stored()).toBe(saved);
        expect(saveData).not.toHaveBeenCalled();
    });

    it.each((['contexts', 'tags'] as const).flatMap((field) => {
        const prefix = field === 'contexts' ? '@' : '#';
        return [
            { field, change: 'content', current: [`${prefix}other`, `${prefix}office`, `${prefix}home`] },
            { field, change: 'order', current: [`${prefix}home`, `${prefix}office`, `${prefix}office`] },
            { field, change: 'duplicates', current: [`${prefix}office`, `${prefix}home`] },
            { field, change: 'repeated prefix', current: [`${prefix}${prefix}office`, `${prefix}office`, `${prefix}home`] },
        ];
    }))('refuses a different current $field $change after restart without normalizing or overwriting it', async ({ field, current }) => {
        const prefix = field === 'contexts' ? '@' : '#';
        const input = { id: 'edit', base: { [field]: `${prefix}old` }, patch: { [field]: `${prefix}${prefix}office, ${prefix}office, ${prefix}home` } };
        expect(await host.saveTaskDraft(input)).toMatchObject({ ok: true });
        expect((await useTaskStore.getState().updateTask('edit', { [field]: current })).success).toBe(true);
        await flushPendingSave();
        const restarted = await open(true);
        const before = stored();
        expect(before[field]).toEqual(current);
        expect(await restarted.saveTaskDraft(input)).toEqual({ ok: false, error: { code: 'STALE_REVISION', message: `Task changed while editing: ${field}` } });
        expect(stored()).toBe(before);
        expect(saveData).not.toHaveBeenCalled();
    });

    it.each(['contexts', 'tags'] as const)('does not normalize the original %s base into permission to overwrite', async (field) => {
        const prefix = field === 'contexts' ? '@' : '#';
        const before = stored();
        expect(await host.saveTaskDraft({ id: 'edit', base: { [field]: `${prefix}${prefix}old` }, patch: { [field]: `${prefix}${prefix}office` } }))
            .toEqual({ ok: false, error: { code: 'STALE_REVISION', message: `Task changed while editing: ${field}` } });
        expect(stored()).toBe(before);
        expect(saveData).not.toHaveBeenCalled();
    });

    it.each(['description', 'checklist'] as const)('does not log a canonical token match when %s conflicts', async (field) => {
        const info = vi.spyOn(logger, 'logInfo');
        const input = {
            id: 'edit',
            base: { contexts: '@old', ...(field === 'description' ? { description: 'Before' } : {}) },
            patch: { contexts: '@@office, @office', ...(field === 'description' ? { description: 'Requested notes' } : {}) },
            ...(field === 'checklist' ? { checklist: { base: [], value: [{ id: 'item', title: 'Requested item', isCompleted: false }] } } : {}),
        };
        expect(await host.saveTaskDraft(input)).toMatchObject({ ok: true });
        const concurrent = field === 'description'
            ? { description: 'Other writer notes' }
            : { checklist: [{ id: 'item', title: 'Other writer item', isCompleted: false }] };
        expect((await useTaskStore.getState().updateTask('edit', concurrent)).success).toBe(true);
        await flushPendingSave();
        const restarted = await open(true);
        const before = stored();
        expect(await restarted.saveTaskDraft(input)).toEqual({ ok: false, error: { code: 'STALE_REVISION', message: `Task changed while editing: ${field}` } });
        expect(stored()).toBe(before);
        expect(saveData).not.toHaveBeenCalled();
        expect(info).not.toHaveBeenCalledWith('Native canonical token retry matched', expect.anything());
    });

    it('finishes failed persistence once, then replays after restart without another token write', async () => {
        const input = { id: 'edit', base: { contexts: '@old', tags: '#old' }, patch: { contexts: '@@office, @office', tags: '##work, #work' } };
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.saveTaskDraft(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        const applied = stored();
        expect(applied).toMatchObject({ contexts: ['@office', '@office'], tags: ['#work', '#work'] });
        saveData.mockImplementation(persist);
        saveData.mockClear();
        expect(await host.saveTaskDraft(input)).toMatchObject({ ok: true });
        expect(stored()).toBe(applied);
        expect(saveData).toHaveBeenCalledTimes(1);
        const restarted = await open(true);
        const before = stored();
        expect(await restarted.saveTaskDraft(input)).toMatchObject({ ok: true });
        expect(stored()).toBe(before);
        expect(stored()).toEqual(applied);
        expect(saveData).not.toHaveBeenCalled();
    });
});
