import { useEffect, useMemo, useState } from 'react';
import type { Project, Section, Task, Area } from '@mindwtr/core';
import { PRESET_CONTEXTS, PRESET_TAGS, useTaskStore } from '@mindwtr/core';

type UseTaskItemProjectContextParams = {
    task: Task;
    propProject?: Project;
    projects: Project[];
    sections: Section[];
    areas: Area[];
    isEditing: boolean;
    editProjectId: string;
    setEditAreaId: (value: string) => void;
};

export function useTaskItemProjectContext({
    task,
    propProject,
    projects,
    sections,
    areas,
    isEditing,
    editProjectId,
    setEditAreaId,
}: UseTaskItemProjectContextParams) {
    const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
    const sectionsByProject = useMemo(() => {
        const map = new Map<string, Section[]>();
        sections.forEach((section) => {
            if (section.deletedAt) return;
            const list = map.get(section.projectId) ?? [];
            list.push(section);
            map.set(section.projectId, list);
        });
        map.forEach((list, key) => {
            list.sort((a, b) => {
                const aOrder = Number.isFinite(a.order) ? a.order : 0;
                const bOrder = Number.isFinite(b.order) ? b.order : 0;
                if (aOrder !== bOrder) return aOrder - bOrder;
                return a.title.localeCompare(b.title);
            });
            map.set(key, list);
        });
        return map;
    }, [sections]);
    const areaById = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas]);

    const [projectContext, setProjectContext] = useState<{ projectTitle: string; projectTasks: string[] } | null>(null);
    const [tagOptions, setTagOptions] = useState<string[]>(Array.from(PRESET_TAGS));
    const [popularTagOptions, setPopularTagOptions] = useState<string[]>(Array.from(PRESET_TAGS).slice(0, 8));
    const [allContexts, setAllContexts] = useState<string[]>(Array.from(PRESET_CONTEXTS).sort());

    useEffect(() => {
        if (!isEditing) return;
        if (editProjectId) {
            setEditAreaId('');
        }
        const { tasks: storeTasks, projects: storeProjects } = useTaskStore.getState();
        const projectId = editProjectId || task.projectId;
        const project = propProject || (projectId ? storeProjects.find((item) => item.id === projectId) : undefined);
        if (projectId) {
            const projectTasks = storeTasks
                .filter((candidate) => candidate.projectId === projectId && candidate.id !== task.id && !candidate.deletedAt)
                .map((candidate) => `${candidate.title}${candidate.status ? ` (${candidate.status})` : ''}`)
                .filter(Boolean)
                .slice(0, 20);
            setProjectContext({
                projectTitle: project?.title || '',
                projectTasks,
            });
        } else {
            setProjectContext(null);
        }

        const tagCounts = new Map<string, number>();
        const tags = new Set<string>(PRESET_TAGS);
        const contexts = new Set<string>(PRESET_CONTEXTS);
        storeTasks.forEach((candidate) => {
            candidate.tags?.forEach((tag) => {
                tags.add(tag);
                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            });
            candidate.contexts?.forEach((ctx) => contexts.add(ctx));
        });
        setTagOptions(Array.from(tags).filter(Boolean));

        const sortedTags = Array.from(tagCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([tag]) => tag);
        setPopularTagOptions(Array.from(new Set([...sortedTags, ...PRESET_TAGS])).slice(0, 8));
        setAllContexts(Array.from(contexts).sort());
    }, [editProjectId, isEditing, propProject, setEditAreaId, task.id, task.projectId]);

    return {
        projectById,
        sectionsByProject,
        areaById,
        projectContext,
        tagOptions,
        popularTagOptions,
        allContexts,
    };
}
