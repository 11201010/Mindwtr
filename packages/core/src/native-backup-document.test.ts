import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_BACKUP_SOURCE_BYTES, serializeBackupData, validateBackupJson } from './backup-transfer';
import { runSerializedSyncDocumentWriteOperation } from './data-transfer-transaction';
import { formatI18nTemplate, getTranslator } from './i18n';
import { applyImportSource, parseImportSource } from './import-runner';
import {
    buildNativeBackupDocumentResult, buildNativeBackupSnapshotRestoreConfirmation, commitNativeBackupDocument,
    inspectNativeBackupDocument, prepareNativeBackupDocument, readNativeBackupDocumentOutcome,
    type NativeBackupDocumentPrepareInput, type NativeBackupOperationReference,
} from './native-backup-document';
import { loadNativeRequestReceipts, NativeReceiptSqliteAdapter, resetNativeRequestReceipts } from './native-request-receipts';
import { openScratchSqlite } from './screen-parity.replay';
import { SqliteAdapter, type SqliteClient } from './sqlite-adapter';
import { resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Task } from './types';

const AT = '2026-10-04T12:00:00.000Z';
const ID = '11111111-1111-4111-8111-111111111111';
const NAME = 'data.2026-10-04T12-00-00.000.snapshot.json';
const metadata = { fileName: 'owned.json', lastModified: Date.parse(AT), appVersion: '1.3.4' };
const reference: NativeBackupOperationReference = { id: ID, sha256: 'a'.repeat(64), byteCount: 420 };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, status: 'next', contexts: [], tags: [],
    createdAt: AT, updatedAt: AT, rev: 1, ...extra });
const original: AppData = { tasks: [task('visible'), task('history', { status: 'done', completedAt: AT }),
    task('hidden', { status: 'archived' })], projects: [], sections: [], areas: [], people: [], settings: { language: 'en' } };
const incoming: AppData = { ...clone(original), tasks: [task('visible', { title: '日本語 🦉', rev: 2 }), task('new')], settings: { language: 'de' } };
const input = (text = serializeBackupData(incoming), operation: 'merge' | 'restore' = 'merge'): NativeBackupDocumentPrepareInput =>
    ({ requestId: ID, mode: operation, snapshotName: NAME, text, metadata: clone(metadata) });
const t = (key: string, params?: Record<string, number | string>) => formatI18nTemplate(getTranslator('en')(key), params ?? {});
const resources: { close: () => void; directory: string }[] = [];
const temporaryRoot = fileURLToPath(new URL('../../../.orchestrator/tmp/', import.meta.url));
async function open(data = original) {
    mkdirSync(temporaryRoot, { recursive: true });
    const directory = mkdtempSync(join(temporaryRoot, 'backup-document-'));
    const sql = openScratchSqlite(join(directory, 'document.sqlite'));
    resources.push({ close: sql.close, directory });
    await new SqliteAdapter(sql.client).saveData(clone(data));
    resetNativeRequestReceipts();
    await loadNativeRequestReceipts(sql.client, { durableCommands: ['backupDocument'] });
    const writes: string[] = [];
    const hooks: { run?: (statement: string) => Promise<void> } = {};
    const client: SqliteClient = { ...sql.client, run: async (statement, params) => {
        writes.push(statement); await hooks.run?.(statement); await sql.client.run(statement, params);
    } };
    const adapter = new NativeReceiptSqliteAdapter(client, { rejectConcurrentWrites: true });
    setStorageAdapter(adapter);
    useTaskStore.setState({ persistenceFailure: null, isLoading: false, editLockCount: 0, error: null,
        tasks: [], projects: [], sections: [], areas: [], people: [], settings: {},
        _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        _tasksById: new Map(), _projectsById: new Map(), _sectionsById: new Map(), _areasById: new Map(), _peopleById: new Map(),
        lastDataChangeAt: 0 });
    await useTaskStore.getState().fetchData({ throwOnError: true, recoveryLoad: true });
    writes.length = 0;
    const state = async () => ({ tasks: await sql.client.all('SELECT * FROM tasks ORDER BY id'),
        settings: await sql.client.all('SELECT * FROM settings'), receipts: await sql.client.all('SELECT * FROM native_request_receipts') });
    return { sql, adapter, client, writes, hooks, state };
}
afterEach(() => {
    vi.restoreAllMocks(); resetForTests(); resetNativeRequestReceipts();
    useTaskStore.setState({ persistenceFailure: null, error: null });
    for (const resource of resources.splice(0).reverse()) { resource.close(); rmSync(resource.directory, { recursive: true, force: true }); }
});

describe('native immutable backup inspection and models', () => {
    it('previews owned bytes with RN counts, effect and warnings; cancellation writes nothing', async () => {
        const env = await open(); const before = await env.state();
        const preview = inspectNativeBackupDocument(input().text, metadata, t);
        expect(preview.valid).toBe(true); expect(preview.title).toBe(t('settings.mergeBackup'));
        expect(preview.summary).toContain(t('settings.backupMobile.backupPreviewCounts', { taskCount: 2, projectCount: 0 }));
        expect(preview.summary).toContain(t('settings.mergeBackupConfirm'));
        expect(env.writes).toEqual([]); expect(await env.state()).toEqual(before);
    });
    it.each(['{private-content', 'null', '{"tasks":"private-content"}'])('returns localized invalid input without raw content: %s', (text) => {
        const preview = inspectNativeBackupDocument(text, metadata, t);
        expect(preview.valid).toBe(false); expect(preview.errorMessage).toBeTruthy();
        expect(JSON.stringify(preview)).not.toContain('private-content');
    });
    it('uses structured version warnings', () => {
        const source = JSON.stringify({ data: incoming, backupMetadata: { createdAt: AT, version: '99.0.0' } });
        const parsed = parseImportSource('backup', { text: source, ...metadata });
        expect(parsed.diagnostics.some((item) => item.severity === 'warning')).toBe(true);
        expect(inspectNativeBackupDocument(source, metadata, t).summary).toContain(t('settings.backupDiagnostics.newerVersion', { version: '99.0.0' }));
    });
    it('enforces actual UTF-8 bytes including multibyte and surrogate pairs', () => {
        const ascii = ' '.repeat(MAX_BACKUP_SOURCE_BYTES - 2) + '{}';
        // At the exact cap parsing reaches ordinary JSON diagnostics, rather than size refusal.
        expect(inspectNativeBackupDocument(ascii, metadata, t).errorMessage).not.toBe(t('settings.backupDiagnostics.tooLarge', { maxSizeMb: 128 }));
        expect(inspectNativeBackupDocument('🦉'.repeat(MAX_BACKUP_SOURCE_BYTES / 4 + 1), metadata, t).errorMessage)
            .toBe(t('settings.backupDiagnostics.tooLarge', { maxSizeMb: 128 }));
    }, 30_000);
    it('uses RN success and Undo words with the exact accepted snapshot', () => {
        const reply = { version: 1 as const, operation: 'merge' as const, snapshotName: NAME, added: 2, updated: 3 };
        expect(buildNativeBackupDocumentResult(reply, t)).toEqual({ title: t('settings.mergeBackup'),
            message: `${t('settings.mergeBackupSummary', { addedCount: 2, updatedCount: 3 })}\n${t('settings.backupMobile.recoverySnapshotSaved', { snapshotName: NAME })}`,
            undoLabel: t('settings.undoImport'), doneLabel: t('common.done') });
        const confirmation = buildNativeBackupSnapshotRestoreConfirmation(NAME, t);
        expect(confirmation.title).toBe(t('settings.undoImportConfirmTitle'));
        expect(confirmation.message).toContain('Anything you changed since is rolled back too');
        expect(buildNativeBackupDocumentResult({ ...reply, operation: 'restore', added: 0, updated: 0 }, t).message)
            .toBe(t('settings.backupMobile.recoverySnapshotRestored'));
    });
});

describe('native frozen backup plan over actual SQLite', () => {
    it('prepares from latest durable edits and preserves complete history without writing', async () => {
        const env = await open(); const current = await env.adapter.getData();
        current.tasks.push(task('before-confirmation')); await env.adapter.saveData(current); env.writes.length = 0;
        const source = input(); const before = await env.state();
        const prepared = await prepareNativeBackupDocument(env.adapter, source); const plan = JSON.parse(prepared.planJSON);
        expect(plan.expectedCurrent.tasks.map((item: Task) => item.id)).toContain('before-confirmation');
        expect(plan.data.tasks.map((item: Task) => item.id)).toEqual(expect.arrayContaining(['history', 'hidden', 'before-confirmation', 'new']));
        expect(plan.reply).toEqual({ version: 1, operation: 'merge', snapshotName: NAME, added: 1, updated: 1 });
        expect(validateBackupJson(prepared.recoveryJSON!, metadata).valid).toBe(true);
        expect(JSON.parse(prepared.recoveryJSON!).tasks).toHaveLength(4);
        expect(JSON.parse(prepared.recoveryJSON!).tasks.find((item: Task) => item.id === 'visible').title).toBe('visible');
        expect(source).toEqual(input()); expect(env.writes).toEqual([]); expect(await env.state()).toEqual(before);
    });
    it('accepts a large-note source and external plan beyond the old bounded journal capacity', async () => {
        const base = clone(original); base.tasks[0].description = 'local 日本語 🦉'.repeat(400_000);
        const backup = clone(incoming); backup.tasks[0].description = 'incoming 日本語 🦉'.repeat(400_000);
        const env = await open(base); const source = input(serializeBackupData(backup));
        expect(Buffer.byteLength(source.text, 'utf8')).toBeGreaterThan(2 * 1024 * 1024);
        const prepared = await prepareNativeBackupDocument(env.adapter, source);
        expect(Buffer.byteLength(prepared.planJSON, 'utf8')).toBeGreaterThan(12 * 1024 * 1024);
        await commitNativeBackupDocument(env.adapter, reference, prepared.planJSON, NAME);
        expect((await env.adapter.getData()).tasks.find((item) => item.id === 'visible')?.description).toBe(backup.tasks[0].description);
    }, 30_000);
    it('uses shared additive entity/attachment tombstone policy and persists the actual prepared effect', async () => {
        const base = clone(original);
        base.tasks.push(task('deleted', { deletedAt: AT }));
        base.tasks[0].attachments = [{ id: 'removed', kind: 'file', title: 'removed', uri: '', createdAt: AT, updatedAt: AT, deletedAt: AT }];
        const backup = clone(incoming);
        backup.tasks.push(task('deleted', { rev: 8 }), task('incoming-deleted', { deletedAt: AT }));
        backup.tasks[0].attachments = [{ id: 'removed', kind: 'file', title: 'removed', uri: '', createdAt: AT, updatedAt: AT },
            { id: 'incoming-removed', kind: 'file', title: 'removed', uri: '', createdAt: AT, updatedAt: AT, deletedAt: AT }];
        const env = await open(base); const prepared = await prepareNativeBackupDocument(env.adapter, input(serializeBackupData(backup)));
        await commitNativeBackupDocument(env.adapter, reference, prepared.planJSON, NAME);
        const durable = await env.adapter.getData();
        expect(durable.tasks.find((item) => item.id === 'deleted')?.deletedAt).toBe(AT);
        expect(durable.tasks.some((item) => item.id === 'incoming-deleted')).toBe(false);
        expect(durable.tasks.find((item) => item.id === 'visible')?.attachments?.filter((item) => !item.deletedAt)).toEqual([]);
        expect(durable.tasks.find((item) => item.id === 'history')?.completedAt).toBe(AT);
    });
    it('refuses stale preparation after an intervening durable edit with no writes', async () => {
        const env = await open(); const prepared = await prepareNativeBackupDocument(env.adapter, input());
        const later = await env.adapter.getData(); later.tasks[0] = { ...later.tasks[0], title: 'later', rev: 3 };
        await env.adapter.saveData(later); const before = await env.state(); env.writes.length = 0;
        await expect(commitNativeBackupDocument(env.adapter, reference, prepared.planJSON, NAME)).rejects.toThrow('STALE_REVISION:');
        expect(env.writes).toEqual([]); expect(await env.state()).toEqual(before);
    });
    it('cold-replays the first reply preserving intervening durable edits with zero document writes', async () => {
        const env = await open(); const prepared = await prepareNativeBackupDocument(env.adapter, input());
        const first = await commitNativeBackupDocument(env.adapter, reference, prepared.planJSON, NAME);
        const later = await env.adapter.getData(); later.tasks[0] = { ...later.tasks[0], title: 'later', rev: 9 }; await env.adapter.saveData(later);
        const before = await env.state(); resetNativeRequestReceipts();
        await loadNativeRequestReceipts(env.sql.client, { durableCommands: ['backupDocument'] });
        const cold = new NativeReceiptSqliteAdapter(env.client, { rejectConcurrentWrites: true });
        await cold.ensureSchema(); // Native boot establishes schema before journal replay.
        setStorageAdapter(cold); env.writes.length = 0;
        expect(await commitNativeBackupDocument(cold, reference, prepared.planJSON, NAME)).toEqual(first);
        expect(env.writes).toEqual([]); expect(await env.state()).toEqual(before);
        expect(useTaskStore.getState()._allTasks.find((item) => item.id === later.tasks[0].id)?.title).toBe('later');
    });
    it('rolls back failed COMMIT and never invents terminal proof', async () => {
        const env = await open(); const prepared = await prepareNativeBackupDocument(env.adapter, input()); const before = await env.state();
        env.hooks.run = async (statement) => { if (statement === 'COMMIT') throw new Error('private SQL failure'); };
        await expect(commitNativeBackupDocument(env.adapter, reference, prepared.planJSON, NAME)).rejects.toThrow('SAVE_FAILED:');
        expect(await env.state()).toEqual(before);
        expect(await readNativeBackupDocumentOutcome(env.adapter, reference, prepared.planJSON, NAME)).toBeNull();
    });
    it('receipts a no-op plan and returns the same terminal reply without a second write', async () => {
        const env = await open(); const current = await env.adapter.getData();
        const prepared = await prepareNativeBackupDocument(env.adapter, input(serializeBackupData(current)));
        const plan = JSON.parse(prepared.planJSON);
        // Exercise a frozen exact no-op independently of merge's tie-resolution counts.
        plan.data = clone(plan.expectedCurrent); plan.reply.added = 0; plan.reply.updated = 0;
        const noOpPlan = JSON.stringify(plan);
        const before = await env.adapter.getData();
        const first = await commitNativeBackupDocument(env.adapter, reference, noOpPlan, NAME);
        expect(await env.adapter.getData()).toEqual(before);
        expect(await env.sql.client.all('SELECT request_id FROM native_request_receipts')).toEqual([{ request_id: ID }]);
        env.writes.length = 0;
        expect(await commitNativeBackupDocument(env.adapter, reference, noOpPlan, NAME)).toEqual(first);
        expect(env.writes).toEqual([]);
    });
    it('retains provable receipt after refresh failure and exact replay only reloads', async () => {
        const env = await open(); const prepared = await prepareNativeBackupDocument(env.adapter, input());
        const fetchData = useTaskStore.getState().fetchData;
        useTaskStore.setState({ fetchData: async () => { throw new Error('private refresh failure'); } });
        await expect(commitNativeBackupDocument(env.adapter, reference, prepared.planJSON, NAME)).rejects.toThrow('SAVE_FAILED: Backup document was saved but reload failed');
        const committed = await env.state(); env.writes.length = 0;
        expect(await readNativeBackupDocumentOutcome(env.adapter, reference, prepared.planJSON, NAME)).toEqual(JSON.parse(prepared.planJSON).reply);
        expect(env.writes).toEqual([]);
        useTaskStore.setState({ fetchData });
        await commitNativeBackupDocument(env.adapter, reference, prepared.planJSON, NAME);
        expect(await env.state()).toEqual(committed); expect(env.writes).toEqual([]);
    });
    it('terminal outcome reads no store/domain data, never flushes or refreshes, and returns null on missing proof', async () => {
        const env = await open(); const prepared = await prepareNativeBackupDocument(env.adapter, input());
        const read = vi.spyOn(env.adapter, 'getData'); const save = vi.spyOn(env.adapter, 'saveDocumentWithReceipt');
        const refresh = vi.fn(async () => { throw new Error('must not refresh'); });
        const previous = useTaskStore.getState().fetchData; useTaskStore.setState({ fetchData: refresh, persistenceFailure: { message: 'owed' } as never });
        expect(await readNativeBackupDocumentOutcome(env.adapter, reference, prepared.planJSON, NAME)).toBeNull();
        expect(read).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
        useTaskStore.setState({ fetchData: previous, persistenceFailure: null });
    });
    it('Undo uses RN restore policy above newer revisions and tombstones later local-only IDs without making another recovery', async () => {
        const env = await open(); const merged = await prepareNativeBackupDocument(env.adapter, input());
        await commitNativeBackupDocument(env.adapter, reference, merged.planJSON, NAME);
        const later = await env.adapter.getData(); later.tasks.push(task('after-merge', { rev: 20 }));
        later.tasks[0] = { ...later.tasks[0], title: 'later', rev: 30 }; await env.adapter.saveData(later);
        const restoreInput = { ...input(merged.recoveryJSON!, 'restore'), requestId: '22222222-2222-4222-8222-222222222222' };
        const restored = await prepareNativeBackupDocument(env.adapter, restoreInput);
        expect(restored.recoveryJSON).toBeNull();
        const plan = JSON.parse(restored.planJSON);
        const expected = applyImportSource('backup', plan.expectedCurrent, parseImportSource('backup', { text: merged.recoveryJSON!, ...metadata }).data!).data;
        // Restore revisions/timestamps are clock-derived; compare at a fixed clock below through final assertions.
        expect(plan.data.tasks.find((item: Task) => item.id === 'after-merge').deletedAt).toBeTruthy();
        expect(plan.data.tasks.find((item: Task) => item.id === later.tasks[0].id).rev).toBeGreaterThan(30);
        expect(plan.data.tasks.find((item: Task) => item.id === 'visible').title).toBe(expected.tasks.find((item) => item.id === 'visible')?.title);
        await commitNativeBackupDocument(env.adapter, { ...reference, id: restoreInput.requestId, sha256: 'b'.repeat(64) }, restored.planJSON, NAME);
        const durable = await env.adapter.getData();
        expect(durable.tasks.find((item) => item.id === 'after-merge')?.deletedAt).toBeTruthy();
        expect(durable.tasks.find((item) => item.id === 'visible')?.title).toBe('visible');
        expect(durable.settings.language).toBe('en');
    });
    it.each(['extra', 'requestId', 'preparedAt', 'data', 'counts', 'snapshot'] as const)('rejects invalid frozen %s before adapter operations', async (fault) => {
        const env = await open(); const prepared = await prepareNativeBackupDocument(env.adapter, input()); const plan = JSON.parse(prepared.planJSON);
        if (fault === 'extra') plan.extra = true;
        if (fault === 'requestId') plan.requestId = '22222222-2222-4222-8222-222222222222';
        if (fault === 'preparedAt') plan.preparedAt = '2026-10-04';
        if (fault === 'data') plan.data.tasks = [null];
        if (fault === 'counts') plan.reply.added = -1;
        if (fault === 'snapshot') plan.reply.snapshotName = '../private';
        const save = vi.spyOn(env.adapter, 'saveDocumentWithReceipt'); env.writes.length = 0;
        await expect(commitNativeBackupDocument(env.adapter, reference, JSON.stringify(plan), NAME)).rejects.toThrow('INVALID_INPUT:');
        expect(save).not.toHaveBeenCalled(); expect(env.writes).toEqual([]);
    });
    it.each(['sha', 'bytes', 'uuid', 'extra'] as const)('rejects invalid manifest %s before writing', async (fault) => {
        const env = await open(); const prepared = await prepareNativeBackupDocument(env.adapter, input()); const ref = { ...reference };
        if (fault === 'sha') ref.sha256 = 'A'.repeat(64);
        if (fault === 'bytes') ref.byteCount = 8193;
        if (fault === 'uuid') ref.id = ID.toUpperCase().replace('11111111', 'AAAAAAAA');
        if (fault === 'extra') Object.assign(ref, { private: 'private' });
        await expect(commitNativeBackupDocument(env.adapter, ref, prepared.planJSON, NAME)).rejects.toThrow('INVALID_INPUT:');
        expect(env.writes).toEqual([]);
    });
    it.each(['plan', 'reference', 'reply', 'malformed'] as const)('refuses changed durable %s identity/reply without rewriting', async (fault) => {
        const env = await open(); const prepared = await prepareNativeBackupDocument(env.adapter, input());
        await commitNativeBackupDocument(env.adapter, reference, prepared.planJSON, NAME); env.writes.length = 0;
        const plan = JSON.parse(prepared.planJSON); const ref = { ...reference };
        if (fault === 'plan') plan.reply.added += 1;
        if (fault === 'reference') ref.sha256 = 'b'.repeat(64);
        if (fault === 'reply') await env.sql.client.run('UPDATE native_request_receipts SET reply=?', [JSON.stringify({ ...plan.reply, updated: 99 })]);
        if (fault === 'malformed') await env.sql.client.run('UPDATE native_request_receipts SET reply=?', ['{private']);
        await expect(commitNativeBackupDocument(env.adapter, ref, JSON.stringify(plan), NAME)).rejects.toThrow('SAVE_FAILED:');
        await expect(readNativeBackupDocumentOutcome(env.adapter, ref, JSON.stringify(plan), NAME)).rejects.toThrow('SAVE_FAILED:');
        expect(env.writes).toEqual([]);
    });
    it('captures mutable call inputs before waiting in the serialized queue', async () => {
        const env = await open(); const prepared = await prepareNativeBackupDocument(env.adapter, input());
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const blocker = runSerializedSyncDocumentWriteOperation(() => held);
        const ref = { ...reference }; const operation = commitNativeBackupDocument(env.adapter, ref, prepared.planJSON, NAME);
        ref.sha256 = 'b'.repeat(64); ref.id = '22222222-2222-4222-8222-222222222222'; release(); await blocker;
        await operation;
        expect(await readNativeBackupDocumentOutcome(env.adapter, reference, prepared.planJSON, NAME)).not.toBeNull();
    });
    it('rejects invalid prepare or owed persistence with no document writes', async () => {
        const env = await open();
        await expect(prepareNativeBackupDocument(env.adapter, { ...input(), snapshotName: '../private' })).rejects.toThrow('INVALID_INPUT:');
        useTaskStore.setState({ persistenceFailure: { message: 'private' } as never });
        await expect(prepareNativeBackupDocument(env.adapter, input())).rejects.toThrow('SAVE_FAILED:');
        expect(env.writes).toEqual([]);
    });
});
