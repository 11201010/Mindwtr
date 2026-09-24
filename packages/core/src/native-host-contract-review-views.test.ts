import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDateFormatter } from './date';
import { loadTranslations } from './i18n/i18n-loader';
import { createNativeHostContract, sortAreasForDisplay } from './native-host-contract';
import { resolveAreaFilterSelection } from './area-filter';
import {
    buildReviewSteps,
    getDailyReviewBuckets,
    getReviewOverviewGroups,
    getWeeklyReviewBuckets,
} from './review-utils';
import {
    decorateReviewOverviewGroups,
    getDailyReviewSettings,
    getReviewDay,
    getReviewOverviewSortBy,
    getReviewOverviewText,
    getWeeklyReviewLabels,
    titleWeeklyReviewSteps,
} from './review-views-model';
import { createReviewRecorder, loadReviewViewsFixture, seedReviewStore, type ReviewScenario } from './review-views-model.replay';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { noopStorage } from './storage';
import { generateUUID } from './uuid';

const fixture = loadReviewViewsFixture();
const part = fixture.weeklyReview;
const scenario = (settings = 'base', extra: Partial<ReviewScenario> = {}): ReviewScenario => ({ name: 'contract', settings, actions: [], ...extra });
const page = { offset: 0, limit: 100 };
const ready = { status: 'ready' as const, events: part.calendarEvents };

describe('native host contract: Review, Weekly Review and Daily Review', () => {
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

    // Revisions read the clock.
    const freezeClock = () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(part.now));
    };
    const openHost = async (entry = scenario(), saveData?: (data: unknown) => Promise<void>) => {
        const recorder = createReviewRecorder();
        await seedReviewStore(part, entry, recorder, { saveData });
        const host = createNativeHostContract();
        expect(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' })).toMatchObject({ ok: true });
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        recorder.log.length = 0;
        return { host, recorder };
    };
    const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        return result.value;
    };

    it('returns what core\'s review models return when called directly', async () => {
        freezeClock();
        const { host } = await openHost();
        const state = useTaskStore.getState();
        const now = new Date();

        const areas = sortAreasForDisplay(state.areas);
        const groups = decorateReviewOverviewGroups(getReviewOverviewGroups({
            tasks: state.tasks, projects: state.projects, orderedAreas: areas,
            areaFilter: resolveAreaFilterSelection(state.settings.filters, areas), sortBy: getReviewOverviewSortBy(state.settings),
        }), { areaById: new Map(areas.map((area) => [area.id, area])), unassignedAreaColor: state.settings.appearance?.unassignedAreaColor, text: getReviewOverviewText(t) });
        const overview = value(host.getReviewOverview({ expansionEdit: { type: 'cycle' }, ...page }));
        const everything = value(host.getReviewOverview({
            expandedAreaIds: overview.expandedAreaIds, expandedProjectIds: [], expansionEdit: { type: 'cycle' }, ...page,
        }));
        expect(everything.items.map((item) => (item.type === 'task' ? item.row.id : item.id)))
            .toEqual(groups.flatMap((group) => [group.id, ...group.projectGroups.flatMap((entry) => [entry.id, ...entry.tasks.map((task) => task.id)])]));
        // Rows carry core meta.
        const row = everything.items.find((item) => item.type === 'task');
        expect(row?.type === 'task' && row.row.meta).toBeTruthy();

        const labels = getWeeklyReviewLabels(t);
        const buckets = getWeeklyReviewBuckets(state.tasks, state.projects, { now });
        const steps = titleWeeklyReviewSteps(buildReviewSteps(buckets, { kind: 'weekly', externalCalendarDayCount: 0 }), labels);
        const weekly = value(host.getWeeklyReview({ ...page }));
        expect(weekly.rail.map((step) => [step.id, step.title])).toEqual(steps.map((step) => [step.id, step.title]));
        expect(weekly.items.map((item) => item.type === 'task' && item.row.id)).toEqual(buckets.inbox.map((task) => task.id));
        const someday = value(host.getWeeklyReview({ checkpoint: JSON.stringify({ step: 'someday', startedAt: part.now }), ...page }));
        expect(someday.items.map((item) => item.type === 'task' && [item.row.id, item.scheduled])).toEqual([
            ...[...buckets.somedayGroups.due, ...buckets.somedayGroups.unscheduled].map((task) => [task.id, false]),
            ...buckets.somedayGroups.scheduled.map((task) => [task.id, true]),
        ]);

        const daily = value(host.getDailyReview({ checkpoint: JSON.stringify({ step: 'focus', startedAt: part.now }), ...page }));
        const dailyBuckets = getDailyReviewBuckets(state.tasks, state.projects, {
            now: getReviewDay(now), sortBy: getDailyReviewSettings(state.settings).sortBy, sections: state.sections,
        });
        expect(daily.step.id).toBe('focus');
        expect(daily.items.map((item) => [item.row.id, item.showFocusToggle])).toEqual(dailyBuckets.focusCandidates.map((task) => [task.id, true]));
    });

    it('moves through the Weekly Review by checkpoints and resumes where it stopped', async () => {
        freezeClock();
        const { host } = await openHost();
        const first = value(host.getWeeklyReview({ checkpoint: null, calendar: ready, ...page }));
        expect(first).toMatchObject({ resumed: false, step: { id: 'inbox', indicator: '1/8' }, back: { checkpoint: null }, finish: null });
        const second = value(host.getWeeklyReview({ checkpoint: first.next!.checkpoint, calendar: ready, ...page }));
        expect(second).toMatchObject({ resumed: true, step: { id: 'stale' }, back: { checkpoint: first.checkpoint } });
        // A paused review resumes from what the host stored.
        const resumed = value(host.getWeeklyReview({ checkpoint: second.checkpoint, calendar: ready, ...page }));
        expect(resumed.step.id).toBe('stale');
        const last = value(host.getWeeklyReview({ checkpoint: JSON.stringify({ step: 'completed', startedAt: part.now }), ...page }));
        expect(last).toMatchObject({ next: null, finish: { lastReviewKey: 'lastWeeklyReview', lastReviewAt: part.now } });
        // A checkpoint from last week starts over.
        const stale = value(host.getWeeklyReview({ checkpoint: JSON.stringify({ step: 'projects', startedAt: '2026-09-18T13:00:00.000Z' }), ...page }));
        expect(stale).toMatchObject({ resumed: false, step: { id: 'inbox' } });
    });

    it('formats review dates with the user\'s language', async () => {
        freezeClock();
        const { host } = await openHost();
        expect(await host.setLanguage({ storedLanguage: 'fr', systemLocale: null })).toMatchObject({ ok: true });
        const view = value(host.getWeeklyReview({ checkpoint: JSON.stringify({ step: 'calendar', startedAt: part.now }), calendar: ready, ...page }));
        const formatDate = createDateFormatter({ language: 'fr', systemLocale: null });
        expect(view.content.step === 'calendar' && view.content.days[0].title).toBe(`${formatDate(new Date(2026, 8, 23), 'EEEE, PP')} · 2`);
        const daily = value(host.getDailyReview({ calendar: ready, ...page }));
        expect(daily.content.step === 'today' && daily.content.calendar.days[0].title).toBe(`${formatDate(new Date(2026, 8, 23), 'P')} · ${daily.content.calendar.label}`);
    });

    it('pages within one revision and refuses a stale page after an edit', async () => {
        freezeClock();
        const { host } = await openHost();
        const everything = { expandedAreaIds: ['area:none', 'area:a-work', 'area:a-home', 'area:a-side'] };
        const first = value(host.getReviewOverview({ ...everything, expansionEdit: { type: 'cycle' }, offset: 0, limit: 3 }));
        const expanded = { expandedAreaIds: first.expandedAreaIds, expandedProjectIds: first.expandedProjectIds };
        const again = value(host.getReviewOverview({ ...expanded, offset: 0, limit: 3 }));
        expect(again.revision).toBe(first.revision);
        expect(value(host.getReviewOverview({ ...expanded, offset: 3, limit: 3, revision: first.revision })).items).toHaveLength(3);
        expect(host.getReviewOverview({ ...expanded, offset: 3, limit: 3 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const weekly = value(host.getWeeklyReview({ offset: 0, limit: 1 }));
        const daily = value(host.getDailyReview({ offset: 0, limit: 1 }));

        await useTaskStore.getState().updateTask('i-thought', { title: 'Inbox idea' });
        expect(host.getReviewOverview({ ...expanded, offset: 3, limit: 3, revision: first.revision })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.getWeeklyReview({ offset: 1, limit: 1, revision: weekly.revision })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.getDailyReview({ offset: 1, limit: 1, revision: daily.revision })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(value(host.getReviewOverview({ ...expanded, offset: 0, limit: 3 })).revision).not.toBe(first.revision);
        // A setting the review reads changes the revision too.
        await useTaskStore.getState().updateSettings({ gtd: { weeklyReview: { includeContextStep: false } } });
        const noContexts = value(host.getWeeklyReview({ offset: 0, limit: 1 }));
        expect(noContexts.revision).not.toBe(weekly.revision);
        expect(noContexts.rail.map((step) => step.id)).not.toContain('contexts');
    });

    it('retries a failed bulk move exactly: one write, and the retry finishes the save', async () => {
        freezeClock();
        const saveData = vi.fn().mockResolvedValue(undefined);
        const { host, recorder } = await openHost(scenario(), saveData);
        const input = { requestId: generateUUID(), action: { type: 'moveTasks' as const, taskIds: ['n-launch', 'n-demo'], status: 'waiting' as const } };
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.runReviewAction(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
        const writes = recorder.log.length;
        expect(recorder.log[0]).toEqual(['batchMoveTasks', ['n-launch', 'n-demo'], 'waiting']);

        saveData.mockResolvedValue(undefined);
        const retried = value(await host.runReviewAction(input));
        expect(retried).toEqual({ changed: true, toast: { tone: 'success', title: 'Done', message: '2 tasks', undo: null }, createdId: null });
        expect(recorder.log).toHaveLength(writes);
        const saved = saveData.mock.lastCall?.[0] as { tasks: { id: string; status: string }[] };
        expect(saved.tasks.filter(({ id }) => id === 'n-launch' || id === 'n-demo').map((task) => task.status)).toEqual(['waiting', 'waiting']);
        // A lost reply repeats the request: no write, no save.
        const saves = saveData.mock.calls.length;
        expect(value(await host.runReviewAction(input))).toEqual(retried);
        expect(saveData).toHaveBeenCalledTimes(saves);
        expect(await host.runReviewAction({ ...input, action: { ...input.action, status: 'next' } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('retries a failed project Add task exactly: one task', async () => {
        freezeClock();
        const saveData = vi.fn().mockResolvedValue(undefined);
        const { host } = await openHost(scenario(), saveData);
        const input = { requestId: generateUUID(), action: { type: 'addProjectTask' as const, projectId: 'p-garden', title: 'Buy bulbs @garden' } };
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.runReviewAction(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        saveData.mockResolvedValue(undefined);
        const retried = value(await host.runReviewAction(input));
        expect(retried).toEqual({ changed: true, toast: null, createdId: input.requestId.toLowerCase() });
        const created = useTaskStore.getState()._allTasks.filter((task) => task.projectId === 'p-garden' && task.title === 'Buy bulbs');
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({ id: input.requestId.toLowerCase(), status: 'next', contexts: ['@garden'] });
    });

    it('follows up a waiting item as target state, and undoes a delete from its toast', async () => {
        freezeClock();
        const { host, recorder } = await openHost();
        const followUp = { requestId: generateUUID(), action: { type: 'followUpToday' as const, taskId: 'w-vendor' } };
        expect(value(await host.runReviewAction(followUp))).toMatchObject({ changed: true });
        expect(recorder.log).toEqual([['updateTask', 'w-vendor', { reviewAt: getReviewDay(new Date()).toISOString() }]]);
        // Already due for review: nothing to write, even for a new request.
        expect(value(await host.runReviewAction({ ...followUp, requestId: generateUUID() }))).toMatchObject({ changed: false });
        expect(recorder.log).toHaveLength(1);

        const trashed = value(await host.runReviewAction({ requestId: generateUUID(), action: { type: 'trashTasks', taskIds: ['i-thought', 'n-bike'] } }));
        expect(trashed.toast).toMatchObject({ message: '2 tasks', undo: { label: 'Restore to Inbox', action: { type: 'restoreTasks', taskIds: ['i-thought', 'n-bike'] } } });
        value(await host.runReviewAction({ requestId: generateUUID(), action: trashed.toast!.undo!.action }));
        expect(['i-thought', 'n-bike'].map((id) => useTaskStore.getState()._tasksById.get(id)?.deletedAt)).toEqual([undefined, undefined]);
    });

    it('refuses invalid input', async () => {
        freezeClock();
        const { host } = await openHost();
        const invalid = { ok: false, error: { code: 'INVALID_INPUT' } };
        expect(host.getReviewOverview({ offset: 0, limit: 101 })).toMatchObject(invalid);
        expect(host.getReviewOverview({ expansionEdit: { type: 'explode' } as never, ...page })).toMatchObject(invalid);
        expect(host.getWeeklyReview({ calendar: { status: 'ready', events: [{ id: 1 }] } as never, ...page })).toMatchObject(invalid);
        expect(host.getDailyReview({ checkpoint: 42 as never, ...page })).toMatchObject(invalid);
        const run = (action: unknown) => host.runReviewAction({ requestId: generateUUID(), action: action as never });
        expect(await host.runReviewAction({ requestId: 'not-a-uuid', action: { type: 'trashTask', taskId: 'i-thought' } })).toMatchObject(invalid);
        expect(await run({ type: 'moveTasks', taskIds: ['i-thought'], status: 'archived' })).toMatchObject(invalid);
        expect(await run({ type: 'organizeTasks', taskIds: ['i-thought'], input: { areaId: 'no-such-area' } })).toMatchObject(invalid);
        expect(await run({ type: 'organizeTasks', taskIds: ['i-thought'], input: { dueDate: 'soon' } })).toMatchObject(invalid);
        expect(await run({ type: 'addProjectTask', projectId: 'p-garden', title: '   ' })).toMatchObject(invalid);
        expect(await run({ type: 'applySuggestions', suggestions: [{ id: 'n-bike', action: 'delete', reason: '' }] })).toMatchObject(invalid);
        expect(await run({ type: 'setTaskStatus', taskId: 'missing', status: 'next' })).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
        expect(await run({ type: 'purgeEverything' })).toMatchObject(invalid);
    });

    it('is NOT_READY until storage is activated', async () => {
        setStorageAdapter(noopStorage);
        const host = createNativeHostContract();
        const notReady = { ok: false, error: { code: 'NOT_READY' } };
        expect(host.getReviewOverview(page)).toMatchObject(notReady);
        expect(host.getWeeklyReview(page)).toMatchObject(notReady);
        expect(host.getDailyReview(page)).toMatchObject(notReady);
        expect(await host.runReviewAction({ requestId: generateUUID(), action: { type: 'trashTask', taskId: 'i-thought' } })).toMatchObject(notReady);
    });
});
