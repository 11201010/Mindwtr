import { useTaskStore } from './store';

export type DetachedProjectTask = { id: string; sectionId?: string };

// deleteProject keeps a project's tasks but clears their projectId/sectionId, and
// restoreProject cannot know which tasks those were. An Undo handler records the
// links BEFORE it deletes and hands them back here. Same membership rule as
// deleteProject: by projectId, or by a section that belongs to the project.
export function collectProjectTaskLinks(projectId: string): DetachedProjectTask[] {
    const state = useTaskStore.getState();
    const sectionIds = new Set(
        state._allSections.filter((section) => section.projectId === projectId).map((section) => section.id),
    );
    return state._allTasks
        .filter((task) => !task.deletedAt
            && (task.projectId === projectId || (task.sectionId !== undefined && sectionIds.has(task.sectionId))))
        .map((task) => ({ id: task.id, ...(task.sectionId ? { sectionId: task.sectionId } : {}) }));
}

// Restores the project, then re-attaches only tasks that are still loose: not
// deleted, no project and no area. A task the user re-filed in the meantime stays put.
export async function undoProjectDelete(projectId: string, links: readonly DetachedProjectTask[]): Promise<void> {
    const restoreResult = await Promise.resolve(useTaskStore.getState().restoreProject(projectId));
    if (!restoreResult.success) throw new Error(restoreResult.error || 'Failed to restore project');

    const state = useTaskStore.getState();
    const liveSectionIds = new Set(
        state._allSections
            .filter((section) => section.projectId === projectId && !section.deletedAt)
            .map((section) => section.id),
    );
    const linkById = new Map(links.map((link) => [link.id, link]));
    const updates = state._allTasks
        .filter((task) => linkById.has(task.id) && !task.deletedAt && !task.projectId && !task.areaId)
        .map((task) => {
            const sectionId = linkById.get(task.id)?.sectionId;
            return {
                id: task.id,
                updates: { projectId, sectionId: sectionId && liveSectionIds.has(sectionId) ? sectionId : undefined },
            };
        });
    if (updates.length === 0) return;
    const attachResult = await Promise.resolve(state.batchUpdateTasks(updates));
    if (!attachResult.success) throw new Error(attachResult.error || 'Failed to restore project tasks');
}
