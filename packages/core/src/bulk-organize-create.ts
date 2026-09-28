import { resolveCaptureAreaQuery } from './capture';
import { DEFAULT_PROJECT_COLOR } from './color-constants';
import { flushPendingSave, useTaskStore } from './store';
import type { Area, Project } from './types';

/** A failed creation can be visible in memory before it is durable. */
export async function ensureBulkOrganizeDestinationSaved(): Promise<void> {
    if (useTaskStore.getState().persistenceFailure) {
        await useTaskStore.getState().retryPersistence();
    }
    await flushPendingSave();
    const failure = useTaskStore.getState().persistenceFailure;
    if (failure) throw new Error(failure.message);
}

// Destination creation is independent of applying the bulk task changes.
// Core actions own identity/defaults; the picker must wait for durable storage.
async function saveDestination<T>(create: () => Promise<T | null>): Promise<T | null> {
    if (useTaskStore.getState().persistenceFailure) {
        // A prior failed creation may exist in memory. Persist that snapshot
        // before allowing the core action to return its deduplicated entity.
        await ensureBulkOrganizeDestinationSaved();
    }
    const created = await create();
    if (!created) return null;
    await ensureBulkOrganizeDestinationSaved();
    return created;
}

/**
 * The store call behind createBulkOrganizeProject, without its durable save: the
 * trimmed title, the placeholder color and the chosen area. addProject returns the
 * same-titled project already in that area instead of adding another. `id` names a
 * new project (the native host passes its request UUID, so a replay finds it).
 */
export function addBulkOrganizeProject(title: string, areaId?: string, id?: string): Promise<Project | null> {
    return useTaskStore.getState().addProject(
        title.trim(),
        DEFAULT_PROJECT_COLOR,
        areaId || id ? { ...(areaId ? { areaId } : {}), ...(id ? { id } : {}) } : undefined,
    );
}

/** The store call behind createBulkOrganizeArea, without its durable save: an area of that name is reused. `id` names a new area. */
export async function addBulkOrganizeArea(name: string, id?: string): Promise<Area | null> {
    const state = useTaskStore.getState();
    const choice = resolveCaptureAreaQuery(state.areas, name);
    if (choice.kind === 'select') return choice.area;
    if (choice.kind === 'empty') return null;
    return state.addArea(choice.areaToCreate.name, { color: choice.areaToCreate.color, ...(id ? { id } : {}) });
}

export async function createBulkOrganizeProject(title: string, areaId?: string): Promise<Project | null> {
    const trimmed = title.trim();
    if (!trimmed) return null;
    return saveDestination(() => addBulkOrganizeProject(trimmed, areaId));
}

export async function createBulkOrganizeArea(name: string): Promise<Area | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    return saveDestination(() => addBulkOrganizeArea(trimmed));
}
