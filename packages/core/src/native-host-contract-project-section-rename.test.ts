import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectSectionRenameMethods, type NativePreparedProjectSectionRename,
    type NativeProjectSectionRenameRequest } from './native-host-contract-project-section-rename';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Project, Section, Task } from './types';

const NOW = '2026-09-28T16:00:00.000Z';
const ID = '2cfd7b53-1c9d-4596-9b28-582a7307a781';
const project = (id = 'target', overrides: Partial<Project> = {}): Project => ({
    id, title: 'Project', status: 'active', color: '#3b82f6', order: 0, tagIds: ['#work'],
    rev: 3, revBy: 'old-device', createdAt: NOW, updatedAt: NOW, ...overrides,
});
const section = (id = 'section', overrides: Partial<Section> = {}): Section => ({
    id, projectId: 'target', title: 'Old title', description: 'Keep raw details', order: 2,
    isCollapsed: true, rev: 4, revBy: 'old-device', createdAt: NOW, updatedAt: NOW, ...overrides,
});
const task = (): Task => ({ id: 'linked-task', projectId: 'target', sectionId: 'section',
    title: 'Keep task', status: 'next', tags: [], contexts: [], rev: 2, revBy: 'old-device',
    createdAt: NOW, updatedAt: NOW });

async function open(initial: Partial<AppData> = {}, failing?: () => boolean) {
    await flushPendingSave(); resetForTests();
    let data: AppData = { tasks: [task()], projects: [project()], sections: [section()], areas: [], people: [],
        settings: { deviceId: 'rename-device' }, ...initial };
    let saves = 0;
    setStorageAdapter({ getData: async () => data, saveData: async (next) => {
        if (failing?.()) throw new Error('disk unavailable');
        data = structuredClone(next); saves++;
    } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    const methods = createProjectSectionRenameMethods({ readiness: () => ({ ok: true, value: null }),
        save: async () => {
            try { await flushPendingSave(); return { ok: true as const, value: null }; }
            catch (error) { return { ok: false as const, error: { code: 'SAVE_FAILED' as const,
                message: error instanceof Error ? error.message : String(error) } }; }
        }, revision: () => 'stable-revision' });
    const request = (title = '  New title  '): NativeProjectSectionRenameRequest => {
        const options = methods.getProjectSectionRenameOptions({ projectId: 'target', sectionId: 'section' });
        if (!options.ok) throw new Error(JSON.stringify(options.error));
        return { requestId: ID, projectId: 'target', sectionId: 'section', title,
            expected: options.value.token };
    };
    const prepare = (input = request()): NativePreparedProjectSectionRename => {
        const outcome = methods.prepareProjectSectionRename(input);
        if (!outcome.ok || outcome.value.kind !== 'prepared') throw new Error(JSON.stringify(outcome));
        return outcome.value.prepared;
    };
    return { methods, request, prepare, data: () => data, saves: () => saves };
}

afterEach(async () => { vi.useRealTimers(); await flushPendingSave(); resetForTests(); });

describe('prepared native Project Section rename', () => {
    it('matches RN title-only update, trims, permits duplicate titles, and leaves other rows untouched', async () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
        const sibling = section('sibling', { title: 'New title', order: 5 });
        const initial = { sections: [section(), sibling], tasks: [task()],
            projects: [project(), project('other')] };
        const { request, prepare } = await open(initial);
        const input = request();
        const planned = prepare(input);
        expect(planned).toMatchObject({ version: 1, result: { id: 'section', projectId: 'target' },
            effect: { section: { after: { title: 'New title', description: 'Keep raw details',
                order: 2, isCollapsed: true, rev: 5, revBy: 'rename-device', updatedAt: NOW } } } });
        expect((await useTaskStore.getState().updateSection('section', { title: 'New title' })).success).toBe(true);
        expect(useTaskStore.getState()._allSections[0]).toEqual(planned.effect.section.after);

        const native = await open(initial);
        const nativePlanned = native.prepare(input);
        const before = useTaskStore.getState();
        const unchanged = { tasks: structuredClone(before._allTasks),
            projects: structuredClone(before._allProjects), sibling: structuredClone(before._allSections[1]) };
        expect(await native.methods.commitPreparedProjectSectionRename({ request: input, prepared: nativePlanned }))
            .toEqual({ ok: true, value: { id: 'section', projectId: 'target' } });
        expect(native.data().sections[0]).toEqual(nativePlanned.effect.section.after);
        expect(native.data().sections[1]).toEqual(unchanged.sibling);
        expect(native.data().tasks).toEqual(unchanged.tasks);
        expect(native.data().projects).toEqual(unchanged.projects);
        expect(native.saves()).toBe(1);
    });

    it('returns a true no-op only with the exact live token and existing trimmed title', async () => {
        const { methods, request, saves } = await open();
        const input = request('  Old title  ');
        expect(methods.prepareProjectSectionRename(input)).toEqual({ ok: true,
            value: { kind: 'noop', result: { id: 'section', projectId: 'target' } } });
        expect(useTaskStore.getState()._allSections[0].rev).toBe(4);
        expect(saves()).toBe(0);
        useTaskStore.setState({ _allSections: [section('section', { rev: 5 })] });
        expect(methods.prepareProjectSectionRename(input))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(0);
    });

    it('reads an archived historical token but refuses its edit', async () => {
        const archivedAt = '2026-09-20T00:00:00.000Z';
        const { methods, saves } = await open({ projects: [project('target', { status: 'archived' })],
            sections: [section('section', { deletedAt: archivedAt, projectArchivedAt: archivedAt })] });
        const options = methods.getProjectSectionRenameOptions({ projectId: 'target', sectionId: 'section' });
        expect(options).toMatchObject({ ok: true, value: { revision: 'stable-revision',
            project: { id: 'target', status: 'archived' }, section: { id: 'section', title: 'Old title' },
            canRename: false, token: { deletedAt: archivedAt, projectArchivedAt: archivedAt } } });
        if (!options.ok) throw new Error('read failed');
        const request = { requestId: ID, projectId: 'target', sectionId: 'section',
            title: 'New title', expected: options.value.token };
        expect(methods.prepareProjectSectionRename(request))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(0);
    });

    it('rejects missing, deleted, purged, and wrong-parent targets', async () => {
        const { methods, request, saves } = await open();
        const input = request();
        const baseline = useTaskStore.getState();
        const conflicts = [
            { _allProjects: [] },
            { _allProjects: [project('target', { deletedAt: NOW })] },
            { _allProjects: [project('target', { purgedAt: NOW })] },
            { _allProjects: [project('target', { status: 'archived' as const })] },
            { _allSections: [] },
            { _allSections: [section('section', { deletedAt: NOW })] },
            { _allSections: [section('section', { projectId: 'other' })] },
        ];
        for (const conflict of conflicts) {
            useTaskStore.setState({ _allProjects: baseline._allProjects, _allSections: baseline._allSections });
            useTaskStore.setState(conflict);
            expect(methods.prepareProjectSectionRename(input))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        useTaskStore.setState({ _allProjects: baseline._allProjects, _allSections: baseline._allSections });
        expect(methods.getProjectSectionRenameOptions({ projectId: 'other', sectionId: 'section' }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(0);
    });

    it('preserves optional legacy nulls and refuses stale parent or Section data on first apply', async () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
        const rawParent = project('target', { startDate: null as never, supportNotes: null as never });
        const rawSection = section('section', { description: null as never, isCollapsed: null as never,
            projectArchivedAt: null as never });
        const { methods, request, prepare, data, saves } = await open({ projects: [rawParent], sections: [rawSection] });
        useTaskStore.setState({ _allProjects: [rawParent], _allSections: [rawSection] });
        const input = request();
        const planned = prepare(input);
        expect(planned.effect.section.before).toMatchObject({ description: null, isCollapsed: null,
            projectArchivedAt: null });
        expect(planned.effect.section.after).toMatchObject({ description: null, isCollapsed: null,
            projectArchivedAt: null });
        expect(await methods.commitPreparedProjectSectionRename({ request: input, prepared: planned }))
            .toMatchObject({ ok: true });
        expect(data().sections[0].description).toBeNull();
        expect(data().projects[0]).toEqual(rawParent);
        const count = saves();
        useTaskStore.setState({ _allSections: [rawSection], _allProjects: [project('target', { title: 'Changed' })] });
        expect(await methods.commitPreparedProjectSectionRename({ request: input, prepared: planned }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        useTaskStore.setState({ _allProjects: [rawParent], _allSections: [section('section', { description: 'Changed' })] });
        expect(await methods.commitPreparedProjectSectionRename({ request: input, prepared: planned }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(count);
    });

    it('accepts a complete after-row receipt before later parent mutation, never a partial receipt', async () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
        const { methods, request, prepare, saves } = await open();
        const input = request();
        const planned = prepare(input);
        expect(await methods.commitPreparedProjectSectionRename({ request: input, prepared: planned }))
            .toMatchObject({ ok: true });
        const count = saves();
        useTaskStore.setState({ _allProjects: [project('target', { title: 'Later', status: 'archived',
            deletedAt: NOW })] });
        expect(await methods.commitPreparedProjectSectionRename({ request: input, prepared: planned }))
            .toEqual({ ok: true, value: planned.result });
        expect(saves()).toBe(count);
        for (const partial of [
            { ...planned.effect.section.after, rev: 9 },
            { ...planned.effect.section.after, deletedAt: NOW },
            { ...planned.effect.section.after, description: 'Later' },
        ]) {
            useTaskStore.setState({ _allSections: [partial] });
            expect(await methods.commitPreparedProjectSectionRename({ request: input, prepared: planned }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        expect(saves()).toBe(count);
    });

    it('retains frozen revision, clock, and initialized device through failed save and exact retry', async () => {
        let failed = true;
        const first = await open({ settings: {} }, () => failed);
        useTaskStore.setState({ settings: {} });
        const input = first.request();
        const planned = first.prepare(input);
        expect(planned.deviceIdBefore).toBeNull();
        expect(planned.deviceIdToInitialize).toBeTruthy();
        expect(await first.methods.commitPreparedProjectSectionRename({ request: input, prepared: planned }))
            .toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(first.data().sections[0].title).toBe('Old title');
        failed = false;
        expect(await first.methods.commitPreparedProjectSectionRename({ request: input, prepared: planned }))
            .toEqual({ ok: true, value: planned.result });
        expect(first.data().sections[0]).toEqual(planned.effect.section.after);
        expect(first.data().settings.deviceId).toBe(planned.deviceIdToInitialize);
        const count = first.saves();
        useTaskStore.setState({ settings: {} });
        expect(await first.methods.commitPreparedProjectSectionRename({ request: input, prepared: planned }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(first.saves()).toBe(count);
    });

    it('rejects malformed requests, forged envelopes and deltas before storage', async () => {
        const { methods, request, prepare, saves } = await open();
        const input = request();
        const planned = prepare(input);
        for (const malformed of [
            { ...input, title: '   ' }, { ...input, title: 'x'.repeat(100_001) },
            { ...input, requestId: ID.toUpperCase() }, { ...input, sectionId: 'x'.repeat(501) },
            { ...input, extra: true }, { ...input, expected: { ...input.expected, order: 0, surprise: true } },
        ]) expect(methods.prepareProjectSectionRename(malformed as NativeProjectSectionRenameRequest))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const mutations: Array<(value: NativePreparedProjectSectionRename) => void> = [
            (p) => { p.version = 2 as never; },
            (p) => { p.request.sectionId = 'other'; },
            (p) => { p.result.projectId = 'other'; },
            (p) => { p.scope.project.status = 'archived'; },
            (p) => { p.effect.section.before.order = 77; },
            (p) => { p.effect.section.after.description = 'forged'; },
            (p) => { p.effect.section.after.rev = 99; },
            (p) => { p.effect.section.after.updatedAt = '2020-01-01T00:00:00.000Z'; },
            (p) => { p.preparedAt = 'not a timestamp'; },
            (p) => { (p.effect.section.after as Section & { extra?: string }).extra = 'forged'; },
        ];
        for (const mutate of mutations) {
            const forged = structuredClone(planned);
            mutate(forged);
            expect(methods.validatePreparedProjectSectionRename({ request: input, prepared: forged }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        expect(methods.validatePreparedProjectSectionRename({ request: input, prepared: planned }))
            .toEqual({ ok: true, value: planned.result });
        expect(methods.probeProjectSectionRenameOutcome(input))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(0);
    });

    it('refuses oversized read token without truncation or a write', async () => {
        const { methods, saves } = await open({ sections: [section('section', { description: 'x'.repeat(2_100_000) })] });
        expect(methods.getProjectSectionRenameOptions({ projectId: 'target', sectionId: 'section' }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saves()).toBe(0);
    });
});
