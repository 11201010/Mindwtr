import { translateWithFallback, type Task } from '@mindwtr/core';
import { useUiStore } from '../store/ui-store';

export async function copyTaskTitles(
    tasks: Pick<Task, 'title' | 'description'>[],
    t: (key: string) => string,
    includeDescription = false,
): Promise<void> {
    if (tasks.length === 0) return;
    const translate = (key: string, fallback: string) => translateWithFallback(t, key, fallback);
    try {
        await navigator.clipboard.writeText(tasks.map((task) => {
            const description = includeDescription && task.description?.trim() ? `\n\n${task.description}` : '';
            return task.title + description;
        }).join('\n'));
        useUiStore.getState().showToast(
            includeDescription
                ? translate('list.taskCopied', 'Task copied to clipboard')
                : tasks.length === 1
                    ? translate('task.titleCopied', 'Title copied')
                    : translate('task.titlesCopied', 'Titles copied'),
            'success',
        );
    } catch {
        useUiStore.getState().showToast(translate('list.taskCopyFailed', 'Could not copy task'), 'error');
    }
}
