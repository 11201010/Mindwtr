import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectDateMethods, type NativeProjectDateField,
    type NativeProjectDateRequest } from './native-host-contract-project-date';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { PROJECT_SQLITE_COLUMNS, projectToSqliteRow } from './project-sync-schema';
import { safeFormatDate } from './date';
import type { AppData, Project, Section, Task } from './types';

const now = '2026-09-28T15:00:00.000Z';
const project = (id = 'target', overrides: Partial<Project> = {}): Project => ({
    id, title: id, status: 'active', color: '#3b82f6', order: 0, tagIds: ['#work'],
    rev: 3, revBy: 'old-device', createdAt: now, updatedAt: now, ...overrides,
});
const task = (): Task => ({ id: 'linked-task', title: 'Keep task text', status: 'next', projectId: 'target',
    tags: ['#work'], contexts: ['@home'], rev: 5, revBy: 'old-device', createdAt: now, updatedAt: now });
const section = (): Section => ({ id: 'linked-section', projectId: 'target', title: 'Keep section text',
    order: 0, rev: 2, revBy: 'old-device', createdAt: now, updatedAt: now });
const sortKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(sortKeys)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sortKeys(nested)])) : value;

async function open(initial: Partial<AppData> = {}, fail?: () => boolean) {
    await flushPendingSave(); resetForTests();
    let data: AppData = { tasks: [], projects: [project()], sections: [], areas: [], people: [],
        settings: { deviceId: 'date-device' }, ...initial };
    let saves = 0;
    setStorageAdapter({ getData: async () => data, saveData: async (next) => {
        if (fail?.()) throw new Error('disk unavailable');
        data = structuredClone(next); saves++;
    } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    const methods = createProjectDateMethods({ readiness: () => ({ ok: true, value: null }),
        save: async () => {
            try { await flushPendingSave(); return { ok: true as const, value: null }; }
            catch (error) { return { ok: false as const, error: { code: 'SAVE_FAILED' as const,
                message: error instanceof Error ? error.message : String(error) } }; }
        }, revision: () => 'stable-revision' });
    const request = (field: NativeProjectDateField, value: string | null): NativeProjectDateRequest => {
        const options = methods.getProjectDateOptions({ projectId: 'target', field });
        if (!options.ok) throw new Error(JSON.stringify(options.error));
        const { id: _id, ...expected } = options.value.project;
        return { requestId: '73799899-d143-40c1-84bd-a09172bba5a4', projectId: 'target',
            field, value, expected };
    };
    return { methods, request, data: () => data, saves: () => saves };
}

afterEach(async () => { vi.useRealTimers(); await flushPendingSave(); resetForTests(); });

describe('prepared native Project start/due dates', () => {
    it.each([
        { field: 'startDate' as const, raw: undefined, value: '2028-02-29' },
        { field: 'dueDate' as const, raw: '2026-03-08T12:00:00.000Z', value: '2026-03-09' },
        { field: 'startDate' as const, raw: 'invalid raw date', value: '2026-11-01' },
    ])('matches RN updateProject for $field set from $raw and preserves other entities', async ({ field, raw, value }) => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T16:00:00.000Z'));
        const original = project('target', { [field]: raw, supportNotes: '  raw Notes  ',
            attachments: [{ id: 'a', kind: 'link', title: 'Source', uri: 'https://example.test/',
                createdAt: now, updatedAt: now }] });
        const other = project('other');
        const { methods, request } = await open({ projects: [original, other], tasks: [task()], sections: [section()] });
        const input = request(field, value);
        const plan = methods.prepareProjectDate(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        const beforeAttachment = projectToSqliteRow(original)[PROJECT_SQLITE_COLUMNS.indexOf('attachments')];
        expect(projectToSqliteRow(plan.value.prepared.effect.project.after)[PROJECT_SQLITE_COLUMNS.indexOf('attachments')])
            .toBe(beforeAttachment);
        expect(plan.value.prepared.effect.project.after).toMatchObject({ [field]: value, rev: 4,
            supportNotes: original.supportNotes });
        const children = { tasks: structuredClone(useTaskStore.getState()._allTasks),
            sections: structuredClone(useTaskStore.getState()._allSections) };
        expect((await useTaskStore.getState().updateProject('target', { [field]: value })).success).toBe(true);
        expect(useTaskStore.getState()._allProjects[0]).toEqual(plan.value.prepared.effect.project.after);
        expect(useTaskStore.getState()._allProjects[1]).toEqual(other);
        expect(useTaskStore.getState()._allTasks).toEqual(children.tasks);
        expect(useTaskStore.getState()._allSections).toEqual(children.sections);
    });

    it('clears only the chosen field and matches RN updateProject', async () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T16:00:00.000Z'));
        const original = project('target', { startDate: '2026-09-29', dueDate: '2026-10-10' });
        const { methods, request } = await open({ projects: [original] });
        const input = request('startDate', null);
        const plan = methods.prepareProjectDate(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(plan.value.prepared.effect.project.after.startDate).toBeUndefined();
        expect(plan.value.prepared.effect.project.after.dueDate).toBe(original.dueDate);
        expect((await useTaskStore.getState().updateProject('target', { startDate: undefined })).success).toBe(true);
        expect(useTaskStore.getState()._allProjects[0]).toEqual(plan.value.prepared.effect.project.after);
    });

    it('keeps raw dates through options and treats absent, null, and empty clears as no-ops', async () => {
        const { methods, request, saves } = await open({ projects: [project('target', { startDate: '', dueDate: undefined })],
            settings: {} });
        useTaskStore.setState({ settings: {} });
        expect(methods.getProjectDateOptions({ projectId: 'target', field: 'startDate' }))
            .toMatchObject({ ok: true, value: { revision: 'stable-revision',
                project: { startDate: '', dueDate: null }, canEdit: true,
                picker: { time: '12:00' } } });
        expect(methods.prepareProjectDate(request('startDate', null))).toEqual({ ok: true,
            value: { kind: 'noop', result: { id: 'target', field: 'startDate', value: null } } });
        expect(methods.prepareProjectDate(request('dueDate', null))).toMatchObject({ ok: true,
            value: { kind: 'noop' } });
        useTaskStore.setState({ _allProjects: [project('target', { startDate: null as never })] });
        expect(methods.prepareProjectDate(request('startDate', null))).toMatchObject({ ok: true,
            value: { kind: 'noop', result: { value: null } } });
        expect(useTaskStore.getState()._projectsById.get('target')?.startDate).toBeNull();
        expect(useTaskStore.getState().settings.deviceId).toBeUndefined();
        expect(saves()).toBe(0);
    });

    it('changes a live legacy null date without normalizing the untouched date', async () => {
        const { methods, request } = await open({ projects: [project('target', { dueDate: 'not a day' })] });
        useTaskStore.setState({ _allProjects: [project('target', {
            startDate: null as never, dueDate: 'not a day' })] });
        const input = request('startDate', '2028-02-29');
        expect(input.expected).toMatchObject({ startDate: null, dueDate: 'not a day' });
        const plan = methods.prepareProjectDate(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(plan.value.prepared.scope.project.startDate).toBeNull();
        expect(plan.value.prepared.effect.project.after.dueDate).toBe('not a day');
        expect(await methods.commitPreparedProjectDate({ request: input, prepared: plan.value.prepared }))
            .toEqual({ ok: true, value: { id: 'target', field: 'startDate', value: '2028-02-29' } });
        expect(useTaskStore.getState()._projectsById.get('target'))
            .toMatchObject({ startDate: '2028-02-29', dueDate: 'not a day' });
    });

    it('checks stale tokens before noop or archive block and refuses unavailable Projects', async () => {
        const { methods, request, saves } = await open();
        const stale = request('dueDate', null);
        useTaskStore.setState({ _allProjects: [project('target', { dueDate: '2026-01-01', rev: 4 })] });
        expect(methods.prepareProjectDate(stale)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        useTaskStore.setState({ _allProjects: [project('target', { status: 'archived' })] });
        expect(methods.getProjectDateOptions({ projectId: 'target', field: 'dueDate' }))
            .toMatchObject({ ok: true, value: { canEdit: false } });
        expect(methods.prepareProjectDate(request('dueDate', '2026-01-01'))).toEqual({ ok: true,
            value: { kind: 'blocked', result: { blocked: '' } } });
        for (const unavailable of [{ deletedAt: now }, { purgedAt: now }]) {
            useTaskStore.setState({ _allProjects: [project('target', unavailable)] });
            expect(methods.getProjectDateOptions({ projectId: 'target', field: 'dueDate' }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        expect(saves()).toBe(0);
    });

    it('accepts sorted-key journals and complete after-row receipts, but refuses partial or changed rows', async () => {
        const original = project('target', { startDate: '2026-09-29', supportNotes: 'keep', attachments: [{ id: 'a',
            kind: 'link', title: 'Source', uri: 'https://example.test/', createdAt: now, updatedAt: now }] });
        const { methods, request, saves } = await open({ projects: [original, project('other')], tasks: [task()] });
        const input = request('startDate', '2026-10-01');
        const plan = methods.prepareProjectDate(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        const frozen = JSON.parse(JSON.stringify(sortKeys({ request: input, prepared: plan.value.prepared }))) as
            { request: typeof input; prepared: typeof plan.value.prepared };
        expect(methods.validatePreparedProjectDate(frozen)).toEqual({ ok: true, value: plan.value.prepared.result });
        useTaskStore.setState({ _allProjects: [{ ...original, startDate: input.value }, project('other')] });
        expect(await methods.commitPreparedProjectDate(frozen)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        useTaskStore.setState({ _allProjects: [original, project('other')] });
        expect(await methods.commitPreparedProjectDate(frozen)).toEqual({ ok: true, value: plan.value.prepared.result });
        const count = saves();
        useTaskStore.setState((state) => ({ settings: { ...state.settings, deviceId: 'different-device' },
            _allProjects: [...state._allProjects, project('later')] }));
        expect(await methods.commitPreparedProjectDate(frozen)).toMatchObject({ ok: true });
        expect(saves()).toBe(count);
        useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((row) => row.id === 'target'
            ? { ...row, title: 'Later title' } : row) }));
        expect(await methods.commitPreparedProjectDate(frozen)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
    });

    it('retries failed persistence and initializes device ID atomically', async () => {
        let failed = true;
        const first = await open({ projects: [project()], settings: {} }, () => failed);
        useTaskStore.setState({ settings: {} });
        const input = first.request('dueDate', '2026-10-01');
        const plan = first.methods.prepareProjectDate(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(plan.value.prepared.deviceIdBefore).toBeNull();
        expect(plan.value.prepared.deviceIdToInitialize).toMatch(/^[0-9a-f-]+$/);
        const frozen = { request: input, prepared: plan.value.prepared };
        expect(await first.methods.commitPreparedProjectDate(frozen)).toMatchObject({ ok: false,
            error: { code: 'SAVE_FAILED' } });
        expect(first.data().projects[0].dueDate).toBeUndefined();
        expect(first.data().settings.deviceId).toBeUndefined();
        failed = false;
        expect(await first.methods.commitPreparedProjectDate(frozen)).toEqual({ ok: true,
            value: { id: 'target', field: 'dueDate', value: '2026-10-01' } });
        expect(first.data().projects[0]).toMatchObject({ dueDate: '2026-10-01', rev: 4 });
        expect(first.data().settings.deviceId).toBe(plan.value.prepared.deviceIdToInitialize);
        const second = await open(structuredClone(first.data()));
        await flushPendingSave();
        const count = second.saves();
        expect(await second.methods.commitPreparedProjectDate(frozen)).toMatchObject({ ok: true });
        expect(second.saves()).toBe(count);
    });

    it('rejects malformed days, times, fields, overlong tokens, and forged effects before writing', async () => {
        const { methods, request, saves } = await open();
        const input = request('dueDate', '2028-02-29');
        const plan = methods.prepareProjectDate(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        for (const value of ['2027-02-29', '2026-04-31', '2026-03-08T12:00', 'tomorrow', '2026-9-8']) {
            expect(methods.prepareProjectDate({ ...input, value })).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
        }
        expect(methods.prepareProjectDate({ ...input, field: 'unknown' as never }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(methods.prepareProjectDate({ ...input, expected: { ...input.expected,
            startDate: 'x'.repeat(101) } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        useTaskStore.setState({ _allProjects: [project('target', { startDate: 'x'.repeat(101) })] });
        expect(methods.getProjectDateOptions({ projectId: 'target', field: 'dueDate' }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        useTaskStore.setState({ _allProjects: [project()] });
        expect(methods.prepareProjectDate({ ...input, requestId: input.requestId.toUpperCase() }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const envelope = { request: input, prepared: plan.value.prepared };
        const missing = structuredClone(envelope);
        (missing.prepared.scope.project as Partial<Project>).tagIds = undefined;
        expect(methods.validatePreparedProjectDate(missing)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const forgedAfter = structuredClone(envelope);
        forgedAfter.prepared.effect.project.after.dueDate = '2026-10-02';
        expect(methods.validatePreparedProjectDate(forgedAfter)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        const forgedResult = structuredClone(envelope);
        forgedResult.prepared.result.value = '2026-10-02';
        expect(methods.validatePreparedProjectDate(forgedResult)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(methods.probeProjectDateOutcome(input)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(0);
    });
});

describe('prepared native Project Review Date', () => {
    it('keeps legacy start/due option and journal shapes while projecting a frozen review instant', async () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T23:59:59.500Z'));
        const raw = '2026-09-28T23:30:14.125+02:00';
        const { methods, request } = await open({ projects: [project('target', { reviewAt: raw })] });
        const legacy = methods.getProjectDateOptions({ projectId: 'target', field: 'dueDate' });
        if (!legacy.ok) throw new Error(JSON.stringify(legacy));
        expect(Object.keys(legacy.value.project).sort()).toEqual([
            'dueDate', 'id', 'rev', 'revBy', 'startDate', 'status', 'title', 'updatedAt',
        ]);
        expect(legacy.value.picker).toEqual({ date: legacy.value.picker.date, time: '12:00' });
        const oldRequest = request('dueDate', '2026-10-01');
        const oldPlan = methods.prepareProjectDate(oldRequest);
        if (!oldPlan.ok || oldPlan.value.kind !== 'prepared') throw new Error(JSON.stringify(oldPlan));
        expect(Object.keys(oldPlan.value.prepared.request.expected).sort()).toEqual([
            'dueDate', 'rev', 'revBy', 'startDate', 'status', 'title', 'updatedAt',
        ]);
        const oldCold = JSON.parse(JSON.stringify(sortKeys({ request: oldRequest,
            prepared: oldPlan.value.prepared }))) as
            { request: typeof oldRequest; prepared: typeof oldPlan.value.prepared };
        expect(methods.validatePreparedProjectDate(oldCold))
            .toEqual({ ok: true, value: oldPlan.value.prepared.result });
        expect(await methods.commitPreparedProjectDate(oldCold)).toEqual({ ok: true,
            value: oldPlan.value.prepared.result });
        expect(useTaskStore.getState()._allProjects[0].reviewAt).toBe(raw);
        expect(await methods.commitPreparedProjectDate(oldCold)).toEqual({ ok: true,
            value: oldPlan.value.prepared.result });
        const review = methods.getProjectDateOptions({ projectId: 'target', field: 'reviewAt' as NativeProjectDateField });
        if (!review.ok) throw new Error(JSON.stringify(review));
        expect(Object.keys(review.value.project).sort()).toEqual([
            'dueDate', 'id', 'rev', 'revBy', 'reviewAt', 'startDate', 'status', 'title', 'updatedAt',
        ]);
        expect(review.value.project.reviewAt).toBe(raw);
        expect(review.value.picker).toEqual({ date: safeFormatDate(new Date(raw), 'yyyy-MM-dd'),
            time: '12:00', instant: new Date(raw).toISOString(), preserveUnchanged: true });
        const missing = await open({ projects: [project('target', { reviewAt: 'invalid' })] });
        const projected = missing.methods.getProjectDateOptions({ projectId: 'target',
            field: 'reviewAt' as NativeProjectDateField });
        expect(projected).toMatchObject({ ok: true, value: { picker: {
            date: safeFormatDate(new Date('2026-09-28T23:59:59.500Z'), 'yyyy-MM-dd'),
            time: '12:00', instant: '2026-09-28T23:59:59.500Z', preserveUnchanged: false,
        } } });
    });

    it('accepts an old start/due journal with a long unrelated raw reviewAt', async () => {
        const raw = 'x'.repeat(101);
        const { methods, request, data } = await open({ projects: [project('target', { reviewAt: raw })] });
        const input = request('dueDate', '2026-10-01');
        const plan = methods.prepareProjectDate(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
        const cold = JSON.parse(JSON.stringify(sortKeys({ request: input, prepared: plan.value.prepared }))) as
            { request: typeof input; prepared: typeof plan.value.prepared };
        expect(methods.validatePreparedProjectDate(cold)).toEqual({ ok: true, value: plan.value.prepared.result });
        expect(await methods.commitPreparedProjectDate(cold)).toMatchObject({ ok: true });
        expect(data().projects[0].reviewAt).toBe(raw);
        expect(methods.getProjectDateOptions({ projectId: 'target', field: 'reviewAt' }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('sets and clears only reviewAt with RN Project row stamping', async () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T16:00:00.000Z'));
        const original = project('target', { startDate: '2026-09-01', dueDate: 'invalid due',
            reviewAt: '2026-09-28', supportNotes: 'Keep Notes' });
        const { methods, request } = await open({ projects: [original, project('other')],
            tasks: [task()], sections: [section()] });
        const value = '2026-10-01T04:00:00.000Z';
        const input = request('reviewAt' as NativeProjectDateField, value);
        const plan = methods.prepareProjectDate(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
        const before = { tasks: structuredClone(useTaskStore.getState()._allTasks),
            sections: structuredClone(useTaskStore.getState()._allSections) };
        expect(plan.value.prepared.effect.project.after).toMatchObject({ reviewAt: value, rev: 4,
            startDate: original.startDate, dueDate: original.dueDate, supportNotes: original.supportNotes });
        expect((await useTaskStore.getState().updateProject('target', { reviewAt: value })).success).toBe(true);
        expect(useTaskStore.getState()._allProjects[0]).toEqual(plan.value.prepared.effect.project.after);
        expect(useTaskStore.getState()._allTasks).toEqual(before.tasks);
        expect(useTaskStore.getState()._allSections).toEqual(before.sections);
        const reopened = await open({ projects: [original], tasks: [task()], sections: [section()] });
        const fresh = reopened.request('reviewAt' as NativeProjectDateField, value);
        const prepared = reopened.methods.prepareProjectDate(fresh);
        if (!prepared.ok || prepared.value.kind !== 'prepared') throw new Error(JSON.stringify(prepared));
        expect(await reopened.methods.commitPreparedProjectDate({ request: fresh, prepared: prepared.value.prepared }))
            .toEqual({ ok: true, value: { id: 'target', field: 'reviewAt', value } });
        expect(reopened.data().projects[0].reviewAt).toBe(value);
        expect(reopened.data().tasks).toEqual(before.tasks);
        expect(reopened.data().sections).toEqual(before.sections);
        const clear = reopened.request('reviewAt' as NativeProjectDateField, null);
        const clearing = reopened.methods.prepareProjectDate(clear);
        if (!clearing.ok || clearing.value.kind !== 'prepared') throw new Error(JSON.stringify(clearing));
        expect(await reopened.methods.commitPreparedProjectDate({ request: clear, prepared: clearing.value.prepared }))
            .toMatchObject({ ok: true });
        expect(reopened.data().projects[0].reviewAt).toBeUndefined();
    });

    it('keeps null, absent, invalid, and date-only raw values until an explicit review edit', async () => {
        const { methods, request, saves } = await open({ projects: [project('target', {
            startDate: null as never, dueDate: '2026-09-29', reviewAt: null as never,
        })] });
        expect(methods.getProjectDateOptions({ projectId: 'target', field: 'reviewAt' }))
            .toMatchObject({ ok: true, value: { project: { reviewAt: null },
                picker: { preserveUnchanged: false } } });
        expect(methods.prepareProjectDate(request('reviewAt', null)))
            .toEqual({ ok: true, value: { kind: 'noop', result: { id: 'target', field: 'reviewAt', value: null } } });
        expect(saves()).toBe(0);
        const nullInput = request('reviewAt', '2026-10-01T04:00:00.000Z');
        const nullPlan = methods.prepareProjectDate(nullInput);
        if (!nullPlan.ok || nullPlan.value.kind !== 'prepared') throw new Error(JSON.stringify(nullPlan));
        useTaskStore.setState({ _allProjects: [project('target', {
            startDate: null as never, dueDate: '2026-09-29', reviewAt: undefined,
        })] });
        expect(await methods.commitPreparedProjectDate({ request: nullInput, prepared: nullPlan.value.prepared }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        const values: Array<string | undefined> = [undefined, '', 'invalid', '2026-09-28'];
        for (const value of values) {
            useTaskStore.setState({ _allProjects: [project('target', {
                startDate: null as never, dueDate: '2026-09-29', reviewAt: value })] });
            const options = methods.getProjectDateOptions({ projectId: 'target', field: 'reviewAt' });
            expect(options).toMatchObject({ ok: true, value: { project: { reviewAt: value ?? null },
                picker: { preserveUnchanged: value === '2026-09-28' } } });
            const input = request('reviewAt', '2026-10-01T04:00:00.000Z');
            const plan = methods.prepareProjectDate(input);
            if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
            expect(plan.value.prepared.scope.project.startDate).toBeNull();
            expect(plan.value.prepared.effect.project.after.startDate).toBeNull();
            expect(plan.value.prepared.effect.project.after.dueDate).toBe('2026-09-29');
            expect(plan.value.prepared.effect.project.after.reviewAt).toBe(input.value);
        }
        expect(saves()).toBe(0);
    });

    it('sets reviewAt from a raw null without changing nullable start/due fields', async () => {
        const { methods, request, data } = await open({ projects: [project('target', {
            startDate: null as never, dueDate: null as never, reviewAt: null as never,
        })] });
        const input = request('reviewAt', '2026-10-01T04:00:00.000Z');
        const plan = methods.prepareProjectDate(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
        expect(await methods.commitPreparedProjectDate({ request: input, prepared: plan.value.prepared }))
            .toEqual({ ok: true, value: plan.value.prepared.result });
        expect(data().projects[0].startDate).toBeNull();
        expect(data().projects[0].dueDate).toBeNull();
        expect(data().projects[0].reviewAt).toBe(input.value);
    });

    it('rejects noncanonical review writes and conditional token forgeries before a write', async () => {
        const { methods, request, saves } = await open({ projects: [project('target', {
            reviewAt: '2026-09-28T14:00:00.000Z',
        })] });
        const input = request('reviewAt', '2026-10-01T04:00:00.000Z');
        for (const value of ['2026-10-01', '2026-10-01T04:00:00Z',
            '2026-10-01T00:00:00.000-04:00', '2026-02-30T04:00:00.000Z', 'tomorrow']) {
            expect(methods.prepareProjectDate({ ...input, value }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        const omitted = { ...input, expected: { ...input.expected } };
        delete omitted.expected.reviewAt;
        expect(methods.prepareProjectDate(omitted)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(methods.prepareProjectDate({ ...input, expected: { ...input.expected, reviewAt: 'later' } }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        const old = request('dueDate', '2026-10-01');
        expect(methods.prepareProjectDate({ ...old, expected: { ...old.expected, reviewAt: null } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const plan = methods.prepareProjectDate(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
        const forged = structuredClone({ request: input, prepared: plan.value.prepared });
        forged.prepared.effect.project.after.reviewAt = '2026-10-02T04:00:00.000Z';
        expect(methods.validatePreparedProjectDate(forged)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(await methods.commitPreparedProjectDate(forged)).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(saves()).toBe(0);
    });

    it('checks stale review token before noop, blocks archived, and keeps outcome probes conservative', async () => {
        const { methods, request, saves } = await open({ projects: [project('target', {
            reviewAt: '2026-09-28T14:00:00.000Z',
        })] });
        const sameValue = request('reviewAt', '2026-09-28T14:00:00.000Z');
        useTaskStore.setState({ _allProjects: [project('target', {
            reviewAt: '2026-09-28T15:00:00.000Z', rev: 4,
        })] });
        expect(methods.prepareProjectDate(sameValue)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        useTaskStore.setState({ _allProjects: [project('target', { status: 'archived' })] });
        expect(methods.prepareProjectDate(request('reviewAt', '2026-10-01T04:00:00.000Z')))
            .toEqual({ ok: true, value: { kind: 'blocked', result: { blocked: '' } } });
        expect(methods.probeProjectDateOutcome(sameValue)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(0);
    });

    it('validates a sorted-key review journal and requires the complete after-row receipt', async () => {
        const original = project('target', { reviewAt: '2026-09-28',
            attachments: [{ id: 'a', kind: 'link', title: 'Keep', uri: 'https://example.test/',
                createdAt: now, updatedAt: now }] });
        const { methods, request, saves } = await open({ projects: [original, project('other')],
            tasks: [task()], sections: [section()] });
        const input = request('reviewAt', '2026-10-01T04:00:00.000Z');
        const plan = methods.prepareProjectDate(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
        const cold = JSON.parse(JSON.stringify(sortKeys({ request: input, prepared: plan.value.prepared }))) as
            { request: typeof input; prepared: typeof plan.value.prepared };
        expect(methods.validatePreparedProjectDate(cold)).toEqual({ ok: true, value: plan.value.prepared.result });
        useTaskStore.setState({ _allProjects: [{ ...original, reviewAt: input.value }, project('other')] });
        expect(await methods.commitPreparedProjectDate(cold)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        useTaskStore.setState({ _allProjects: [original, project('other')] });
        expect(await methods.commitPreparedProjectDate(cold)).toEqual({ ok: true, value: plan.value.prepared.result });
        const count = saves();
        useTaskStore.setState((state) => ({ settings: { ...state.settings, deviceId: 'later-device' },
            _allProjects: [...state._allProjects, project('later')] }));
        expect(await methods.commitPreparedProjectDate(cold)).toEqual({ ok: true, value: plan.value.prepared.result });
        expect(saves()).toBe(count);
        useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((row) => row.id === 'target'
            ? { ...row, title: 'Later' } : row) }));
        expect(await methods.commitPreparedProjectDate(cold)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
    });

    it('retries the exact frozen review effect after failed persistence and cold receipt', async () => {
        let failed = true;
        const first = await open({ projects: [project('target', { reviewAt: '2026-09-28' })],
            settings: {} }, () => failed);
        useTaskStore.setState({ settings: {} });
        const input = first.request('reviewAt', '2026-10-01T04:00:00.000Z');
        const plan = first.methods.prepareProjectDate(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(JSON.stringify(plan));
        const frozen = { request: input, prepared: plan.value.prepared };
        expect(await first.methods.commitPreparedProjectDate(frozen)).toMatchObject({ ok: false,
            error: { code: 'SAVE_FAILED' } });
        const expectedAfter = structuredClone(useTaskStore.getState()._allProjects[0]);
        failed = false;
        expect(await first.methods.commitPreparedProjectDate(frozen)).toEqual({ ok: true,
            value: plan.value.prepared.result });
        expect(useTaskStore.getState()._allProjects[0]).toEqual(expectedAfter);
        const second = await open(structuredClone(first.data()));
        await flushPendingSave();
        const count = second.saves();
        expect(await second.methods.commitPreparedProjectDate(frozen)).toEqual({ ok: true,
            value: plan.value.prepared.result });
        expect(second.saves()).toBe(count);
    });
});
