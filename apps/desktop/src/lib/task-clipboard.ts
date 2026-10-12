import { translateWithFallback, type Task } from '@mindwtr/core';
import { useUiStore } from '../store/ui-store';
import { logInfo, logWarn } from './app-log';

export async function copyTaskTitles(
    tasks: Pick<Task, 'title' | 'description'>[],
    t: (key: string) => string,
    includeDescription = false,
    source: 'menu' | 'shortcut' = 'shortcut',
): Promise<void> {
    if (tasks.length === 0) return;
    const text = tasks.map((task) => {
        const description = includeDescription && task.description?.trim() ? `\n\n${task.description}` : '';
        return task.title + description;
    }).join('\n');
    const message = includeDescription
        ? translateWithFallback(t, 'list.taskCopied', 'Task copied to clipboard')
        : tasks.length === 1
            ? translateWithFallback(t, 'task.titleCopied', 'Title copied')
            : translateWithFallback(t, 'task.titlesCopied', 'Titles copied');
    await writeTaskClipboard(text, t, message, source);
}

export async function copyTaskReference(
    taskId: string,
    kind: 'link' | 'id',
    t: (key: string) => string,
): Promise<void> {
    await writeTaskClipboard(
        kind === 'link' ? `mindwtr://open?task=${encodeURIComponent(taskId)}` : taskId,
        t,
        translateWithFallback(t, 'list.taskCopied', 'Task copied to clipboard'),
        'menu',
    );
}

async function writeTaskClipboard(
    text: string,
    t: (key: string) => string,
    message: string,
    source: 'menu' | 'shortcut',
): Promise<void> {
    const translate = (key: string, fallback: string) => translateWithFallback(t, key, fallback);
    const activation = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;
    const diagnostic = {
        releaseCheck: 'v1.3.5/task-copy-diagnostics',
        source,
        documentFocused: typeof document !== 'undefined' && document.hasFocus(),
        activationSupported: Boolean(activation),
        activationActive: activation?.isActive ?? null,
        clipboardAvailable: typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function',
    };
    try {
        await navigator.clipboard.writeText(text);
        void logInfo('Task clipboard write completed', {
            scope: 'clipboard', extra: { ...diagnostic, outcome: 'copied' },
        }).catch(() => {});
        useUiStore.getState().showToast(message, 'success');
    } catch (error) {
        const errorKind = !diagnostic.clipboardAvailable ? 'unavailable'
            : (error instanceof Error || error instanceof DOMException) && ['NotAllowedError', 'SecurityError', 'AbortError', 'TypeError'].includes(error.name)
                ? error.name : 'other';
        void logWarn('Task clipboard write failed', {
            scope: 'clipboard', extra: { ...diagnostic, outcome: 'failed', errorKind },
        }).catch(() => {});
        useUiStore.getState().showToast(translate('list.taskCopyFailed', 'Could not copy task'), 'error');
    }
}
