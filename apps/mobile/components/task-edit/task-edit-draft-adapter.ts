// The save composition lives in core (task-editor-model.ts) so native hosts
// save the same patch as this editor.
export {
    buildTaskEditUpdatePatch,
    createTaskEditDraft,
    isTaskEditDraftDirty,
    type TaskEditDraft,
    type TaskEditDraftOverrides,
} from '@mindwtr/core';
