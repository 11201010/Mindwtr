import { projectMatchesAreaFilterSelection, type AreaFilterSelection } from './area-filter';
import type { Area, Project } from './types';

export type ProjectTagFilter =
    | { kind: 'all' }
    | { kind: 'untagged' }
    | { kind: 'tag'; value: string };

export type ProjectAreaGroup = {
    areaId?: string;
    projects: Project[];
};

export type ProjectGroups = {
    active: ProjectAreaGroup[];
    deferred: ProjectAreaGroup[];
    archived: ProjectAreaGroup[];
    tagInventory: {
        values: string[];
        hasUntagged: boolean;
    };
};

type BuildProjectGroupsInput = {
    projects: Project[];
    orderedAreas: Area[];
    areaFilter: AreaFilterSelection;
    tagFilter: ProjectTagFilter;
    /**
     * Starred projects first inside each area group (#1263). Only for a list the
     * user cannot drag: a drag list must show the stored `order`, or a starred
     * project dragged lower jumps back and drops land in the wrong place.
     */
    pinFocused?: boolean;
};

const projectOrder = (project: Project): number => (
    Number.isFinite(project.order) ? project.order : 0
);

const groupProjectsByArea = (
    projects: Project[],
    orderedAreas: Area[],
    areaById: Map<string, Area>,
): ProjectAreaGroup[] => {
    const byArea = new Map<string | undefined, Project[]>();
    projects.forEach((project) => {
        const areaId = project.areaId && areaById.has(project.areaId)
            ? project.areaId
            : undefined;
        const entries = byArea.get(areaId) ?? [];
        entries.push(project);
        byArea.set(areaId, entries);
    });

    const groups: ProjectAreaGroup[] = orderedAreas.flatMap((area) => {
        const entries = byArea.get(area.id);
        return entries?.length ? [{ areaId: area.id, projects: entries }] : [];
    });
    const noAreaProjects = byArea.get(undefined);
    if (noAreaProjects?.length) groups.push({ areaId: undefined, projects: noAreaProjects });
    return groups;
};

export function buildProjectGroups({
    projects,
    orderedAreas,
    areaFilter,
    tagFilter,
    pinFocused = false,
}: BuildProjectGroupsInput): ProjectGroups {
    const visibleProjects = projects
        .filter((project) => !project.deletedAt)
        .sort((a, b) => {
            if (pinFocused && (a.isFocused === true) !== (b.isFocused === true)) return a.isFocused === true ? -1 : 1;
            const orderDiff = projectOrder(a) - projectOrder(b);
            return orderDiff || a.title.localeCompare(b.title);
        });
    const activeAreas = orderedAreas.filter((area) => !area.deletedAt);
    const areaById = new Map(activeAreas.map((area) => [area.id, area]));
    const tagValues = new Set<string>();
    let hasUntagged = false;
    visibleProjects.forEach((project) => {
        const values = project.tagIds ?? [];
        if (values.length === 0) hasUntagged = true;
        values.forEach((value) => tagValues.add(value));
    });
    const filteredProjects = visibleProjects.filter((project) => {
        if (!projectMatchesAreaFilterSelection(project, areaFilter, areaById)) return false;
        const values = project.tagIds ?? [];
        if (tagFilter.kind === 'untagged') return values.length === 0;
        if (tagFilter.kind === 'tag') return values.includes(tagFilter.value);
        return true;
    });

    const active: Project[] = [];
    const deferred: Project[] = [];
    const archived: Project[] = [];
    filteredProjects.forEach((project) => {
        if (project.status === 'archived') {
            archived.push(project);
        } else if (project.status === 'waiting' || project.status === 'someday') {
            deferred.push(project);
        } else {
            active.push(project);
        }
    });

    return {
        active: groupProjectsByArea(active, activeAreas, areaById),
        deferred: groupProjectsByArea(deferred, activeAreas, areaById),
        archived: groupProjectsByArea(archived, activeAreas, areaById),
        tagInventory: {
            values: Array.from(tagValues).sort(),
            hasUntagged,
        },
    };
}
