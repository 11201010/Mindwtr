import { sameShallowRecord } from './shallow-identity';
import { normalizeCancellationTimestamp } from './task-status';
import type { Project } from './types';

const hasOwnField = (value: object, field: PropertyKey): boolean => (
    Object.prototype.hasOwnProperty.call(value, field)
);

export function isProjectCancelled(
    project: Pick<Project, 'status' | 'cancelledAt'> | undefined,
): boolean {
    return project?.status === 'archived'
        && normalizeCancellationTimestamp(project.cancelledAt) !== undefined;
}

/**
 * Canonical project cancellation shape. A cancellation marker is meaningful
 * only on an archived project; active/waiting/someday projects cannot retain it.
 */
export function normalizeProjectLifecycleFields(project: Project): Project {
    const cancelledAt = project.status === 'archived'
        ? normalizeCancellationTimestamp(project.cancelledAt)
        : undefined;
    const cancellationChanged = cancelledAt !== project.cancelledAt;
    const focusChanged = project.status === 'archived' && project.isFocused !== false;
    if (!cancellationChanged && !focusChanged) return project;
    const next: Project = {
        ...project,
        ...(cancellationChanged ? { cancelledAt } : {}),
        ...(focusChanged ? { isFocused: false } : {}),
    };
    return sameShallowRecord(project, next) ? project : next;
}

/**
 * Applies project cancellation precedence to a raw patch. A valid timestamp by
 * itself is the explicit cancel signal; an explicit non-archived status is a
 * reactivation and therefore clears cancellation.
 */
export function normalizeProjectUpdate(
    project: Project,
    updates: Partial<Project>,
): Partial<Project> {
    let adjustedUpdates = updates;
    if (hasOwnField(updates, 'cancelledAt')) {
        const cancelledAt = normalizeCancellationTimestamp(updates.cancelledAt);
        adjustedUpdates = {
            ...adjustedUpdates,
            cancelledAt,
            ...(cancelledAt && !hasOwnField(updates, 'status') ? { status: 'archived' as const } : {}),
        };
    }

    const resolvedStatus = hasOwnField(adjustedUpdates, 'status')
        ? adjustedUpdates.status
        : project.status;
    if (resolvedStatus !== 'archived') {
        adjustedUpdates = {
            ...adjustedUpdates,
            cancelledAt: undefined,
        };
    }
    const explicitlyEnteredNonActiveStatus = hasOwnField(adjustedUpdates, 'status')
        && resolvedStatus !== project.status
        && resolvedStatus !== 'active';
    if (resolvedStatus === 'archived' || explicitlyEnteredNonActiveStatus) {
        adjustedUpdates = {
            ...adjustedUpdates,
            isFocused: false,
        };
    }
    return adjustedUpdates;
}
