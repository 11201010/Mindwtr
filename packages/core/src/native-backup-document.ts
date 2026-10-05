import { MAX_BACKUP_SOURCE_BYTES, serializeBackupData } from './backup-transfer';
import { base64ToBytes } from './base64-bytes';
import { runSerializedSyncDocumentWriteOperation } from './data-transfer-transaction';
import { createImportDiagnostics, formatImportDiagnostic, type ImportDiagnosticTranslator } from './import-diagnostics';
import { DEFAULT_IMPORT_SOURCE_LIMITS } from './import-source-reader';
import { applyImportSource, parseImportSource, summarizeBackupMerge } from './import-runner';
import { taskEditValuesEqual } from './json-value-equality';
import type { MindwtrCsvImportExecutionResult } from './mindwtr-csv-import';
import type { TodoistImportExecutionResult } from './todoist-import';
import type { TickTickImportExecutionResult } from './ticktick-import';
import type { DgtImportExecutionResult } from './dgt-import';
import type { OmniFocusImportExecutionResult } from './omnifocus-import';
import { MAX_NATIVE_DOCUMENT_RECEIPT_REPLY_BYTES, type NativeReceiptSqliteAdapter } from './native-request-receipts';
import { flushPendingSave, useTaskStore } from './store';
import { markNextLoadAsDocumentReplacement } from './store-settings';
import { validateMergedSyncData } from './sync-normalization';
import { cloneAppData } from './sync-runtime-utils';
import type { AppData } from './types';

export const MAX_NATIVE_BACKUP_PLAN_BYTES = 512 * 1024 * 1024;
export type NativeBackupDocumentMetadata = { fileName: string; lastModified: number; appVersion: string };
export type NativeBackupOperationReference = { id: string; sha256: string; byteCount: number };
export type NativeBackupJsonDocumentReply = {
    version: 1; operation: 'merge' | 'restore' | 'replace'; snapshotName: string; added: number; updated: number;
};
export type NativeBackupCsvImportResult = Omit<MindwtrCsvImportExecutionResult, 'data'>;
export type NativeBackupTodoistImportResult = Omit<TodoistImportExecutionResult, 'data'>;
export type NativeBackupTickTickImportResult = Omit<TickTickImportExecutionResult, 'data'>;
export type NativeBackupDgtImportResult = Omit<DgtImportExecutionResult, 'data'>;
export type NativeBackupOmniFocusImportResult = Omit<OmniFocusImportExecutionResult, 'data'>;
export type NativeBackupDocumentReply = NativeBackupJsonDocumentReply | {
    version: 1; operation: 'csv'; snapshotName: string; result: NativeBackupCsvImportResult;
} | {
    version: 1; operation: 'todoist'; snapshotName: string; result: NativeBackupTodoistImportResult;
} | {
    version: 1; operation: 'ticktick'; snapshotName: string; result: NativeBackupTickTickImportResult;
} | {
    version: 1; operation: 'dgt'; snapshotName: string; result: NativeBackupDgtImportResult;
} | {
    version: 1; operation: 'omnifocus'; snapshotName: string; result: NativeBackupOmniFocusImportResult;
};
type Operation = 'merge' | 'restore' | 'replace' | 'csv' | 'todoist' | 'ticktick' | 'dgt' | 'omnifocus';
export type NativeBackupDocumentPrepareInput = {
    requestId: string; mode: Operation; snapshotName: string;
    text: string; metadata: NativeBackupDocumentMetadata;
};
type Plan = {
    version: 1; requestId: string; mode: Operation; preparedAt: string;
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
const mode = (value: unknown): value is Operation => value === 'merge' || value === 'restore' || value === 'replace' || value === 'csv' || value === 'todoist' || value === 'ticktick' || value === 'dgt' || value === 'omnifocus';
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
const sextet = (code: number): number => code >= 65 && code <= 90 ? code - 65
    : code >= 97 && code <= 122 ? code - 71 : code >= 48 && code <= 57 ? code + 4
        : code === 43 ? 62 : code === 47 ? 63 : -1;
// Validate canonical padding and trailing bits, and bound decoded bytes before allocating.
const decodeBinarySource = (text: unknown, metadata: unknown, label: 'CSV' | 'Todoist' | 'TickTick' | 'DGT' | 'OmniFocus') => {
    const limit = DEFAULT_IMPORT_SOURCE_LIMITS.maxInputBytes;
    if (typeof text !== 'string') invalid();
    if (text.length > 4 * Math.ceil(limit / 3)) invalid(`${label} source exceeds 16 MiB`);
    if (text.length % 4 !== 0) invalid();
    const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
    const size = text.length / 4 * 3 - padding;
    if (size > limit) invalid(`${label} source exceeds 16 MiB`);
    const end = text.length - padding;
    for (let index = 0; index < end; index += 1) if (sextet(text.charCodeAt(index)) < 0) invalid();
    if (padding && (end < 2 || (sextet(text.charCodeAt(end - 1)) & (padding === 2 ? 15 : 3)) !== 0)) invalid();
    if (!metadataValid(metadata)) invalid();
    return { bytes: base64ToBytes(text), fileName: metadata.fileName };
};
const parseCsvSource = (text: unknown, metadata: unknown) => parseImportSource('mindwtr-csv', decodeBinarySource(text, metadata, 'CSV'));
const parseTodoistSource = (text: unknown, metadata: unknown) => parseImportSource('todoist', decodeBinarySource(text, metadata, 'Todoist'));
const parseTickTickSource = (text: unknown, metadata: unknown) => parseImportSource('ticktick', decodeBinarySource(text, metadata, 'TickTick'));
const parseDgtSource = (text: unknown, metadata: unknown) => parseImportSource('dgt', decodeBinarySource(text, metadata, 'DGT'));
const parseOmniFocusSource = (text: unknown, metadata: unknown) => parseImportSource('omnifocus', decodeBinarySource(text, metadata, 'OmniFocus'));
const warningMessages = (warnings: string[], t: ImportDiagnosticTranslator) => createImportDiagnostics(warnings, 'warning')
    .map((item) => formatImportDiagnostic(item, t));
const inspectCsv = (text: string, metadata: NativeBackupDocumentMetadata, t: ImportDiagnosticTranslator) => {
    const model = { valid: false, title: t('settings.backupMobile.importMindwtrCsvData'), summary: '',
        confirmLabel: t('settings.backupMobile.import'), cancelLabel: t('common.cancel'),
        errorTitle: t('settings.backupMobile.importFailed'), errorMessage: t('settings.backupMobile.theSelectedFileIsNotASupportedMindwtrCsvFile') };
    try {
        const parsed = parseCsvSource(text, metadata);
        if (!parsed.valid || !parsed.parsedData || !parsed.preview) {
            const error = parsed.diagnostics.find((item) => item.severity === 'error');
            return { ...model, errorMessage: error ? formatImportDiagnostic(error, t) : model.errorMessage };
        }
        const preview = parsed.preview;
        const projects = preview.projects.slice(0, 4).map((project) => `• ${project.areaName ? `${project.areaName} / ` : ''}${project.name}: ${project.taskCount}`);
        if (preview.projects.length > 4) projects.push(t('settings.backupMobile.moreProjects', { projectCount: preview.projects.length - 4 }));
        const details = [t('settings.backupMobile.importTasksFromFile', { taskCount: preview.taskCount, fileName: preview.fileName }),
            preview.areaCount > 0 ? t('settings.backupMobile.mindwtrCsvAreasWillBeCreated', { areaCount: preview.areaCount }) : null,
            preview.projectCount > 0 ? t('settings.backupMobile.projectsWillBeCreatedWhenNeeded', { projectCount: preview.projectCount }) : null,
            preview.sectionCount > 0 ? t('settings.backupMobile.mindwtrCsvSectionsWillBeCreated', { sectionCount: preview.sectionCount }) : null,
            preview.checklistItemCount > 0 ? t('settings.backupMobile.checklistItemsWillBePreserved', { checklistItemCount: preview.checklistItemCount }) : null,
            preview.standaloneTaskCount > 0 ? t('settings.backupMobile.tasksWillStayOutsideProjects', { taskCount: preview.standaloneTaskCount }) : null,
            ...projects, ...warningMessages(preview.warnings, t)].filter(Boolean);
        return { ...model, valid: true, summary: details.join('\n'), errorMessage: '' };
    } catch { return model; }
};
const inspectTodoist = (text: string, metadata: NativeBackupDocumentMetadata, t: ImportDiagnosticTranslator) => {
    const model = { valid: false, title: t('settings.backupMobile.importTodoistData'), summary: '',
        confirmLabel: t('settings.backupMobile.import'), cancelLabel: t('common.cancel'),
        errorTitle: t('settings.backupMobile.importFailed'), errorMessage: t('settings.backupMobile.theSelectedFileIsNotASupportedTodoistExport') };
    try {
        const parsed = parseTodoistSource(text, metadata);
        if (!parsed.valid || !parsed.preview) {
            const error = parsed.diagnostics.find((item) => item.severity === 'error');
            return { ...model, errorMessage: error ? formatImportDiagnostic(error, t) : model.errorMessage };
        }
        const preview = parsed.preview;
        const projects = preview.projects.slice(0, 4).map((project) => `• ${project.name}: ${project.taskCount}`);
        if (preview.projects.length > 4) projects.push(t('settings.backupMobile.moreProjects', { projectCount: preview.projects.length - 4 }));
        const details = [t('settings.backupMobile.importTodoistTasksFromProjects', { taskCount: preview.taskCount, projectCount: preview.projectCount }),
            preview.sectionCount > 0 ? t('settings.backupMobile.sectionsWillBePreserved', { sectionCount: preview.sectionCount }) : null,
            preview.checklistItemCount > 0 ? t('settings.backupMobile.subtasksWillBecomeChecklistItems', { subtaskCount: preview.checklistItemCount }) : null,
            ...projects, ...warningMessages(preview.warnings, t)].filter(Boolean);
        return { ...model, valid: true, summary: details.join('\n'), errorMessage: '' };
    } catch { return model; }
};
const inspectTickTick = (text: string, metadata: NativeBackupDocumentMetadata, t: ImportDiagnosticTranslator) => {
    const model = { valid: false, title: t('settings.backupMobile.importTicktickData'), summary: '',
        confirmLabel: t('settings.backupMobile.import'), cancelLabel: t('common.cancel'),
        errorTitle: t('settings.backupMobile.importFailed'), errorMessage: t('settings.backupMobile.theSelectedFileIsNotASupportedTicktickBackup') };
    try {
        const parsed = parseTickTickSource(text, metadata);
        if (!parsed.valid || !parsed.preview || !parsed.parsedData) {
            const error = parsed.diagnostics.find((item) => item.severity === 'error');
            return { ...model, errorMessage: error ? formatImportDiagnostic(error, t) : model.errorMessage };
        }
        const preview = parsed.preview;
        const projects = preview.projects.slice(0, 4).map((project) => `• ${project.areaName ? `${project.areaName} / ` : ''}${project.name}: ${project.taskCount}`);
        if (preview.projects.length > 4) projects.push(t('settings.backupMobile.moreProjects', { projectCount: preview.projects.length - 4 }));
        const details = [t('settings.backupMobile.importTasksFromFile', { taskCount: preview.taskCount, fileName: preview.fileName }),
            preview.areaCount > 0 ? t('settings.backupMobile.ticktickAreasWillBeCreated', { areaCount: preview.areaCount }) : null,
            preview.projectCount > 0 ? t('settings.backupMobile.ticktickProjectsWillBeCreated', { projectCount: preview.projectCount }) : null,
            preview.checklistItemCount > 0 ? t('settings.backupMobile.checklistItemsWillBePreserved', { checklistItemCount: preview.checklistItemCount }) : null,
            preview.recurringCount > 0 ? t('settings.backupMobile.recurringTasksWillKeepSupportedRepeatRules', { taskCount: preview.recurringCount }) : null,
            ...projects, ...warningMessages(preview.warnings, t)].filter(Boolean);
        return { ...model, valid: true, summary: details.join('\n'), errorMessage: '' };
    } catch { return model; }
};

const inspectDgt = (text: string, metadata: NativeBackupDocumentMetadata, t: ImportDiagnosticTranslator) => {
    const model = { valid: false, title: t('settings.backupMobile.importDgtGtdData'), summary: '',
        confirmLabel: t('settings.backupMobile.import'), cancelLabel: t('common.cancel'),
        errorTitle: t('settings.backupMobile.importFailed'), errorMessage: t('settings.backupMobile.theSelectedFileIsNotASupportedDgtGtdExport') };
    try {
        const parsed = parseDgtSource(text, metadata);
        if (!parsed.valid || !parsed.preview || !parsed.parsedData) {
            const error = parsed.diagnostics.find((item) => item.severity === 'error');
            return { ...model, errorMessage: error ? formatImportDiagnostic(error, t) : model.errorMessage };
        }
        const preview = parsed.preview;
        const projects = preview.projects.slice(0, 4).map((project) => `• ${project.areaName ? `${project.areaName} / ` : ''}${project.name}: ${project.taskCount}`);
        if (preview.projects.length > 4) projects.push(t('settings.backupMobile.moreProjects', { projectCount: preview.projects.length - 4 }));
        const details = [t('settings.backupMobile.importTasksFromFile', { taskCount: preview.taskCount, fileName: preview.fileName }),
            preview.areaCount > 0 ? t('settings.backupMobile.dgtAreasWillBeCreated', { areaCount: preview.areaCount }) : null,
            preview.projectCount > 0 ? t('settings.backupMobile.projectsWillBeCreated', { projectCount: preview.projectCount }) : null,
            preview.checklistItemCount > 0 ? t('settings.backupMobile.checklistItemsWillBePreserved', { checklistItemCount: preview.checklistItemCount }) : null,
            preview.standaloneTaskCount > 0 ? t('settings.backupMobile.tasksWillStayOutsideProjects', { taskCount: preview.standaloneTaskCount }) : null,
            ...projects, ...warningMessages(preview.warnings, t)].filter(Boolean);
        return { ...model, valid: true, summary: details.join('\n'), errorMessage: '' };
    } catch { return model; }
};

const inspectOmniFocus = (text: string, metadata: NativeBackupDocumentMetadata, t: ImportDiagnosticTranslator) => {
    const model = { valid: false, title: t('settings.backupMobile.importOmnifocusData'), summary: '',
        confirmLabel: t('settings.backupMobile.import'), cancelLabel: t('common.cancel'),
        errorTitle: t('settings.backupMobile.importFailed'), errorMessage: t('settings.backupMobile.theSelectedFileIsNotASupportedOmnifocusExport') };
    try {
        const parsed = parseOmniFocusSource(text, metadata);
        if (!parsed.valid || !parsed.preview || !parsed.parsedData) {
            const error = parsed.diagnostics.find((item) => item.severity === 'error');
            return { ...model, errorMessage: error ? formatImportDiagnostic(error, t) : model.errorMessage };
        }
        const preview = parsed.preview;
        const projects = preview.projects.slice(0, 4).map((project) => `• ${project.name}: ${project.taskCount}`);
        if (preview.projects.length > 4) projects.push(t('settings.backupMobile.moreProjects', { projectCount: preview.projects.length - 4 }));
        const details = [t('settings.backupMobile.importTaskCountFromFile', { taskCount: preview.taskCount, fileName: preview.fileName }),
            preview.projectCount > 0 ? t('settings.backupMobile.projectsWillBeCreatedWhenNeeded', { projectCount: preview.projectCount }) : null,
            preview.areaCount > 0 ? t('settings.backupMobile.omnifocusAreasWillBeCreated', { areaCount: preview.areaCount }) : null,
            preview.checklistItemCount > 0 ? t('settings.backupMobile.nestedTasksWillBecomeChecklistItems', { taskCount: preview.checklistItemCount }) : null,
            preview.standaloneTaskCount > 0 ? t('settings.backupMobile.tasksWillStayOutsideProjects', { taskCount: preview.standaloneTaskCount }) : null,
            t('settings.backupMobile.importedTasksKeepOmnifocusNotesDatesTagsRecurrenceAndChecklist'),
            ...projects, ...warningMessages(preview.warnings, t)].filter(Boolean);
        return { ...model, valid: true, summary: details.join('\n'), errorMessage: '' };
    } catch { return model; }
};

/** RN's immutable inspection preview. Invalid files are ordinary localized values. */
export function inspectNativeBackupDocument(text: string, metadata: NativeBackupDocumentMetadata, t: ImportDiagnosticTranslator, format: 'json' | 'json-restore' | 'csv' | 'todoist' | 'ticktick' | 'dgt' | 'omnifocus' = 'json') {
    if (format === 'csv') return inspectCsv(text, metadata, t);
    if (format === 'todoist') return inspectTodoist(text, metadata, t);
    if (format === 'ticktick') return inspectTickTick(text, metadata, t);
    if (format === 'dgt') return inspectDgt(text, metadata, t);
    if (format === 'omnifocus') return inspectOmniFocus(text, metadata, t);
    if (format !== 'json' && format !== 'json-restore') invalid();
    const replacing = format === 'json-restore';
    const model = {
        valid: false, title: t(replacing ? 'settings.backupMobile.restoreBackup' : 'settings.mergeBackup'), summary: '',
        confirmLabel: t(replacing ? 'markdown.referenceRestore' : 'settings.mergeBackupAction'),
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
            t(replacing ? 'settings.backupMobile.thisWillReplaceAllCurrentLocalDataARecoverySnapshot' : 'settings.mergeBackupConfirm'), ...(warnings.length ? ['', ...warnings] : []),
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
    let parsed: ReturnType<typeof parseSource>['data'];
    let csv: ReturnType<typeof parseCsvSource>['parsedData'];
    let todoist: ReturnType<typeof parseTodoistSource>['parsedProjects'] | undefined;
    let ticktick: ReturnType<typeof parseTickTickSource>['parsedData'];
    let dgt: ReturnType<typeof parseDgtSource>['parsedData'];
    let omnifocus: ReturnType<typeof parseOmniFocusSource>['parsedData'];
    try {
        if (input.mode === 'csv') { const validation = parseCsvSource(input.text, input.metadata); if (!validation.valid || !validation.parsedData) invalid(); csv = validation.parsedData; }
        else if (input.mode === 'todoist') { const validation = parseTodoistSource(input.text, input.metadata); if (!validation.valid || !validation.preview) invalid(); todoist = validation.parsedProjects; }
        else if (input.mode === 'ticktick') { const validation = parseTickTickSource(input.text, input.metadata); if (!validation.valid || !validation.parsedData) invalid(); ticktick = validation.parsedData; }
        else if (input.mode === 'dgt') { const validation = parseDgtSource(input.text, input.metadata); if (!validation.valid || !validation.parsedData) invalid(); dgt = validation.parsedData; }
        else if (input.mode === 'omnifocus') { const validation = parseOmniFocusSource(input.text, input.metadata); if (!validation.valid || !validation.parsedData) invalid(); omnifocus = validation.parsedData; }
        else { const validation = parseSource(input.text, input.metadata); if (!validation.valid || !validation.data) invalid(); parsed = validation.data; }
    }
    catch (error) { if (error instanceof BackupInputError) throw error; return invalid(); }
    const { requestId, mode: operation, snapshotName } = input;
    const appVersion = input.metadata.appVersion;
    try {
        return await runSerializedSyncDocumentWriteOperation(async () => {
            await flush();
            const current = await adapter.getData();
            if (!completeDocument(current)) invalid();
            const expectedCurrent = cloneAppData(current);
            const applied = operation === 'merge' ? applyImportSource('backup-merge', current, parsed!) : null;
            const csvApplied = operation === 'csv' ? applyImportSource('mindwtr-csv', current, csv!) : null;
            const todoistApplied = operation === 'todoist' ? applyImportSource('todoist', current, todoist!) : null;
            const ticktickApplied = operation === 'ticktick' ? applyImportSource('ticktick', current, ticktick!) : null;
            const dgtApplied = operation === 'dgt' ? applyImportSource('dgt', current, dgt!) : null;
            const omnifocusApplied = operation === 'omnifocus' ? applyImportSource('omnifocus', current, omnifocus!) : null;
            const data = omnifocusApplied?.data ?? dgtApplied?.data ?? ticktickApplied?.data ?? todoistApplied?.data ?? csvApplied?.data ?? applied?.data ?? applyImportSource('backup', current, parsed!).data;
            const counts = applied ? summarizeBackupMerge(applied.result) : { added: 0, updated: 0 };
            let reply: NativeBackupDocumentReply;
            if (omnifocusApplied) {
                const result = omnifocusApplied.result;
                reply = { version: 1, operation: 'omnifocus', snapshotName, result: {
                    importedAreaCount: result.importedAreaCount, importedChecklistItemCount: result.importedChecklistItemCount,
                    importedProjectCount: result.importedProjectCount, importedSectionCount: result.importedSectionCount,
                    importedStandaloneTaskCount: result.importedStandaloneTaskCount, importedTaskCount: result.importedTaskCount, warnings: result.warnings,
                } };
            } else if (dgtApplied) {
                const result = dgtApplied.result;
                reply = { version: 1, operation: 'dgt', snapshotName, result: {
                    importedAreaCount: result.importedAreaCount, importedChecklistItemCount: result.importedChecklistItemCount,
                    importedProjectCount: result.importedProjectCount, importedSectionCount: result.importedSectionCount,
                    importedTaskCount: result.importedTaskCount, warnings: result.warnings,
                } };
            } else if (ticktickApplied) {
                const result = ticktickApplied.result;
                reply = { version: 1, operation: 'ticktick', snapshotName, result: {
                    importedAreaCount: result.importedAreaCount, importedChecklistItemCount: result.importedChecklistItemCount,
                    importedProjectCount: result.importedProjectCount, importedSectionCount: result.importedSectionCount,
                    importedTaskCount: result.importedTaskCount, warnings: result.warnings,
                } };
            } else if (todoistApplied) {
                const result = todoistApplied.result;
                reply = { version: 1, operation: 'todoist', snapshotName, result: {
                    importedChecklistItemCount: result.importedChecklistItemCount, importedProjectCount: result.importedProjectCount,
                    importedSectionCount: result.importedSectionCount, importedTaskCount: result.importedTaskCount, warnings: result.warnings,
                } };
            } else if (csvApplied) {
                const result = csvApplied.result;
                reply = { version: 1, operation: 'csv', snapshotName, result: {
                    importedAreaCount: result.importedAreaCount, importedChecklistItemCount: result.importedChecklistItemCount,
                    importedProjectCount: result.importedProjectCount, importedSectionCount: result.importedSectionCount,
                    importedStandaloneTaskCount: result.importedStandaloneTaskCount, importedTaskCount: result.importedTaskCount, warnings: result.warnings,
                } };
            } else reply = { version: 1, operation: operation as 'merge' | 'restore' | 'replace', snapshotName, ...counts };
            validateReply(reply);
            const plan: Plan = { version: 1, requestId, mode: operation, preparedAt: new Date().toISOString(),
                expectedCurrent, data, reply };
            if (!completeDocument(data)) invalid();
            const recoveryJSON = operation !== 'restore' ? serializeBackupData(expectedCurrent) : null;
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

const validateReply = (value: unknown, snapshotName?: string, operation?: Operation): NativeBackupDocumentReply => {
    if (!record(value) || value.version !== 1 || !mode(value.operation) || !snapshot(value.snapshotName)
        || snapshotName !== undefined && value.snapshotName !== snapshotName || operation !== undefined && value.operation !== operation) invalid();
    if (value.operation === 'csv' || value.operation === 'todoist' || value.operation === 'ticktick' || value.operation === 'dgt' || value.operation === 'omnifocus') {
        const counts = value.operation === 'csv' || value.operation === 'omnifocus'
            ? ['importedAreaCount', 'importedChecklistItemCount', 'importedProjectCount', 'importedSectionCount', 'importedStandaloneTaskCount', 'importedTaskCount']
            : value.operation === 'ticktick' || value.operation === 'dgt' ? ['importedAreaCount', 'importedChecklistItemCount', 'importedProjectCount', 'importedSectionCount', 'importedTaskCount']
                : ['importedChecklistItemCount', 'importedProjectCount', 'importedSectionCount', 'importedTaskCount'];
        const result = value.result;
        if (!exact(value, ['version', 'operation', 'snapshotName', 'result']) || !exact(result, [...counts, 'warnings'])
            || !counts.every((field) => count(result[field])) || !Array.isArray(result.warnings)
            || !result.warnings.every((warning) => typeof warning === 'string')) invalid();
        if (!withinUtf8Limit(JSON.stringify(value), MAX_NATIVE_DOCUMENT_RECEIPT_REPLY_BYTES)) invalid(`${value.operation === 'csv' ? 'CSV' : value.operation === 'ticktick' ? 'TickTick' : value.operation === 'dgt' ? 'DGT' : value.operation === 'omnifocus' ? 'OmniFocus' : 'Todoist'} import result exceeds 64 KiB`);
    } else if (!exact(value, ['version', 'operation', 'snapshotName', 'added', 'updated']) || !count(value.added) || !count(value.updated)
        || (value.operation === 'restore' || value.operation === 'replace') && (value.added !== 0 || value.updated !== 0)) invalid();
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
    if (reply.operation === 'omnifocus') {
        const result = reply.result;
        return { title: t('settings.backupMobile.importComplete'), message: [
            t('settings.backupMobile.importedTaskProjectCounts', { taskCount: result.importedTaskCount, projectCount: result.importedProjectCount }),
            result.importedAreaCount > 0 ? t('settings.backupMobile.omnifocusAreasCreated', { areaCount: result.importedAreaCount }) : null,
            result.importedChecklistItemCount > 0 ? t('settings.backupMobile.nestedTasksBecameChecklistItems', { taskCount: result.importedChecklistItemCount }) : null,
            result.importedStandaloneTaskCount > 0 ? t('settings.backupMobile.tasksStayedOutsideProjects', { taskCount: result.importedStandaloneTaskCount }) : null,
            t('settings.backupMobile.recoverySnapshotSaved', { snapshotName: reply.snapshotName }),
            ...warningMessages(result.warnings, t)].filter(Boolean).join('\n'), undoLabel: t('settings.undoImport'), doneLabel: t('common.done') };
    }
    if (reply.operation === 'ticktick' || reply.operation === 'dgt') {
        const result = reply.result;
        return { title: t('settings.backupMobile.importComplete'), message: [
            t('settings.backupMobile.importedTaskProjectAreaCounts', { taskCount: result.importedTaskCount,
                projectCount: result.importedProjectCount, areaCount: result.importedAreaCount }),
            result.importedChecklistItemCount > 0 ? t('settings.backupMobile.checklistItemsPreserved', { checklistItemCount: result.importedChecklistItemCount }) : null,
            t('settings.backupMobile.recoverySnapshotSaved', { snapshotName: reply.snapshotName }),
            ...warningMessages(result.warnings, t)].filter(Boolean).join('\n'), undoLabel: t('settings.undoImport'), doneLabel: t('common.done') };
    }
    if (reply.operation === 'todoist') {
        const result = reply.result;
        return { title: t('settings.backupMobile.importComplete'), message: [
            t('settings.backupMobile.importedTodoistTasksIntoProjects', { taskCount: result.importedTaskCount, projectCount: result.importedProjectCount }),
            result.importedChecklistItemCount > 0 ? t('settings.backupMobile.subtasksBecameChecklistItems', { subtaskCount: result.importedChecklistItemCount }) : null,
            t('settings.backupMobile.recoverySnapshotSaved', { snapshotName: reply.snapshotName }),
            ...warningMessages(result.warnings, t)].filter(Boolean).join('\n'), undoLabel: t('settings.undoImport'), doneLabel: t('common.done') };
    }
    if (reply.operation === 'csv') {
        const result = reply.result;
        return { title: t('settings.backupMobile.importComplete'), message: [
            t('settings.backupMobile.importedTaskProjectSectionAreaCounts', { taskCount: result.importedTaskCount,
                projectCount: result.importedProjectCount, sectionCount: result.importedSectionCount, areaCount: result.importedAreaCount }),
            result.importedChecklistItemCount > 0 ? t('settings.backupMobile.checklistItemsPreserved', { checklistItemCount: result.importedChecklistItemCount }) : null,
            t('settings.backupMobile.recoverySnapshotSaved', { snapshotName: reply.snapshotName }),
            ...warningMessages(result.warnings, t)].filter(Boolean).join('\n'), undoLabel: t('settings.undoImport'), doneLabel: t('common.done') };
    }
    return {
        title: t(reply.operation === 'merge' ? 'settings.mergeBackup' : 'settings.backupMobile.restoreComplete'),
        message: reply.operation === 'merge' ? [
            t('settings.mergeBackupSummary', { addedCount: reply.added, updatedCount: reply.updated }),
            t('settings.backupMobile.recoverySnapshotSaved', { snapshotName: reply.snapshotName }),
        ].join('\n') : reply.operation === 'replace' ? t('settings.backupMobile.backupRestoredWithSnapshot', { snapshotName: reply.snapshotName })
            : t('settings.backupMobile.recoverySnapshotRestored'),
        undoLabel: reply.operation !== 'restore' ? t('settings.undoImport') : '', doneLabel: t('common.done'),
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
