import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDateFormatter } from './date';
import { loadTranslations } from './i18n/i18n-loader';
import { resolveAreaFilterSelection, isTaskVisibleInArea } from './area-filter';
import { EMPTY_LIST_FILTER_STATE, resolveListFilterState } from './list-filter-state';
import {
    buildSomedayFilterOptions,
    buildSomedayViewModel,
    buildStatusListFilterOptions,
    buildStatusListModel,
    buildWaitingViewModel,
    selectSomedayTasks,
    selectStatusListTasks,
} from './menu-views-model';
import { createWriteRecorder, loadMenuViewsFixture, seedMenuViewsStore, type MenuViewScenario } from './menu-views-model.replay';
import { createNativeHostContract, sortAreasForDisplay } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { noopStorage } from './storage';
import { generateUUID } from './uuid';

const fixture = loadMenuViewsFixture();
const scenario = (screen: MenuViewScenario['screen'], settings: string): MenuViewScenario => ({ name: screen, screen, settings, actions: [] });

describe('native host contract: More sheet and list views', () => {
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

    // Revisions read the clock.
    const freezeClock = () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(fixture.now));
    };

    const openHost = async (entry: MenuViewScenario, saveData?: (data: unknown) => Promise<void>, data = fixture) => {
        const recorder = createWriteRecorder();
        await seedMenuViewsStore(data, entry, recorder, { saveData });
        const host = createNativeHostContract();
        expect(await host.setLanguage({ storedLanguage: 'en', systemLocale: null })).toMatchObject({ ok: true });
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        recorder.log.length = 0;
        return { host, recorder };
    };
    const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        return result.value;
    };
    const visible = () => {
        const state = useTaskStore.getState();
        const areas = sortAreasForDisplay(state.areas);
        const areaById = new Map(areas.map((area) => [area.id, area]));
        const resolvedAreaFilter = resolveAreaFilterSelection(state.settings.filters, areas);
        const projectById = new Map(state.projects.map((project) => [project.id, project]));
        return {
            state, areaById, resolvedAreaFilter,
            visibleTasks: state.tasks.filter((task) => isTaskVisibleInArea(task, { areaById, projectById, resolvedAreaFilter })),
        };
    };

    it('returns what core\'s models return when called directly', async () => {
        freezeClock();
        const { host } = await openHost(scenario('someday', 'sections'));
        const { state, areaById, resolvedAreaFilter, visibleTasks } = visible();

        const waiting = buildWaitingViewModel({ tasks: visibleTasks, projects: state.projects, resolvedAreaFilter, areaById, person: 'alice', t });
        const waitingView = value(host.getWaitingView({ person: 'alice', offset: 0, limit: 100 }));
        expect(waitingView.rows.map((row) => row.id)).toEqual(waiting.tasks.map((task) => task.id));
        expect(waitingView.deferred).toEqual(waiting.deferred);

        const tasks = selectSomedayTasks(visibleTasks);
        const options = buildSomedayFilterOptions({ tasks, projects: state.projects, settings: state.settings, t });
        const filters = { ...EMPTY_LIST_FILTER_STATE, tokens: ['#music'] };
        const resolved = resolveListFilterState(filters, { ...options, t });
        const someday = buildSomedayViewModel({
            tasks, projects: state.projects, areaById, resolvedAreaFilter, settings: state.settings,
            sortBy: 'title', groupBy: 'project', showDetails: true, criteria: resolved.criteria, searchQuery: resolved.searchQuery, t,
        });
        const somedayView = value(host.getSomedayView({ sortBy: 'title', groupBy: 'project', showDetails: true, filters, offset: 0, limit: 100 }));
        expect(somedayView.items.map((item) => (item.type === 'heading' ? item.id : item.row.id)))
            .toEqual(someday.groups!.flatMap((group) => [group.id, ...group.tasks.map((task) => task.id)]));
        expect(somedayView.filters.state).toEqual(resolved.state);
        // Rows carry core meta.
        const row = somedayView.items.find((item) => item.type === 'task');
        expect(row?.type === 'task' && row.row.meta).toBeTruthy();

        const referenceTasks = selectStatusListTasks({
            kind: 'reference', tasks: state.tasks, projects: state.projects, allProjects: state._allProjects,
            resolvedAreaFilter, areaById, includeArchivedProjects: true,
        });
        const referenceOptions = buildStatusListFilterOptions({ kind: 'reference', tasks: referenceTasks, allProjects: state._allProjects, settings: state.settings, t });
        const reference = buildStatusListModel({
            kind: 'reference', tasks: referenceTasks, projects: state.projects, areas: state.areas, settings: state.settings,
            groupBy: 'project', criteria: {}, searchQuery: '', collapsedGroupIds: new Set(), t,
        });
        const referenceView = value(host.getReferenceView({ groupBy: 'project', includeArchivedProjects: true, offset: 0, limit: 100 }));
        expect(referenceView.items.map((item) => (item.type === 'section' ? item.id : item.row.id)))
            .toEqual(reference.items.map((item) => (item.type === 'section' ? item.id : item.task.id)));
        expect(referenceView.filters.tokens.map((token) => token.value)).toEqual(referenceOptions.tokens);
        // A reference filed in an archived project opens read-only, as on mobile.
        const archived = referenceView.items.find((item) => item.type === 'task' && item.row.id === 'r-c');
        expect(archived?.type === 'task' && archived.row.readOnly).toBe(true);
    });

    it('pages within one revision and refuses a stale page after an edit', async () => {
        freezeClock();
        const { host } = await openHost(scenario('waiting', 'base'));
        const first = value(host.getWaitingView({ offset: 0, limit: 2 }));
        expect(first.total).toBe(5);
        const second = value(host.getWaitingView({ offset: 2, limit: 2, revision: first.revision }));
        expect([...first.rows, ...second.rows].map((row) => row.id)).toEqual(['w-alice2', 'w-alice', 'w-desc', 'w-plain']);
        // A later page needs the revision; another person's list is another revision.
        expect(host.getWaitingView({ offset: 2, limit: 2 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(value(host.getWaitingView({ person: 'bob', offset: 0, limit: 2 })).revision).not.toBe(first.revision);

        await useTaskStore.getState().updateTask('w-plain', { title: 'Landlord reply' });
        expect(host.getWaitingView({ offset: 2, limit: 2, revision: first.revision })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        const refreshed = value(host.getWaitingView({ offset: 0, limit: 2 }));
        expect(refreshed.revision).not.toBe(first.revision);

        const someday = value(host.getSomedayView({ offset: 0, limit: 1 }));
        await useTaskStore.getState().updateSettings({ gtd: { ...useTaskStore.getState().settings.gtd, viewSections: { someday: [{ id: 'x', title: 'X', order: 0 }] } } });
        expect(host.getSomedayView({ offset: 1, limit: 1, revision: someday.revision })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });

    it('refuses invalid input', async () => {
        freezeClock();
        const { host } = await openHost(scenario('someday', 'sections'));
        expect(host.getWaitingView({ offset: 0, limit: 101 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.getSomedayView({ groupBy: 'tag' as never, offset: 0, limit: 10 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.getSomedayView({ filters: { tokens: 'x' } as never, offset: 0, limit: 10 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.getSomedayView({ filters: { color: 'red' } as never, offset: 0, limit: 10 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.getSomedayView({ filterEdit: { type: 'togglePriority', value: 'huge' } as never, offset: 0, limit: 10 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.getReferenceView({ sortBy: 'title' } as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.getDoneView({ groupBy: 'completedDate', sortBy: 'completed', includeArchivedProjects: true, offset: 0, limit: 10 } as never))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.reorderSomedaySections({ ids: ['s-later', 's-ideas'] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.renameSomedaySection({ id: 's-later', title: '  ' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.createSomedaySection({ title: ' ' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.moveSomedayTasksToSection({ taskIds: ['s-a'], sectionId: null, requestId: 'nope' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.activateProject({ projectId: 'p-old' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.setTaskListSort({ sortBy: 'completed' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('writes nothing again for a target already reached', async () => {
        freezeClock();
        const { host, recorder } = await openHost(scenario('someday', 'sections'));
        expect(value(await host.activateProject({ projectId: 'p-launch' }))).toEqual({ id: 'p-launch', changed: false });
        expect(value(await host.renameSomedaySection({ id: 's-later', title: ' Later ' }))).toEqual({ id: 's-later', changed: false });
        expect(value(await host.reorderSomedaySections({ ids: ['s-later', 's-ideas', 's-empty'] }))).toEqual({ changed: false });
        expect(value(await host.createSomedaySection({ title: 'IDEAS' }))).toEqual({ id: 's-ideas', existing: true });
        expect(value(await host.deleteSomedaySection({ id: 'missing' }))).toEqual({ id: 'missing', changed: false });
        expect(value(await host.moveSomedayTasksToSection({ taskIds: ['s-a'], sectionId: 's-later', requestId: generateUUID() })))
            .toEqual({ moved: 0, toast: null, undo: null });
        expect(recorder.log).toEqual([]);
    });

    it('deletes a section only from settings: its tasks keep their assignment and show under No section', async () => {
        freezeClock();
        const { host, recorder } = await openHost(scenario('someday', 'sections'));
        const row = value(host.getSomedaySections()).rows.find((entry) => entry.id === 's-later')!;
        expect(row.deleteConfirm).toEqual({ title: 'Delete', message: 'Delete "Later"?', cancelLabel: 'Cancel', confirmLabel: 'Delete' });
        expect(value(await host.deleteSomedaySection({ id: 's-later' }))).toEqual({ id: 's-later', changed: true });
        expect(recorder.log.map((entry) => (entry as unknown[])[0])).toEqual(['updateSettings']);
        expect(useTaskStore.getState()._tasksById.get('s-a')?.viewSectionIds).toEqual({ someday: 's-later' });
        const view = value(host.getSomedayView({ offset: 0, limit: 100 }));
        const noSection = view.items.findIndex((item) => item.type === 'heading' && item.id === 'view-section:someday:none');
        expect(view.items.slice(noSection).some((item) => item.type === 'task' && item.row.id === 's-a')).toBe(true);
    });

    it('retries a failed section move exactly: one write, and Undo still restores the first sections', async () => {
        freezeClock();
        const saveData = vi.fn().mockResolvedValue(undefined);
        const { host, recorder } = await openHost(scenario('someday', 'sections'), saveData);
        const input = { taskIds: ['s-a', 's-b'], sectionId: 's-empty', requestId: generateUUID() };
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.moveSomedayTasksToSection(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
        expect(recorder.log).toHaveLength(1);

        saveData.mockResolvedValue(undefined);
        const retried = value(await host.moveSomedayTasksToSection(input));
        expect(retried).toEqual({
            moved: 2,
            toast: { message: 'Moved to Travel (2)', undoLabel: 'Undo' },
            undo: { previous: [{ id: 's-a', sectionId: 's-later' }, { id: 's-b', sectionId: 's-ideas' }], sectionId: 's-empty' },
        });
        expect(recorder.log).toHaveLength(1);
        const saved = saveData.mock.lastCall?.[0] as { tasks: { id: string; viewSectionIds?: { someday?: string } }[] };
        expect(saved.tasks.filter(({ id }) => id === 's-a' || id === 's-b').map((task) => task.viewSectionIds?.someday)).toEqual(['s-empty', 's-empty']);
        // A lost reply repeats the request: no write, no save.
        const saves = saveData.mock.calls.length;
        expect(value(await host.moveSomedayTasksToSection(input))).toEqual(retried);
        expect(saveData).toHaveBeenCalledTimes(saves);
        expect(await host.moveSomedayTasksToSection({ ...input, sectionId: null })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

        expect(value(await host.undoSomedaySectionMove({ undo: retried && 'undo' in retried ? retried.undo! : never(), requestId: generateUUID() })))
            .toEqual({ reverted: 2 });
        expect(['s-a', 's-b'].map((id) => useTaskStore.getState()._tasksById.get(id)?.viewSectionIds?.someday)).toEqual(['s-later', 's-ideas']);
    });

    it('retries a failed Add task exactly: one task', async () => {
        freezeClock();
        const saveData = vi.fn().mockResolvedValue(undefined);
        const { host, recorder } = await openHost(scenario('someday', 'sections'), saveData);
        const input = { title: '  Book flights ', sectionId: 's-empty', captureId: generateUUID() };
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.addSomedaySectionTask(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        saveData.mockResolvedValue(undefined);
        expect(value(await host.addSomedaySectionTask(input))).toEqual({ id: input.captureId, toast: 'Task created' });
        expect(recorder.normalize(recorder.log)).toEqual([['addTask', 'Book flights', { status: 'someday', viewSectionIds: { someday: 's-empty' } }]]);
        const saved = saveData.mock.lastCall?.[0] as { tasks: { id: string; title: string }[] };
        expect(saved.tasks.filter((task) => task.title === 'Book flights')).toHaveLength(1);
    });

    it('retries a failed new section exactly: one settings write, the same section', async () => {
        freezeClock();
        const saveData = vi.fn().mockResolvedValue(undefined);
        const { host, recorder } = await openHost(scenario('someday', 'sections'), saveData);
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.createSomedaySection({ title: 'Hobbies' })).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        saveData.mockResolvedValue(undefined);
        const retried = value(await host.createSomedaySection({ title: 'Hobbies' }));
        expect(retried.existing).toBe(true);
        expect(recorder.log).toHaveLength(1);
        const saved = saveData.mock.lastCall?.[0] as { settings: { gtd: { viewSections: { someday: { id: string; title: string }[] } } } };
        expect(saved.settings.gtd.viewSections.someday.find((section) => section.title === 'Hobbies')?.id).toBe(retried.id);
    });

    it('retries a failed project activation exactly: one write', async () => {
        freezeClock();
        const saveData = vi.fn().mockResolvedValue(undefined);
        const { host, recorder } = await openHost(scenario('waiting', 'base'), saveData);
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.activateProject({ projectId: 'p-vendor' })).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        saveData.mockResolvedValue(undefined);
        expect(value(await host.activateProject({ projectId: 'p-vendor' }))).toEqual({ id: 'p-vendor', changed: false });
        expect(recorder.log).toEqual([['updateProject', 'p-vendor', { status: 'active' }]]);
        const saved = saveData.mock.lastCall?.[0] as { projects: { id: string; status: string }[] };
        expect(saved.projects.find((project) => project.id === 'p-vendor')?.status).toBe('active');
    });

    it('titles older completion months with the user\'s date formatting', async () => {
        freezeClock();
        const keepDone = { ...fixture, settings: { ...fixture.settings, keepDone: { gtd: { autoArchiveDays: 0 } } } };
        const { host } = await openHost(scenario('done', 'keepDone'), undefined, keepDone);
        expect(await host.setLanguage({ storedLanguage: 'fr', systemLocale: null })).toMatchObject({ ok: true });
        const view = value(host.getDoneView({ groupBy: 'completedDate', offset: 0, limit: 100 }));
        const month = view.items.find((item) => item.type === 'section' && item.id === 'completedDate:2026-08');
        const title = createDateFormatter({ language: 'fr', systemLocale: null })(new Date(2026, 7, 1), 'LLLL yyyy');
        expect(month).toMatchObject({ type: 'section', title });
        expect(title).not.toBe('August 2026');
    });

    it('is NOT_READY until storage is activated', async () => {
        setStorageAdapter(noopStorage);
        const host = createNativeHostContract();
        const notReady = { ok: false, error: { code: 'NOT_READY' } };
        const page = { offset: 0, limit: 10 };
        expect(host.getMoreMenu()).toMatchObject(notReady);
        expect(host.getWaitingView(page)).toMatchObject(notReady);
        expect(host.getSomedayView(page)).toMatchObject(notReady);
        expect(host.getReferenceView(page)).toMatchObject(notReady);
        expect(host.getDoneView(page)).toMatchObject(notReady);
        expect(host.getSomedaySections()).toMatchObject(notReady);
        expect(host.getSomedayMoveDialog({ taskIds: ['s-a'] })).toMatchObject(notReady);
        expect(await host.activateProject({ projectId: 'p' })).toMatchObject(notReady);
        expect(await host.moveSomedayTasksToSection({ taskIds: ['s-a'], sectionId: null, requestId: generateUUID() })).toMatchObject(notReady);
        expect(await host.undoSomedaySectionMove({ undo: { previous: [{ id: 's-a' }], sectionId: null }, requestId: generateUUID() })).toMatchObject(notReady);
        expect(await host.addSomedaySectionTask({ title: 'x', sectionId: null, captureId: generateUUID() })).toMatchObject(notReady);
        expect(await host.createSomedaySection({ title: 'x' })).toMatchObject(notReady);
        expect(await host.renameSomedaySection({ id: 's', title: 'x' })).toMatchObject(notReady);
        expect(await host.reorderSomedaySections({ ids: [] })).toMatchObject(notReady);
        expect(await host.deleteSomedaySection({ id: 's' })).toMatchObject(notReady);
        expect(await host.setTaskListSort({ sortBy: 'title' })).toMatchObject(notReady);
    });
});

function never(): never {
    throw new Error('unreachable');
}
