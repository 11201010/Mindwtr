import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { collectBulkTaskTokens } from './bulk-task-tokens';
import { loadTranslations } from './i18n/i18n-loader';
import { createNativeHostContract } from './native-host-contract';
import type { NativeBulkAction } from './native-host-contract-bulk-actions';
import { createBulkOrganizeArea, createBulkOrganizeProject } from './bulk-organize-create';
import { flushPendingSave, resetForTests, useTaskStore } from './store';
import {
    BULK_ORGANIZE_KEEP,
    BULK_ORGANIZE_NONE,
    buildBulkOrganizeDialogModel,
    buildBulkOrganizeInput,
    buildTaskListBulkBarModel,
    EMPTY_BULK_ORGANIZE_DRAFT,
    getBulkMoveStatusOptions,
    getBulkOrganizeAreaOptions,
    getBulkOrganizeProjectOptions,
    getTaskListBulkToast,
    planBulkOrganize,
    planBulkTagEdit,
    runTaskListBulkWrite,
    type BulkOrganizeDraft,
    type TaskListBulkWrite,
} from './task-list-bulk-actions';
import {
    loadBulkActionsFixture,
    normalize,
    openBulkActionsHost,
    requestId,
    seedBulkActionsStore,
    value,
} from './task-list-bulk-actions.replay';

const fixture = loadBulkActionsFixture();
const ORGANIZE: Partial<BulkOrganizeDraft> = {
    status: 'waiting', delegateWho: 'Alice', projectChoice: 'p-launch', startDate: '2026-09-27', contexts: '@desk', tags: 'q4',
};

describe('native host contract: selection mode', () => {
    const originalTz = process.env.TZ;
    let t: (key: string) => string = (key) => key;
    beforeAll(async () => {
        process.env.TZ = fixture.timeZone;
        const english = await loadTranslations('en');
        t = (key) => english[key] ?? key;
    });
    afterAll(() => {
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });
    afterEach(async () => {
        vi.useRealTimers();
        await flushPendingSave();
        resetForTests();
        vi.restoreAllMocks();
    });
    const freezeClock = () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(fixture.now));
    };
    const open = async (saveData?: (data: unknown) => Promise<void>) => {
        const log: unknown[] = [];
        await seedBulkActionsStore(fixture, log, saveData);
        const host = await openBulkActionsHost();
        log.length = 0;
        return { host, log };
    };
    /** Every task as stored, less the device stamp. */
    const tasksNow = () => normalize(useTaskStore.getState()._allTasks.map(({ revBy: _revBy, ...task }) => task));

    describe('equals core called directly', () => {
        const cases: { name: string; action: NativeBulkAction; list: 'inbox' | 'done'; write: () => TaskListBulkWrite | null }[] = [
            { name: 'move', list: 'inbox', action: { type: 'moveTasks', taskIds: ['i-call', 'i-milk'], status: 'next' }, write: () => ({ kind: 'move', taskIds: ['i-call', 'i-milk'], status: 'next' }) },
            {
                name: 'add a tag', list: 'inbox',
                action: { type: 'editTaskTokens', taskIds: ['i-call', 'i-milk'], field: 'tags', mode: 'add', values: ['urgent'] },
                write: () => planBulkTagEdit(['i-call', 'i-milk'], useTaskStore.getState()._tasksById, 'add', 'urgent'),
            },
            {
                name: 'remove a tag', list: 'done',
                action: { type: 'editTaskTokens', taskIds: ['d-rent'], field: 'tags', mode: 'remove', values: ['#money'] },
                write: () => planBulkTagEdit(['d-rent'], useTaskStore.getState()._tasksById, 'remove', ['#money']),
            },
            {
                name: 'organize', list: 'inbox',
                action: { type: 'organize', taskIds: ['i-call', 'i-read'], draft: ORGANIZE },
                write: () => planBulkOrganize(['i-call', 'i-read'], useTaskStore.getState()._tasksById, buildBulkOrganizeInput({ ...EMPTY_BULK_ORGANIZE_DRAFT, ...ORGANIZE })),
            },
            { name: 'delete', list: 'inbox', action: { type: 'trashTasks', taskIds: ['i-milk', 'i-party'] }, write: () => ({ kind: 'trash', taskIds: ['i-milk', 'i-party'] }) },
        ];
        for (const entry of cases) {
            it(entry.name, async () => {
                freezeClock();
                const core = await open();
                const write = entry.write()!;
                await runTaskListBulkWrite(useTaskStore.getState(), write);
                const toast = getTaskListBulkToast(write, t);
                const expected = { tasks: tasksNow(), log: [...core.log] };
                await flushPendingSave();

                const contract = await open();
                const result = value(await contract.host.runBulkAction({ requestId: requestId(), list: entry.list, action: entry.action }));
                expect({ tasks: tasksNow(), log: contract.log }).toEqual(expected);
                expect(result).toEqual({
                    changed: true,
                    toast: toast && {
                        tone: toast.tone, title: toast.title, message: toast.message,
                        undo: toast.undo ? { label: toast.undo.label, action: { type: 'restoreTasks', taskIds: toast.undo.taskIds } } : null,
                    },
                });
            });
        }

        it('the bar, the remove-tag tokens and the organize dialog', async () => {
            freezeClock();
            const { host } = await open();
            const view = value(host.getBulkActions({
                list: 'inbox', taskIds: ['i-milk', 'i-read'], organize: { draft: ORGANIZE }, picker: { kind: 'removeTag' },
            }));
            const state = useTaskStore.getState();
            expect(view.bar).toEqual(buildTaskListBulkBarModel({
                selectedCount: 2, hasSelection: true, busy: false, rangeSelectMode: false, statuses: getBulkMoveStatusOptions('inbox'),
                moveToSection: false, organize: true, removeTag: { canRemove: true }, t,
            }));
            expect(view.picker?.items.map((item) => item.value)).toEqual(collectBulkTaskTokens(['i-milk', 'i-read'], state._tasksById, 'tags'));
            const dialog = buildBulkOrganizeDialogModel({
                draft: { ...EMPTY_BULK_ORGANIZE_DRAFT, ...ORGANIZE },
                projects: getBulkOrganizeProjectOptions(state.projects),
                areas: getBulkOrganizeAreaOptions(state.areas),
                selectedCount: 2,
                t,
            });
            const { draft, statuses, dates, waitingFor, contexts, tags, ...rest } = view.organize!;
            const { statuses: _statuses, dates: _dates, waitingFor: _waitingFor, contexts: _contexts, tags: _tags, ...dialogRest } = dialog;
            expect(draft).toEqual({ ...EMPTY_BULK_ORGANIZE_DRAFT, ...ORGANIZE });
            expect(rest).toEqual(dialogRest);
            expect(statuses.map(({ edit: _edit, ...status }) => status)).toEqual(dialog.statuses);
            expect(dates.map((date) => [date.field, date.label])).toEqual(dialog.dates.map((date) => [date.field, date.label]));
            expect(waitingFor).toEqual({ ...dialog.waitingFor, value: 'Alice' });
            expect([contexts, tags]).toEqual([{ ...dialog.contexts, value: '@desk' }, { ...dialog.tags, value: 'q4' }]);
            // Start holds tomorrow: its chip is on and clears it; the picker opens there.
            expect(dates[0]).toMatchObject({
                value: '2026-09-27', displayValue: '09/27/2026', pickerStart: '2026-09-27',
                quickDates: [
                    { preset: 'today', selected: false, value: '2026-09-26', edit: { type: 'setText', field: 'startDate', value: '2026-09-26' } },
                    { preset: 'tomorrow', selected: true, value: '', edit: { type: 'setText', field: 'startDate', value: '' } },
                ],
            });
            expect(dates[1]).toMatchObject({ value: '', displayValue: '', pickerStart: '2026-09-26' });
        });
    });

    describe('retries exactly after a failed save', () => {
        const retry = async (list: 'inbox' | 'done', action: NativeBulkAction, expectedLog: unknown[]) => {
            freezeClock();
            const saveData = vi.fn().mockResolvedValue(undefined);
            const { host, log } = await open(saveData);
            const input = { requestId: requestId(), list, action };
            saveData.mockRejectedValue(new Error('disk unavailable'));
            expect(await host.runBulkAction(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
            expect(log).toEqual(expectedLog);
            const landed = tasksNow();
            saveData.mockResolvedValue(undefined);
            const retried = await host.runBulkAction(input);
            expect(retried).toMatchObject({ ok: true, value: { changed: true } });
            // The retry only saved: no second write, the same tasks.
            expect(log).toEqual(expectedLog);
            expect(tasksNow()).toEqual(landed);
            // The retry's save stored what landed.
            const plain = (tasks: unknown[]) => JSON.parse(JSON.stringify(tasks.map((task) => ({ ...(task as object), revBy: undefined }))));
            expect(plain((saveData.mock.lastCall?.[0] as { tasks: unknown[] }).tasks)).toEqual(plain(useTaskStore.getState()._allTasks));
            // A lost reply repeats the request: no write, no save.
            const saves = saveData.mock.calls.length;
            expect(await host.runBulkAction(input)).toEqual(retried);
            expect(saveData).toHaveBeenCalledTimes(saves);
            expect(await host.runBulkAction({ ...input, action: { ...action, taskIds: ['w-bob'] } as NativeBulkAction }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            return { host, retried };
        };

        it('a move', async () => {
            await retry('inbox', { type: 'moveTasks', taskIds: ['i-call', 'i-milk'], status: 'someday' }, [
                ['batchMoveTasks', ['i-call', 'i-milk'], 'someday'],
                ['batchUpdateTasks', [{ id: 'i-call', updates: { status: 'someday' } }, { id: 'i-milk', updates: { status: 'someday' } }]],
            ]);
        }, 20_000);

        it('adding a tag', async () => {
            await retry('inbox', { type: 'editTaskTokens', taskIds: ['i-call'], field: 'tags', mode: 'add', values: ['urgent'] }, [
                ['batchUpdateTasks', [{ id: 'i-call', updates: { tags: ['#health', '#urgent'] } }]],
            ]);
        }, 20_000);

        it('removing a tag', async () => {
            await retry('done', { type: 'editTaskTokens', taskIds: ['d-rent'], field: 'tags', mode: 'remove', values: ['#money'] }, [
                ['batchUpdateTasks', [{ id: 'd-rent', updates: { tags: [] } }]],
            ]);
        }, 20_000);

        it('Bulk organize', async () => {
            await retry('inbox', { type: 'organize', taskIds: ['i-read'], draft: { status: 'someday', tags: 'later' } }, [
                ['batchUpdateTasks', [{ id: 'i-read', updates: { status: 'someday', tags: ['#later'] } }]],
            ]);
        }, 20_000);

        it('a delete, then its Undo', async () => {
            const { host, retried } = await retry('inbox', { type: 'trashTasks', taskIds: ['i-milk', 'i-party'] }, [['batchDeleteTasks', ['i-milk', 'i-party']]]);
            expect(retried).toEqual({ ok: true, value: { changed: true, toast: {
                tone: 'success', title: 'Done', message: '2 tasks',
                undo: { label: 'Undo', action: { type: 'restoreTasks', taskIds: ['i-milk', 'i-party'] } },
            } } });
            expect(value(await host.runBulkAction({ requestId: requestId(), list: 'inbox', action: { type: 'restoreTasks', taskIds: ['i-milk', 'i-party'] } })))
                .toEqual({ changed: true, toast: null });
            expect(useTaskStore.getState()._tasksById.get('i-milk')?.deletedAt).toBeUndefined();
        }, 20_000);

        it('an Undo', async () => {
            freezeClock();
            const saveData = vi.fn().mockResolvedValue(undefined);
            const { host, log } = await open(saveData);
            value(await host.runBulkAction({ requestId: requestId(), list: 'waiting', action: { type: 'trashTasks', taskIds: ['w-landlord'] } }));
            log.length = 0;
            const undo = { requestId: requestId(), list: 'waiting' as const, action: { type: 'restoreTasks' as const, taskIds: ['w-landlord'] } };
            saveData.mockRejectedValue(new Error('disk unavailable'));
            expect(await host.runBulkAction(undo)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
            saveData.mockResolvedValue(undefined);
            expect(await host.runBulkAction(undo)).toEqual({ ok: true, value: { changed: true, toast: null } });
            expect(log).toEqual([['restoreTask', 'w-landlord']]);
            expect(useTaskStore.getState()._tasksById.get('w-landlord')?.deletedAt).toBeUndefined();
        }, 20_000);
    });

    describe('Select all', () => {
        it('acts on every selectable row on screen, less the rows deselected since', async () => {
            freezeClock();
            const { host, log } = await open();
            const params = { includeArchivedProjects: true };
            const view = value(host.getBulkActions({ list: 'reference', params, selectAll: { except: ['r-wifi'] } }));
            // The archived project's reference opens read-only: Select all skips it.
            expect(view).toMatchObject({ selectableCount: 2, selectedCount: 1, selectedIds: [], selectAll: { params, except: ['r-wifi'] } });
            const result = value(await host.runBulkAction({ requestId: requestId(), list: 'reference', action: { type: 'moveTasks', status: 'next', selectAll: view.selectAll! } }));
            expect(result).toMatchObject({ changed: true, toast: { message: '1 task' } });
            expect(log[0]).toEqual(['batchMoveTasks', ['r-manual'], 'next']);
        });

        it('refuses with STALE_REVISION once the rows on screen changed', async () => {
            freezeClock();
            const { host, log } = await open();
            const view = value(host.getBulkActions({ list: 'inbox', selectAll: {} }));
            expect(view.selectedCount).toBe(4);
            // Another device files a row away.
            await useTaskStore.getState().updateTask('i-read', { status: 'next' });
            log.length = 0;
            const stale = await host.runBulkAction({ requestId: requestId(), list: 'inbox', action: { type: 'trashTasks', selectAll: view.selectAll! } });
            expect(stale).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(log).toEqual([]);
            // Minutes passing change nothing on screen: Select all still holds.
            const fresh = value(host.getBulkActions({ list: 'inbox', selectAll: {} }));
            vi.setSystemTime(new Date(Date.parse(fixture.now) + 120_000));
            const done = value(await host.runBulkAction({ requestId: requestId(), list: 'inbox', action: { type: 'trashTasks', selectAll: fresh.selectAll! } }));
            expect(done).toMatchObject({ changed: true, toast: { message: '3 tasks', undo: { action: { type: 'restoreTasks', taskIds: ['i-party', 'i-call', 'i-milk'] } } } });
        });
    });

    describe('selection', () => {
        it('taps and Range keep the tap order; a read-only row does not select; hidden rows leave', async () => {
            freezeClock();
            const { host } = await open();
            const params = { includeArchivedProjects: true };
            const tap = (taskIds: string[], anchorId: string | null, taskId: string, range = false) => value(host.getBulkActions({
                list: 'reference', params, taskIds, anchorId, selectionEdit: { taskId, range },
            }));
            expect(tap([], null, 'r-old')).toMatchObject({ selectedIds: [], anchorId: null, selectedCount: 0 });
            const first = tap([], null, 'r-wifi');
            expect(first).toMatchObject({ selectedIds: ['r-wifi'], anchorId: 'r-wifi' });
            expect(tap(first.selectedIds, first.anchorId, 'r-manual', true)).toMatchObject({ selectedIds: ['r-wifi', 'r-manual'], anchorId: 'r-manual' });
            // Without archived projects, r-old is not on screen at all.
            expect(host.getBulkActions({ list: 'reference', selectionEdit: { taskId: 'r-old' } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            // A row filtered away leaves the selection.
            const filtered = value(host.getBulkActions({ list: 'reference', params: { filters: { searchQuery: 'wifi' } }, taskIds: ['r-manual', 'r-wifi'] }));
            expect(filtered).toMatchObject({ selectedIds: ['r-wifi'], selectedCount: 1 });
        });

        it('the organize pickers lead with Keep and None, and search the rest', async () => {
            freezeClock();
            const { host } = await open();
            const view = value(host.getBulkActions({ list: 'inbox', taskIds: ['i-call'], organize: { draft: { projectChoice: 'p-home' } }, picker: { kind: 'project', query: 'LA' } }));
            expect(view.picker).toEqual({
                kind: 'project',
                total: 3,
                items: [
                    { value: BULK_ORGANIZE_KEEP, label: 'Keep project', selected: false, edit: { type: 'setProject', value: BULK_ORGANIZE_KEEP } },
                    { value: '__NONE__', label: t('taskEdit.noProjectOption'), selected: false, edit: { type: 'setProject', value: '__NONE__' } },
                    { value: 'p-launch', label: 'Launch', selected: false, edit: { type: 'setProject', value: 'p-launch' } },
                ],
                // "LA" names no project exactly: the search box offers to create it.
                create: { name: 'LA', label: '+ Create "LA"', accessibilityLabel: 'Create: LA' },
                submit: { create: 'LA' },
            });
            const areas = value(host.getBulkActions({ list: 'inbox', taskIds: ['i-call'], organize: {}, picker: { kind: 'area', offset: 2, limit: 1, revision: view.revision } }));
            expect(areas.picker).toMatchObject({ total: 4, items: [{ value: 'a-work', label: 'Work' }] });
            // Choosing a project resets the area to Keep.
            const chosen = value(host.getBulkActions({
                list: 'inbox', taskIds: ['i-call'], organize: { draft: { areaChoice: 'a-home' }, edit: { type: 'setProject', value: 'p-launch' } },
            }));
            expect(chosen.organize).toMatchObject({ draft: { projectChoice: 'p-launch', areaChoice: BULK_ORGANIZE_KEEP }, area: { disabled: true } });
        });
    });

    describe('target state', () => {
        it('a replay under a new request writes nothing', async () => {
            freezeClock();
            const { host, log } = await open();
            const actions: NativeBulkAction[] = [
                { type: 'moveTasks', taskIds: ['i-call'], status: 'next' },
                { type: 'editTaskTokens', taskIds: ['i-milk'], field: 'tags', mode: 'add', values: ['urgent'] },
                { type: 'organize', taskIds: ['i-read'], draft: { projectChoice: 'p-home', dueDate: '2026-10-20' } },
                { type: 'trashTasks', taskIds: ['i-party'] },
                { type: 'restoreTasks', taskIds: ['i-party'] },
            ];
            for (const action of actions) {
                expect(value(await host.runBulkAction({ requestId: requestId(), list: 'inbox', action }))).toMatchObject({ changed: true });
            }
            log.length = 0;
            // The Undo's replay finds the task back; the delete's replay would trash it again, so it runs before its Undo.
            for (const action of actions.slice(0, 3)) {
                expect(value(await host.runBulkAction({ requestId: requestId(), list: 'inbox', action }))).toEqual({ changed: false, toast: null });
            }
            expect(value(await host.runBulkAction({ requestId: requestId(), list: 'inbox', action: actions[4] }))).toEqual({ changed: false, toast: null });
            expect(log).toEqual([]);
        });

        it('a Select all delete replayed after it landed (a new request after a restart) writes nothing', async () => {
            freezeClock();
            const { host, log } = await open();
            const view = value(host.getBulkActions({ list: 'inbox', selectAll: {} }));
            const action: NativeBulkAction = { type: 'trashTasks', selectAll: view.selectAll! };
            expect(value(await host.runBulkAction({ requestId: requestId(), list: 'inbox', action }))).toMatchObject({ changed: true });
            log.length = 0;
            // The trashed rows left the Inbox, so the stored revision no longer matches: core refuses before any write.
            expect(await host.runBulkAction({ requestId: requestId(), list: 'inbox', action })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(log).toEqual([]);
        });

        it('a delete replayed after it landed writes nothing', async () => {
            freezeClock();
            const { host, log } = await open();
            const action: NativeBulkAction = { type: 'trashTasks', taskIds: ['i-party', 'i-milk'] };
            value(await host.runBulkAction({ requestId: requestId(), list: 'inbox', action }));
            log.length = 0;
            expect(value(await host.runBulkAction({ requestId: requestId(), list: 'inbox', action }))).toEqual({ changed: false, toast: null });
            expect(log).toEqual([]);
        });
    });

    describe('creating a project or area from the organize pickers', () => {
        const picker = (host: Awaited<ReturnType<typeof open>>['host'], kind: 'project' | 'area' | 'removeTag', query?: string, extra: Record<string, unknown> = {}) => value(host.getBulkActions({
            list: 'inbox', taskIds: ['i-call'], organize: {}, picker: { kind, ...(query === undefined ? {} : { query }) }, ...extra,
        })).picker!;
        /** Projects and areas as stored, less what a new row draws at random (its ID and device stamp). */
        const destinationsNow = () => normalize({
            projects: useTaskStore.getState()._allProjects.map(({ id: _id, revBy: _revBy, ...project }) => project),
            areas: useTaskStore.getState()._allAreas.map(({ id: _id, revBy: _revBy, ...area }) => area),
        });

        it('offers Create for a name no option carries, and Done chooses an exact match, as the mobile pickers do', async () => {
            freezeClock();
            const { host } = await open();
            expect(picker(host, 'project', ' Garden ')).toMatchObject({
                create: { name: 'Garden', label: '+ Create "Garden"', accessibilityLabel: 'Create: Garden' },
                submit: { create: 'Garden' },
            });
            // A title match ignores case and spaces; an archived project is no option, so its title can be created.
            expect(picker(host, 'project', ' LAUNCH ')).toMatchObject({ create: null, submit: { edit: { type: 'setProject', value: 'p-launch' } } });
            expect(picker(host, 'project', 'Old stuff')).toMatchObject({ create: { name: 'Old stuff' }, submit: { create: 'Old stuff' } });
            expect(picker(host, 'area', 'home')).toMatchObject({ create: null, submit: { edit: { type: 'setArea', value: 'a-home' } } });
            expect(picker(host, 'area', 'Errands')).toMatchObject({
                create: { name: 'Errands', label: '+ Create "Errands"', accessibilityLabel: 'Create: Errands' },
                submit: { create: 'Errands' },
            });
            // Nothing to create without a search, while Apply runs, or on the remove-tag picker.
            expect(picker(host, 'project')).toMatchObject({ create: null, submit: null });
            expect(picker(host, 'project', '  ')).toMatchObject({ create: null, submit: null });
            expect(picker(host, 'project', 'Garden', { busy: true })).toMatchObject({ create: null, submit: null });
            expect(value(host.getBulkActions({ list: 'inbox', taskIds: ['i-milk'], picker: { kind: 'removeTag', query: 'x' } })).picker)
                .toMatchObject({ create: null, submit: null });
        });

        it.each([
            ['project', 'Garden', { areaChoice: 'a-home' }, () => createBulkOrganizeProject(' Garden ', 'a-home')],
            ['project', 'Garden', { projectChoice: 'p-launch' }, () => createBulkOrganizeProject(' Garden ')],
            ['area', 'Errands', { projectChoice: BULK_ORGANIZE_NONE }, () => createBulkOrganizeArea(' Errands ')],
        ] as const)('creates the %s %s as core\'s createBulkOrganize* does for mobile, and chooses it', async (kind, name, draft, core) => {
            freezeClock();
            const direct = await open();
            const created = await core();
            const expected = destinationsNow();
            expect(direct.log).toEqual([]);

            const contract = await open();
            const tasks = tasksNow();
            const result = value(await contract.host.createBulkOrganizeDestination({ requestId: requestId(), list: 'inbox', kind, name: ` ${name} `, draft }));
            expect(destinationsNow()).toEqual(expected);
            expect(result.changed).toBe(true);
            expect(result.id).toBe((kind === 'project' ? useTaskStore.getState().projects : useTaskStore.getState().areas).find((entry) => (
                'title' in entry ? entry.title : entry.name) === name)!.id);
            expect(created).not.toBeNull();
            // The draft chooses it, as mobile's picker does after a create; a project resets the area to Keep.
            expect(result.draft).toEqual(kind === 'project'
                ? { ...EMPTY_BULK_ORGANIZE_DRAFT, ...draft, projectChoice: result.id, areaChoice: BULK_ORGANIZE_KEEP }
                : { ...EMPTY_BULK_ORGANIZE_DRAFT, ...draft, areaChoice: result.id });
            // Creating writes no task.
            expect(contract.log).toEqual([]);
            expect(tasksNow()).toEqual(tasks);
        });

        it('an exact match, or a replay after it landed, chooses the existing one and writes nothing', async () => {
            freezeClock();
            const saveData = vi.fn().mockResolvedValue(undefined);
            const { host } = await open(saveData);
            expect(value(await host.createBulkOrganizeDestination({ requestId: requestId(), list: 'inbox', kind: 'project', name: 'launch' })))
                .toEqual({ id: 'p-launch', changed: false, draft: { ...EMPTY_BULK_ORGANIZE_DRAFT, projectChoice: 'p-launch' } });
            const first = value(await host.createBulkOrganizeDestination({ requestId: requestId(), list: 'inbox', kind: 'area', name: 'Errands' }));
            expect(first.changed).toBe(true);
            const stored = destinationsNow();
            saveData.mockClear();
            expect(value(await host.createBulkOrganizeDestination({ requestId: requestId(), list: 'inbox', kind: 'area', name: ' errands ' })))
                .toEqual({ ...first, changed: false });
            expect(destinationsNow()).toEqual(stored);
            expect(saveData).not.toHaveBeenCalled();
        });

        it.each([
            // The draft's area leaves the dialog before the retry.
            ['project', 'Garden', { areaChoice: 'a-work' }, () => useTaskStore.getState().deleteArea('a-work')],
            // The draft's project leaves the dialog before the retry.
            ['area', 'Errands', { projectChoice: 'p-home' }, () => useTaskStore.getState().updateProject('p-home', { status: 'archived' })],
        ] as const)('retries a new %s exactly after a failed save, even when its draft\'s choice left the dialog since', async (kind, name, draft, change) => {
            freezeClock();
            const saveData = vi.fn().mockResolvedValue(undefined);
            const { host } = await open(saveData);
            const input = { requestId: requestId(), list: 'inbox' as const, kind, name, draft };
            saveData.mockRejectedValue(new Error('disk unavailable'));
            expect(await host.createBulkOrganizeDestination(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
            const entries = () => (kind === 'project' ? useTaskStore.getState()._allProjects : useTaskStore.getState()._allAreas)
                .filter((entry) => ('title' in entry ? entry.title : entry.name) === name);
            expect(entries()).toHaveLength(1);
            await change();
            const landed = destinationsNow();
            saveData.mockResolvedValue(undefined);
            const retried = value(await host.createBulkOrganizeDestination(input));
            expect(retried).toEqual({
                id: entries()[0].id,
                changed: true,
                draft: kind === 'project'
                    ? { ...EMPTY_BULK_ORGANIZE_DRAFT, projectChoice: entries()[0].id, areaChoice: BULK_ORGANIZE_KEEP }
                    : { ...EMPTY_BULK_ORGANIZE_DRAFT, ...draft, areaChoice: entries()[0].id },
            });
            // The retry only saved: nothing new in memory, and storage holds the new row.
            expect(destinationsNow()).toEqual(landed);
            const saved = saveData.mock.lastCall?.[0] as { projects: { id: string }[]; areas: { id: string }[] };
            expect((kind === 'project' ? saved.projects : saved.areas).filter((entry) => entry.id === retried.id)).toHaveLength(1);
            expect(useTaskStore.getState().persistenceFailure).toBeNull();
            // A lost reply repeats the request: no write, no save.
            const saves = saveData.mock.calls.length;
            expect(await host.createBulkOrganizeDestination(input)).toEqual({ ok: true, value: retried });
            expect(saveData).toHaveBeenCalledTimes(saves);
            expect(await host.createBulkOrganizeDestination({ ...input, name: 'Orchard' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }, 20_000);

        it('a replay after a restart resolves the row it made, even renamed, archived or deleted, and adds nothing', async () => {
            freezeClock();
            const { host } = await open();
            const area = { requestId: requestId(), list: 'inbox' as const, kind: 'area' as const, name: 'Errands' };
            const deleted = { requestId: requestId(), list: 'inbox' as const, kind: 'project' as const, name: 'Garden', draft: { areaChoice: 'a-home' } };
            const archived = { requestId: requestId(), list: 'inbox' as const, kind: 'project' as const, name: 'Orchard' };
            const first = await Promise.all([area, deleted, archived].map(async (input) => value(await host.createBulkOrganizeDestination(input))));
            expect(first.every((result) => result.changed)).toBe(true);
            // The row takes the request UUID as its ID.
            expect(first.map((result) => result.id)).toEqual([area.requestId, deleted.requestId, archived.requestId]);
            await useTaskStore.getState().updateArea(first[0].id, { name: 'Chores' });
            await useTaskStore.getState().deleteProject(first[1].id);
            await useTaskStore.getState().updateProject(first[2].id, { status: 'archived' });
            await flushPendingSave();
            const stored = destinationsNow();
            // A new host has no receipts: the replays find the rows by their request UUIDs.
            const restarted = await openBulkActionsHost();
            expect(value(await restarted.createBulkOrganizeDestination(area)))
                .toEqual({ id: first[0].id, changed: false, draft: { ...EMPTY_BULK_ORGANIZE_DRAFT, areaChoice: first[0].id } });
            // A project that is no option any more is not chosen: the draft stays as sent.
            expect(value(await restarted.createBulkOrganizeDestination(deleted)))
                .toEqual({ id: first[1].id, changed: false, draft: { ...EMPTY_BULK_ORGANIZE_DRAFT, areaChoice: 'a-home' } });
            expect(value(await restarted.createBulkOrganizeDestination(archived)))
                .toEqual({ id: first[2].id, changed: false, draft: EMPTY_BULK_ORGANIZE_DRAFT });
            expect(destinationsNow()).toEqual(stored);
            expect(useTaskStore.getState()._allAreas.filter((entry) => entry.name === 'Errands')).toEqual([]);
            expect(useTaskStore.getState()._projectsById.get(first[1].id)?.deletedAt).toBeTruthy();
        }, 20_000);

        it('refuses invalid input without writing', async () => {
            freezeClock();
            const { host } = await open();
            const stored = destinationsNow();
            const refused = async (input: Record<string, unknown>) => expect(await host.createBulkOrganizeDestination({
                requestId: requestId(), list: 'inbox', kind: 'project', name: 'Garden', ...input,
            } as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            await refused({ list: 'waiting' });
            await refused({ list: 'project' });
            await refused({ kind: 'tag' });
            await refused({ name: '   ' });
            await refused({ name: 7 });
            await refused({ name: 'x'.repeat(501) });
            await refused({ draft: { areaChoice: 'a-gone' } });
            await refused({ draft: { color: 'red' } });
            await refused({ requestId: 'not-a-uuid' });
            expect(destinationsNow()).toEqual(stored);
        });
    });

    it('is NOT_READY before native storage is activated', async () => {
        const log: unknown[] = [];
        await seedBulkActionsStore(fixture, log);
        const host = createNativeHostContract();
        expect(host.getBulkActions({ list: 'inbox' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.runBulkAction({ requestId: requestId(), list: 'inbox', action: { type: 'trashTasks', taskIds: ['i-call'] } }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.createBulkOrganizeDestination({ requestId: requestId(), list: 'inbox', kind: 'area', name: 'Errands' }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(log).toEqual([]);
        expect(useTaskStore.getState().areas.some((area) => area.name === 'Errands')).toBe(false);
    });

    it('refuses invalid input without writing', async () => {
        freezeClock();
        const { host, log } = await open();
        const refused = async (list: string, action: unknown) => expect(await host.runBulkAction({ requestId: requestId(), list: list as 'inbox', action: action as NativeBulkAction }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        await refused('trash', { type: 'trashTasks', taskIds: ['i-call'] });
        await refused('inbox', { type: 'moveTasks', taskIds: ['i-call'], status: 'inbox' });
        await refused('waiting', { type: 'moveTasks', taskIds: ['w-bob'], status: 'archived' });
        await refused('waiting', { type: 'organize', taskIds: ['w-bob'], draft: { status: 'next' } });
        await refused('waiting', { type: 'editTaskTokens', taskIds: ['w-bob'], field: 'tags', mode: 'remove', values: ['#x'] });
        await refused('inbox', { type: 'editTaskTokens', taskIds: ['i-call'], field: 'contexts', mode: 'add', values: ['@x'] });
        await refused('inbox', { type: 'editTaskTokens', taskIds: ['i-call'], field: 'tags', mode: 'add', values: ['  '] });
        await refused('inbox', { type: 'moveTasks', status: 'next', taskIds: ['i-call'], selectAll: { params: {}, revision: 'x' } });
        await refused('inbox', { type: 'moveTasks', status: 'next', taskIds: ['missing'] });
        await refused('inbox', { type: 'moveTasks', status: 'next', taskIds: ['i-deleted'] });
        await refused('reference', { type: 'moveTasks', status: 'next', taskIds: ['r-old'] });
        await refused('inbox', { type: 'organize', taskIds: ['i-call'], draft: { status: 'waiting' } });
        await refused('inbox', { type: 'organize', taskIds: ['i-call'], draft: { dueDate: '10/20/2026' } });
        await refused('inbox', { type: 'organize', taskIds: ['i-call'], draft: { startDate: '2026-02-30' } });
        await refused('inbox', { type: 'organize', taskIds: ['i-call'], draft: { startDate: '2026-09-27T09:00' } });
        await refused('inbox', { type: 'organize', taskIds: ['i-call'], draft: { projectChoice: 'p-old' } });
        await refused('inbox', { type: 'organize', taskIds: ['i-call'], draft: { areaChoice: 'a-gone' } });
        await refused('inbox', { type: 'organize', taskIds: ['i-call'], draft: { color: 'red' } });
        await refused('inbox', { type: 'moveTasks', status: 'next', selectAll: { params: { filterEdit: { type: 'clear' } }, revision: 'x' } });
        await refused('inbox', { type: 'restoreTasks', taskIds: ['missing'] });
        expect(await host.runBulkAction({ requestId: 'not-a-uuid', list: 'inbox', action: { type: 'trashTasks', taskIds: ['i-call'] } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const view = (input: unknown) => expect(host.getBulkActions(input as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        view({ list: 'project' });
        view({ list: 'inbox', taskIds: ['i-call'], selectAll: {} });
        view({ list: 'waiting', organize: {} });
        view({ list: 'waiting', picker: { kind: 'removeTag' } });
        view({ list: 'inbox', params: { offset: 3 } });
        view({ list: 'inbox', organize: { draft: {}, edit: { type: 'setText', field: 'dueDate', value: 'tomorrow' } } });
        view({ list: 'inbox', organize: { edit: { type: 'rename' } } });
        view({ list: 'inbox', selectAll: {}, selectionEdit: { taskId: 'i-call' } });
        expect(host.getBulkActions({ list: 'inbox', picker: { kind: 'project', offset: 1 } } as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(log).toEqual([]);
    });
});
