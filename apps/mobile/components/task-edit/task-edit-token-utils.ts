// Token parsing lives in core (task-editor-model.ts) so native hosts suggest and
// save tokens the way this editor does.
export {
    getTaskEditorActiveTokenQuery as getActiveTokenQuery,
    parseTaskEditorTokenList as parseTokenList,
    replaceTaskEditorTrailingToken as replaceTrailingToken,
} from '@mindwtr/core';
