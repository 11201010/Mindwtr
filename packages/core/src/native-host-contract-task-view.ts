/**
 * The task editor's View tab and checklist for a native host (task
 * core-editor-view-checklist). The View tab is read with getTaskView; checklist
 * edits change the host's unsaved checklist through editTaskChecklist, as the
 * React Native editor edits its draft, and saveTaskDraft saves it with the rest of
 * the draft in one write. Reset checklist writes at once, as in React Native; it
 * takes a `requestId`: a repeat after a failed save only finishes that save
 * (native-request-receipts.ts), and it is target-state, so a replay that already
 * landed writes nothing.
 */
import { formatTimeEstimateLabel } from './calendar-scheduling';
import { createDateFormatter, type DateFormatter, type DateFormattingConfig } from './date';
import { tFallback } from './i18n';
import { createMarkdownLinkLookup, resolveMarkdownBlocks, resolveMarkdownInline, type MarkdownInline, type ResolvedMarkdownBlock } from './markdown-blocks';
import { NATIVE_HOST_CONTRACT_VERSION, NATIVE_HOST_MAX_WINDOW, type NativeHostResult } from './native-host-contract';
import { isPaging, page, paramsKey } from './native-host-contract-menu-views';
import { createNativeRequestReceipts, runStoreWrite, settleWrite } from './native-request-receipts';
import { getProjectSectionsForView } from './project-utils';
import { resolveFeatureFlags } from './resolve-feature-flags';
import { useTaskStore } from './store';
import { createTaskDraft, setTaskDraftField, taskDraftToUpdatePatch, type TaskDraft } from './task-draft';
import {
    applyTaskChecklistEdit,
    buildTaskChecklistFieldModel,
    getChecklistEditStatus,
    type TaskChecklistEdit,
    type TaskChecklistFieldModel,
} from './task-checklist-model';
import { getTaskEditorFieldLayout, getTaskEditorProjectSections } from './task-editor-model';
import { formatTaskEditorDate } from './task-editor-schedule';
import { buildTaskViewModel, type TaskViewRow } from './task-view-model';
import type { ChecklistItem, Task } from './types';
import { generateUUID } from './uuid';

export type NativeTaskViewRow =
    | Extract<TaskViewRow, { type: 'title' | 'status' | 'field' | 'tokens' }>
    | { type: 'description'; label: string; blocks: ResolvedMarkdownBlock[] }
    | (Omit<Extract<TaskViewRow, { type: 'checklist' }>, 'items'> & {
        /** All the checklist's items; `items` holds the requested window of them. */
        total: number;
        items: Array<Extract<TaskViewRow, { type: 'checklist' }>['items'][number] & { inline: MarkdownInline[] }>;
    })
    | {
        type: 'attachments';
        label: string;
        items: Array<{ id: string; kind: 'file' | 'link'; title: string; uri: string; mimeType: string | null; image: boolean; note: string | null; disabled: boolean }>;
    };

export type NativeTaskView = {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    /** Covers the task, the settings, the language, the day and minute, and the draft and checklist sent. */
    revision: string;
    id: string;
    /** A task in an archived project: the saved task, nothing tappable, and `readOnlyHint` above the rows. */
    readOnly: boolean;
    readOnlyHint: string | null;
    rows: NativeTaskViewRow[];
    /** The words a deleted reference adds ("deleted task") and the code block's copy button. */
    markdownLabels: { deletedTask: string; deletedProject: string; copyCode: string };
    /** The saved checklist: where the editor's checklist starts, and saveTaskDraft's `checklist.base`. */
    checklistBase: ChecklistItem[];
};

export type NativeTaskChecklistEdit = TaskChecklistEdit;

export type NativeTaskChecklistEditResult = {
    /** The draft after the edit. A list task's status follows its items (getChecklistEditStatus). */
    draft: TaskDraft;
    checklist: ChecklistItem[];
    /** False when the edit changes nothing; React Native then ends editing (insertAfter, append) or does nothing. */
    changed: boolean;
    /** A new empty item to focus. */
    focusId: string | null;
    /** The Form tab's checklist field for the edited checklist. */
    field: TaskChecklistFieldModel;
};

type TaskViewDeps = {
    readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>;
    t: () => (key: string) => string;
    dateFormatting: () => DateFormattingConfig;
    revision: (now: Date) => string;
    /** Mobile opens a task in an archived project read-only. */
    isReadOnly: (task: Task) => boolean;
    /** A whole task draft from the host, or null when invalid (the editor contract's rule). */
    readDraft: (value: unknown) => TaskDraft | null;
};

const CHECKLIST_LIMIT = 1_000;
const TEXT_LIMIT = 10_000;
const NATIVE_JSON_LIMIT_BYTES = 2_000_000;

/** The host checks UTF-8 bytes, including for a JSON string with non-ASCII text. */
export const isNativeJsonWithinBytes = (value: unknown, limit = NATIVE_JSON_LIMIT_BYTES): boolean => {
    let json: string;
    try {
        json = JSON.stringify(value);
    } catch {
        return false;
    }
    if (typeof json !== 'string' || json.length > limit) return false;
    let bytes = 0;
    for (let index = 0; index < json.length; index++) {
        const unit = json.charCodeAt(index);
        if (unit < 0x80) bytes++;
        else if (unit < 0x800) bytes += 2;
        else if (unit >= 0xd800 && unit <= 0xdbff
            && index + 1 < json.length && json.charCodeAt(index + 1) >= 0xdc00
            && json.charCodeAt(index + 1) <= 0xdfff) {
            bytes += 4;
            index++;
        } else bytes += 3;
        if (bytes > limit) return false;
    }
    return true;
};

const fail = (code: 'INVALID_INPUT' | 'STALE_REVISION' | 'TASK_NOT_FOUND' | 'SAVE_FAILED', message: string): NativeHostResult<never> => ({
    ok: false,
    error: { code, message },
});
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isIndex = (value: unknown, length: number) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < length;
const isText = (value: unknown, native = false): value is string => typeof value === 'string'
    && value.length <= (native ? NATIVE_JSON_LIMIT_BYTES : TEXT_LIMIT);

/** A checklist from the host: items with exactly an id, a title and isCompleted. */
export const readChecklist = (value: unknown, native = false): ChecklistItem[] | null => {
    if (!Array.isArray(value) || value.length > (native ? NATIVE_JSON_LIMIT_BYTES : CHECKLIST_LIMIT)) return null;
    const valid = value.every((item) => isRecord(item)
        && Object.keys(item).every((key) => key === 'id' || key === 'title' || key === 'isCompleted')
        && typeof item.id === 'string' && item.id.length <= 200 && isText(item.title, native) && typeof item.isCompleted === 'boolean');
    if (valid && native && !isNativeJsonWithinBytes(value)) return null;
    return valid ? value.map((item) => ({ id: item.id, title: item.title, isCompleted: item.isCompleted })) : null;
};
export const toChecklist = (items: Task['checklist']): ChecklistItem[] => (items ?? []).map(({ id, title, isCompleted }) => ({ id, title, isCompleted }));
export const sameChecklist = (left: readonly ChecklistItem[], right: readonly ChecklistItem[]) => JSON.stringify(left) === JSON.stringify(right);

const readEdit = (value: unknown, length: number): TaskChecklistEdit | null => {
    if (!isRecord(value)) return null;
    switch (value.kind) {
        case 'toggle':
        case 'insertAfter':
        case 'remove':
            return isIndex(value.index, length) ? { kind: value.kind, index: value.index as number } : null;
        case 'rename':
            return isIndex(value.index, length) && isText(value.text, true) ? { kind: 'rename', index: value.index as number, text: value.text } : null;
        case 'move':
            return isIndex(value.from, length) && isIndex(value.to, length) ? { kind: 'move', from: value.from as number, to: value.to as number } : null;
        case 'append':
            return isText(value.title, true) ? { kind: 'append', title: value.title } : null;
        case 'add':
        case 'uncheckAll':
            return { kind: value.kind };
        default:
            return null;
    }
};

export function createTaskViewMethods(deps: TaskViewDeps) {
    // A retry finishes a failed save and never writes twice.
    const receipts = createNativeRequestReceipts({
        save: async () => {
            if (useTaskStore.getState().persistenceFailure) {
                try {
                    await useTaskStore.getState().retryPersistence();
                } catch (error) {
                    return fail('SAVE_FAILED', error instanceof Error ? error.message : String(error));
                }
            }
            return deps.save();
        },
    });

    const findTask = (id: unknown): Task | NativeHostResult<never> => {
        if (typeof id !== 'string' || !id.trim()) return fail('INVALID_INPUT', 'Task ID is required');
        const task = useTaskStore.getState()._tasksById.get(id);
        return task && !task.deletedAt ? task : fail('TASK_NOT_FOUND', 'Task not found');
    };
    const isTask = (value: Task | NativeHostResult<never>): value is Task => !('ok' in value);

    return {
        /**
         * The View tab. Send the editor's unsaved `draft` and `checklist` to show them, as
         * the React Native editor does; without them it shows the saved task. A read-only
         * task always shows the saved task. The checklist's items come in windows of at most
         * 100 (`offset`, `limit`); a later window sends the first one's `revision`.
         */
        getTaskView(input: {
            id: string;
            draft?: TaskDraft;
            checklist?: ChecklistItem[];
            offset?: number;
            limit?: number;
            revision?: string;
        }): NativeHostResult<NativeTaskView> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isRecord(input) || !isNativeJsonWithinBytes(input)) return fail('INVALID_INPUT', 'A bounded task view request is required');
            const window = { offset: input.offset ?? 0, limit: input.limit ?? NATIVE_HOST_MAX_WINDOW, revision: input.revision };
            const draftInput = input.draft === undefined ? undefined : deps.readDraft(input.draft);
            const checklistInput = input.checklist === undefined ? undefined : readChecklist(input.checklist, true);
            if (!isPaging(window) || draftInput === null || checklistInput === null) {
                return fail('INVALID_INPUT', 'A valid draft and checklist when sent, a window of at most 100 items, and the revision for a later window are required');
            }
            const task = findTask(input.id);
            if (!isTask(task)) return task;
            const state = useTaskStore.getState();
            const t = deps.t();
            const now = new Date();
            const readOnly = deps.isReadOnly(task);
            const draft = draftInput ?? createTaskDraft(task);
            const checklist = checklistInput ?? task.checklist;
            // The editor's task with its draft applied (React Native's mergedTask).
            const shown: Task = readOnly ? task : {
                ...task,
                ...(taskDraftToUpdatePatch(draft, task, { attachments: task.attachments }) ?? {}),
                checklist,
            };
            const attachments = (task.attachments ?? []).filter((attachment) => !attachment.deletedAt);
            const flags = resolveFeatureFlags(state.settings);
            const { showStatusField } = getTaskEditorFieldLayout({
                task,
                draft,
                checklist,
                taskEditor: state.settings.gtd?.taskEditor,
                hasProjectSections: getTaskEditorProjectSections(state.sections, draft.projectId).length > 0,
                prioritiesEnabled: flags.priorities,
                timeEstimatesEnabled: flags.timeEstimates,
                contextInputDraft: draft.contexts,
                descriptionDraft: draft.description,
                tagInputDraft: draft.tags,
                visibleAttachmentsLength: attachments.length,
            });
            const format: DateFormatter = createDateFormatter(deps.dateFormatting());
            const notSet = t('common.notSet');
            const rows = buildTaskViewModel({
                task: shown,
                projects: state.projects,
                sections: readOnly
                    ? getProjectSectionsForView(state._allProjects.find((project) => project.id === task.projectId), state.sections, state._allSections)
                    : getTaskEditorProjectSections(state.sections, draft.projectId),
                areas: state.areas,
                attachments,
                prioritiesEnabled: flags.priorities,
                timeEstimatesEnabled: flags.timeEstimates,
                showStatusField,
                readOnly,
                t,
                formatDate: (value) => formatTaskEditorDate(value, format, notSet),
                formatDueDate: (value) => formatTaskEditorDate(value, format, notSet, { due: true }),
                formatTimeEstimateLabel: (value) => formatTimeEstimateLabel(value, { t }),
                now,
            });
            const revision = `${deps.revision(now)}:${paramsKey(readOnly ? null : [draft, checklist ?? null])}`;
            if (window.revision !== undefined && window.revision !== revision) {
                return fail('STALE_REVISION', 'The task or the draft changed; read the view again from offset zero');
            }
            const lookup = createMarkdownLinkLookup(state._allTasks, state._allProjects);
            return {
                ok: true,
                value: {
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision,
                    id: task.id,
                    readOnly,
                    readOnlyHint: readOnly ? tFallback(t, 'projects.archivedReadOnlyHint', 'Archived project. Reactivate it to edit this task.') : null,
                    rows: rows.map((row): NativeTaskViewRow => {
                        switch (row.type) {
                            case 'description':
                                return { type: 'description', label: row.label, blocks: resolveMarkdownBlocks(row.markdown, lookup) };
                            case 'checklist':
                                return {
                                    ...row,
                                    total: row.items.length,
                                    items: page(row.items, window).map((item) => ({ ...item, inline: resolveMarkdownInline(item.title, lookup) })),
                                };
                            case 'attachments':
                                return {
                                    type: 'attachments',
                                    label: row.label,
                                    items: row.items.map(({ attachment, title, image, note, disabled }) => ({
                                        id: attachment.id,
                                        kind: attachment.kind,
                                        title,
                                        uri: attachment.uri,
                                        mimeType: attachment.mimeType ?? null,
                                        image,
                                        note,
                                        disabled,
                                    })),
                                };
                            default:
                                return row;
                        }
                    }),
                    markdownLabels: {
                        deletedTask: tFallback(t, 'markdown.referenceDeletedTask', 'deleted task'),
                        deletedProject: tFallback(t, 'markdown.referenceDeletedProject', 'deleted project'),
                        copyCode: tFallback(t, 'markdown.copyCode', 'Copy code'),
                    },
                    checklistBase: toChecklist(task.checklist),
                },
            };
        },

        /**
         * One checklist edit on the host's unsaved draft and checklist, as the React Native
         * editor makes it (task-checklist-model.ts). Without `edit`, the Form tab's field for
         * the checklist as it is. Nothing is written; saveTaskDraft saves the draft and
         * checklist together.
         */
        editTaskChecklist(input: {
            id: string;
            draft: TaskDraft;
            checklist: ChecklistItem[];
            edit?: NativeTaskChecklistEdit;
        }): NativeHostResult<NativeTaskChecklistEditResult> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isRecord(input) || !isNativeJsonWithinBytes(input)) return fail('INVALID_INPUT', 'A bounded checklist edit is required');
            const draft = deps.readDraft(input.draft);
            const checklist = readChecklist(input.checklist, true);
            const edit = checklist && input.edit !== undefined ? readEdit(input.edit, checklist.length) : undefined;
            if (!draft || !checklist || edit === null) {
                return fail('INVALID_INPUT', 'A whole draft, a bounded checklist, and a valid edit are required');
            }
            const task = findTask(input.id);
            if (!isTask(task)) return task;
            if (deps.isReadOnly(task)) return fail('INVALID_INPUT', 'Task is read-only while its project is archived');
            const result = edit ? applyTaskChecklistEdit(checklist, edit, { isReference: draft.status === 'reference', newId: generateUUID }) : null;
            let nextDraft = draft;
            if (result) {
                const status = getChecklistEditStatus({ taskMode: task.taskMode, status: draft.status, checklist: result.checklist });
                if (status !== draft.status) nextDraft = setTaskDraftField(draft, 'status', status);
            }
            const nextChecklist = result?.checklist ?? checklist;
            return {
                ok: true,
                value: {
                    draft: nextDraft,
                    checklist: nextChecklist,
                    changed: result !== null,
                    focusId: result?.focusId ?? null,
                    field: buildTaskChecklistFieldModel({ checklist: nextChecklist, isReference: nextDraft.status === 'reference', t: deps.t() }),
                },
            };
        },

        /**
         * Reset checklist: every saved item open, and a Done task back to Next, written at
         * once. Then apply the `uncheckAll` edit to the host's checklist and use `checklist`
         * as the new checklist base for saveTaskDraft. A saved checklist already open writes nothing. A task with no
         * saved checklist (items added in this editor only) writes nothing either: the host reopens its draft items.
         */
        async resetTaskChecklist(input: { id: string; requestId: string }): Promise<NativeHostResult<{ id: string; checklist: ChecklistItem[] }>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!isRecord(input)) return fail('INVALID_INPUT', 'Task ID is required');
            const found = findTask(input.id);
            if (!isTask(found)) return found;
            return receipts.run(input.requestId, JSON.stringify(['resetTaskChecklist', input.id]), async () => {
                const task = useTaskStore.getState()._tasksById.get(input.id);
                if (!task || task.deletedAt) return fail('TASK_NOT_FOUND', 'Task not found');
                if (deps.isReadOnly(task)) return fail('INVALID_INPUT', 'Task is read-only while its project is archived');
                const items = task.checklist ?? [];
                if (items.length === 0 || (task.status !== 'done' && items.every((item) => !item.isCompleted))) {
                    return { ok: true, value: { id: task.id, checklist: toChecklist(items) } };
                }
                const written = await runStoreWrite(() => useTaskStore.getState().resetTaskChecklist(task.id));
                return settleWrite(written, { id: task.id, checklist: toChecklist(useTaskStore.getState()._tasksById.get(task.id)?.checklist) });
            });
        },
    };
}
