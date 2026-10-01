import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Attachment, Project, Task } from './types';

const at = '2026-10-01T12:00:00.000Z';
const later = '2026-10-01T13:00:00.000Z';
const scheduleBase = { startTime: null, dueDate: null, relativeStartOffset: null, reviewAt: null };
const file: Attachment = { id: 'file', kind: 'file', title: 'Report', uri: 'file:///report.pdf', createdAt: at, updatedAt: at };
const link: Attachment = { id: 'link', kind: 'link', title: 'Old', uri: 'https://example.org/old', createdAt: at, updatedAt: at };
const task = (): Task => ({ id: 'edit', title: 'Task', status: 'next', taskMode: 'list', tags: [], contexts: [],
    checklist: [{ id: 'check', title: 'Check', isCompleted: false }], attachments: [file, link],
    createdAt: at, updatedAt: at, rev: 1, revBy: 'device-a' });
const unwrap = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

describe('prepared Task URL draft', () => {
    let durable: AppData;
    let writes: ReturnType<typeof vi.fn>;
    let host: ReturnType<typeof createNativeHostContract>;
    const saved = () => durable.tasks[0];
    const open = async () => {
        resetForTests();
        useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0 });
        host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true, recoveryLoad: true })).toMatchObject({ ok: true });
        await flushPendingSave();
    };
    const owner = (attachments: Attachment[]) => ({ kind: 'task' as const, taskId: 'edit', attachments });
    const half = (value: Attachment[]) => ({ base: [file, link], value });
    const request = (value: Attachment[]) => ({ id: 'edit', base: {}, patch: {}, scheduleBase, attachments: half(value) });
    const add = async (attachments: Attachment[], text = 'Private | https://alice:secret-a@example.org/path?token=secret-b') => {
        const result = unwrap(await host.submitAttachmentLinks({ owner: owner(attachments),
            requestId: '00000000-0000-4000-8000-000000000001', text, urlOnly: true }));
        expect(result.kind).toBe('saved');
        if (result.kind !== 'saved' || !result.attachments) throw new Error('Missing draft list');
        return result.attachments;
    };

    beforeEach(async () => {
        durable = { tasks: [task()], projects: [], sections: [], areas: [], people: [], settings: { deviceId: 'device-a' } };
        writes = vi.fn(async (next: AppData) => { durable = structuredClone(next); });
        setStorageAdapter({ getData: async () => structuredClone(durable), saveData: writes });
        await open();
        writes.mockClear();
    });
    afterEach(async () => { await flushPendingSave(); resetForTests(); });

    it('keeps add, edit and remove in one raw draft, then saves once through V2', async () => {
        const opening = unwrap(host.getTaskView({ id: 'edit' }));
        expect(opening.attachmentsBase).toEqual([file, link]);
        let value = await add(opening.attachmentsBase);
        const added = value[2];
        expect(await add(value)).toEqual(value);
        const changed = unwrap(await host.submitAttachmentLinks({ owner: owner(value),
            requestId: '00000000-0000-4000-8000-000000000002', text: 'Edited | https://example.org/edited',
            editing: { attachmentId: added.id, title: added.title, uri: added.uri }, urlOnly: true }));
        expect(changed.kind).toBe('saved');
        if (changed.kind !== 'saved' || !changed.attachments) return;
        value = changed.attachments;
        expect(await host.removeAttachment({ owner: owner(value), requestId: '00000000-0000-4000-8000-000000000003',
            attachmentId: file.id, urlOnly: true })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const removed = unwrap(await host.removeAttachment({ owner: owner(value),
            requestId: '00000000-0000-4000-8000-000000000004', attachmentId: link.id, urlOnly: true }));
        expect(removed.kind).toBe('saved');
        if (removed.kind !== 'saved' || !removed.attachments) return;
        value = removed.attachments;
        expect(unwrap(host.getTaskView({ id: 'edit', attachments: value })).rows
            .find((row) => row.type === 'attachments')).toMatchObject({ items: [
                expect.objectContaining({ id: file.id }), expect.objectContaining({ id: added.id }),
            ] });
        expect(saved().attachments).toEqual([file, link]);
        expect(writes).not.toHaveBeenCalled();
        const input = request(value);
        const prepared = unwrap(await host.prepareTaskDraftSaveV2(input));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        expect(unwrap(host.validatePreparedTaskDraftSave({ request: input, prepared: prepared.prepared })).version).toBe(2);
        expect(await host.commitPreparedTaskDraftSave({ request: input, prepared: prepared.prepared })).toMatchObject({ ok: true });
        expect(saved().attachments).toEqual(value);
        const count = writes.mock.calls.length;
        await open();
        expect(await host.commitPreparedTaskDraftSave({ request: input, prepared: prepared.prepared })).toMatchObject({ ok: true });
        expect(writes).toHaveBeenCalledTimes(count);
    });

    it('opens saved and unsaved task links through the shared plan without a file host or writes', async () => {
        const savedLink = unwrap(await host.openAttachment({ owner: owner([file, link]), attachmentId: link.id, urlOnly: true }));
        expect(savedLink).toEqual({ status: 'available', message: null, update: null,
            open: { kind: 'link', uri: link.uri, failedMessage: 'Could not open this link.' } });

        const draft = await add([file, link], 'Private | custom://alice:secret@example.org/path');
        const opened = unwrap(await host.openAttachment({ owner: owner(draft), attachmentId: draft[2].id, urlOnly: true }));
        expect(opened).toEqual({ status: 'available', message: null, update: null,
            open: { kind: 'link', uri: draft[2].uri, failedMessage: 'Could not open this link.' } });
        expect(saved().attachments).toEqual([file, link]);
        expect(writes).not.toHaveBeenCalled();
    });

    it('opens a saved link on a live read-only Task without writing', async () => {
        const archived: Project = { id: 'archived', title: 'Archived', status: 'archived', color: '#000000',
            order: 0, tagIds: [], createdAt: at, updatedAt: at };
        const readOnly = { ...task(), projectId: archived.id };
        useTaskStore.setState({ _allProjects: [archived], _allTasks: [readOnly], _tasksById: new Map([[readOnly.id, readOnly]]) });
        expect(unwrap(host.getAttachmentList({ owner: owner([file, link]) })).canEdit).toBe(false);
        expect(unwrap(await host.openAttachment({ owner: owner([file, link]), attachmentId: link.id, urlOnly: true }))).toEqual({
            status: 'available', message: null, update: null,
            open: { kind: 'link', uri: link.uri, failedMessage: 'Could not open this link.' },
        });
        expect(writes).not.toHaveBeenCalled();
    });

    it('lists and opens stored Project links on active and archived Projects without a file host or writes', async () => {
        const path = { ...link, id: 'path', title: 'Desktop report', uri: '/Users/alice/private/report.pdf' };
        const project: Project = { id: 'project', title: 'Project', status: 'active', color: '#000000',
            order: 0, tagIds: [], attachments: [file, link, path], createdAt: at, updatedAt: at };
        durable.projects = [project];
        await open();
        writes.mockClear();
        const owner = { kind: 'project' as const, projectId: project.id };
        expect(unwrap(host.getAttachmentList({ owner })).rows.map((row) => [row.id, row.kind, row.title]))
            .toEqual([['file', 'file', 'Report'], ['link', 'link', 'Old'], ['path', 'link', 'Desktop report']]);
        expect(unwrap(await host.openAttachment({ owner, attachmentId: link.id, urlOnly: true }))).toEqual({
            status: 'available', message: null, update: null,
            open: { kind: 'link', uri: link.uri, failedMessage: 'Could not open this link.' },
        });
        expect(unwrap(await host.openAttachment({ owner, attachmentId: path.id, urlOnly: true })))
            .toMatchObject({ open: { kind: 'alert', message: expect.stringContaining(path.uri) } });
        useTaskStore.setState({ _allProjects: [{ ...project, status: 'archived' }] });
        expect(unwrap(host.getAttachmentList({ owner })).canEdit).toBe(false);
        expect(unwrap(await host.openAttachment({ owner, attachmentId: link.id, urlOnly: true })).open)
            .toMatchObject({ kind: 'link', uri: link.uri });
        expect(writes).not.toHaveBeenCalled();
    });

    it('refuses unavailable Projects and non-live or malformed Project URL targets without leaking credentials', async () => {
        const privateLink = { ...link, uri: 'https://alice:secret@example.org/path?token=private' };
        const removed = { ...privateLink, id: 'removed', deletedAt: later };
        const project: Project = { id: 'project', title: 'Project', status: 'active', color: '#000000',
            order: 0, tagIds: [], attachments: [file, privateLink, removed], createdAt: at, updatedAt: at };
        durable.projects = [project];
        await open();
        writes.mockClear();
        const owner = { kind: 'project' as const, projectId: project.id };
        const check = async (result: Awaited<ReturnType<typeof host.openAttachment>>) => {
            expect(result).toMatchObject({ ok: false });
            expect(JSON.stringify(result)).not.toMatch(/alice|secret|private/);
        };
        await check(await host.openAttachment({ owner, attachmentId: file.id, urlOnly: true }));
        await check(await host.openAttachment({ owner, attachmentId: removed.id, urlOnly: true }));
        await check(await host.openAttachment({ owner, attachmentId: 'missing', urlOnly: true }));
        await check(await host.openAttachment({ owner: { ...owner, attachments: [privateLink] } as never,
            attachmentId: link.id, urlOnly: true }));
        await check(await host.openAttachment({ owner, attachmentId: 'x'.repeat(501), urlOnly: true }));
        useTaskStore.setState({ _allProjects: [{ ...project, attachments: [file] }] });
        await check(await host.openAttachment({ owner, attachmentId: link.id, urlOnly: true }));
        for (const candidate of [null, { ...project, deletedAt: later }, { ...project, purgedAt: later }]) {
            useTaskStore.setState({ _allProjects: candidate ? [candidate] : [] });
            await check(await host.openAttachment({ owner, attachmentId: link.id, urlOnly: true }));
            expect(host.getAttachmentList({ owner })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        expect(writes).not.toHaveBeenCalled();
    });

    it('uses the shared alert for a desktop file path and never returns it as an OS link', async () => {
        const path = { ...link, uri: 'C:\\Private\\report.pdf' };
        const result = unwrap(await host.openAttachment({ owner: owner([file, path]), attachmentId: path.id, urlOnly: true }));
        expect(result).toMatchObject({ status: 'available', message: null, update: null,
            open: { kind: 'alert', message: expect.stringContaining(path.uri) } });
        expect(writes).not.toHaveBeenCalled();
    });

    it('refuses unavailable tasks, files, removed links and forged file IDs without leaking link text', async () => {
        const secret = 'https://alice:secret@example.org/path?token=private';
        const privateLink = { ...link, uri: secret };
        const request = (attachments: Attachment[], attachmentId = link.id) =>
            host.openAttachment({ owner: owner(attachments), attachmentId, urlOnly: true });
        const check = async (result: Awaited<ReturnType<typeof host.openAttachment>>) => {
            expect(result).toMatchObject({ ok: false });
            expect(JSON.stringify(result)).not.toMatch(/alice|secret|private/);
        };
        const setTask = (candidate: Task | null) => useTaskStore.setState({
            _allTasks: candidate ? [candidate] : [], _tasksById: new Map(candidate ? [[candidate.id, candidate]] : []),
        });

        await check(await request([file, privateLink], file.id));
        await check(await request([file, { ...privateLink, deletedAt: later }]));
        await check(await request([file, privateLink], 'absent'));
        await check(await request([{ ...file, kind: 'link', uri: secret }, privateLink], file.id));
        await check(await host.openAttachment({ owner: { kind: 'project', projectId: 'other' }, attachmentId: link.id, urlOnly: true }));
        await check(await request([privateLink, privateLink]));
        await check(await request(Array.from({ length: 1_001 }, (_, i) => ({ ...privateLink, id: `link-${i}` }))));
        setTask(null);
        await check(await request([file, privateLink]));
        setTask({ ...task(), deletedAt: later });
        await check(await request([file, privateLink]));
        setTask({ ...task(), purgedAt: later });
        await check(await request([file, privateLink]));
        expect(writes).not.toHaveBeenCalled();
    });

    it('accepts an added then soft-removed link in the same unsaved draft', async () => {
        const added = await add([file, link]);
        const removed = unwrap(await host.removeAttachment({ owner: owner(added),
            requestId: '00000000-0000-4000-8000-000000000008', attachmentId: added[2].id, urlOnly: true }));
        expect(removed.kind).toBe('saved');
        if (removed.kind !== 'saved' || !removed.attachments) return;
        expect(removed.attachments[2].deletedAt).toBeDefined();
        const input = request(removed.attachments);
        const prepared = unwrap(await host.prepareTaskDraftSaveV2(input));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        expect(prepared.prepared.effect.task.after.attachments).toEqual(removed.attachments);
        expect(await host.commitPreparedTaskDraftSave({ request: input, prepared: prepared.prepared })).toMatchObject({ ok: true });
    });

    it('merges sync changes before prepare and refuses any mutation after prepare', async () => {
        const value = await add([file, link]);
        durable.tasks[0] = { ...saved(), attachments: [
            { ...file, cloudKey: 'remote-file', contentRev: 3 },
            { ...link, deletedAt: later, updatedAt: later },
            { id: 'other', kind: 'link', title: 'Synced', uri: 'https://example.org/synced', createdAt: later, updatedAt: later },
        ], rev: 2, updatedAt: later };
        const input = request(value);
        const prepared = unwrap(await host.prepareTaskDraftSaveV2(input));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        expect(prepared.prepared.effect.task.after.attachments).toEqual([...saved().attachments!, value[2]]);
        durable.tasks[0] = { ...saved(), title: 'Independent', rev: 3 };
        const frozen = structuredClone(saved());
        expect(await host.commitPreparedTaskDraftSave({ request: input, prepared: prepared.prepared }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(saved()).toEqual(frozen);
        durable.tasks[0] = { ...structuredClone(prepared.prepared.effect.task.after), rev: 99 };
        expect(await host.commitPreparedTaskDraftSave({ request: input, prepared: prepared.prepared }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });

    it('refuses forged file edits, malformed links, duplicate IDs and oversized lists without leaking URLs', async () => {
        const value = await add([file, link]);
        const malformed = unwrap(await host.submitAttachmentLinks({ owner: owner([file, link]),
            requestId: '00000000-0000-4000-8000-000000000009',
            text: 'https://example.org/good\nnot-a-url-secret-c', urlOnly: true }));
        expect(malformed.kind).toBe('refused');
        expect(JSON.stringify(malformed)).not.toContain('secret-c');
        const forged = { ...file, kind: 'link' as const, title: 'Forged', uri: 'https://example.org/forged' };
        const bad = [
            { base: [{ ...file, kind: 'link' as const }, link], value: [forged, link] },
            { base: [file, link], value: [file, link, { ...value[2], id: file.id }] },
            { base: [file, link], value: [file, link, { ...value[2], uri: 'https://example.org/ok\ninvalid' }] },
            { base: [file, link], value: [file, link, ...Array.from({ length: 1_000 }, (_, i) =>
                ({ ...value[2], id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }))] },
        ];
        for (const attachments of bad) {
            const result = await host.prepareTaskDraftSaveV2({ ...request(value), attachments });
            expect(result).toMatchObject({ ok: false });
            if (!result.ok) expect(JSON.stringify(result.error)).not.toMatch(/secret-a|secret-b|alice/);
        }
        expect(writes).not.toHaveBeenCalled();
    });

    it('binds URL edits into the checklist prepared Task effect and cold resume permits a newer saved list', async () => {
        const value = await add([file, link]);
        durable.tasks[0] = { ...saved(), attachments: [...saved().attachments!,
            { id: 'other', kind: 'link', title: 'Synced', uri: 'https://example.org/synced', createdAt: later, updatedAt: later }],
        rev: 2, updatedAt: later };
        const resumed = await host.checkTaskEditorResume({ id: 'edit', touchedBase: {}, attachmentsBase: [file, link], attachments: value });
        expect(resumed).toMatchObject({ ok: true, value: { kind: 'ready', freshAttachmentsBase: saved().attachments } });
        await useTaskStore.getState().fetchData({ throwOnError: true });
        const input = { ...request(value), requestId: '00000000-0000-4000-8000-000000000005',
            checklist: { base: task().checklist!, value: [{ id: 'check', title: 'Changed', isCompleted: false }] } };
        const prepared = unwrap(host.prepareTaskChecklistSave(input));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        expect(prepared.prepared.effect.tasks.find((row) => row.after.id === 'edit')?.after.attachments)
            .toEqual([...saved().attachments!, value[2]]);
        expect(host.validatePreparedTaskChecklistWrite({ request: input, prepared: prepared.prepared }))
            .toMatchObject({ ok: true });
        expect(await host.commitPreparedTaskChecklistWrite({ request: input, prepared: prepared.prepared }))
            .toMatchObject({ ok: true });
        expect(saved().checklist?.[0].title).toBe('Changed');
        const count = writes.mock.calls.length;
        await open();
        expect(await host.commitPreparedTaskChecklistWrite({ request: input, prepared: prepared.prepared }))
            .toMatchObject({ ok: true });
        expect(writes).toHaveBeenCalledTimes(count);
    });

    it('gives direct, V2 and unchanged-checklist Save the same link list', async () => {
        const value = await add([file, link]);
        const input = request(value);
        const v2 = unwrap(await host.prepareTaskDraftSaveV2(input));
        expect(v2.kind).toBe('prepared');
        if (v2.kind !== 'prepared') return;
        expect(await host.commitPreparedTaskDraftSave({ request: input, prepared: v2.prepared })).toMatchObject({ ok: true });
        const expected = structuredClone(saved().attachments);

        durable.tasks = [task()];
        await open();
        expect(await host.saveTaskDraft({ id: 'edit', base: {}, patch: {}, attachments: half(value),
            requestId: '00000000-0000-4000-8000-000000000006' })).toMatchObject({ ok: true });
        expect(saved().attachments).toEqual(expected);

        durable.tasks = [task()];
        await open();
        const checklist = { ...input, requestId: '00000000-0000-4000-8000-000000000007',
            checklist: { base: task().checklist!, value: task().checklist! } };
        const prepared = unwrap(host.prepareTaskChecklistSave(checklist));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        expect(await host.commitPreparedTaskChecklistWrite({ request: checklist, prepared: prepared.prepared }))
            .toMatchObject({ ok: true });
        expect(saved().attachments).toEqual(expected);
    });

    it('accepts the shared planner title decoded from an unlabeled URL in both prepared routes', async () => {
        const value = await add([file, link], 'https://example.org/a%20%20b');
        expect(value[2].title).toContain('a  b');
        const input = request(value);
        const v2 = unwrap(await host.prepareTaskDraftSaveV2(input));
        expect(v2.kind).toBe('prepared');
        if (v2.kind !== 'prepared') return;
        expect(await host.commitPreparedTaskDraftSave({ request: input, prepared: v2.prepared }))
            .toMatchObject({ ok: true });
        expect(saved().attachments).toEqual(value);

        durable.tasks = [task()];
        await open();
        const checklist = { ...input, requestId: '00000000-0000-4000-8000-000000000010',
            checklist: { base: task().checklist!, value: task().checklist! } };
        const prepared = unwrap(host.prepareTaskChecklistSave(checklist));
        expect(prepared.kind).toBe('prepared');
        if (prepared.kind !== 'prepared') return;
        expect(await host.commitPreparedTaskChecklistWrite({ request: checklist, prepared: prepared.prepared }))
            .toMatchObject({ ok: true });
        expect(saved().attachments).toEqual(value);
    });
});
