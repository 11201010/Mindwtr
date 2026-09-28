/**
 * The Focus checklist page (mobile's check-focus route, opened from a task's
 * Focus button): the task's checklist, where every tick, rename, delete and add is
 * saved at once. Mobile's check-focus.tsx renders this model and applies these
 * edits, and the native host contract serves them (native-host-contract-focus-checklist.ts).
 *
 * The editor's checklist (task-checklist-model.ts) edits a draft instead, and its
 * rename splits pasted lines and its add refuses a second empty item; this page
 * keeps a rename's text as typed and always appends an empty item.
 */
import { tFallback } from './i18n';
import type { ChecklistItem, Task } from './types';

type Translate = (key: string) => string;

export type FocusChecklistEdit =
    | { kind: 'toggle'; index: number }
    | { kind: 'rename'; index: number; text: string }
    | { kind: 'remove'; index: number }
    /** Appends an empty open item with this ID. */
    | { kind: 'add'; id: string };

/** The checklist after one edit on the page. */
export function applyFocusChecklistEdit(checklist: readonly ChecklistItem[], edit: FocusChecklistEdit): ChecklistItem[] {
    switch (edit.kind) {
        case 'toggle':
            return checklist.map((item, index) => (index === edit.index ? { ...item, isCompleted: !item.isCompleted } : item));
        case 'rename':
            return checklist.map((item, index) => (index === edit.index ? { ...item, title: edit.text } : item));
        case 'remove':
            return checklist.filter((_, index) => index !== edit.index);
        case 'add':
            return [...checklist, { id: edit.id, title: '', isCompleted: false }];
    }
}

export type FocusChecklistPageModel = {
    backLabel: string;
    /** Shown alone under the header Back when the task is not among the visible tasks (deleted, archived, or unknown). */
    missingText: string;
    /** The task's title; null when the task is missing. */
    title: string | null;
    /** Shown while the checklist is empty. */
    emptyText: string | null;
    items: {
        id: string;
        title: string;
        isCompleted: boolean;
        /** The checkbox's spoken label: the title, or the placeholder for a blank one. */
        checkboxLabel: string;
        placeholder: string;
        inputLabel: string;
        deleteLabel: string;
    }[];
    addLabel: string;
    /** The error toast after a write that failed: its message is the store's, else `fallbackMessage`. */
    error: { title: string; fallbackMessage: string };
};

export function buildFocusChecklistPageModel(input: {
    task: Pick<Task, 'title'> | undefined;
    checklist: readonly ChecklistItem[];
    t: Translate;
}): FocusChecklistPageModel {
    const { t } = input;
    const itemNameLabel = tFallback(t, 'taskEdit.itemNamePlaceholder', 'Item name');
    const deleteLabel = tFallback(t, 'common.delete', 'Delete');
    return {
        backLabel: tFallback(t, 'common.back', 'Back'),
        missingText: tFallback(t, 'list.noTasks', 'No tasks found'),
        title: input.task ? input.task.title : null,
        emptyText: input.checklist.length === 0 ? tFallback(t, 'taskEdit.noChecklistItems', 'No checklist items') : null,
        items: input.checklist.map((item) => {
            const name = item.title.trim() || itemNameLabel;
            return {
                id: item.id,
                title: item.title,
                isCompleted: item.isCompleted,
                checkboxLabel: name,
                placeholder: itemNameLabel,
                inputLabel: itemNameLabel,
                deleteLabel: `${deleteLabel}: ${name}`,
            };
        }),
        addLabel: tFallback(t, 'taskEdit.addItem', 'Add Item'),
        error: {
            title: tFallback(t, 'common.error', 'Error'),
            fallbackMessage: tFallback(t, 'task.updateFailed', 'Could not update task.'),
        },
    };
}
