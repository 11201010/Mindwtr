import { useMemo } from 'react';
import {
    buildProjectGroups,
    type Area,
    type AreaFilterSelection,
    getUsedTaskTokens,
    type Project,
    type ProjectTagFilter,
    type Task,
} from '@mindwtr/core';

type UseProjectFilteringParams = {
    projects: Project[];
    tasks: Task[];
    sortedAreas: Area[];
    selectedTagFilter: string;
    selectedAreaFilter: AreaFilterSelection;
    allTagsValue: string;
    noTagsValue: string;
    focusedProjectCount: number;
};

export function useProjectFiltering({
    projects,
    tasks,
    sortedAreas,
    selectedTagFilter,
    selectedAreaFilter,
    allTagsValue,
    noTagsValue,
    focusedProjectCount,
}: UseProjectFilteringParams) {
    const focusedCount = focusedProjectCount;

    const areaUsage = useMemo(() => {
        const counts = new Map<string, number>();
        projects.forEach((project) => {
            if (project.deletedAt || !project.areaId) return;
            counts.set(project.areaId, (counts.get(project.areaId) || 0) + 1);
        });
        return counts;
    }, [projects]);

    const projectTagOptions = useMemo<string[]>(() => {
        const projectTags = projects.flatMap((project) => project.tagIds || []);
        return Array.from(new Set([
            ...getUsedTaskTokens(tasks, (task) => task.tags, { prefix: '#' }),
            ...projectTags,
        ])).filter(Boolean);
    }, [tasks, projects]);

    const groupedProjects = useMemo(() => {
        const tagFilter: ProjectTagFilter = selectedTagFilter === allTagsValue
            ? { kind: 'all' }
            : selectedTagFilter === noTagsValue
                ? { kind: 'untagged' }
                : { kind: 'tag', value: selectedTagFilter };

        return buildProjectGroups({
            projects,
            orderedAreas: sortedAreas,
            areaFilter: selectedAreaFilter,
            tagFilter,
            // This list has no drag order on the phone; the star is how a project moves up.
            pinFocused: true,
        });
    }, [
        allTagsValue,
        noTagsValue,
        projects,
        selectedAreaFilter,
        selectedTagFilter,
        sortedAreas,
    ]);

    return {
        areaUsage,
        focusedCount,
        groupedActiveProjects: groupedProjects.active,
        groupedDeferredProjects: groupedProjects.deferred,
        groupedArchivedProjects: groupedProjects.archived,
        projectTagOptions,
        tagFilterOptions: {
            list: groupedProjects.tagInventory.values,
            hasNoTags: groupedProjects.tagInventory.hasUntagged,
        },
    };
}
