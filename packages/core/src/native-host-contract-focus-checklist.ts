/**
 * The native host contract for the Focus checklist page (mobile's check-focus
 * route: a task's checklist, opened from the lists for a task with one), from
 * core's focus-checklist-model.ts. Kept in its own file and spread into
 * createNativeHostContract.
 *
 * Every edit on the page is saved at once, as on mobile. The editor's checklist is
 * another thing: it edits a draft (editTaskChecklist) and saves with the task.
 *
 * - getFocusChecklist reads the page for a task ID; its items come in windows of
 *   at most 100 (`offset`, `limit`; a later window sends the first one's `revision`).
 *   A task that is not among the visible tasks (deleted, archived, unknown) reads
 *   `found: false`: show `missingText` alone.
 * - Each item carries its `toggle` and `remove` edits; a rename is
 *   `{ kind: 'rename', index, itemId, text }` with the typed text; Add is
 *   `{ kind: 'add', itemId }` with a new UUID for the item. Send one with
 *   editFocusChecklist with the `taskRevision` it was made on: the page's, then each
 *   answer's. Mobile shows the edit at once and puts the checklist back when the
 *   write fails, with the toast `error.title` and the failure's message
 *   (ACTION_FAILED carries the toast's message).
 *
 * editFocusChecklist takes a request UUID and retries exactly
 * (native-request-receipts.ts): the same host answers a retry from its receipt. An
 * edit is compare-and-set on the task's revision: once the task changed since the
 * edit was made (a later edit, another device), it refuses with STALE_REVISION and
 * writes nothing, so a replay after a restart never undoes a later edit.
 *
 * Only functions read this module's imports from native-host-contract.ts, so the
 * import cycle between the two files is safe.
 */
import { applyFocusChecklistEdit, buildFocusChecklistPageModel, type FocusChecklistEdit, type FocusChecklistPageModel } from './focus-checklist-model';
import { NATIVE_HOST_CONTRACT_VERSION, NATIVE_HOST_MAX_WINDOW, type NativeHostResult } from './native-host-contract';
import { fail, isObjectRecord, isPaging, isText, page, paramsKey } from './native-host-contract-menu-views';
import { toChecklist } from './native-host-contract-task-view';
import { createNativeRequestReceipts, runStoreWrite, settleWrite } from './native-request-receipts';
import { useTaskStore } from './store';
import type { ChecklistItem, Task } from './types';

/** An edit on the page, naming its item by position and ID. */
export type NativeFocusChecklistEdit =
    | { kind: 'toggle'; index: number; itemId: string; isCompleted: boolean }
    | { kind: 'rename'; index: number; itemId: string; text: string }
    | { kind: 'remove'; index: number; itemId: string }
    | { kind: 'add'; itemId: string };

export type NativeFocusChecklistView = Omit<FocusChecklistPageModel, 'items'> & {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    /** Covers the tasks, the settings, the language, the minute and the task ID. */
    revision: string;
    id: string;
    found: boolean;
    /** The saved task's revision: send it with the next edit. Null when the task is missing. */
    taskRevision: string | null;
    /** All the checklist's items; `items` holds the requested window of them. */
    total: number;
    items: (FocusChecklistPageModel['items'][number] & {
        index: number;
        /** Tick or untick it; Delete it. */
        edits: {
            toggle: Extract<NativeFocusChecklistEdit, { kind: 'toggle' }>;
            remove: Extract<NativeFocusChecklistEdit, { kind: 'remove' }>;
        };
    })[];
};

type FocusChecklistDeps = {
    readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>;
    t: () => (key: string) => string;
    /** Data plus display revision: tasks, settings, language and the minute. */
    revision: (now: Date) => string;
};

export type NativeFocusChecklistEditResult = { changed: boolean; checklist: ChecklistItem[]; taskRevision: string };

const TEXT_LIMIT = 10_000;
const isId = (value: unknown): value is string => isText(value, 200) && value.length > 0;
const isIndex = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

function readEdit(value: unknown): NativeFocusChecklistEdit | null {
    if (!isObjectRecord(value) || !isId(value.itemId)) return null;
    switch (value.kind) {
        case 'toggle':
            return isIndex(value.index) && typeof value.isCompleted === 'boolean' ? value as NativeFocusChecklistEdit : null;
        case 'rename':
            return isIndex(value.index) && isText(value.text, TEXT_LIMIT) ? value as NativeFocusChecklistEdit : null;
        case 'remove':
            return isIndex(value.index) ? value as NativeFocusChecklistEdit : null;
        case 'add':
            return value as NativeFocusChecklistEdit;
        default:
            return null;
    }
}

/** A visible task, as mobile's page finds it (state.tasks: not deleted, not archived). */
const visibleTask = (id: string) => useTaskStore.getState().tasks.find((task) => task.id === id);
/** Changes with every write to the task, here or synced from another device. */
const taskRevisionOf = (task: Task) => `${task.rev ?? 0}:${task.revBy ?? ''}:${task.updatedAt}`;

export function createFocusChecklistMethods(deps: FocusChecklistDeps) {
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

    return {
        /** The Focus checklist page for a task, as mobile shows it. */
        getFocusChecklist(input: { id: string; offset?: number; limit?: number; revision?: string }): NativeHostResult<NativeFocusChecklistView> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const window = isObjectRecord(input)
                ? { offset: input.offset ?? 0, limit: input.limit ?? NATIVE_HOST_MAX_WINDOW, revision: input.revision }
                : null;
            if (!isObjectRecord(input) || !isId(input.id) || !window || !isPaging(window)) {
                return fail('INVALID_INPUT', 'A task ID and a window of at most 100 items are required');
            }
            const now = new Date();
            const revision = `${deps.revision(now)}:${paramsKey(input.id)}`;
            if (window.revision !== undefined && window.revision !== revision) {
                return fail('STALE_REVISION', 'The task changed; read the page again from offset zero');
            }
            const task = visibleTask(input.id);
            const checklist = task?.checklist ?? [];
            const model = buildFocusChecklistPageModel({ task, checklist, t: deps.t() });
            const items = model.items.map((item, index) => ({
                ...item,
                index,
                edits: {
                    toggle: { kind: 'toggle' as const, index, itemId: item.id, isCompleted: !item.isCompleted },
                    remove: { kind: 'remove' as const, index, itemId: item.id },
                },
            }));
            return {
                ok: true,
                value: {
                    ...model,
                    version: NATIVE_HOST_CONTRACT_VERSION,
                    revision,
                    id: input.id,
                    found: Boolean(task),
                    taskRevision: task ? taskRevisionOf(task) : null,
                    total: items.length,
                    items: page(items, window),
                },
            };
        },

        /**
         * One edit on the page, made on `taskRevision`, saved at once as mobile saves it
         * (updateTask with the whole checklist). Reuse `requestId` to retry. Answers with
         * the saved checklist and the task revision the next edit is made on.
         */
        async editFocusChecklist(input: {
            requestId: string;
            id: string;
            taskRevision: string;
            edit: NativeFocusChecklistEdit;
        }): Promise<NativeHostResult<NativeFocusChecklistEditResult>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const edit = isObjectRecord(input) ? readEdit(input.edit) : null;
            if (!isObjectRecord(input) || !isId(input.id) || !isText(input.taskRevision) || !input.taskRevision || !edit) {
                return fail('INVALID_INPUT', 'A request UUID, a task ID, the task revision the edit was made on and a valid edit are required');
            }
            const { id, taskRevision } = input;
            return receipts.run<NativeFocusChecklistEditResult>(input.requestId, JSON.stringify(['focusChecklist', id, taskRevision, edit]), async () => {
                const task = visibleTask(id);
                if (!task) return fail('TASK_NOT_FOUND', 'Task not found');
                // Compare-and-set: a replay after a later edit (or an edit made on an old read) writes nothing.
                if (taskRevisionOf(task) !== taskRevision) return fail('STALE_REVISION', 'The task changed; read the page again');
                const list = task.checklist ?? [];
                const unchanged = () => ({ ok: true as const, value: { changed: false, checklist: toChecklist(list), taskRevision } });
                let change: FocusChecklistEdit;
                if (edit.kind === 'add') {
                    if (list.some((item) => item.id === edit.itemId)) return fail('INVALID_INPUT', 'An item already has that ID');
                    change = { kind: 'add', id: edit.itemId };
                } else {
                    const item = list[edit.index];
                    if (item?.id !== edit.itemId) return fail('INVALID_INPUT', 'That item is not at that position');
                    if (edit.kind === 'toggle') {
                        if (item.isCompleted === edit.isCompleted) return unchanged();
                        change = { kind: 'toggle', index: edit.index };
                    } else if (edit.kind === 'rename') {
                        if (item.title === edit.text) return unchanged();
                        change = { kind: 'rename', index: edit.index, text: edit.text };
                    } else {
                        change = { kind: 'remove', index: edit.index };
                    }
                }
                const next = applyFocusChecklistEdit(list, change);
                const refusal = { refused: false, message: '' };
                const written = await runStoreWrite(async () => {
                    const result = await useTaskStore.getState().updateTask(task.id, { checklist: next });
                    if (result && result.success === false) {
                        refusal.refused = true;
                        refusal.message = typeof result.error === 'string' ? result.error.trim() : '';
                    }
                    return result;
                });
                if (!written.ok && written.error.code === 'ACTION_FAILED') {
                    // The message is the toast's, as mobile words it: the store's refusal or the thrown error, else its own line.
                    const message = refusal.refused ? refusal.message : written.error.message;
                    return fail('ACTION_FAILED', message || buildFocusChecklistPageModel({ task, checklist: list, t: deps.t() }).error.fallbackMessage);
                }
                const saved = useTaskStore.getState()._tasksById.get(id) ?? task;
                return settleWrite(written, { changed: true, checklist: toChecklist(saved.checklist ?? next), taskRevision: taskRevisionOf(saved) });
            });
        },
    };
}
