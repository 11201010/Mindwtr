import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract, NATIVE_HOST_EDITOR_FIELDS, NATIVE_HOST_MAX_WINDOW, type NativeEditableFields } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { noopStorage, type StorageAdapter } from './storage';
import { isTaskVisibleInArea, resolveAreaFilterSelection } from './area-filter';
import * as projectGrouping from './project-grouping';
import * as focusDerivation from './focus-sections';
import * as projectTaskListModel from './project-task-list-model';
import { formatLocalDate } from './import-source-reader';
import { resolveFeatureFlags } from './resolve-feature-flags';
import { configureDateFormatting } from './date';
import { buildTaskRowMeta, resolveTaskRowFeatures, resolveTaskRowLookup } from './task-row-meta';
import { isTaskActionable } from './task-status';
import { splitTodayTasksByStartTime } from './task-utils';
import { getEnglishI18nValue, getTranslator, tFallback } from './i18n';
import { getTranslationsSync } from './i18n/i18n-loader';
import { resolveLanguageFromLocale } from './i18n/i18n-storage';
import { zhHans } from './i18n/locales/zh-Hans';
import type { Language } from './i18n/i18n-types';
import type { AppSettings, Area, Project, Section, Task } from './types';

const CAPTURE_ID = '123e4567-e89b-12d3-a456-426614174000';
const projectParity = JSON.parse(
    readFileSync(new URL('./project-task-list-parity.fixtures.json', import.meta.url), 'utf8'),
) as {
    projects: Project[];
    sections: Section[];
    tasks: Task[];
    mobileSnapshot: Record<string, Array<Record<string, unknown>>>;
};

const task = (id: string, createdAt: string, extra: Partial<Task> = {}): Task => ({
    id,
    title: id,
    status: 'inbox',
    tags: [],
    contexts: [],
    createdAt,
    updatedAt: createdAt,
    ...extra,
});

const project = (id: string, status: Project['status'] = 'active', order = 0, extra: Partial<Project> = {}): Project => ({
    id,
    title: id,
    status,
    color: '#123456',
    order,
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...extra,
});

const area = (id: string, name: string, order: number, extra: Partial<Area> = {}): Area => ({
    id, name, order, color: '#abcdef', icon: 'home',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...extra,
});

describe('native host contract', () => {
    let saveData: ReturnType<typeof vi.fn>;
    let getData: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        saveData = vi.fn().mockResolvedValue(undefined);
        getData = vi.fn().mockResolvedValue({ tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} });
        setStorageAdapter({
            getData,
            saveData,
        } satisfies StorageAdapter);
        useTaskStore.setState({
            _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
        });
    });

    afterEach(async () => {
        vi.useRealTimers();
        await flushPendingSave();
        resetForTests();
        vi.restoreAllMocks();
    });

    // Inbox and project pages carry a minute in their revision; paging tests keep one minute.
    const freezeClock = () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 8, 23, 10, 0));
    };

    const activateWith = async (tasks: Task[], projects: Project[] = []) => {
        getData.mockResolvedValue({ tasks, projects, sections: [], areas: [], people: [], settings: {} });
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        return host;
    };

    it('resolves stored and system languages like mobile and loads strings before returning', async () => {
        const host = createNativeHostContract();
        expect(host.getStrings({ keys: ['common.save'] })).toEqual({
            ok: true, value: { language: 'en', strings: { 'common.save': 'Save' }, missing: [] },
        });
        for (const [storedLanguage, systemLocale, expected] of [
            ['zh', 'ja-JP', 'zh'],
            ['unsupported', 'ja-JP', 'ja'],
            [null, 'ja-JP', 'ja'],
            [null, 'zh-TW', 'zh-Hant'],
            [null, 'fr-FR', 'en'],
            [null, null, 'en'],
        ] as const) {
            expect(await host.setLanguage({ storedLanguage, systemLocale }))
                .toEqual({ ok: true, value: { language: expected } });
            if (expected === 'zh') {
                expect(host.getStrings({ keys: ['common.save'] })).toEqual({
                    ok: true, value: { language: 'zh', strings: { 'common.save': '保存' }, missing: [] },
                });
            }
            if (systemLocale === 'fr-FR') expect(expected).toBe(resolveLanguageFromLocale(systemLocale));
        }
    });

    it('falls back to English, reports missing keys, and validates string requests', async () => {
        const host = createNativeHostContract();
        expect(await host.setLanguage({ storedLanguage: 'zh', systemLocale: null })).toMatchObject({ ok: true });
        const fallbackKey = 'common.save';
        const zh = getTranslationsSync('zh');
        const saved = zh[fallbackKey];
        delete zh[fallbackKey];
        try {
            expect(host.getStrings({ keys: [fallbackKey, 'not.a.real.key'] })).toEqual({
                ok: true,
                value: {
                    language: 'zh',
                    strings: { [fallbackKey]: getEnglishI18nValue(fallbackKey) },
                    missing: ['not.a.real.key'],
                },
            });
        } finally {
            zh[fallbackKey] = saved;
        }
        for (const input of [null, {}, { keys: 'common.save' }, { keys: [1] }, { keys: Array(501).fill('common.save') }]) {
            expect(host.getStrings(input as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        for (const input of [null, {}, { storedLanguage: 1, systemLocale: null }, { storedLanguage: null, systemLocale: 1 }]) {
            expect(await host.setLanguage(input as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
    });

    it('pages deterministic visible Inbox rows and rejects a stale revision after order or membership changes', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        freezeClock();
        useTaskStore.setState({ _allTasks: [
            task('later', '2026-09-03T00:00:00.000Z'),
            task('first', '2026-09-01T00:00:00.000Z'),
            task('middle', '2026-09-02T00:00:00.000Z'),
            task('other-status', '2026-09-01T00:00:00.000Z', { status: 'next' }),
        ] });
        const first = host.getInboxWindow({ offset: 0, limit: 2 });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.value.total).toBe(3);
        expect(first.value.rows.map(({ id }) => id)).toEqual(['first', 'middle']);
        expect(first.value.rows[0]).toEqual({
            id: 'first', title: 'first', status: 'inbox', priority: null, dueDate: null,
            startTime: null, isFocusedToday: false, projectTitle: null, hasNotes: false, revealDate: null, laterToday: false,
            meta: expect.objectContaining({ parts: [], statusLabel: 'Inbox' }),
        });
        expect(host.getInboxWindow({ offset: 2, limit: 2, revision: first.value.revision }))
            .toMatchObject({ ok: true, value: { rows: [{ id: 'later' }], total: 3 } });

        expect((await useTaskStore.getState().updateTask('later', { dueDate: '2026-09-01' })).success).toBe(true);
        await flushPendingSave();
        expect(host.getInboxWindow({ offset: 2, limit: 2, revision: first.value.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        const reordered = host.getInboxWindow({ offset: 0, limit: 2 });
        expect(reordered).toMatchObject({ ok: true, value: { rows: [{ id: 'later' }, { id: 'first' }] } });
        if (!reordered.ok) return;

        expect((await useTaskStore.getState().updateTask('first', { status: 'next' })).success).toBe(true);
        await flushPendingSave();
        expect(host.getInboxWindow({ offset: 2, limit: 2, revision: reordered.value.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.getInboxWindow({ offset: 0, limit: 2 })).toMatchObject({ ok: true, value: { total: 2 } });
        expect(host.getInboxWindow({ offset: 1, limit: 2 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.getInboxWindow({ offset: 0, limit: NATIVE_HOST_MAX_WINDOW + 1 }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.createInboxTask({ title: 'New', captureId: 'bad' }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

        const beforeSort = host.getInboxWindow({ offset: 0, limit: 1 });
        if (!beforeSort.ok) return;
        useTaskStore.setState({ settings: { taskSortBy: 'created-desc' } });
        expect(host.getInboxWindow({ offset: 1, limit: 1, revision: beforeSort.value.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.getInboxWindow({ offset: 0, limit: 2 }))
            .toMatchObject({ ok: true, value: { rows: [{ id: 'later' }, { id: 'middle' }] } });
    });

    it('invalidates Inbox paging when a project becomes inactive', async () => {
        const project: Project = {
            id: 'project', title: 'Project', status: 'active', color: '#123456', order: 0,
            tagIds: [], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
        };
        getData.mockResolvedValue({
            tasks: [task('in-project', '2026-09-01T00:00:00.000Z', { projectId: project.id })],
            projects: [project], sections: [], areas: [], people: [], settings: {},
        });
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        const first = host.getInboxWindow({ offset: 0, limit: 1 });
        expect(first).toMatchObject({ ok: true, value: { total: 1, rows: [{ projectTitle: 'Project' }] } });
        if (!first.ok) return;
        useTaskStore.setState({ _allProjects: [{ ...project, status: 'archived' }] });
        expect(host.getInboxWindow({ offset: 1, limit: 1, revision: first.value.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.getInboxWindow({ offset: 0, limit: 1 }))
            .toMatchObject({ ok: true, value: { total: 0, rows: [] } });
    });

    it('matches mobile Projects grouping and core summaries, caching until an area or task changes', async () => {
        const areas = [
            area('later', 'Later', 2), area('zeta', 'Zeta', 1), area('alpha', 'Alpha', 1),
            area('deleted-area', 'Deleted', 0, { deletedAt: '2026-09-02T00:00:00.000Z' }),
        ];
        const projects = [
            project('alpha-regular', 'active', 0, { areaId: 'alpha' }),
            project('alpha-focused', 'active', 9, { areaId: 'alpha', isFocused: true }),
            project('zeta-active', 'active', 0, { areaId: 'zeta' }),
            project('later-active', 'active', 0, { areaId: 'later' }),
            project('orphan', 'active', 0, { areaId: 'deleted-area' }),
            project('waiting', 'waiting', 0, { areaId: 'zeta' }),
            project('someday', 'someday', 0, { areaId: 'later' }),
            project('archived', 'archived', 0, { areaId: 'alpha' }),
            project('deleted-project', 'active', 0, { areaId: 'alpha', deletedAt: '2026-09-02T00:00:00.000Z' }),
        ];
        getData.mockResolvedValue({
            tasks: [
                task('focused-waiting', '2026-09-01T00:00:00.000Z', { projectId: 'alpha-focused', status: 'waiting' }),
                task('regular-next', '2026-09-01T00:00:00.000Z', { projectId: 'alpha-regular', status: 'next', title: 'Next step' }),
                task('regular-done', '2026-09-01T00:00:00.000Z', { projectId: 'alpha-regular', status: 'done' }),
            ],
            projects, sections: [], areas, people: [], settings: {},
        });
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        const state = useTaskStore.getState();
        const independentlyOrderedAreas = [...state.areas]
            .filter((item) => !item.deletedAt)
            .sort((a, b) => a.order !== b.order ? a.order - b.order : a.name.localeCompare(b.name));
        const mobileGroups = projectGrouping.buildProjectGroups({
            projects: state.projects,
            orderedAreas: independentlyOrderedAreas,
            areaFilter: resolveAreaFilterSelection(undefined, independentlyOrderedAreas),
            tagFilter: { kind: 'all' },
            pinFocused: true,
        });
        const groupCalls = vi.spyOn(projectGrouping, 'buildProjectGroups');
        const first = host.getProjects();
        if (!first.ok) throw new Error('Projects query failed');
        const shape = (groups: { areaId: string | null; projects: { id: string }[] }[]) =>
            groups.map(({ areaId, projects: rows }) => ({ areaId, ids: rows.map(({ id }) => id) }));
        for (const key of ['active', 'deferred', 'archived'] as const) {
            expect(shape(first.value[key])).toEqual(shape(mobileGroups[key].map((group) => ({
                areaId: group.areaId ?? null, projects: group.projects,
            }))));
        }
        expect(shape(first.value.active)).toEqual([
            { areaId: 'alpha', ids: ['alpha-focused', 'alpha-regular'] },
            { areaId: 'zeta', ids: ['zeta-active'] },
            { areaId: 'later', ids: ['later-active'] },
            { areaId: null, ids: ['orphan'] },
        ]);
        expect(first.value.active[0]).toMatchObject({ areaName: 'Alpha', areaColor: '#abcdef', areaIcon: 'home' });
        expect(first.value.active[3]).toMatchObject({ areaName: null, areaColor: null, areaIcon: null });
        const summaryById = state.getDerivedState().projectTaskSummaryById;
        for (const row of [...first.value.active, ...first.value.deferred, ...first.value.archived].flatMap((group) => group.projects)) {
            const summary = summaryById.get(row.id);
            expect(row).toMatchObject({
                activeTaskCount: summary?.activeTaskCount ?? 0,
                nextActionId: summary?.nextAction?.id ?? null,
                nextActionTitle: summary?.nextAction?.title ?? null,
                focusedWithoutNextAction: row.isFocused && !summary?.nextAction && (summary?.activeTaskCount ?? 0) > 0,
                color: '#123456',
            });
        }
        expect(first.value.active[0].projects[0]).toMatchObject({
            id: 'alpha-focused', isFocused: true, activeTaskCount: 1,
            nextActionId: null, nextActionTitle: null, focusedWithoutNextAction: true,
        });
        expect(first.value.active[0].projects[1]).toMatchObject({
            id: 'alpha-regular', nextActionId: 'regular-next', nextActionTitle: 'Next step',
        });
        const unchanged = host.getProjects();
        expect(unchanged).toMatchObject({ ok: true, value: { revision: first.value.revision } });
        if (!unchanged.ok) throw new Error('Projects query failed');
        expect(unchanged.value).toBe(first.value);
        expect(groupCalls).toHaveBeenCalledTimes(1);

        expect((await useTaskStore.getState().updateArea('alpha', { name: 'Renamed' })).success).toBe(true);
        const renamed = host.getProjects();
        if (!renamed.ok) throw new Error('Projects query failed after area rename');
        expect(renamed.value.revision).not.toBe(first.value.revision);
        expect(renamed.value.active[0].areaName).toBe('Renamed');
        expect(groupCalls).toHaveBeenCalledTimes(2);
        expect((await useTaskStore.getState().updateTask('regular-next', { title: 'Edited step' })).success).toBe(true);
        const edited = host.getProjects();
        if (!edited.ok) throw new Error('Projects query failed after task edit');
        expect(edited.value.revision).not.toBe(renamed.value.revision);
        expect(edited.value.active[0].projects[1].nextActionTitle).toBe('Edited step');
        expect(groupCalls).toHaveBeenCalledTimes(3);
    });

    describe('project detail', () => {
        // The store state mobile's snapshot rendered from; a real load would run
        // migrations (for example auto-archiving old Done tasks) first.
        const activateParity = async () => {
            const host = createNativeHostContract();
            expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
            useTaskStore.setState({
                _allTasks: projectParity.tasks, _allProjects: projectParity.projects, _allSections: projectParity.sections,
            });
            freezeClock();
            return host;
        };
        const detail = (host: ReturnType<typeof createNativeHostContract>, projectId: string, limit = NATIVE_HOST_MAX_WINDOW) => {
            const result = host.getProjectDetail({ projectId, offset: 0, limit });
            if (!result.ok) throw new Error(`Project detail failed: ${result.error.code}`);
            return result.value;
        };

        const expectMobileParity = (value: ReturnType<typeof detail>, scenario: string) => {
            const mobile = projectParity.mobileSnapshot[scenario];
            expect(value.total).toBe(mobile.length);
            expect(value.items.map((item) => (item.type === 'section'
                ? { type: 'section', id: item.id, count: item.count, muted: item.muted }
                : { type: 'task', id: item.row.id, sectionId: item.sectionId, sequenceCue: item.sequenceCue })))
                .toEqual(mobile.map((item) => (item.type === 'section'
                    ? { type: 'section', id: item.id, count: item.count, muted: item.muted === true }
                    : {
                        type: 'task', id: item.id,
                        sectionId: item.reorderSectionId === 'undefined' ? null : item.reorderSectionId,
                        sequenceCue: item.sequenceCue,
                    })));
        };
        const setProjectSort = (sorts: Record<string, Project['taskSortBy']>) => useTaskStore.setState({
            _allProjects: projectParity.projects.map((item) => (item.id in sorts ? { ...item, taskSortBy: sorts[item.id] } : item)),
        });

        it('pages the mobile project list as it opens, with section markers and sequence cues', async () => {
            const host = await activateParity();
            for (const [projectId, scenario] of [
                ['p-live', 'live-default'], ['p-archived', 'archived-default'], ['p-seq', 'sequential-default'],
            ] as const) {
                expectMobileParity(detail(host, projectId), scenario);
            }
            const live = detail(host, 'p-live');
            expect(live).toMatchObject({ version: 1, projectId: 'p-live', readOnly: false });
            expect(live.items.filter((item) => item.type === 'section').map((item) => item.title))
                .toEqual(['Design', 'Build', 'No Section', 'Reference']);
            expect(live.items[1]).toEqual({
                type: 'task',
                row: {
                    id: 'live-a1', title: 'Sketch', status: 'next', priority: null, dueDate: null, startTime: null,
                    isFocusedToday: false, projectTitle: 'Launch', hasNotes: false, revealDate: null, laterToday: false,
                    meta: expect.objectContaining({ statusLabel: 'Next', accessibilityLabel: 'Sketch. Status: Next' }),
                },
                sectionId: 'sec-a',
                sequenceCue: null,
            });
            expect(detail(host, 'p-archived').readOnly).toBe(true);
            expect(detail(host, 'p-seq').items.map((item) => (item.type === 'task' ? item.sequenceCue : item.id)))
                .toEqual(['available', 'later', null, 'later']);
        });

        it('follows the saved project sort like mobile, dropping sequence cues off the default sort', async () => {
            const host = await activateParity();
            setProjectSort({ 'p-live': 'title', 'p-seq': 'title' });
            expectMobileParity(detail(host, 'p-live'), 'live-sorted-title');
            const sequentialByTitle = detail(host, 'p-seq');
            expect(sequentialByTitle.items.map((item) => (item.type === 'task' ? item.row.id : item.id)))
                .toEqual(['seq-1', 'seq-2', 'seq-5', 'seq-3']);
            expect(sequentialByTitle.items.every((item) => item.type === 'task' && item.sequenceCue === null)).toBe(true);

            // A time-estimate sort (a valid, feature-gated project sort) falls back to project
            // order while Time estimates is off.
            setProjectSort({ 'p-seq': 'timeEstimate' });
            useTaskStore.setState({ settings: { features: { timeEstimates: false } } });
            const estimatesOff = detail(host, 'p-seq');
            expectMobileParity(estimatesOff, 'sequential-default');
            useTaskStore.setState({ settings: { features: { timeEstimates: true } } });
            expect(host.getProjectDetail({ projectId: 'p-seq', offset: 1, limit: 1, revision: estimatesOff.revision }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(detail(host, 'p-seq').items.every((item) => item.type === 'task' && item.sequenceCue === null)).toBe(true);
        });

        it('windows items, rejects stale pages, and reports a missing or deleted project', async () => {
            const host = await activateParity();
            const full = detail(host, 'p-live');
            const first = host.getProjectDetail({ projectId: 'p-live', offset: 0, limit: 4 });
            if (!first.ok) throw new Error('First page failed');
            expect(first.value.total).toBe(full.total);
            const pages = [...first.value.items];
            for (let offset = 4; offset < full.total; offset += 4) {
                const page = host.getProjectDetail({ projectId: 'p-live', offset, limit: 4, revision: first.value.revision });
                if (!page.ok) throw new Error(`Page ${offset} failed`);
                expect(page.value.revision).toBe(first.value.revision);
                pages.push(...page.value.items);
            }
            expect(pages).toEqual(full.items);
            expect(host.getProjectDetail({ projectId: 'p-live', offset: full.total, limit: 4, revision: first.value.revision }))
                .toMatchObject({ ok: true, value: { items: [], total: full.total } });

            expect((await useTaskStore.getState().updateTask('live-u1', { title: 'Renamed' })).success).toBe(true);
            await flushPendingSave();
            expect(host.getProjectDetail({ projectId: 'p-live', offset: 4, limit: 4, revision: first.value.revision }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });

            expect(host.getProjectDetail({ projectId: 'missing', offset: 0, limit: 4 }))
                .toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
            expect((await useTaskStore.getState().deleteProject('p-other')).success).toBe(true);
            await flushPendingSave();
            expect(host.getProjectDetail({ projectId: 'p-other', offset: 0, limit: 4 }))
                .toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });

            for (const input of [
                null, {}, { projectId: '', offset: 0, limit: 1 }, { projectId: 'p-live', offset: -1, limit: 1 },
                { projectId: 'p-live', offset: 0, limit: 0 }, { projectId: 'p-live', offset: 0, limit: NATIVE_HOST_MAX_WINDOW + 1 },
                { projectId: 'p-live', offset: 1, limit: 1 }, { projectId: 'p-live', offset: 0, limit: 1, revision: 1 },
            ]) {
                expect(host.getProjectDetail(input as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            }
        });

        it('translates section titles and invalidates the English revision after a language change', async () => {
            const host = await activateParity();
            const english = detail(host, 'p-live');
            expect(await host.setLanguage({ storedLanguage: 'zh', systemLocale: null }))
                .toEqual({ ok: true, value: { language: 'zh' } });
            const chinese = detail(host, 'p-live');
            expect(chinese.revision).not.toBe(english.revision);
            expect(chinese.items.filter((item) => item.type === 'section').map((item) => item.title))
                .toEqual(['Design', 'Build', zhHans['projects.noSection'], zhHans['status.reference']]);
            expect(host.getProjectDetail({ projectId: 'p-live', offset: 1, limit: 1, revision: english.revision }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        });

        it('builds each project list once per revision', async () => {
            const host = await activateParity();
            const build = vi.spyOn(projectTaskListModel, 'buildProjectTaskListModel');
            const first = detail(host, 'p-live');
            expect(detail(host, 'p-live')).toEqual(first);
            expect(host.getProjectDetail({ projectId: 'p-live', offset: 2, limit: 2, revision: first.revision }).ok).toBe(true);
            expect(build).toHaveBeenCalledTimes(1);
            detail(host, 'p-seq');
            expect(build).toHaveBeenCalledTimes(2);
        });
    });

    it('acknowledges create and complete only when their store snapshots are durable', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        saveData.mockClear();
        let releaseSave!: () => void;
        saveData.mockImplementation(() => new Promise<void>((resolve) => { releaseSave = resolve; }));

        let createdSettled = false;
        const creating = host.createInboxTask({ title: '  Captured thought  ', captureId: CAPTURE_ID }).then((result) => {
            createdSettled = true;
            return result;
        });
        await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
        expect(createdSettled).toBe(false);
        releaseSave();
        const created = await creating;
        expect(created).toMatchObject({ ok: true, value: { id: expect.any(String) } });
        if (!created.ok) return;
        expect(host.getTask({ id: created.value.id })).toMatchObject({
            ok: true, value: { title: 'Captured thought', status: 'inbox' },
        });

        let completedSettled = false;
        const completing = host.completeTask({ id: created.value.id }).then((result) => {
            completedSettled = true;
            return result;
        });
        await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(2));
        expect(completedSettled).toBe(false);
        releaseSave();
        expect(await completing).toEqual({ ok: true, value: { id: created.value.id } });
        expect(host.getTask({ id: created.value.id })).toMatchObject({
            ok: true, value: { status: 'done', completedAt: expect.any(String) },
        });
    });

    it('reports a failed save without a successful task ID', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        saveData.mockClear();
        saveData.mockRejectedValue(new Error('disk unavailable'));
        const input = { title: 'Unsaved thought', captureId: CAPTURE_ID };
        const result = await host.createInboxTask(input);
        expect(result).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
        expect(result).not.toHaveProperty('value.id');
        saveData.mockResolvedValue(undefined);
        expect(await host.createInboxTask(input)).toEqual({ ok: true, value: { id: CAPTURE_ID } });
        expect(useTaskStore.getState()._allTasks).toHaveLength(1);
    });

    it('reports failed completion persistence and retries the optimistic completion without repeating it', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        saveData.mockClear();
        useTaskStore.setState({ _allTasks: [task('to-complete', '2026-09-01T00:00:00.000Z')] });
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.completeTask({ id: 'to-complete' }))
            .toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
        const completedAt = useTaskStore.getState()._tasksById.get('to-complete')?.completedAt;
        expect(completedAt).toEqual(expect.any(String));
        saveData.mockResolvedValue(undefined);
        expect(await host.completeTask({ id: 'to-complete' })).toEqual({ ok: true, value: { id: 'to-complete' } });
        expect(useTaskStore.getState()._tasksById.get('to-complete')?.completedAt).toBe(completedAt);
    });

    it('rejects every entry point until a real adapter, load, and write-safety gate succeed', async () => {
        setStorageAdapter(noopStorage);
        const host = createNativeHostContract();
        expect(host.getInboxWindow({ offset: 0, limit: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(host.getFocus({ limit: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(host.getProjects()).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(host.getProjectDetail({ projectId: 'x', offset: 0, limit: 1 }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(host.getFocusSectionWindow({ key: 'next', offset: 0, limit: 1, revision: 'x' }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(host.getTask({ id: 'x' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(host.getTaskEditor({ id: 'x' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.createInboxTask({ title: 'x', captureId: CAPTURE_ID }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.completeTask({ id: 'x' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.updateTask({ id: 'x', base: { title: 'x' }, patch: { title: 'y' } }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(saveData).not.toHaveBeenCalled();
        setStorageAdapter({ getData, saveData });
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        setStorageAdapter(noopStorage);
        expect(host.getInboxWindow({ offset: 0, limit: 1 }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    });

    it('keeps the contract closed when the initial store load fails', async () => {
        getData.mockRejectedValue(new Error('database unreadable'));
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: false })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(getData).not.toHaveBeenCalled();
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(useTaskStore.getState().error).toContain('database unreadable');
        expect(host.getInboxWindow({ offset: 0, limit: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.createInboxTask({ title: 'Must not save', captureId: CAPTURE_ID }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(saveData).not.toHaveBeenCalled();
    });

    it('acknowledges a lost completion reply without completing twice, after flushing pending work', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        saveData.mockClear();
        useTaskStore.setState({ _allTasks: [task('replay', '2026-09-01T00:00:00.000Z')] });
        expect(await host.completeTask({ id: 'replay' })).toEqual({ ok: true, value: { id: 'replay' } });
        const completedAt = useTaskStore.getState()._tasksById.get('replay')?.completedAt;
        expect(saveData).toHaveBeenCalledTimes(1);

        let releaseSave!: () => void;
        saveData.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseSave = resolve; }));
        expect((await useTaskStore.getState().updateTask('replay', { description: 'Pending edit' })).success).toBe(true);
        let replaySettled = false;
        const replay = host.completeTask({ id: 'replay' }).then((result) => {
            replaySettled = true;
            return result;
        });
        await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(2));
        expect(replaySettled).toBe(false);
        releaseSave();
        expect(await replay).toEqual({ ok: true, value: { id: 'replay' } });
        expect(useTaskStore.getState()._tasksById.get('replay')?.completedAt).toBe(completedAt);
    });

    it('closes an activated contract after a later store load error', async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        saveData.mockClear();
        getData.mockRejectedValue(new Error('database unreadable'));
        await expect(useTaskStore.getState().fetchData({ throwOnError: true })).rejects.toThrow('database unreadable');
        expect(host.getInboxWindow({ offset: 0, limit: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        useTaskStore.getState().setError(null);
        expect(await host.createInboxTask({ title: 'Must not save', captureId: CAPTURE_ID }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(saveData).not.toHaveBeenCalled();
    });

    it('fails closed when a task changes during the initial storage read', async () => {
        let releaseRead!: (data: unknown) => void;
        getData.mockImplementation(() => new Promise((resolve) => { releaseRead = resolve; }));
        const host = createNativeHostContract();
        const activating = host.activate({ writeSafetyReady: true });
        await vi.waitFor(() => expect(getData).toHaveBeenCalledTimes(1));
        expect((await useTaskStore.getState().addTask('Concurrent capture')).success).toBe(true);
        releaseRead({
            tasks: [task('stored', '2026-09-01T00:00:00.000Z')],
            projects: [], sections: [], areas: [], people: [], settings: {},
        });
        expect(await activating).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(host.getInboxWindow({ offset: 0, limit: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    });

    it('returns raw task editor fields, archived read-only state, and store-ordered selectable projects', async () => {
        const currentArchivedProject = project('current-archived', 'archived', 2);
        const host = createNativeHostContract();
        expect(host.getTaskEditor({ id: 'raw' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        getData.mockResolvedValue({
            tasks: [
                task('raw', '2026-09-01T00:00:00.000Z', {
                    title: '  stored title  ', description: 'stored notes', status: 'archived', priority: 'high',
                    projectId: currentArchivedProject.id, startTime: '2026-09-23T09:15:00-04:00', dueDate: '2026-09-30',
                }),
                task('missing-fields', '2026-09-01T00:00:00.000Z'),
                task('deleted-task', '2026-09-01T00:00:00.000Z', { deletedAt: '2026-09-02T00:00:00.000Z' }),
            ],
            projects: [
                currentArchivedProject,
                project('active-later', 'active', 1),
                project('active-first', 'active', 0),
                project('other-archived', 'archived', 3),
                project('deleted-project', 'active', -1, { deletedAt: '2026-09-02T00:00:00.000Z' }),
                project('completed-project', 'completed', 4),
            ],
            sections: [], areas: [], people: [], settings: {},
        });
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });

        const rawEditor = host.getTaskEditor({ id: 'raw' });
        expect(rawEditor).toEqual({
            ok: true,
            value: {
                version: 1,
                id: 'raw',
                fields: {
                    title: '  stored title  ', description: 'stored notes', status: 'archived', priority: 'high',
                    projectId: currentArchivedProject.id, startTime: '2026-09-23T09:15:00-04:00', dueDate: '2026-09-30',
                },
                projects: [
                    { id: 'current-archived', title: 'current-archived' },
                    { id: 'active-later', title: 'active-later' },
                    { id: 'active-first', title: 'active-first' },
                ],
                readOnly: true,
                statuses: ['inbox', 'next', 'waiting', 'someday', 'reference', 'done'],
                priorities: ['low', 'medium', 'high', 'urgent'],
            },
        });
        if (rawEditor.ok) expect(Object.keys(rawEditor.value.fields)).toEqual(NATIVE_HOST_EDITOR_FIELDS);
        expect(host.getTaskEditor({ id: 'missing-fields' })).toMatchObject({
            ok: true,
            value: { fields: {
                title: 'missing-fields', description: null, status: 'inbox', priority: null,
                projectId: null, startTime: null, dueDate: null,
            }, readOnly: false },
        });
        expect(host.getTaskEditor({ id: 'deleted-task' })).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
        expect(host.getTaskEditor({ id: '' })).toEqual({
            ok: false, error: { code: 'INVALID_INPUT', message: 'Task ID is required' },
        });
        expect(await host.updateTask({ id: '', base: {}, patch: {} })).toEqual({
            ok: false, error: { code: 'INVALID_INPUT', message: 'Task ID is required' },
        });
    });

    const editorFieldEdits: Array<{ field: keyof NativeEditableFields; value: unknown }> = [
        { field: 'title', value: '  Updated title  ' },
        { field: 'description', value: 'Updated notes' },
        { field: 'status', value: 'next' },
        { field: 'priority', value: 'urgent' },
        { field: 'projectId', value: 'assigned-project' },
        { field: 'startTime', value: '2026-10-02T09:15:00.000Z' },
        { field: 'dueDate', value: '2026-10-04' },
    ];

    it.each(editorFieldEdits)('persists $field only after its save is durable', async ({ field, value }) => {
        const host = await activateWith(
            [task('edit', '2026-09-01T00:00:00.000Z', { description: 'Old notes', priority: 'low' })],
            [project('assigned-project')],
        );
        const editor = host.getTaskEditor({ id: 'edit' });
        if (!editor.ok) throw new Error('Task editor did not load');
        const base = { [field]: editor.value.fields[field] } as Partial<NativeEditableFields>;
        const patch = { [field]: value } as Partial<NativeEditableFields>;
        let savedSnapshot: unknown;
        let releaseSave!: () => void;
        saveData.mockClear();
        saveData.mockImplementation((data: unknown) => {
            savedSnapshot = data;
            return new Promise<void>((resolve) => { releaseSave = resolve; });
        });

        let settled = false;
        const saving = host.updateTask({ id: 'edit', base, patch }).then((result) => {
            settled = true;
            return result;
        });
        await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
        expect(settled).toBe(false);
        releaseSave();
        expect(await saving).toEqual({ ok: true, value: { id: 'edit', changed: true } });

        const persistedTask = (savedSnapshot as { tasks: Task[] }).tasks.find(({ id }) => id === 'edit');
        expect(persistedTask?.[field as keyof Task]).toBe(value);
        if (field === 'dueDate') {
            getData.mockResolvedValue(savedSnapshot as never);
            await expect(useTaskStore.getState().fetchData({ throwOnError: true })).resolves.toBeUndefined();
            expect(host.getTaskEditor({ id: 'edit' })).toMatchObject({ ok: true, value: { fields: { dueDate: '2026-10-04' } } });
        }
    });

    it('clears descriptions the same way as the mobile task draft', async () => {
        const host = await activateWith([task('edit', '2026-09-01T00:00:00.000Z', { description: 'Old notes' })]);
        saveData.mockClear();
        expect(await host.updateTask({ id: 'edit', base: { description: 'Old notes' }, patch: { description: '' } }))
            .toEqual({ ok: true, value: { id: 'edit', changed: true } });
        const savedData = saveData.mock.calls.at(-1)?.[0] as { tasks: Task[] };
        expect(savedData.tasks.find(({ id }) => id === 'edit')?.description).toBeUndefined();
        expect(host.getTaskEditor({ id: 'edit' })).toMatchObject({ ok: true, value: { fields: { description: null } } });
        expect(await host.updateTask({ id: 'edit', base: { description: 'Old notes' }, patch: { description: null } }))
            .toEqual({ ok: true, value: { id: 'edit', changed: false } });
    });

    const invalidEditorPatches: Array<{
        name: string;
        base: Record<string, unknown>;
        patch: Record<string, unknown>;
        messageFields: string[];
    }> = [
        { name: 'unknown key', base: { unknown: 'before' }, patch: { unknown: 'after' }, messageFields: ['title'] },
        { name: 'base and patch key mismatch', base: { title: 'edit' }, patch: { description: 'changed' }, messageFields: ['title', 'description'] },
        { name: 'blank title', base: { title: 'edit' }, patch: { title: '  ' }, messageFields: ['title'] },
        { name: 'bad status', base: { status: 'inbox' }, patch: { status: 'invalid' }, messageFields: ['status'] },
        { name: 'archived status', base: { status: 'inbox' }, patch: { status: 'archived' }, messageFields: ['status'] },
        { name: 'bad priority', base: { priority: null }, patch: { priority: 'critical' }, messageFields: ['priority'] },
        { name: 'deleted project', base: { projectId: 'current' }, patch: { projectId: 'deleted' }, messageFields: ['projectId'] },
        { name: 'another archived project', base: { projectId: 'current' }, patch: { projectId: 'archived' }, messageFields: ['projectId'] },
        { name: 'malformed date', base: { dueDate: null }, patch: { dueDate: '2026-02-30' }, messageFields: ['dueDate'] },
        { name: 'datetime with invalid time fields', base: { dueDate: null }, patch: { dueDate: '2026-09-23T25:99' }, messageFields: ['dueDate'] },
        { name: 'datetime with a space separator', base: { dueDate: null }, patch: { dueDate: '2026-09-23 10:00' }, messageFields: ['dueDate'] },
        { name: 'natural-language date', base: { dueDate: null }, patch: { dueDate: 'tomorrow' }, messageFields: ['dueDate'] },
        { name: 'date without zero padding', base: { dueDate: null }, patch: { dueDate: '2026-9-3' }, messageFields: ['dueDate'] },
    ];

    it.each(invalidEditorPatches)('rejects $name without writing', async ({ name, base, patch, messageFields }) => {
        const initial = task('edit', '2026-09-01T00:00:00.000Z', { projectId: 'current', rev: 7 });
        const host = await activateWith([initial], [
            project('current'),
            project('deleted', 'active', 1, { deletedAt: '2026-09-02T00:00:00.000Z' }),
            project('archived', 'archived', 2),
        ]);
        saveData.mockClear();

        const result = await host.updateTask({ id: 'edit', base, patch } as never);
        expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        if (!result.ok) {
            if (name === 'base and patch key mismatch') {
                expect(result.error.message).toBe('base and patch fields must match: title, description');
            }
            for (const field of messageFields) expect(result.error.message).toContain(field);
            for (const [key, value] of Object.entries(patch)) {
                if (!NATIVE_HOST_EDITOR_FIELDS.includes(key as typeof NATIVE_HOST_EDITOR_FIELDS[number])) {
                    expect(result.error.message).not.toContain(key);
                }
                if (typeof value === 'string' && value.trim()) expect(result.error.message).not.toContain(value);
            }
        }
        expect(saveData).not.toHaveBeenCalled();
        expect(useTaskStore.getState()._tasksById.get('edit')?.rev).toBe(7);
    });

    it('rejects an empty patch without writing', async () => {
        const host = await activateWith([task('edit', '2026-09-01T00:00:00.000Z', { rev: 2 })]);
        saveData.mockClear();
        expect(await host.updateTask({ id: 'edit', base: {}, patch: {} })).toMatchObject({
            ok: false, error: { code: 'INVALID_INPUT' },
        });
        expect(saveData).not.toHaveBeenCalled();
        expect(useTaskStore.getState()._tasksById.get('edit')?.rev).toBe(2);
    });

    const referenceTaskFieldEdits: Array<{
        name: string;
        taskStatus: Task['status'];
        base: Partial<NativeEditableFields>;
        patch: Partial<NativeEditableFields>;
        field: 'priority' | 'startTime' | 'dueDate';
    }> = [
        {
            name: 'status reference with priority', taskStatus: 'next',
            base: { status: 'next', priority: null }, patch: { status: 'reference', priority: 'high' }, field: 'priority',
        },
        {
            name: 'status reference with due date', taskStatus: 'next',
            base: { status: 'next', dueDate: null }, patch: { status: 'reference', dueDate: '2026-09-30' }, field: 'dueDate',
        },
        {
            name: 'priority on an existing reference task', taskStatus: 'reference',
            base: { priority: null }, patch: { priority: 'high' }, field: 'priority',
        },
    ];

    it.each(referenceTaskFieldEdits)('rejects $name before the store can clear the field', async ({ taskStatus, base, patch, field }) => {
        const host = await activateWith([task('reference-edit', '2026-09-01T00:00:00.000Z', { status: taskStatus, rev: 11 })]);
        saveData.mockClear();

        const result = await host.updateTask({ id: 'reference-edit', base, patch });
        expect(result).toEqual({
            ok: false, error: { code: 'INVALID_INPUT', message: `${field} cannot be set while status is reference` },
        });
        expect(saveData).not.toHaveBeenCalled();
        expect(useTaskStore.getState()._tasksById.get('reference-edit')?.rev).toBe(11);
    });

    it('rejects updates to tasks in archived projects without writing', async () => {
        const host = await activateWith(
            [task('archived-project-task', '2026-09-01T00:00:00.000Z', { projectId: 'archived', rev: 12 })],
            [project('archived', 'archived')],
        );
        const revBefore = useTaskStore.getState()._tasksById.get('archived-project-task')?.rev;
        saveData.mockClear();

        expect(await host.updateTask({
            id: 'archived-project-task', base: { title: 'archived-project-task' }, patch: { title: 'Changed' },
        })).toEqual({
            ok: false,
            error: { code: 'INVALID_INPUT', message: 'Task is read-only while its project is archived' },
        });
        expect(saveData).not.toHaveBeenCalled();
        expect(useTaskStore.getState()._tasksById.get('archived-project-task')?.rev).toBe(revBefore);
    });

    it('accepts timezone datetimes and stores them unchanged', async () => {
        const value = '2026-09-23T10:00:00+05:30';
        const host = await activateWith([task('edit', '2026-09-01T00:00:00.000Z')]);

        expect(await host.updateTask({ id: 'edit', base: { dueDate: null }, patch: { dueDate: value } }))
            .toEqual({ ok: true, value: { id: 'edit', changed: true } });
        const savedData = saveData.mock.calls.at(-1)?.[0] as { tasks: Task[] };
        expect(savedData.tasks.find(({ id }) => id === 'edit')?.dueDate).toBe(value);
    });

    it('rejects a conflict on a patched field without overwriting it', async () => {
        const host = await activateWith([task('edit', '2026-09-01T00:00:00.000Z', { title: 'Original' })]);
        expect((await useTaskStore.getState().updateTask('edit', { title: 'Other writer' })).success).toBe(true);
        await flushPendingSave();
        const revAfterOtherWrite = useTaskStore.getState()._tasksById.get('edit')?.rev;
        saveData.mockClear();

        expect(await host.updateTask({ id: 'edit', base: { title: 'Original' }, patch: { title: 'My edit' } }))
            .toEqual({ ok: false, error: { code: 'STALE_REVISION', message: 'Task changed while editing: title' } });
        expect(useTaskStore.getState()._tasksById.get('edit')).toMatchObject({ title: 'Other writer', rev: revAfterOtherWrite });
        expect(saveData).not.toHaveBeenCalled();
    });

    it('keeps an unrelated writer change while applying the requested field', async () => {
        const host = await activateWith([task('edit', '2026-09-01T00:00:00.000Z', { title: 'Original', description: 'Old notes' })]);
        expect((await useTaskStore.getState().updateTask('edit', { description: 'Other notes' })).success).toBe(true);
        await flushPendingSave();

        expect(await host.updateTask({ id: 'edit', base: { title: 'Original' }, patch: { title: 'My edit' } }))
            .toEqual({ ok: true, value: { id: 'edit', changed: true } });
        expect(useTaskStore.getState()._tasksById.get('edit')).toMatchObject({ title: 'My edit', description: 'Other notes' });
    });

    it('acknowledges a repeated edit without a second store write', async () => {
        const host = await activateWith([task('edit', '2026-09-01T00:00:00.000Z', { title: 'Original' })]);
        const input = { id: 'edit', base: { title: 'Original' }, patch: { title: 'My edit' } };
        saveData.mockClear();
        expect(await host.updateTask(input)).toEqual({ ok: true, value: { id: 'edit', changed: true } });
        const revAfterFirstWrite = useTaskStore.getState()._tasksById.get('edit')?.rev;
        expect(await host.updateTask(input)).toEqual({ ok: true, value: { id: 'edit', changed: false } });
        expect(useTaskStore.getState()._tasksById.get('edit')?.rev).toBe(revAfterFirstWrite);
        expect(saveData).toHaveBeenCalledTimes(1);
    });

    it('creates one recurring follow-up through core and does not duplicate it on retry', async () => {
        const host = await activateWith([task('recurring', '2026-09-01T00:00:00.000Z', {
            status: 'next', recurrence: { rule: 'daily', strategy: 'fluid' }, dueDate: '2026-09-20',
        })]);
        const input = { id: 'recurring', base: { status: 'next' }, patch: { status: 'done' } };
        expect(await host.updateTask(input)).toEqual({ ok: true, value: { id: 'recurring', changed: true } });
        const afterFirst = useTaskStore.getState()._allTasks;
        const followUps = afterFirst.filter((item) => item.id !== 'recurring' && item.status !== 'done' && item.status !== 'archived');
        expect(afterFirst.find(({ id }) => id === 'recurring')?.completedAt).toEqual(expect.any(String));
        expect(followUps).toHaveLength(1);
        const completedRev = afterFirst.find(({ id }) => id === 'recurring')?.rev;

        expect(await host.updateTask(input)).toEqual({ ok: true, value: { id: 'recurring', changed: false } });
        expect(useTaskStore.getState()._allTasks).toHaveLength(2);
        expect(useTaskStore.getState()._allTasks.find(({ id }) => id === 'recurring')?.rev).toBe(completedRev);
    });

    it('reports a failed recurring save and retries it without another update or follow-up', async () => {
        const host = await activateWith([task('recurring', '2026-09-01T00:00:00.000Z', {
            status: 'next', recurrence: { rule: 'daily', strategy: 'fluid' }, dueDate: '2026-09-20',
        })]);
        const input = { id: 'recurring', base: { status: 'next' }, patch: { status: 'done' } };
        saveData.mockClear();
        saveData.mockRejectedValue(new Error('disk unavailable'));

        expect(await host.updateTask(input)).toMatchObject({
            ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' },
        });
        const completed = useTaskStore.getState()._tasksById.get('recurring');
        const revAfterFailure = completed?.rev;
        expect(useTaskStore.getState()._allTasks).toHaveLength(2);
        expect(useTaskStore.getState()._allTasks.filter((item) => item.id !== 'recurring' && item.status !== 'done' && item.status !== 'archived')).toHaveLength(1);

        saveData.mockResolvedValue(undefined);
        expect(await host.updateTask(input)).toEqual({ ok: true, value: { id: 'recurring', changed: false } });
        const savedData = saveData.mock.calls.at(-1)?.[0] as { tasks: Task[] };
        expect(savedData.tasks.find(({ id }) => id === 'recurring')?.status).toBe('done');
        expect(savedData.tasks.filter((item) => item.id !== 'recurring' && item.status !== 'done' && item.status !== 'archived'))
            .toHaveLength(1);
        expect(useTaskStore.getState()._allTasks).toHaveLength(2);
        expect(useTaskStore.getState()._tasksById.get('recurring')?.rev).toBe(revAfterFailure);
    });

    it('matches the mobile Focus core pipeline and carries Upcoming reveal dates', async () => {
        const now = new Date(2026, 8, 23, 10, 0);
        const tomorrow = formatLocalDate(new Date(2026, 8, 24));
        const tasks = [
            task('starred', '2026-09-01T00:00:00.000Z', { status: 'next', isFocusedToday: true }),
            task('due-today', '2026-09-02T00:00:00.000Z', { status: 'next', dueDate: formatLocalDate(now) }),
            task('later-today', '2026-09-03T00:00:00.000Z', { status: 'next', startTime: new Date(2026, 8, 23, 17).toISOString() }),
            task('review-due', '2026-09-04T00:00:00.000Z', { status: 'waiting', reviewAt: new Date(2026, 8, 22).toISOString() }),
            task('seq-first', '2026-09-05T00:00:00.000Z', { status: 'next', projectId: 'seq', order: 0 }),
            task('seq-second', '2026-09-06T00:00:00.000Z', { status: 'next', projectId: 'seq', order: 1 }),
            task('upcoming', '2026-09-07T00:00:00.000Z', { status: 'next', startTime: tomorrow, description: 'Notes' }),
            task('parked-someday', '2026-09-07T00:00:00.000Z', { status: 'next', projectId: 'someday' }),
            task('parked-archived', '2026-09-07T00:00:00.000Z', { status: 'next', projectId: 'archived' }),
            task('starred-parked', '2026-09-07T00:00:00.000Z', { status: 'next', projectId: 'someday', isFocusedToday: true }),
            task('done', '2026-09-08T00:00:00.000Z', { status: 'done' }),
            task('deleted', '2026-09-09T00:00:00.000Z', { status: 'next', deletedAt: '2026-09-10T00:00:00.000Z' }),
        ];
        const host = await activateWith(tasks, [
            project('seq', 'active', 0, { isSequential: true }),
            project('someday', 'someday'),
            project('archived', 'archived'),
        ]);
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const result = host.getFocus({ limit: 20 });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const state = useTaskStore.getState();
        const actionable = state.tasks.filter(isTaskActionable);
        const projectById = new Map(state.projects.map((item) => [item.id, item]));
        const resolvedAreaFilter = resolveAreaFilterSelection(undefined, state.areas);
        const visibleTasks = actionable.filter((item) => isTaskVisibleInArea(item, { projectById, resolvedAreaFilter }));
        const pools = focusDerivation.buildFocusPools({
            tasks: actionable, visibleTasks, projects: state.projects, criteria: undefined, now,
        });
        const lists = focusDerivation.deriveFocusTaskLists(pools, {
            now, projects: state.projects, sections: state.sections,
            sortBy: focusDerivation.DEFAULT_FOCUS_SORT_BY,
            prioritiesEnabled: resolveFeatureFlags(state.settings).priorities,
            sortOrder: undefined,
        });
        const direct = focusDerivation.buildFocusTaskSections(lists, getTranslator('en'));
        const scheduleByStartTime = splitTodayTasksByStartTime(lists.schedule, now);
        expect(result.value.sections.map(({ key, title, total, rows }) => ({ key, title, total, ids: rows.map(({ id }) => id) })))
            .toEqual(direct.map(({ key, title, items }) => ({
                key, title, total: items.length,
                ids: (key === 'schedule' ? [...scheduleByStartTime.ready, ...scheduleByStartTime.laterToday] : items).map(({ id }) => id),
            })));
        expect(result.value.sections.map(({ key, title }) => ({ key, title }))).toEqual([
            { key: 'focus', title: "Today's Focus" },
            { key: 'schedule', title: 'Today' },
            { key: 'reviewDue', title: 'Review Due' },
            { key: 'next', title: 'Next Actions' },
            { key: 'upcoming', title: 'Upcoming' },
        ]);
        const visibleIds = result.value.sections.flatMap(({ rows }) => rows.map(({ id }) => id));
        for (const id of ['seq-second', 'parked-someday', 'parked-archived', 'done', 'deleted']) expect(visibleIds).not.toContain(id);
        expect(result.value.sections.find(({ key }) => key === 'focus')?.rows.map(({ id }) => id)).toContain('starred-parked');
        expect(result.value.sections.find(({ key }) => key === 'next')?.rows.map(({ id }) => id)).toContain('seq-first');
        expect(result.value.sections.find(({ key }) => key === 'schedule')?.rows.map(({ id, laterToday }) => ({ id, laterToday })))
            .toEqual([{ id: 'due-today', laterToday: false }, { id: 'later-today', laterToday: true }]);
        const reveal = pools.upcoming.find(({ task: item }) => item.id === 'upcoming')?.appearsAt;
        expect(reveal).toBeInstanceOf(Date);
        expect(reveal && formatLocalDate(reveal)).toBe('2026-09-24');
        expect(result.value.sections.find(({ key }) => key === 'upcoming')?.rows[0])
            .toMatchObject({ id: 'upcoming', revealDate: '2026-09-24', hasNotes: true, laterToday: false });
        expect(result.value.sections.filter(({ key }) => key !== 'schedule').flatMap(({ rows }) => rows.every(({ laterToday }) => !laterToday)))
            .toEqual([true, true, true, true]);
        expect(result.value.sections.filter(({ key }) => key !== 'upcoming').flatMap(({ rows }) => rows.map(({ revealDate }) => revealDate)))
            .toEqual(Array(visibleIds.length - 1).fill(null));
    });

    it('translates Focus titles and invalidates the English revision after a language change', async () => {
        const now = new Date(2026, 8, 23, 10);
        const host = await activateWith([
            task('starred', '2026-09-01T00:00:00.000Z', { status: 'next', isFocusedToday: true }),
            task('upcoming', '2026-09-01T00:00:00.000Z', { status: 'next', startTime: formatLocalDate(new Date(2026, 8, 24)) }),
        ]);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(now);
        const english = host.getFocus({ limit: 10 });
        if (!english.ok) throw new Error('English Focus query failed');
        expect(await host.setLanguage({ storedLanguage: 'zh', systemLocale: null }))
            .toEqual({ ok: true, value: { language: 'zh' } });
        const chinese = host.getFocus({ limit: 10 });
        if (!chinese.ok) throw new Error('Chinese Focus query failed');
        expect(chinese.value.sections.map(({ key, title }) => ({ key, title }))).toEqual([
            { key: 'focus', title: zhHans['agenda.todaysFocus'] },
            { key: 'schedule', title: zhHans['focus.schedule'] },
            { key: 'reviewDue', title: zhHans['agenda.reviewDue'] },
            { key: 'next', title: zhHans['focus.nextActions'] },
            { key: 'upcoming', title: zhHans['agenda.upcoming'] },
        ]);
        expect(chinese.value.revision).not.toBe(english.value.revision);
        expect(host.getFocusSectionWindow({ key: 'next', offset: 0, limit: 1, revision: english.value.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });

    it('follows core ordering with priorities enabled and disabled', async () => {
        const now = new Date(2026, 8, 23, 10);
        const items = [
            task('urgent-later-created', '2026-09-02T00:00:00.000Z', { status: 'next', dueDate: formatLocalDate(now), priority: 'urgent' }),
            task('low-earlier-created', '2026-09-01T00:00:00.000Z', { status: 'next', dueDate: formatLocalDate(now), priority: 'low' }),
        ];
        const host = await activateWith(items);
        vi.useFakeTimers();
        vi.setSystemTime(now);
        for (const priorities of [true, false]) {
            useTaskStore.setState({ settings: { features: { priorities } } });
            const result = host.getFocus({ limit: 10 });
            if (!result.ok) throw new Error('Focus query failed');
            const state = useTaskStore.getState();
            const active = state.tasks.filter(isTaskActionable);
            const pools = focusDerivation.buildFocusPools({ tasks: active, visibleTasks: active, projects: state.projects, criteria: undefined, now });
            const direct = focusDerivation.deriveFocusTaskLists(pools, {
                now, projects: state.projects, sections: state.sections, sortBy: focusDerivation.DEFAULT_FOCUS_SORT_BY,
                prioritiesEnabled: resolveFeatureFlags(state.settings).priorities, sortOrder: undefined,
            });
            expect(result.value.sections.find(({ key }) => key === 'schedule')?.rows.map(({ id }) => id))
                .toEqual(direct.schedule.map(({ id }) => id));
            expect(result.value.sections.find(({ key }) => key === 'schedule')?.rows.map(({ id }) => id))
                .toEqual(priorities ? ['urgent-later-created', 'low-earlier-created'] : ['low-earlier-created', 'urgent-later-created']);
        }
    });

    it('bounds initial Focus rows and pages a section beyond 100 rows', async () => {
        const host = await activateWith(Array.from({ length: 215 }, (_, index) =>
            task(`next-${index}`, '2026-09-01T00:00:00.000Z', { status: 'next' })));
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 8, 23, 10));
        const first = host.getFocus({ limit: 50 });
        if (!first.ok) throw new Error('Focus query failed');
        expect(first.value.sections.find(({ key }) => key === 'next')).toMatchObject({ total: 215, rows: expect.any(Array) });
        expect(first.value.sections.find(({ key }) => key === 'next')?.rows).toHaveLength(50);
        const ids: string[] = [];
        for (const offset of [0, 100, 200]) {
            const page = host.getFocusSectionWindow({ key: 'next', offset, limit: 100, revision: first.value.revision });
            if (!page.ok) throw new Error('Focus page failed');
            expect(page.value).toMatchObject({ version: 1, revision: first.value.revision, key: 'next', total: 215 });
            ids.push(...page.value.rows.map(({ id }) => id));
        }
        expect(ids).toHaveLength(215);
        expect(new Set(ids).size).toBe(215);
        expect(host.getFocus({ limit: 0 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(host.getFocus({ limit: NATIVE_HOST_MAX_WINDOW + 1 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        for (const input of [
            { key: 'bad', offset: 0, limit: 1 },
            { key: 'focus', offset: 0, limit: 1 },
            { key: 'next', offset: -1, limit: 1 },
            { key: 'next', offset: 0.5, limit: 1 },
            { key: 'next', offset: 0, limit: 0 },
            { key: 'next', offset: 0, limit: NATIVE_HOST_MAX_WINDOW + 1 },
        ]) {
            expect(host.getFocusSectionWindow({ ...input, revision: first.value.revision } as never))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
    });

    it('invalidates Focus pages after store edits, minute ticks, and local midnight', async () => {
        const now = new Date(2026, 8, 23, 23, 59, 0);
        const tomorrow = formatLocalDate(new Date(2026, 8, 24));
        const host = await activateWith([
            task('editable', '2026-09-01T00:00:00.000Z', { status: 'next' }),
            task('reveals-tomorrow', '2026-09-01T00:00:00.000Z', { status: 'next', startTime: tomorrow }),
        ]);
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const first = host.getFocus({ limit: 10 });
        if (!first.ok) throw new Error('Focus query failed');
        expect(first.value.sections.find(({ key }) => key === 'upcoming')?.rows.map(({ id }) => id)).toContain('reveals-tomorrow');
        useTaskStore.setState({ _allTasks: [
            task('editable', '2026-09-01T00:00:00.000Z', { status: 'next', title: 'Edited' }),
            task('reveals-tomorrow', '2026-09-01T00:00:00.000Z', { status: 'next', startTime: tomorrow }),
        ] });
        const edited = host.getFocus({ limit: 10 });
        if (!edited.ok) throw new Error('Focus query failed');
        expect(edited.value.revision).not.toBe(first.value.revision);
        expect(host.getFocusSectionWindow({ key: 'next', offset: 0, limit: 1, revision: first.value.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        vi.setSystemTime(new Date(2026, 8, 24, 0, 0, 0));
        const midnight = host.getFocus({ limit: 10 });
        if (!midnight.ok) throw new Error('Focus query failed');
        expect(midnight.value.revision).not.toBe(edited.value.revision);
        expect(midnight.value.sections.some(({ key }) => key === 'upcoming')).toBe(false);
        expect(midnight.value.sections.find(({ key }) => key === 'schedule')?.rows.map(({ id }) => id)).toContain('reveals-tomorrow');
        vi.setSystemTime(new Date(2026, 8, 24, 0, 1, 0));
        const minute = host.getFocus({ limit: 10 });
        if (!minute.ok) throw new Error('Focus query failed');
        expect(minute.value.revision).not.toBe(midnight.value.revision);
    });

    it('reuses the core Focus derivation for one revision', async () => {
        const host = await activateWith([task('next', '2026-09-01T00:00:00.000Z', { status: 'next' })]);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 8, 23, 10));
        const derive = vi.spyOn(focusDerivation, 'deriveFocusTaskLists');
        const first = host.getFocus({ limit: 1 });
        if (!first.ok) throw new Error('Focus query failed');
        expect(host.getFocus({ limit: 1 })).toEqual(first);
        expect(host.getFocusSectionWindow({ key: 'next', offset: 0, limit: 1, revision: first.value.revision }).ok).toBe(true);
        expect(derive).toHaveBeenCalledTimes(1);
    });

    describe('task row meta', () => {
        const NOW = new Date(2026, 8, 23, 10, 0);
        const sections: Section[] = [{
            id: 's-1', projectId: 'p-seq', title: 'Phase 1', order: 0,
            createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
        }];
        const activateMeta = async (settings: AppSettings) => {
            getData.mockResolvedValue({
                tasks: [],
                projects: [
                    project('p-seq', 'active', 0, { title: 'Launch', areaId: 'a-work', isSequential: true }),
                    project('p-due', 'active', 6, { title: 'Taxes', areaId: 'a-work', dueDate: '2026-09-20' }),
                    project('p-review', 'active', 1, { title: 'Garden', reviewAt: '2026-09-20T09:00:00' }),
                    project('p-review-early', 'active', 2, { title: 'Budget', reviewAt: '2026-09-10' }),
                    project('p-review-later', 'active', 3, { title: 'Travel', reviewAt: '2026-09-30' }),
                    project('p-review-archived', 'archived', 4, { reviewAt: '2026-09-10' }),
                    project('p-review-deleted', 'active', 5, { reviewAt: '2026-09-10', deletedAt: '2026-09-11T00:00:00.000Z' }),
                ],
                sections,
                areas: [area('a-work', 'Work', 0, { color: '#22c55e' })],
                people: [],
                settings,
            });
            const host = createNativeHostContract();
            expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
            // Set after the load, whose migrations would promote a dated Inbox task.
            useTaskStore.setState({
                _allTasks: [
                    task('inbox-due', '2026-09-02T10:00:00', {
                        dueDate: '2026-09-21', contexts: ['@home', '@phone'], tags: ['#bills'],
                        checklist: [{ id: 'c1', title: 'One', isCompleted: true }, { id: 'c2', title: 'Two', isCompleted: false }],
                    }),
                    task('seq-first', '2026-09-03T10:00:00', {
                        status: 'next', projectId: 'p-seq', sectionId: 's-1', order: 0, startTime: '2026-09-22T09:00',
                    }),
                    task('seq-second', '2026-09-04T10:00:00', { status: 'next', projectId: 'p-seq', order: 1 }),
                    task('boosted', '2026-09-05T10:00:00', { status: 'next', projectId: 'p-due' }),
                ],
            });
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(NOW);
            return host;
        };
        // What the mobile row computes with the date configuration its root layout applies.
        const mobileMeta = (id: string, settings: AppSettings, language: Language, systemLocale: string | null, options = {}) => {
            const state = useTaskStore.getState();
            const rowTask = state._allTasks.find((candidate) => candidate.id === id)!;
            return buildTaskRowMeta({
                ...options,
                task: rowTask,
                lookup: resolveTaskRowLookup(rowTask, state.projects, state.areas, state._sectionsById),
                features: resolveTaskRowFeatures(state.settings),
                language,
                dateFormatting: {
                    language: settings.language || language,
                    dateFormat: settings.dateFormat,
                    calendarSystem: settings.calendarSystem,
                    timeFormat: settings.timeFormat,
                    systemLocale,
                },
                t: getTranslator(language),
                now: NOW,
            });
        };
        afterEach(() => configureDateFormatting());

        it('formats every row with the user date settings and language, with each view like mobile', async () => {
            const settings: AppSettings = {
                language: 'de', dateFormat: 'dmy', timeFormat: '24h',
                appearance: { showTaskAge: true },
            };
            const host = await activateMeta(settings);
            expect(await host.setLanguage({ storedLanguage: 'de', systemLocale: 'de-DE' })).toMatchObject({ ok: true });
            // Rows format with the stored settings, whatever the process-wide configuration is.
            configureDateFormatting({ language: 'fa', dateFormat: 'ymd', calendarSystem: 'jalali', systemLocale: 'fa-IR' });

            const inbox = host.getInboxWindow({ offset: 0, limit: 10 });
            if (!inbox.ok) throw new Error('Inbox query failed');
            const inboxMeta = inbox.value.rows[0].meta;
            expect(inboxMeta).toEqual(mobileMeta('inbox-due', settings, 'de', 'de-DE', { hideChecklistProgress: true }));
            expect(inboxMeta.parts).toEqual([
                { kind: 'context', text: '@home', overflowCount: 1, detail: false },
                { kind: 'tag', text: '#bills', overflowCount: 0, detail: true },
                { kind: 'due', text: '21.09.2026', tone: 'overdue', detail: false },
            ]);
            expect(inboxMeta).toMatchObject({ ageLabel: '3 weeks old', statusLabel: 'Eingang', canFocus: true });

            const detail = host.getProjectDetail({ projectId: 'p-seq', offset: 0, limit: 10 });
            if (!detail.ok) throw new Error('Project detail failed');
            const firstRow = detail.value.items.find((item) => item.type === 'task' && item.row.id === 'seq-first');
            if (firstRow?.type !== 'task') throw new Error('Missing project row');
            expect(firstRow.row.meta).toEqual(mobileMeta('seq-first', settings, 'de', 'de-DE', {
                hideProjectMeta: true, sequenceCue: 'available', sequenceLabel: getTranslator('de')('projects.availableNextAction'),
            }));
            expect(firstRow.row.meta.parts.map(({ kind }) => kind)).toEqual(['start']);
            expect(firstRow.row.meta.parts[0].text).toBe(`${getTranslator('de')('taskEdit.startDateLabel')}: 22.09.2026 09:00`);
            expect(firstRow.row.meta.accessibilityLabel).toContain(getTranslator('de')('projects.availableNextAction'));

            const focus = host.getFocus({ limit: 10 });
            if (!focus.ok) throw new Error('Focus query failed');
            const focusRows = focus.value.sections.flatMap(({ rows }) => rows);
            const deadline = tFallback(getTranslator('de'), 'focus.projectOverdue', 'Project overdue');
            expect(focusRows.find(({ id }) => id === 'boosted')?.meta)
                .toEqual(mobileMeta('boosted', settings, 'de', 'de-DE', { projectDeadlineLabel: deadline }));
            expect(focusRows.find(({ id }) => id === 'boosted')?.meta.parts).toEqual([
                { kind: 'project', text: 'Taxes', projectId: 'p-due', dotColor: '#22c55e', detail: false },
                { kind: 'projectDeadline', text: deadline, detail: false },
            ]);
            expect(focusRows.find(({ id }) => id === 'seq-first')?.meta)
                .toEqual(mobileMeta('seq-first', settings, 'de', 'de-DE'));
            expect(focusRows.find(({ id }) => id === 'seq-first')?.meta.parts[0])
                .toEqual({ kind: 'project', text: 'Launch · Phase 1', projectId: 'p-seq', dotColor: '#22c55e', detail: false });
        });

        it('refreshes Inbox and project pages when settings, language, or the local day change', async () => {
            const host = await activateMeta({});
            const inbox = () => {
                const result = host.getInboxWindow({ offset: 0, limit: 1 });
                if (!result.ok) throw new Error('Inbox query failed');
                return result.value;
            };
            const project = () => {
                const result = host.getProjectDetail({ projectId: 'p-seq', offset: 0, limit: 1 });
                if (!result.ok) throw new Error('Project detail failed');
                return result.value;
            };
            const focus = () => {
                const result = host.getFocus({ limit: 10 });
                if (!result.ok) throw new Error('Focus query failed');
                return result.value;
            };
            const dueText = () => inbox().rows[0].meta.parts.find(({ kind }) => kind === 'due')?.text;
            const first = { inbox: inbox(), project: project(), focus: focus() };
            expect(dueText()).toBe('09/21/2026');
            expect(inbox().revision).toBe(first.inbox.revision);

            useTaskStore.setState({ settings: { dateFormat: 'ymd' } });
            const ymd = { inbox: inbox(), project: project(), focus: focus() };
            expect(dueText()).toBe('2026-09-21');
            expect(ymd.inbox.revision).not.toBe(first.inbox.revision);
            expect(ymd.project.revision).not.toBe(first.project.revision);
            expect(ymd.focus.revision).not.toBe(first.focus.revision);
            expect(host.getInboxWindow({ offset: 1, limit: 1, revision: first.inbox.revision }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });

            expect(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-GB' })).toMatchObject({ ok: true });
            const british = { inbox: inbox(), project: project() };
            expect(british.inbox.revision).not.toBe(ymd.inbox.revision);
            expect(british.project.revision).not.toBe(ymd.project.revision);

            vi.setSystemTime(new Date(2026, 8, 24, 0, 0, 1));
            const tomorrow = { inbox: inbox(), project: project() };
            expect(tomorrow.inbox.revision).not.toBe(british.inbox.revision);
            expect(tomorrow.project.revision).not.toBe(british.project.revision);
            expect(host.getProjectDetail({ projectId: 'p-seq', offset: 1, limit: 1, revision: british.project.revision }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        });

        it('refreshes Inbox and project pages when a timed due date passes within the day', async () => {
            const host = await activateMeta({});
            useTaskStore.setState({ _allTasks: [
                task('inbox-timed', '2026-09-20T10:00:00', { dueDate: '2026-09-23T10:01' }),
                task('project-timed', '2026-09-20T10:00:00', { status: 'next', projectId: 'p-seq', dueDate: '2026-09-23T10:01' }),
            ] });
            const read = () => {
                const inbox = host.getInboxWindow({ offset: 0, limit: 1 });
                const project = host.getProjectDetail({ projectId: 'p-seq', offset: 0, limit: 10 });
                if (!inbox.ok || !project.ok) throw new Error('Query failed');
                const projectRow = project.value.items.find((item) => item.type === 'task' && item.row.id === 'project-timed');
                return {
                    inbox: inbox.value,
                    project: project.value,
                    tones: [inbox.value.rows[0].meta, projectRow?.type === 'task' ? projectRow.row.meta : null]
                        .map((meta) => meta?.parts.find((part) => part.kind === 'due')),
                };
            };
            const before = read();
            expect(before.tones).toMatchObject([{ tone: 'dueSoon' }, { tone: 'dueSoon' }]);

            vi.setSystemTime(new Date(2026, 8, 23, 10, 2, 0));
            const after = read();
            expect(after.tones).toMatchObject([{ tone: 'overdue' }, { tone: 'overdue' }]);
            expect(after.inbox.revision).not.toBe(before.inbox.revision);
            expect(after.project.revision).not.toBe(before.project.revision);
            expect(host.getInboxWindow({ offset: 1, limit: 1, revision: before.inbox.revision }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(host.getProjectDetail({ projectId: 'p-seq', offset: 1, limit: 1, revision: before.project.revision }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });

            vi.setSystemTime(new Date(2026, 8, 23, 10, 2, 59));
            expect(read().inbox.revision).toBe(after.inbox.revision);
        });

        it('lists Focus review projects like mobile: due, live, not archived, earliest first', async () => {
            const host = await activateMeta({});
            const focus = host.getFocus({ limit: 10 });
            if (!focus.ok) throw new Error('Focus query failed');
            const state = useTaskStore.getState();
            expect(focus.value.reviewProjects.map(({ id }) => id)).toEqual(['p-review-early', 'p-review']);
            expect(focus.value.reviewProjects.map(({ id }) => id))
                .toEqual(focusDerivation.getReviewDueProjects(state.projects, NOW).map(({ id }) => id));
            expect(focus.value.reviewProjects[1]).toEqual({
                id: 'p-review', title: 'Garden', status: 'active', isFocused: false, color: '#123456',
                activeTaskCount: 0, nextActionId: null, nextActionTitle: null, focusedWithoutNextAction: false,
                reviewDateLabel: '09/20/2026',
            });
        });
    });

    it('queries 5,000 tasks and serves the same revision from cache', async () => {
        const host = await activateWith(Array.from({ length: 5_000 }, (_, index) =>
            task(`next-${index}`, '2026-09-01T00:00:00.000Z', { status: 'next' })));
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 8, 23, 10));
        const derive = vi.spyOn(focusDerivation, 'deriveFocusTaskLists');
        const start = performance.now();
        const first = host.getFocus({ limit: 50 });
        const firstMs = performance.now() - start;
        const cachedStart = performance.now();
        const second = host.getFocus({ limit: 50 });
        const cachedMs = performance.now() - cachedStart;
        console.info(`native Focus 5,000 tasks: first ${firstMs.toFixed(1)} ms, cached ${cachedMs.toFixed(1)} ms`);
        expect(first.ok).toBe(true);
        expect(second).toEqual(first);
        expect(derive).toHaveBeenCalledTimes(1);
    });
});
