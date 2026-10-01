import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoardRecorder, loadBoardViewsFixture, seedBoardStore } from './board-view-model.replay';
import { createNativeHostContract } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { en } from './i18n/locales/en';
import type { AppData } from './types';

const fixture = loadBoardViewsFixture().board;
const taskId = 'n-draft';
const deleteId = '97bb2a90-d834-44b0-aed3-c2f7d0e48e5a';
const undoId = '97bb2a90-d834-44b0-aed3-c2f7d0e48e5b';
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
const current = () => useTaskStore.getState()._tasksById.get(taskId)!;
const open = async (saveData?: (data: AppData) => Promise<void>) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(fixture.now));
    await seedBoardStore(fixture, { name: 'task-delete', settings: 'base', actions: [] }, createBoardRecorder(), { saveData });
    const host = createNativeHostContract();
    value(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' }));
    value(await host.activate({ writeSafetyReady: true }));
    return host;
};
const restart = async () => {
    const host = createNativeHostContract();
    value(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' }));
    value(await host.activate({ writeSafetyReady: true, recoveryLoad: true }));
    return host;
};
const deletion = (host: Awaited<ReturnType<typeof open>>) => {
    const opening = value(host.getTaskEditorModel({ id: taskId }));
    const request = { requestId: deleteId, taskId, taskRevision: opening.taskRevision };
    const prepared = value(host.prepareTaskDelete(request));
    expect(prepared.kind).toBe('prepared');
    return { request, prepared: prepared.prepared };
};
const undo = (host: Awaited<ReturnType<typeof open>>, deleted: ReturnType<typeof deletion>) => {
    const request = { requestId: undoId, deleteRequestId: deleteId };
    const prepared = value(host.prepareTaskDeleteUndo({ request, delete: deleted }));
    expect(prepared.kind).toBe('prepared');
    return { request, prepared: prepared.prepared };
};

afterEach(async () => {
    await flushPendingSave();
    resetForTests();
    vi.useRealTimers();
});

describe('prepared Task editor Delete and Undo', () => {
    it('deletes the saved source, ignores an unsaved draft, and restores the saved row', async () => {
        const host = await open();
        const saved = copy(current());
        const opening = value(host.getTaskEditorModel({ id: taskId }));
        const edited = value(host.editTaskDraft({ id: taskId, draft: opening.draft,
            edit: { type: 'fields', patch: { title: 'Unsaved editor title' } } }));
        expect(edited.draft.title).toBe('Unsaved editor title');
        expect(current()).toEqual(saved);
        useTaskStore.setState({ settings: { ...useTaskStore.getState().settings, undoNotificationsEnabled: false } });
        const deleted = deletion(host);
        expect(deleted.prepared.board.prepared.before).toEqual(saved);
        expect(deleted.prepared.result).toEqual({ id: taskId, deletion: {
            message: 'Task deleted', undoLabel: 'Undo', undoEnabled: true,
        } });
        expect(value(host.validatePreparedTaskDelete(deleted))).toEqual(deleted.prepared.result);
        expect(value(await host.commitPreparedTaskDelete(deleted))).toEqual(deleted.prepared.result);
        expect(current()).toMatchObject({ title: saved.title, deletedAt: deleted.prepared.board.prepared.after.deletedAt });
        const restored = undo(host, deleted);
        expect(value(host.validatePreparedTaskDeleteUndo(restored))).toEqual({ id: taskId });
        expect(value(await host.commitPreparedTaskDeleteUndo(restored))).toEqual({ id: taskId });
        expect(current()).toMatchObject({ title: saved.title, projectId: saved.projectId });
        expect(current().sectionId).toBe(saved.sectionId);
        expect(current().areaId).toBe(saved.areaId);
        expect(current().deletedAt).toBeUndefined();
        expect(value(await (await restart()).commitPreparedTaskDeleteUndo(restored))).toEqual({ id: taskId });
    });

    it('allows saved Reference deletion but refuses stale rows, projected IDs and an archived parent', async () => {
        const host = await open();
        const old = deletion(host);
        await useTaskStore.getState().updateTask(taskId, { status: 'reference' });
        await flushPendingSave();
        expect(host.prepareTaskDelete(old.request)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        const reference = deletion(host);
        expect(value(await host.commitPreparedTaskDelete(reference))).toEqual(reference.prepared.result);
        expect(current()).toMatchObject({ status: 'reference' });
        expect(host.prepareTaskDelete({ ...reference.request, taskId: `${taskId}:projected-recurrence` })).toMatchObject({ ok: false });
        await useTaskStore.getState().restoreTask(taskId);
        useTaskStore.setState((state) => ({ _allProjects: state._allProjects.map((project) => project.id === current().projectId
            ? { ...project, status: 'archived' as const } : project) }));
        expect(host.prepareTaskDelete({ ...reference.request, taskRevision: value(host.getTaskEditorModel({ id: taskId })).taskRevision }))
            .toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
    });

    it('refuses Undo after target edits, a second Delete, or purge', async () => {
        const host = await open();
        const deleted = deletion(host);
        value(await host.commitPreparedTaskDelete(deleted));
        await useTaskStore.getState().updateTask(taskId, { title: 'Newer Trash title' });
        await flushPendingSave();
        const request = { requestId: undoId, deleteRequestId: deleteId };
        expect(host.prepareTaskDeleteUndo({ request, delete: deleted }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        await useTaskStore.getState().restoreTask(taskId);
        await useTaskStore.getState().deleteTask(taskId);
        await flushPendingSave();
        expect(host.prepareTaskDeleteUndo({ request, delete: deleted }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        await useTaskStore.getState().purgeTask(taskId);
        await flushPendingSave();
        expect(host.prepareTaskDeleteUndo({ request, delete: deleted }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });

    it('refuses a prepared Undo when the deleted target changes before commit', async () => {
        const host = await open();
        const deleted = deletion(host);
        value(await host.commitPreparedTaskDelete(deleted));
        const restored = undo(host, deleted);
        await useTaskStore.getState().updateTask(taskId, { title: 'Later edit in Trash' });
        await flushPendingSave();
        const before = copy(current());
        expect(await host.commitPreparedTaskDeleteUndo(restored))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(current()).toEqual(before);
    });

    it('sanitizes removed containers and refuses a changed sanitizer result before Undo commit', async () => {
        const host = await open();
        const deleted = deletion(host);
        value(await host.commitPreparedTaskDelete(deleted));
        const projectId = current().projectId!;
        const state = useTaskStore.getState();
        useTaskStore.setState({ _allProjects: state._allProjects.map((project) => project.id === projectId
            ? { ...project, deletedAt: fixture.now } : project) });
        const restored = undo(host, deleted);
        expect(restored.prepared.after.projectId).toBeUndefined();
        expect(restored.prepared.after.sectionId).toBeUndefined();
        useTaskStore.setState({ _allProjects: state._allProjects });
        expect(await host.commitPreparedTaskDeleteUndo(restored)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        useTaskStore.setState({ _allProjects: state._allProjects.map((project) => project.id === projectId
            ? { ...project, deletedAt: fixture.now } : project) });
        expect(value(await host.commitPreparedTaskDeleteUndo(restored))).toEqual({ id: taskId });
        expect(current().projectId).toBeUndefined();
    });

    it('keeps Delete and Undo journals valid after the current translation changes', async () => {
        const host = await open();
        const deleted = deletion(host);
        const priorDelete = en['list.taskDeleted'];
        const priorUndo = en['common.undo'];
        try {
            en['list.taskDeleted'] = 'Updated deletion wording';
            en['common.undo'] = 'Revert';
            const cold = await restart();
            expect(value(cold.validatePreparedTaskDelete(deleted))).toEqual(deleted.prepared.result);
            expect(value(await cold.commitPreparedTaskDelete(deleted))).toEqual(deleted.prepared.result);
            const restored = undo(cold, deleted);
            expect(value(cold.validatePreparedTaskDeleteUndo(restored))).toEqual({ id: taskId });
            expect(value(await cold.commitPreparedTaskDeleteUndo(restored))).toEqual({ id: taskId });
        } finally {
            en['list.taskDeleted'] = priorDelete;
            en['common.undo'] = priorUndo;
        }
    });

    it('rejects forged and oversized Delete/Undo journals before any write', async () => {
        const saveData = vi.fn(async () => undefined);
        const host = await open(saveData);
        const deleted = deletion(host);
        const initial = saveData.mock.calls.length;
        const forged = copy(deleted);
        forged.prepared.board.prepared.after.title = 'Forged';
        expect(host.validatePreparedTaskDelete(forged)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const oversized = copy(deleted);
        oversized.prepared.result.deletion.message = 'x'.repeat(2_000_001);
        expect(host.validatePreparedTaskDelete(oversized)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        value(await host.commitPreparedTaskDelete(deleted));
        const restored = undo(host, deleted);
        const tampered = copy(restored);
        tampered.prepared.after.title = 'Forged restore';
        expect(host.validatePreparedTaskDeleteUndo(tampered)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const badProof = copy(restored);
        badProof.prepared.delete.prepared.board.prepared.after.title = 'Forged Delete';
        expect(host.validatePreparedTaskDeleteUndo(badProof)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(saveData).toHaveBeenCalledTimes(initial + 1);
    });

    it('retries failed Delete and Undo saves with exact cold-store replay', async () => {
        let fail = false;
        let durable: AppData | null = null;
        const host = await open(async (next) => {
            if (fail) throw new Error('disk unavailable');
            durable = copy(next);
        });
        const deleted = deletion(host);
        fail = true;
        expect(await host.commitPreparedTaskDelete(deleted)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(current().deletedAt).toBe(deleted.prepared.board.prepared.after.deletedAt);
        fail = false;
        expect(value(await host.commitPreparedTaskDelete(deleted))).toEqual(deleted.prepared.result);
        const restored = undo(host, deleted);
        fail = true;
        expect(await host.commitPreparedTaskDeleteUndo(restored)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(current().deletedAt).toBeUndefined();
        fail = false;
        expect(value(await host.commitPreparedTaskDeleteUndo(restored))).toEqual({ id: taskId });
        const final = copy(durable!);
        resetForTests();
        setStorageAdapter({ getData: async () => final, saveData: async () => undefined });
        await useTaskStore.getState().fetchData({ throwOnError: true });
        const cold = await restart();
        expect(value(cold.validatePreparedTaskDeleteUndo(restored))).toEqual({ id: taskId });
        expect(value(await cold.commitPreparedTaskDeleteUndo(restored))).toEqual({ id: taskId });
        expect(current().deletedAt).toBeUndefined();
    }, 20_000);
});
