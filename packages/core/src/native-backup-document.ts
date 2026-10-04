import { MAX_BACKUP_SOURCE_BYTES, serializeBackupData } from './backup-transfer';
import { runSerializedSyncDocumentWriteOperation } from './data-transfer-transaction';
import { formatImportDiagnostic, type ImportDiagnosticTranslator } from './import-diagnostics';
import { applyImportSource, parseImportSource, summarizeBackupMerge } from './import-runner';
import { taskEditValuesEqual } from './json-value-equality';
import type { NativeReceiptSqliteAdapter } from './native-request-receipts';
import { flushPendingSave, useTaskStore } from './store';
import { markNextLoadAsDocumentReplacement } from './store-settings';
import { validateMergedSyncData } from './sync-normalization';
import { cloneAppData } from './sync-runtime-utils';
import type { AppData } from './types';

export const MAX_NATIVE_BACKUP_PLAN_BYTES = 512 * 1024 * 1024;
export type NativeBackupDocumentMetadata = { fileName: string; lastModified: number; appVersion: string };
export type NativeBackupOperationReference = { id: string; sha256: string; byteCount: number };
export type NativeBackupDocumentReply = {
    version: 1; operation: 'merge' | 'restore'; snapshotName: string; added: number; updated: number;
};
export type NativeBackupDocumentPrepareInput = {
    requestId: string; mode: 'merge' | 'restore'; snapshotName: string;
    text: string; metadata: NativeBackupDocumentMetadata;
};
type Plan = {
    version: 1; requestId: string; mode: 'merge' | 'restore'; preparedAt: string;
    expectedCurrent: AppData; data: AppData; reply: NativeBackupDocumentReply;
};
class BackupInputError extends Error {}
function invalid(message = 'Invalid backup document input'): never { throw new BackupInputError(`INVALID_INPUT: ${message}`); }
function saveFailed(): never { throw new Error('SAVE_FAILED: Backup document outcome could not be verified'); }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, fields: string[]): value is Record<string, unknown> => record(value)
    && Object.keys(value).length === fields.length && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
const uuid = (value: unknown): value is string => typeof value === 'string'
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);
const mode = (value: unknown): value is 'merge' | 'restore' => value === 'merge' || value === 'restore';
const snapshotPattern = /^data\.(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:\.(\d{3})(?:\.\d+)?)?\.snapshot\.json$/u;
const snapshot = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length > 128) return false;
    const match = snapshotPattern.exec(value);
    if (!match) return false;
    const timestamp = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5] ?? '000'}Z`;
    return Number.isFinite(Date.parse(timestamp)) && new Date(timestamp).toISOString() === timestamp;
};
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const metadataValid = (value: unknown): value is NativeBackupDocumentMetadata => exact(value, ['fileName', 'lastModified', 'appVersion'])
    && typeof value.fileName === 'string' && value.fileName.length <= 1024
    && typeof value.appVersion === 'string' && value.appVersion.length <= 128
    && typeof value.lastModified === 'number' && Number.isFinite(value.lastModified) && value.lastModified >= 0;

// Count without allocating a second encoded copy of a document up to 512 MiB.
// Unpaired UTF-16 surrogates become the UTF-8 replacement character, as TextEncoder does.
const withinUtf8Limit = (value: unknown, limit: number): value is string => {
    if (typeof value !== 'string' || value.length > limit) return false;
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
            && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
            bytes += 4; index += 1;
        } else bytes += 3;
        if (bytes > limit) return false;
    }
    return true;
};
const parseSource = (text: unknown, metadata: unknown) => {
    if (!withinUtf8Limit(text, MAX_BACKUP_SOURCE_BYTES)) invalid('Backup source exceeds 128 MiB');
    if (!metadataValid(metadata)) invalid();
    return parseImportSource('backup', { text, ...metadata });
};

/** RN's immutable inspection preview. Invalid files are ordinary localized values. */
export function inspectNativeBackupDocument(text: string, metadata: NativeBackupDocumentMetadata, t: ImportDiagnosticTranslator) {
    const model = {
        valid: false, title: t('settings.mergeBackup'), summary: '', confirmLabel: t('settings.mergeBackupAction'),
        cancelLabel: t('common.cancel'), errorTitle: t('settings.backupMobile.invalidBackup'),
        errorMessage: t('settings.backupMobile.thisFileIsNotAValidMindwtrBackup'),
    };
    if (!withinUtf8Limit(text, MAX_BACKUP_SOURCE_BYTES)) {
        return { ...model, errorMessage: formatImportDiagnostic({ code: 'backup-source-too-large', severity: 'error',
            params: { maxSizeMb: 128 } }, t) };
    }
    try {
        const validation = parseSource(text, metadata);
        if (!validation.valid || !validation.data) {
            const errors = validation.diagnostics.filter((item) => item.severity === 'error');
            return { ...model, errorMessage: errors.length ? errors.map((item) => formatImportDiagnostic(item, t)).join('\n') : model.errorMessage };
        }
        const warnings = validation.diagnostics.filter((item) => item.severity === 'warning').map((item) => formatImportDiagnostic(item, t));
        const details = [
            validation.metadata?.backupAt
                ? t('settings.backupMobile.backupDateLabel', { backupDate: new Date(validation.metadata.backupAt).toLocaleString() })
                : validation.metadata?.fileName ? t('settings.backupMobile.fileLabel', { fileName: validation.metadata.fileName }) : null,
            t('settings.backupMobile.backupPreviewCounts', { taskCount: validation.metadata?.taskCount ?? 0, projectCount: validation.metadata?.projectCount ?? 0 }),
            t('settings.mergeBackupConfirm'), ...(warnings.length ? ['', ...warnings] : []),
        ].filter(Boolean);
        return { ...model, valid: true, summary: details.join('\n'), errorMessage: '' };
    } catch { return model; }
}

const flush = async () => {
    if (useTaskStore.getState().persistenceFailure) saveFailed();
    await flushPendingSave();
    if (useTaskStore.getState().persistenceFailure) saveFailed();
};
const completeDocument = (value: unknown): value is AppData => record(value)
    && ['tasks', 'projects', 'sections', 'areas', 'people'].every((field) => Array.isArray(value[field]))
    && record(value.settings) && validateMergedSyncData(value as unknown as AppData).length === 0;

/** Freeze shared RN policy against a fresh durable base; this performs no document or file write. */
export async function prepareNativeBackupDocument(adapter: NativeReceiptSqliteAdapter, input: NativeBackupDocumentPrepareInput): Promise<{ planJSON: string; recoveryJSON: string | null }> {
    if (!exact(input, ['requestId', 'mode', 'snapshotName', 'text', 'metadata'])
        || !uuid(input.requestId) || !mode(input.mode) || !snapshot(input.snapshotName)) invalid();
    // Parse owned bytes before admission; no untrusted thrown details escape.
    let validation: ReturnType<typeof parseSource>;
    try { validation = parseSource(input.text, input.metadata); }
    catch (error) { if (error instanceof BackupInputError) throw error; return invalid(); }
    if (!validation.valid || !validation.data) invalid();
    const parsed = validation.data;
    const { requestId, mode: operation, snapshotName } = input;
    const appVersion = input.metadata.appVersion;
    try {
        return await runSerializedSyncDocumentWriteOperation(async () => {
            await flush();
            const current = await adapter.getData();
            if (!completeDocument(current)) invalid();
            const expectedCurrent = cloneAppData(current);
            const applied = operation === 'merge' ? applyImportSource('backup-merge', current, parsed) : null;
            const data = applied?.data ?? applyImportSource('backup', current, parsed).data;
            const counts = applied ? summarizeBackupMerge(applied.result) : { added: 0, updated: 0 };
            const plan: Plan = { version: 1, requestId, mode: operation, preparedAt: new Date().toISOString(),
                expectedCurrent, data, reply: { version: 1, operation, snapshotName, ...counts } };
            if (!completeDocument(data)) invalid();
            const recoveryJSON = operation === 'merge' ? serializeBackupData(expectedCurrent) : null;
            if (recoveryJSON !== null) {
                if (!withinUtf8Limit(recoveryJSON, MAX_BACKUP_SOURCE_BYTES)) invalid('Recovery snapshot exceeds 128 MiB');
                if (!parseSource(recoveryJSON, { fileName: snapshotName, lastModified: Date.now(), appVersion }).valid) invalid('Recovery snapshot is not a valid backup');
            }
            const planJSON = JSON.stringify(plan);
            if (!withinUtf8Limit(planJSON, MAX_NATIVE_BACKUP_PLAN_BYTES)) invalid('Prepared backup plan exceeds 512 MiB');
            return { planJSON, recoveryJSON };
        });
    } catch (error) {
        if (error instanceof BackupInputError) throw error;
        return saveFailed();
    }
}

const validateReply = (value: unknown, snapshotName?: string, operation?: 'merge' | 'restore'): NativeBackupDocumentReply => {
    if (!exact(value, ['version', 'operation', 'snapshotName', 'added', 'updated']) || value.version !== 1
        || !mode(value.operation) || !snapshot(value.snapshotName) || !count(value.added) || !count(value.updated)
        || value.operation === 'restore' && (value.added !== 0 || value.updated !== 0)
        || snapshotName !== undefined && value.snapshotName !== snapshotName || operation !== undefined && value.operation !== operation) invalid();
    return value as NativeBackupDocumentReply;
};
const readPlan = (reference: NativeBackupOperationReference, planJSON: string, snapshotName: string): Plan => {
    if (!exact(reference, ['id', 'sha256', 'byteCount']) || !uuid(reference.id)
        || typeof reference.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(reference.sha256)
        || !Number.isSafeInteger(reference.byteCount) || reference.byteCount < 1 || reference.byteCount > 8192
        || !snapshot(snapshotName) || !withinUtf8Limit(planJSON, MAX_NATIVE_BACKUP_PLAN_BYTES)) invalid();
    let value: unknown;
    try { value = JSON.parse(planJSON); } catch { return invalid(); }
    if (!exact(value, ['version', 'requestId', 'mode', 'preparedAt', 'expectedCurrent', 'data', 'reply'])
        || value.version !== 1 || value.requestId !== reference.id || !mode(value.mode)
        || typeof value.preparedAt !== 'string' || !Number.isFinite(Date.parse(value.preparedAt))
        || new Date(value.preparedAt).toISOString() !== value.preparedAt
        ) invalid();
    try { if (!completeDocument(value.expectedCurrent) || !completeDocument(value.data)) invalid(); }
    catch { return invalid(); }
    validateReply(value.reply, snapshotName, value.mode);
    return value as Plan;
};
const payload = (reference: NativeBackupOperationReference, plan: Plan) => JSON.stringify(['backupDocument', plan.mode, reference.id, reference.sha256]);
const matchedReply = (reply: unknown, plan: Plan): NativeBackupDocumentReply => {
    try {
        const validated = validateReply(reply, plan.reply.snapshotName, plan.mode);
        if (!taskEditValuesEqual(validated, plan.reply)) saveFailed();
        return validated;
    } catch { return saveFailed(); }
};

/** Read terminal success proof only: never flush, reload, reapply policy or save. */
export async function readNativeBackupDocumentOutcome(adapter: NativeReceiptSqliteAdapter, reference: NativeBackupOperationReference, planJSON: string, snapshotName: string): Promise<NativeBackupDocumentReply | null> {
    const plan = readPlan(reference, planJSON, snapshotName);
    try {
        const result = await adapter.readDurableReceipt(reference.id, payload(reference, plan));
        if (!result.ok) saveFailed();
        return result.value === null ? null : matchedReply(result.value, plan);
    } catch { return saveFailed(); }
}

/** Commit only the frozen plan, or reload after an exact durable replay. */
export async function commitNativeBackupDocument(adapter: NativeReceiptSqliteAdapter, reference: NativeBackupOperationReference, planJSON: string, snapshotName: string): Promise<NativeBackupDocumentReply> {
    const plan = readPlan(reference, planJSON, snapshotName);
    const ownedReference = { ...reference };
    try {
        return await runSerializedSyncDocumentWriteOperation(async () => {
            await flush();
            let result;
            try {
                result = await adapter.saveDocumentWithReceipt({ requestId: ownedReference.id, payload: payload(ownedReference, plan),
                    expectedCurrent: plan.expectedCurrent, data: plan.data, reply: plan.reply });
            } catch (error) {
                if (error instanceof Error && error.message === 'Stale document receipt baseline') {
                    throw new Error('STALE_REVISION: Local data changed after backup preparation');
                }
                return saveFailed();
            }
            const reply = matchedReply(result.reply, plan);
            try {
                markNextLoadAsDocumentReplacement();
                // Maintenance resumes only after the native journal has been cleared.
                await useTaskStore.getState().fetchData({ throwOnError: true, recoveryLoad: true });
            } catch { throw new Error('SAVE_FAILED: Backup document was saved but reload failed'); }
            return reply;
        });
    } catch (error) {
        if (error instanceof Error && (error.message === 'STALE_REVISION: Local data changed after backup preparation'
            || error.message === 'SAVE_FAILED: Backup document was saved but reload failed')) throw error;
        return saveFailed();
    }
}

export function buildNativeBackupDocumentResult(reply: NativeBackupDocumentReply, t: ImportDiagnosticTranslator) {
    validateReply(reply);
    return {
        title: t(reply.operation === 'merge' ? 'settings.mergeBackup' : 'settings.backupMobile.restoreComplete'),
        message: reply.operation === 'merge' ? [
            t('settings.mergeBackupSummary', { addedCount: reply.added, updatedCount: reply.updated }),
            t('settings.backupMobile.recoverySnapshotSaved', { snapshotName: reply.snapshotName }),
        ].join('\n') : t('settings.backupMobile.recoverySnapshotRestored'),
        undoLabel: reply.operation === 'merge' ? t('settings.undoImport') : '', doneLabel: t('common.done'),
    };
}

export function buildNativeBackupSnapshotRestoreConfirmation(snapshotName: string, t: ImportDiagnosticTranslator) {
    if (!snapshot(snapshotName)) invalid();
    const match = snapshotName.match(snapshotPattern)!;
    const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5] ?? '000'}Z`);
    const label = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return { title: t('settings.undoImportConfirmTitle'), message: t('settings.undoImportConfirm', { snapshotName: label }),
        confirmLabel: t('markdown.referenceRestore'), cancelLabel: t('common.cancel') };
}
