import { safeParseDate } from './date';
import { tFallback, type TranslateFn } from './i18n';
import type { Project, Section } from './types';

export type ProjectDetailsMetadata = {
    summary: string;
    statusLabel: string;
    typeLabel: string;
    sequentialScopeLabel: string | null;
    sections: Array<Pick<Section, 'id' | 'title'>>;
    areaLabel: string;
    tagsLabel: string;
    hasStartDate: boolean;
    hasDueDate: boolean;
    startDateLabel: string;
    dueDateLabel: string;
    reviewDateLabel: string;
};

/** RN's Project Details date display, including invalid raw values. */
export function formatProjectDate(dateStr: string | undefined, notSetLabel: string): string {
    if (!dateStr) return notSetLabel;
    try {
        const parsed = safeParseDate(dateStr);
        return parsed ? parsed.toLocaleDateString() : dateStr;
    } catch {
        return dateStr;
    }
}

/** Display-only policy shared by the RN panel and native Project detail window. */
export function getProjectDetailsPresentation(
    project: Project,
    input: {
        isArchivedProject: boolean;
        areaName: string;
        sections: readonly Pick<Section, 'id' | 'title'>[];
        t: TranslateFn;
    },
): ProjectDetailsMetadata {
    const { t } = input;
    const displayStatus = input.isArchivedProject ? 'archived' : project.status;
    const statusLabel = project.cancelledAt
        ? tFallback(t, 'projects.cancelled', 'Cancelled')
        : displayStatus === 'active' ? t('status.active')
            : displayStatus === 'waiting' ? t('status.waiting')
                : displayStatus === 'someday' ? t('status.someday')
                    : tFallback(t, 'status.archived', 'Archived');
    const typeLabel = project.isSequential
        ? tFallback(t, 'projects.sequential', 'Sequential')
        : tFallback(t, 'projects.parallel', 'Parallel');
    const noAreaLabel = tFallback(t, 'projects.noArea', 'No Area');
    const areaLabel = input.areaName || noAreaLabel;
    const sections = input.sections.map(({ id, title }) => ({ id, title }));
    const summary = [
        statusLabel,
        typeLabel,
        areaLabel !== noAreaLabel ? areaLabel : '',
        sections.length > 0 ? `${sections.length} ${tFallback(t, 'projects.sectionsLabel', 'Sections')}` : '',
    ].filter(Boolean).join(' · ');
    return {
        summary,
        statusLabel,
        typeLabel,
        sequentialScopeLabel: project.isSequential
            ? project.sequentialScope === 'section'
                ? tFallback(t, 'projects.sequentialWithinSections', 'Within sections')
                : tFallback(t, 'projects.sequentialAcrossSections', 'Across sections')
            : null,
        sections,
        areaLabel,
        tagsLabel: project.tagIds?.length ? project.tagIds.join(', ') : t('common.none'),
        hasStartDate: Boolean(project.startDate),
        hasDueDate: Boolean(project.dueDate),
        startDateLabel: formatProjectDate(project.startDate, t('common.notSet')),
        dueDateLabel: formatProjectDate(project.dueDate, t('common.notSet')),
        reviewDateLabel: formatProjectDate(project.reviewAt, t('common.notSet')),
    };
}
