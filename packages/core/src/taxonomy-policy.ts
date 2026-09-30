import { nextRevision, normalizeTagId } from './store-helpers';
import { dedupeTagValuesLastWins, formatTagIdPreservingCase } from './store-projects/shared';
import type { Project, Task } from './types';

export type TaxonomyKind = 'context' | 'tag';
export type TaxonomyAction = 'rename' | 'delete';
export type TaxonomyScope = { tasks: Task[]; projects: Project[] };
export type TaxonomyEffect = { tasks: Array<{ before: Task; after: Task }>;
    projects: Array<{ before: Project; after: Project }> };

const key = (kind: TaxonomyKind, value: string) => kind === 'tag' ? normalizeTagId(value) : value.trim().toLowerCase();

/** The exact RN early-return policy; `to` retains the text supplied by its caller. */
export function taxonomyDestination(kind: TaxonomyKind, action: TaxonomyAction,
    name: string, to: string | null): string | null | undefined {
    const source = key(kind, name);
    if (!source) return undefined;
    if (action === 'delete') return null;
    if (to === null) return undefined;
    const destination = kind === 'tag' ? formatTagIdPreservingCase(to) : to.trim();
    if (!key(kind, to) || !destination) return undefined;
    if (kind === 'tag' ? source === key(kind, to) && formatTagIdPreservingCase(name) === destination
        : source === destination.toLowerCase() && name.trim() === destination) return undefined;
    return destination;
}

export function selectTaxonomyScope(kind: TaxonomyKind, name: string,
    tasks: readonly Task[], projects: readonly Project[]): TaxonomyScope {
    const target = key(kind, name);
    const has = (values: readonly string[]) => values.some((value) => key(kind, value) === target);
    return { tasks: tasks.filter((task) => has(kind === 'tag' ? task.tags ?? [] : task.contexts ?? [])),
        projects: kind === 'tag' ? projects.filter((project) => has(project.tagIds ?? [])) : [] };
}

/** Preserves RN's first-match rename, context first-wins and tag last-wins rules. */
export function planTaxonomyEffect(kind: TaxonomyKind, action: TaxonomyAction, name: string,
    to: string | null, scope: TaxonomyScope, deviceId: string, now: string): TaxonomyEffect | null {
    const destination = taxonomyDestination(kind, action, name, to);
    if (destination === undefined) return null;
    const target = key(kind, name);
    const valuesAfter = (values: string[]): string[] | null => {
        if (action === 'delete') {
            const filtered = values.filter((value) => key(kind, value) !== target);
            return filtered.length === values.length ? null : filtered;
        }
        const index = values.findIndex((value) => key(kind, value) === target);
        if (index < 0) return null;
        const replaced = [...values];
        replaced[index] = destination!;
        if (kind === 'tag') return dedupeTagValuesLastWins(replaced, destination!);
        const seen = new Set<string>();
        return replaced.filter((value) => {
            const normalized = key(kind, value);
            if (seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        });
    };
    return {
        tasks: scope.tasks.flatMap((before) => {
            const field = kind === 'tag' ? 'tags' : 'contexts';
            const values = valuesAfter(before[field] ?? []);
            return values === null ? [] : [{ before, after: { ...before, [field]: values,
                updatedAt: now, rev: nextRevision(before.rev), revBy: deviceId } }];
        }),
        projects: kind === 'tag' ? scope.projects.flatMap((before) => {
            const values = valuesAfter(before.tagIds ?? []);
            return values === null ? [] : [{ before, after: { ...before, tagIds: values,
                updatedAt: now, rev: nextRevision(before.rev), revBy: deviceId } }];
        }) : [],
    };
}
