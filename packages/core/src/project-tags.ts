import { getUsedTaskTokens } from './task-token-usage';
import type { Project, Task } from './types';

export type ProjectTagsIntent = { kind: 'add' | 'toggle'; input: string } | { kind: 'clear' };

/** RN's input rule: trim, then add one leading # only if none is present. */
export function normalizeProjectTag(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/** The complete RN suggestion inventory, in task-token order then Project insertion order. */
export function projectTagSuggestions(tasks: Task[], projects: Project[]): string[] {
    return Array.from(new Set([
        ...getUsedTaskTokens(tasks, (task) => task.tags, { prefix: '#' }),
        ...projects.flatMap((project) => project.tagIds || []),
    ])).filter(Boolean);
}

/** Apply the exact RN Add/Toggle/Clear array operations without rewriting legacy raw tags. */
export function projectTagsForIntent(current: readonly string[], intent: ProjectTagsIntent): string[] {
    if (intent.kind === 'clear') return [];
    const normalized = normalizeProjectTag(intent.input);
    if (!normalized) return [...current];
    if (intent.kind === 'add') return Array.from(new Set([...current, normalized]));
    return current.includes(normalized)
        ? current.filter((tag) => tag !== normalized)
        : [...current, normalized];
}
