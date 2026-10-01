import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectAttachmentWriteMethods, type NativeProjectAttachmentWriteRequest } from './native-host-contract-project-attachments';
import { requestRowId } from './native-request-receipts';
import { openSqliteHost } from './screen-parity.replay';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Attachment, Project, Section, Task } from './types';

const now = '2026-10-01T15:00:00.000Z';
const later = '2026-10-01T16:00:00.000Z';
const requestId = '73799899-d143-40c1-84bd-a09172bba5a4';
const file: Attachment = { id: 'file', kind: 'file', title: 'Keep.pdf', uri: 'file:///keep.pdf',
    mimeType: 'application/pdf', size: 12, cloudKey: 'cloud-file', createdAt: now, updatedAt: now };
const link: Attachment = { id: 'link', kind: 'link', title: 'Before', uri: 'https://example.test/old',
    createdAt: now, updatedAt: now };
const project = (id = 'target', overrides: Partial<Project> = {}): Project => ({
    id, title: id, status: 'active', color: '#3b82f6', order: 0, tagIds: ['#work'],
    supportNotes: 'Keep notes', attachments: [file, link], rev: 3, revBy: 'old-device',
    createdAt: now, updatedAt: now, ...overrides,
});
const task: Task = { id: 'task', title: 'Keep task', status: 'next', projectId: 'target', tags: [], contexts: [],
    createdAt: now, updatedAt: now };
const section: Section = { id: 'section', projectId: 'target', title: 'Keep section', order: 0,
    createdAt: now, updatedAt: now };

async function open(initial: Partial<AppData> = {}, fail?: () => boolean) {
    await flushPendingSave(); resetForTests();
    let data: AppData = { tasks: [task], projects: [project(), project('other')], sections: [section],
        areas: [], people: [], settings: { deviceId: 'links-device' }, ...initial };
    let saves = 0;
    setStorageAdapter({ getData: async () => structuredClone(data), saveData: async (next) => {
        if (fail?.()) throw new Error('private disk failure');
        data = structuredClone(next); saves++;
    } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    const methods = createProjectAttachmentWriteMethods({ readiness: () => ({ ok: true, value: null }),
        save: async () => {
            try { await flushPendingSave(); return { ok: true as const, value: null }; }
            catch { return { ok: false as const, error: { code: 'SAVE_FAILED' as const, message: 'Could not save' } }; }
        }, revision: () => 'stable-revision', t: () => (key) => key });
    const request = (intent: NativeProjectAttachmentWriteRequest['intent']): NativeProjectAttachmentWriteRequest => {
        const options = methods.getProjectAttachmentEditOptions({ projectId: 'target' });
        if (!options.ok) throw new Error(options.error.code);
        const { id: _id, ...expected } = options.value.project;
        return { requestId, projectId: 'target', intent, expected };
    };
    return { methods, request, data: () => data, saves: () => saves };
}

afterEach(async () => { vi.useRealTimers(); await flushPendingSave(); resetForTests(); });

describe('prepared native Project URL attachment edits', () => {
    it('persists one Project row through SQLite restart and replays only the exact saved row', async () => {
        const env = await openSqliteHost({ projects: [project()], settings: { deviceId: 'links-device' } });
        try {
            const options = env.host.getProjectAttachmentEditOptions({ projectId: 'target' });
            if (!options.ok) throw new Error(options.error.code);
            const { id: _id, ...expected } = options.value.project;
            const request = JSON.parse(JSON.stringify({ requestId, projectId: 'target', expected,
                intent: { kind: 'add', text: 'SQLite | https://example.org/sqlite' } })) as NativeProjectAttachmentWriteRequest;
            const plan = env.host.prepareProjectAttachmentWrite(request);
            if (!plan.ok || plan.value.kind !== 'prepared') throw new Error(plan.ok ? plan.value.kind : `${plan.error.code}: ${plan.error.message}`);
            const frozen = { request, prepared: plan.value.prepared };
            expect(await env.host.commitPreparedProjectAttachmentWrite(frozen)).toEqual({ ok: true,
                value: plan.value.prepared.result });
            const saved = await env.sql<{ rev: number; attachments: string }>('SELECT rev, attachments FROM projects WHERE id = ?', ['target']);
            expect(saved[0].rev).toBe(plan.value.prepared.effect.project.after.rev);
            expect(JSON.parse(saved[0].attachments)).toEqual(plan.value.prepared.effect.project.after.attachments);
            const replay = await env.replay((host) => host.commitPreparedProjectAttachmentWrite(frozen));
            expect(replay.result).toEqual({ ok: true, value: plan.value.prepared.result });
            expect(replay.wrote).toBe(false);
            expect(replay.receipts).toBe(false);
            expect((await useTaskStore.getState().updateProject('target', { title: 'Later title' })).success).toBe(true);
            await flushPendingSave();
            const changed = await env.replay((host) => host.commitPreparedProjectAttachmentWrite(frozen));
            expect(changed.result).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(changed.wrote).toBe(false);
        } finally { await env.close(); }
    });

    it('adds multiline titled URLs once, preserving files, child rows and every unrelated Project field', async () => {
        const original = project('target', { dueDate: '2026-10-20', areaId: 'area',
            attachments: [file, link, { ...link, id: 'removed', deletedAt: now }] });
        const { methods, request, data, saves } = await open({ projects: [original, project('other')] });
        const before = structuredClone(useTaskStore.getState()._allProjects[0]);
        const children = { tasks: structuredClone(useTaskStore.getState()._allTasks),
            sections: structuredClone(useTaskStore.getState()._allSections) };
        const input = request({ kind: 'add', text: '  Docs  |  https://example.org/a  \nhttps://example.org/b' });
        const plan = methods.prepareProjectAttachmentWrite(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        const frozen = { request: input, prepared: plan.value.prepared };
        expect(plan.value.prepared.result).toEqual({ id: 'target', attachmentIds: [
            requestRowId(requestId, 'link:0'), requestRowId(requestId, 'link:1'),
        ] });
        expect(plan.value.prepared.effect.project.after).toMatchObject({ rev: before.rev! + 1, dueDate: original.dueDate,
            supportNotes: original.supportNotes, attachments: [file, link, original.attachments![2],
                expect.objectContaining({ kind: 'link', title: 'Docs', uri: 'https://example.org/a' }),
                expect.objectContaining({ kind: 'link', uri: 'https://example.org/b' })] });
        expect(methods.validatePreparedProjectAttachmentWrite(frozen)).toEqual({ ok: true, value: plan.value.prepared.result });
        expect(await methods.commitPreparedProjectAttachmentWrite(frozen)).toEqual({ ok: true, value: plan.value.prepared.result });
        expect(saves()).toBe(1);
        expect(data().projects[0]).toEqual(plan.value.prepared.effect.project.after);
        expect(data().projects[1]).toEqual(project('other'));
        expect(data().tasks).toEqual(children.tasks);
        expect(data().sections).toEqual(children.sections);
        const second = await open(structuredClone(data()));
        const count = second.saves();
        expect(await second.methods.commitPreparedProjectAttachmentWrite(frozen)).toEqual({ ok: true, value: plan.value.prepared.result });
        expect(second.saves()).toBe(count);
        useTaskStore.setState({ _allProjects: [{ ...second.data().projects[0], title: 'Intervening edit' }, second.data().projects[1]] });
        expect(await second.methods.commitPreparedProjectAttachmentWrite(frozen)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
    });

    it('soft-removes only a live link, and no-op or refused requests write nothing', async () => {
        const { methods, request, data, saves } = await open();
        const input = request({ kind: 'remove', attachmentId: link.id });
        const plan = methods.prepareProjectAttachmentWrite(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(plan.value.prepared.effect.project.after.attachments).toEqual([
            file, { ...link, deletedAt: plan.value.prepared.updateAt, updatedAt: plan.value.prepared.updateAt },
        ]);
        expect(await methods.commitPreparedProjectAttachmentWrite({ request: input, prepared: plan.value.prepared }))
            .toEqual({ ok: true, value: { id: 'target', attachmentIds: ['link'] } });
        expect(data().projects[0].rev).toBe(4);
        const count = saves();
        expect(methods.prepareProjectAttachmentWrite(request({ kind: 'remove', attachmentId: 'missing' })))
            .toEqual({ ok: true, value: { kind: 'noop', result: { id: 'target', attachmentIds: [] } } });
        expect(methods.prepareProjectAttachmentWrite(request({ kind: 'remove', attachmentId: 'link' })))
            .toEqual({ ok: true, value: { kind: 'noop', result: { id: 'target', attachmentIds: [] } } });
        expect(methods.prepareProjectAttachmentWrite(request({ kind: 'remove', attachmentId: 'file' })))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(methods.prepareProjectAttachmentWrite(request({ kind: 'add', text: ' \n ' })))
            .toEqual({ ok: true, value: { kind: 'noop', result: { id: 'target', attachmentIds: [] } } });
        expect(saves()).toBe(count);
    });

    it('checks the token before archived/no-op policy and rejects deleted or purged Projects', async () => {
        const { methods, request, saves } = await open();
        const stale = request({ kind: 'remove', attachmentId: 'missing' });
        useTaskStore.setState({ _allProjects: [project('target', { status: 'archived', rev: 4 })] });
        expect(methods.prepareProjectAttachmentWrite(stale)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(methods.getProjectAttachmentEditOptions({ projectId: 'target' })).toMatchObject({ ok: true,
            value: { canEdit: false } });
        expect(methods.prepareProjectAttachmentWrite(request({ kind: 'add', text: 'https://example.org' })))
            .toEqual({ ok: true, value: { kind: 'blocked', result: { blocked: '' } } });
        for (const change of [{ deletedAt: now }, { purgedAt: now }]) {
            useTaskStore.setState({ _allProjects: [project('target', change)] });
            expect(methods.getProjectAttachmentEditOptions({ projectId: 'target' })).toMatchObject({ ok: false,
                error: { code: 'STALE_REVISION' } });
        }
        expect(saves()).toBe(0);
    });

    it('preserves raw SQLite-null Project columns and refuses oversized options or journals', async () => {
        const { methods, request, saves } = await open();
        const nullable = { ...project(), areaId: null, supportNotes: null, attachments: null,
            rev: null, revBy: null, deletedAt: null, purgedAt: null } as unknown as Project;
        useTaskStore.setState({ _allProjects: [nullable] });
        const input = request({ kind: 'add', text: 'https://example.org/new' });
        const plan = methods.prepareProjectAttachmentWrite(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        expect(plan.value.prepared.scope.project).toEqual(nullable);
        expect(plan.value.prepared.effect.project.after).toMatchObject({ areaId: null, supportNotes: null,
            attachments: [expect.objectContaining({ kind: 'link' })], rev: 1 });
        expect(methods.validatePreparedProjectAttachmentWrite({ request: input, prepared: plan.value.prepared }))
            .toMatchObject({ ok: true });
        useTaskStore.setState({ _allProjects: [project('target', { attachments: Array.from({ length: 1_001 }, (_, index) =>
            ({ ...link, id: `link-${index}` })) })] });
        expect(methods.getProjectAttachmentEditOptions({ projectId: 'target' })).toMatchObject({ ok: false,
            error: { code: 'INVALID_INPUT' } });
        expect(methods.validatePreparedProjectAttachmentWrite({ request: input,
            prepared: { ...plan.value.prepared, extra: 'x'.repeat(2_000_001) } as never }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saves()).toBe(0);
    });

    it('rejects forged effects, ID collisions and secret-bearing malformed requests before writing', async () => {
        const { methods, request, saves } = await open();
        const input = request({ kind: 'add', text: 'Private | https://alice:secret@example.org/path?token=private' });
        const plan = methods.prepareProjectAttachmentWrite(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        const frozen = { request: input, prepared: plan.value.prepared };
        for (const mutate of [
            (value: typeof frozen) => { value.prepared.effect.project.after.title = 'Forged'; },
            (value: typeof frozen) => { value.prepared.effect.project.after.attachments![0].title = 'Forged file'; },
            (value: typeof frozen) => { value.prepared.result.attachmentIds = ['wrong']; },
            (value: typeof frozen) => { value.prepared.scope.project.color = '#000000'; },
            (value: typeof frozen) => { (value.prepared as object as Record<string, unknown>).extra = true; },
        ]) {
            const forged = structuredClone(frozen); mutate(forged);
            const validation = methods.validatePreparedProjectAttachmentWrite(forged);
            expect(validation).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(JSON.stringify(validation)).not.toMatch(/alice|secret|private/);
            expect(await methods.commitPreparedProjectAttachmentWrite(forged)).toMatchObject({ ok: false,
                error: { code: 'INVALID_INPUT' } });
        }
        const malformed = methods.prepareProjectAttachmentWrite({ ...input,
            intent: { kind: 'add', text: 'https://example.org/good\nnot-a-url-secret' } });
        expect(malformed).toMatchObject({ ok: true, value: { kind: 'refused' } });
        for (const bad of [
            { ...input, requestId: requestId.toUpperCase() },
            { ...input, intent: { kind: 'add', text: 'x'.repeat(100_001) } },
            { ...input, intent: { kind: 'remove', attachmentId: 'x'.repeat(501) } },
            { ...input, extra: true },
        ]) {
            const answer = methods.prepareProjectAttachmentWrite(bad as never);
            expect(answer).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(JSON.stringify(answer)).not.toMatch(/alice|secret|private/);
        }
        useTaskStore.setState({ _allProjects: [project('target', { attachments: [file, link,
            { ...link, id: requestRowId(requestId, 'link:0'), deletedAt: later }] })] });
        const collision = request({ kind: 'add', text: 'https://example.org/new' });
        expect(methods.prepareProjectAttachmentWrite(collision)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(methods.probeProjectAttachmentWriteOutcome(input)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
        expect(saves()).toBe(0);
    });

    it('retries a failed save without another revision, then rejects a changed initialization device', async () => {
        let failed = true;
        const first = await open({ settings: {} }, () => failed);
        useTaskStore.setState({ settings: {} });
        const input = first.request({ kind: 'add', text: 'https://example.org/new' });
        const plan = first.methods.prepareProjectAttachmentWrite(input);
        if (!plan.ok || plan.value.kind !== 'prepared') throw new Error('prepare failed');
        const frozen = { request: input, prepared: plan.value.prepared };
        expect(await first.methods.commitPreparedProjectAttachmentWrite(frozen)).toMatchObject({ ok: false,
            error: { code: 'SAVE_FAILED' } });
        expect(first.data().projects[0].rev).toBe(3);
        failed = false;
        expect(await first.methods.commitPreparedProjectAttachmentWrite(frozen)).toMatchObject({ ok: true });
        expect(first.data().projects[0].rev).toBe(4);
        const second = await open(structuredClone(first.data()));
        useTaskStore.setState((state) => ({ settings: { ...state.settings, deviceId: 'different-device' } }));
        expect(await second.methods.commitPreparedProjectAttachmentWrite(frozen)).toMatchObject({ ok: false,
            error: { code: 'STALE_REVISION' } });
    });
});
