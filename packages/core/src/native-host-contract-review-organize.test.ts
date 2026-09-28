import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildBulkOrganizeTaskUpdates } from './bulk-organize';
import { collectBulkTaskTokens } from './bulk-task-tokens';
import { loadTranslations } from './i18n/i18n-loader';
import { formatListItemCount } from './list-count';
import { createNativeHostContract } from './native-host-contract';
import { matchesPickerQuery } from './native-host-contract-menu-views';
import type { NativeReviewAction, NativeReviewOverview } from './native-host-contract-review-views';
import { compareProjectsByPickerOrder } from './project-utils';
import { getAdvancedReviewDate } from './review-utils';
import { createReviewRecorder, loadReviewViewsFixture, seedReviewStore, type ReviewFixturePart, type ReviewScenario } from './review-views-model.replay';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { noopStorage } from './storage';
import {
    BULK_ORGANIZE_KEEP,
    BULK_ORGANIZE_NONE,
    buildBulkOrganizeDialogModel,
    buildBulkOrganizeInput,
    EMPTY_BULK_ORGANIZE_DRAFT,
    getBulkOrganizeAreaOptions,
    getBulkOrganizeProjectOptions,
    type BulkOrganizeDraft,
} from './task-list-bulk-actions';
import type { Task } from './types';
import { generateUUID } from './uuid';

const part = loadReviewViewsFixture().weeklyReview;
const scenario: ReviewScenario = { name: 'contract', settings: 'base', actions: [] };
const page = { offset: 0, limit: 100 };
// Due for review: w-alice (a day), n-launch (a time, kept by Review in 1 week) and s-piano; w-parcel is not due yet.
const DATA: ReviewFixturePart = {
    ...part,
    tasks: part.tasks.map((task) => (task.id === 'n-launch' ? { ...task, reviewAt: '2026-09-21T09:30' } : task)),
};
const ORGANIZE: Partial<BulkOrganizeDraft> = { status: 'waiting', delegateWho: 'Alice', projectChoice: 'p-garden', tags: 'q4', dueDate: '2026-10-02' };

describe('native host contract: Review rows and Review\'s Organize sheet', () => {
    const originalTz = process.env.TZ;
    let t: (key: string) => string = (key) => key;
    beforeAll(async () => {
        process.env.TZ = part.timeZone;
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

    // Revisions and review dates read the clock.
    const freezeClock = (at = part.now) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(at));
    };
    const startHost = async () => {
        const host = createNativeHostContract();
        expect(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' })).toMatchObject({ ok: true });
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        return host;
    };
    const openHost = async (saveData?: (data: unknown) => Promise<void>, data = DATA) => {
        const recorder = createReviewRecorder();
        await seedReviewStore(data, scenario, recorder, { saveData });
        const host = await startHost();
        recorder.log.length = 0;
        return { host, recorder };
    };
    const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        return result.value;
    };
    const run = (host: Awaited<ReturnType<typeof startHost>>, action: NativeReviewAction, requestId = generateUUID()) => (
        host.runReviewAction({ requestId, action })
    );
    /** The overview with every area and project open. */
    const everything = (host: Awaited<ReturnType<typeof startHost>>, extra: Record<string, unknown> = {}): NativeReviewOverview => {
        const areas = value(host.getReviewOverview({ expansionEdit: { type: 'cycle' }, ...page }));
        return value(host.getReviewOverview({ expandedAreaIds: areas.expandedAreaIds, expansionEdit: { type: 'cycle' }, ...extra, ...page }));
    };
    const taskItems = (view: NativeReviewOverview) => view.items.flatMap((item) => (item.type === 'task' ? [item] : []));
    const task = (id: string) => useTaskStore.getState()._tasksById.get(id)!;
    /** Every task as stored, less the device stamp. */
    const tasksNow = () => JSON.parse(JSON.stringify(useTaskStore.getState()._allTasks.map(({ revBy: _revBy, ...entry }) => entry)));
    const markAction = (id: string, advance: boolean) => ({ type: 'markTaskReviewed' as const, taskId: id, advance, reviewAt: task(id).reviewAt ?? null });

    describe('a row\'s Mark reviewed and Review in 1 week', () => {
        it('are offered under every row due for review, in either scope, carrying the review date the row shows', async () => {
            freezeClock();
            const { host } = await openHost();
            const due = everything(host, { scope: 'due' });
            expect(taskItems(due).map((item) => item.row.id).sort()).toEqual(['n-launch', 's-piano', 'w-alice']);
            const alice = taskItems(due).find((item) => item.row.id === 'w-alice')!;
            expect(alice.review).toEqual({
                markReviewed: {
                    label: t('review.markReviewed'), accessibilityLabel: `${t('review.markReviewed')}: ${task('w-alice').title}`,
                    action: { type: 'markTaskReviewed', taskId: 'w-alice', advance: false, reviewAt: '2026-09-22' },
                },
                advance: {
                    label: t('review.advanceWeek'), accessibilityLabel: `${t('review.advanceWeek')}: ${task('w-alice').title}`,
                    action: { type: 'markTaskReviewed', taskId: 'w-alice', advance: true, reviewAt: '2026-09-22' },
                },
            });
            // Mobile shows them for due rows in the All scope too, and for no other row.
            const all = taskItems(everything(host, { scope: 'all' }));
            expect(all.filter((item) => item.review).map((item) => item.row.id).sort()).toEqual(['n-launch', 's-piano', 'w-alice']);
            expect(all.find((item) => item.row.id === 'w-parcel')?.review).toBeNull();
        });

        it.each([
            ['Review in 1 week keeps a day as a day', 'w-alice', true],
            ['Review in 1 week keeps the time of day', 'n-launch', true],
            ['Mark reviewed clears the review date', 's-piano', false],
        ] as const)('%s, as mobile writes it with core\'s getAdvancedReviewDate', async (_name, id, advance) => {
            freezeClock();
            const direct = await openHost();
            const before = task(id);
            // Mobile's markReviewed(task, advance).
            await useTaskStore.getState().updateTask(id, { reviewAt: advance ? getAdvancedReviewDate(before.reviewAt) : undefined });
            const expected = { tasks: tasksNow(), log: [...direct.recorder.log] };
            await flushPendingSave();

            const contract = await openHost();
            const action = taskItems(everything(contract.host))
                .find((item) => item.row.id === id)!.review![advance ? 'advance' : 'markReviewed'].action;
            expect(value(await run(contract.host, action))).toEqual({
                changed: true, toast: { tone: 'success', title: null, message: t('review.markReviewedDone'), undo: null }, createdId: null,
            });
            expect({ tasks: tasksNow(), log: contract.recorder.log }).toEqual(expected);
            if (advance) expect(task(id).reviewAt).toBe(id === 'n-launch' ? '2026-09-30T09:30' : '2026-09-30');
        });

        it('retries exactly after a failed save: one write, and the retry only saves', async () => {
            freezeClock();
            const saveData = vi.fn().mockResolvedValue(undefined);
            const { host, recorder } = await openHost(saveData);
            const input = { requestId: generateUUID(), action: markAction('w-alice', true) };
            saveData.mockRejectedValue(new Error('disk unavailable'));
            expect(await host.runReviewAction(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
            expect(recorder.log).toEqual([['updateTask', 'w-alice', { reviewAt: '2026-09-30' }]]);
            saveData.mockResolvedValue(undefined);
            const retried = value(await host.runReviewAction(input));
            expect(retried).toMatchObject({ changed: true, toast: { message: t('review.markReviewedDone') } });
            expect(recorder.log).toHaveLength(1);
            const saved = saveData.mock.lastCall?.[0] as { tasks: Task[] };
            expect(saved.tasks.find((entry) => entry.id === 'w-alice')?.reviewAt).toBe('2026-09-30');
            // A lost reply repeats the request: no write, no save.
            const saves = saveData.mock.calls.length;
            expect(value(await host.runReviewAction(input))).toEqual(retried);
            expect(saveData).toHaveBeenCalledTimes(saves);
            expect(await host.runReviewAction({ ...input, action: { ...input.action, advance: false } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        });

        it('a replay after a restart writes nothing: the task is no longer due, or its review date moved on since', async () => {
            freezeClock();
            const { host, recorder } = await openHost();
            const advance = { requestId: generateUUID(), action: markAction('w-alice', true) };
            const clear = { requestId: generateUUID(), action: markAction('s-piano', false) };
            expect(value(await host.runReviewAction(advance)).changed).toBe(true);
            expect(value(await host.runReviewAction(clear)).changed).toBe(true);
            const writes = recorder.log.length;
            const stored = tasksNow();
            // A new host has no receipts, as after a restart.
            let restarted = await startHost();
            expect(value(await restarted.runReviewAction(advance))).toEqual({ changed: false, toast: null, createdId: null });
            expect(value(await restarted.runReviewAction(clear))).toEqual({ changed: false, toast: null, createdId: null });
            expect(recorder.log).toHaveLength(writes);
            expect(tasksNow()).toEqual(stored);

            // Eight days on, w-alice is due again and s-piano got a new past review date:
            // a replay finds a review date it never showed and does not move it again.
            await useTaskStore.getState().updateTask('s-piano', { reviewAt: '2026-09-28' });
            await flushPendingSave();
            freezeClock('2026-10-01T14:00:00.000Z');
            // Activating a week on archives old done tasks; the replays below write nothing more.
            restarted = await startHost();
            await flushPendingSave();
            const later = tasksNow();
            const writesLater = recorder.log.length;
            expect(await restarted.runReviewAction(advance)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(await restarted.runReviewAction(clear)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(recorder.log).toHaveLength(writesLater);
            expect(tasksNow()).toEqual(later);
        });

        it('refuses a review date changed since the row showed it, and writes nothing for a task not due', async () => {
            freezeClock();
            const { host, recorder } = await openHost();
            const action = markAction('w-alice', true);
            await useTaskStore.getState().updateTask('w-alice', { reviewAt: '2026-09-21' });
            recorder.log.length = 0;
            expect(await run(host, action)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            // Not due: mobile shows no link and writes nothing.
            expect(value(await run(host, markAction('w-parcel', true)))).toEqual({ changed: false, toast: null, createdId: null });
            expect(recorder.log).toEqual([]);
            expect(task('w-alice').reviewAt).toBe('2026-09-21');
        });
    });

    describe('the Organize sheet', () => {
        const REVIEW_SELECTION = ['n-bike', 'n-cv'];
        const INBOX_SELECTION = ['i-thought', 'i-dentist'];

        it('is the lists\' Bulk organize dialog: the same draft, edits and pickers as getBulkActions', async () => {
            freezeClock();
            const { host } = await openHost();
            const organize = { draft: ORGANIZE, edit: { type: 'setArea' as const, value: 'a-home' } };
            const review = everything(host, { selectedIds: REVIEW_SELECTION, organize, picker: { kind: 'project', query: ' GAR' } });
            const inbox = value(host.getBulkActions({ list: 'inbox', taskIds: INBOX_SELECTION, organize, picker: { kind: 'project', query: ' GAR' } }));
            expect(review.bulk?.selectedIds).toEqual(REVIEW_SELECTION);
            expect(review.bulk?.organize).toEqual(inbox.organize);
            expect(review.bulk?.picker).toEqual(inbox.picker);

            // Core's dialog model, called as mobile's TaskListBulkOrganizeModal calls it.
            const state = useTaskStore.getState();
            const draft = { ...EMPTY_BULK_ORGANIZE_DRAFT, ...ORGANIZE, areaChoice: 'a-home' };
            const dialog = buildBulkOrganizeDialogModel({
                draft, projects: getBulkOrganizeProjectOptions(state.projects), areas: getBulkOrganizeAreaOptions(state.areas), selectedCount: 2, t,
            });
            expect(review.bulk?.organize).toMatchObject({ draft, title: dialog.title, subtitle: dialog.subtitle, canApply: true, project: dialog.project, area: dialog.area });

            // The project picker: Keep, None, then the options matching the search (the Inbox tokens' rule), in mobile's picker order.
            const projects = [...getBulkOrganizeProjectOptions(state.projects)].sort(compareProjectsByPickerOrder);
            const all = everything(host, { selectedIds: REVIEW_SELECTION, organize: { draft }, picker: { kind: 'project' } }).bulk!.picker!;
            expect(all.items.map((item) => item.value)).toEqual([BULK_ORGANIZE_KEEP, BULK_ORGANIZE_NONE, ...projects.map((project) => project.id)]);
            expect(review.bulk?.picker?.items.slice(2).map((item) => item.label))
                .toEqual(projects.filter((project) => matchesPickerQuery(project.title, ' GAR')).map((project) => project.title));
            expect(review.bulk?.picker?.items.find((item) => item.value === 'p-garden')).toMatchObject({ selected: true, edit: { type: 'setProject', value: 'p-garden' } });
            // The area picker offers Create for a new name, as mobile's does; none while Apply runs.
            const area = (query: string, busy = false) => everything(host, { selectedIds: REVIEW_SELECTION, busy, picker: { kind: 'area', query } }).bulk!.picker!;
            expect(area('errands')).toMatchObject({ create: { name: 'errands' }, submit: { create: 'errands' } });
            expect(area(' HOME ')).toMatchObject({ create: null, submit: { edit: { type: 'setArea', value: 'a-home' } } });
            expect(area('errands', true)).toMatchObject({ create: null, submit: null });
            // Remove tag's picker searches the selection's tags the same way.
            const tags = collectBulkTaskTokens(['n-cv', 'n-orphan'], Object.fromEntries(state.tasks.map((entry) => [entry.id, entry])), 'tags');
            const removeTag = everything(host, { selectedIds: ['n-cv', 'n-orphan'], picker: { kind: 'removeTag', query: ' CAR' } }).bulk!.picker!;
            expect(removeTag.items.map((item) => item.value)).toEqual(tags.filter((tag) => matchesPickerQuery(tag, ' CAR')));
            expect(removeTag.items.map((item) => item.value)).toEqual(['#career']);
            // Without `organize` or `picker`, the bar has neither.
            expect(everything(host, { selectedIds: REVIEW_SELECTION }).bulk).toMatchObject({ organize: null, picker: null });
        });

        it('applies a draft as mobile\'s Review does: core\'s organize input, one batch write', async () => {
            freezeClock();
            const direct = await openHost();
            const state = useTaskStore.getState();
            const updates = buildBulkOrganizeTaskUpdates(REVIEW_SELECTION, Object.fromEntries(state.tasks.map((entry) => [entry.id, entry])),
                buildBulkOrganizeInput({ ...EMPTY_BULK_ORGANIZE_DRAFT, ...ORGANIZE }));
            await state.batchUpdateTasks(updates);
            const expected = { tasks: tasksNow(), log: [...direct.recorder.log] };
            await flushPendingSave();

            const contract = await openHost();
            const draft = everything(contract.host, { selectedIds: REVIEW_SELECTION, organize: { draft: ORGANIZE } }).bulk!.organize!.draft;
            expect(value(await run(contract.host, { type: 'organizeTasks', taskIds: REVIEW_SELECTION, draft }))).toEqual({
                changed: true, toast: { tone: 'success', title: t('common.done'), message: formatListItemCount(updates.length, 'task', t), undo: null }, createdId: null,
            });
            expect({ tasks: tasksNow(), log: contract.recorder.log }).toEqual(expected);
            // One task: mobile's singular count.
            expect(value(await run(contract.host, { type: 'organizeTasks', taskIds: ['n-rent'], draft: { tags: 'q4' } })).toast?.message)
                .toBe(formatListItemCount(1, 'task', t));
        });

        it('retries a failed Apply exactly, even when the draft\'s project left the dialog since', async () => {
            freezeClock();
            const saveData = vi.fn().mockResolvedValue(undefined);
            const { host, recorder } = await openHost(saveData);
            const input = { requestId: generateUUID(), action: { type: 'organizeTasks' as const, taskIds: REVIEW_SELECTION, draft: ORGANIZE } };
            saveData.mockRejectedValue(new Error('disk unavailable'));
            expect(await host.runReviewAction(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
            expect(recorder.log).toHaveLength(1);
            const landed = REVIEW_SELECTION.map((id) => [task(id).projectId, task(id).status, task(id).assignedTo]);
            await useTaskStore.getState().updateProject('p-garden', { status: 'archived' });
            saveData.mockResolvedValue(undefined);
            const retried = value(await host.runReviewAction(input));
            expect(retried).toMatchObject({ changed: true });
            expect(recorder.log).toHaveLength(1);
            expect(landed).toEqual([['p-garden', 'waiting', 'Alice'], ['p-garden', 'waiting', 'Alice']]);
            const saved = saveData.mock.lastCall?.[0] as { tasks: Task[] };
            expect(saved.tasks.filter((entry) => REVIEW_SELECTION.includes(entry.id)).map((entry) => entry.dueDate)).toEqual(['2026-10-02', '2026-10-02']);
            // A lost reply repeats the request: no write, no save.
            const saves = saveData.mock.calls.length;
            expect(value(await host.runReviewAction(input))).toEqual(retried);
            expect(saveData).toHaveBeenCalledTimes(saves);
            // A new request with that project is refused now: the dialog no longer offers it.
            expect(await run(host, { type: 'organizeTasks', taskIds: ['n-rent'], draft: ORGANIZE })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        });

        it('a replay of Apply, or of a create from its pickers, after a restart writes nothing', async () => {
            freezeClock();
            const { host, recorder } = await openHost();
            const apply = { requestId: generateUUID(), action: { type: 'organizeTasks' as const, taskIds: REVIEW_SELECTION, draft: ORGANIZE } };
            const create = { requestId: generateUUID(), list: 'review' as const, kind: 'area' as const, name: 'Errands' };
            expect(value(await host.runReviewAction(apply)).changed).toBe(true);
            const made = value(await host.createBulkOrganizeDestination(create));
            expect(made).toEqual({ id: create.requestId.toLowerCase(), changed: true, draft: { ...EMPTY_BULK_ORGANIZE_DRAFT, areaChoice: made.id } });
            // The new area is a choice of Review's dialog at once.
            expect(everything(host, { selectedIds: REVIEW_SELECTION, organize: { draft: made.draft } }).bulk?.organize?.area.value).toBe('Errands');
            await useTaskStore.getState().updateArea(made.id, { name: 'Chores' });
            await flushPendingSave();
            const writes = recorder.log.length;
            const stored = { tasks: tasksNow(), areas: JSON.stringify(useTaskStore.getState()._allAreas) };
            const restarted = await startHost();
            expect(value(await restarted.runReviewAction(apply))).toEqual({ changed: false, toast: null, createdId: null });
            expect(value(await restarted.createBulkOrganizeDestination(create))).toEqual({ ...made, changed: false });
            expect(recorder.log).toHaveLength(writes);
            expect({ tasks: tasksNow(), areas: JSON.stringify(useTaskStore.getState()._allAreas) }).toEqual(stored);
        });

        it('pages a picker under the overview\'s revision and refuses a stale page', async () => {
            freezeClock();
            const old = '2026-08-01T12:00:00.000Z';
            const many = Array.from({ length: 105 }, (_, index) => ({
                id: `p-many-${index}`, title: `Many ${String(index).padStart(3, '0')}`, status: 'active' as const, color: '#94a3b8', order: 20 + index,
                tagIds: [], createdAt: old, updatedAt: old,
            }));
            const { host } = await openHost(undefined, { ...DATA, projects: [...DATA.projects, ...many] });
            const first = everything(host, { selectedIds: REVIEW_SELECTION, picker: { kind: 'project', query: 'many' } });
            expect([first.bulk?.picker?.total, first.bulk?.picker?.items.length]).toEqual([107, 100]);
            const expanded = { expandedAreaIds: first.expandedAreaIds, expandedProjectIds: first.expandedProjectIds, selectedIds: REVIEW_SELECTION };
            const rest = value(host.getReviewOverview({ ...expanded, picker: { kind: 'project', query: 'many', offset: 100, revision: first.revision }, ...page }));
            expect(rest.bulk?.picker?.items.map((item) => item.label)).toEqual(many.slice(98).map((project) => project.title));
            expect(host.getReviewOverview({ ...expanded, picker: { kind: 'project', offset: 100 }, ...page })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            await useTaskStore.getState().updateTask('n-bike', { title: 'Fix the bike' });
            expect(host.getReviewOverview({ ...expanded, picker: { kind: 'project', query: 'many', offset: 100, revision: first.revision }, ...page }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        });
    });

    it('refuses invalid input without writing', async () => {
        freezeClock();
        const { host, recorder } = await openHost();
        const invalid = { ok: false, error: { code: 'INVALID_INPUT' } };
        const view = (extra: Record<string, unknown>) => host.getReviewOverview({ selectedIds: ['n-bike'], ...extra, ...page } as never);
        expect(view({ organize: { draft: { color: 'red' } } })).toMatchObject(invalid);
        expect(view({ organize: { draft: { projectChoice: 'p-archived' } } })).toMatchObject(invalid);
        expect(view({ organize: { edit: { type: 'rename' } } })).toMatchObject(invalid);
        expect(view({ organize: 'open' })).toMatchObject(invalid);
        expect(view({ picker: { kind: 'tag' } })).toMatchObject(invalid);
        expect(view({ picker: { kind: 'project', query: 7 } })).toMatchObject(invalid);
        expect(view({ picker: { kind: 'project', limit: 101 } })).toMatchObject(invalid);
        expect(view({ busy: 'yes' })).toMatchObject(invalid);
        const refused = async (action: unknown) => expect(await run(host, action as NativeReviewAction)).toMatchObject(invalid);
        await refused({ type: 'markTaskReviewed', taskId: 'w-alice', advance: 'yes', reviewAt: '2026-09-22' });
        await refused({ type: 'markTaskReviewed', taskId: 'w-alice', advance: true, reviewAt: 20260922 });
        await refused({ type: 'markTaskReviewed', taskId: 'w-alice', advance: true });
        await refused({ type: 'organizeTasks', taskIds: ['n-bike'], draft: {}, input: {} });
        await refused({ type: 'organizeTasks', taskIds: ['n-bike'], draft: { status: 'waiting' } });
        await refused({ type: 'organizeTasks', taskIds: ['n-bike'], draft: { areaChoice: 'a-nowhere' } });
        await refused({ type: 'organizeTasks', taskIds: ['n-bike'], draft: { dueDate: 'soon' } });
        await refused({ type: 'organizeTasks', taskIds: ['missing'], draft: { tags: 'q4' } });
        expect(await run(host, { type: 'markTaskReviewed', taskId: 'missing', advance: true, reviewAt: null })).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
        expect(await host.createBulkOrganizeDestination({ requestId: generateUUID(), list: 'calendar' as never, kind: 'area', name: 'Errands' })).toMatchObject(invalid);
        expect(recorder.log).toEqual([]);
    });

    it('is NOT_READY until storage is activated', async () => {
        setStorageAdapter(noopStorage);
        const host = createNativeHostContract();
        const notReady = { ok: false, error: { code: 'NOT_READY' } };
        expect(host.getReviewOverview({ selectedIds: ['n-bike'], organize: {}, picker: { kind: 'project' }, ...page })).toMatchObject(notReady);
        expect(await host.runReviewAction({ requestId: generateUUID(), action: { type: 'markTaskReviewed', taskId: 'w-alice', advance: true, reviewAt: null } }))
            .toMatchObject(notReady);
        expect(await host.runReviewAction({ requestId: generateUUID(), action: { type: 'organizeTasks', taskIds: ['n-bike'], draft: {} } })).toMatchObject(notReady);
        expect(await host.createBulkOrganizeDestination({ requestId: generateUUID(), list: 'review', kind: 'area', name: 'Errands' })).toMatchObject(notReady);
    });
});
