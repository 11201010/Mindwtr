import { tFallback } from './i18n';

/** A localized noun with its count for list headers and action toasts. */
export function formatListItemCount(count: number, kind: 'task' | 'project', t: (key: string) => string): string {
    return `${count} ${formatListItemCountNoun(count, kind, t)}`;
}

export function formatListItemCountNoun(count: number, kind: 'task' | 'project', t: (key: string) => string): string {
    const key = kind === 'task'
        ? count === 1 ? 'list.countTaskSingular' : 'common.tasks'
        : count === 1 ? 'list.countProjectSingular' : 'projects.count';
    return tFallback(t, key, count === 1 ? kind : `${kind}s`);
}
