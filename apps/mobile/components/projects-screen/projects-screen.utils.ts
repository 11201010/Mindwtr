import { type Project } from '@mindwtr/core';
export { normalizeProjectTag } from '@mindwtr/core';
export { formatProjectDate } from '@mindwtr/core';

export type ProjectStatusPalette = Record<Project['status'], { text: string; bg: string; border: string }>;

// Shared by the project rows and the detail modal so both read the same swatches.
export function buildProjectStatusPalette(tc: {
    border: string;
    filterBg: string;
    secondaryText: string;
    tint: string;
}): ProjectStatusPalette {
    return {
        active: { text: tc.tint, bg: `${tc.tint}22`, border: tc.tint },
        waiting: { text: '#F59E0B', bg: '#F59E0B22', border: '#F59E0B' },
        someday: { text: '#A855F7', bg: '#A855F722', border: '#A855F7' },
        archived: { text: tc.secondaryText, bg: tc.filterBg, border: tc.border },
    };
}

export { resolveAttachmentValidationMessage } from '@mindwtr/core';

export function buildProjectQuickCaptureReturnTo(projectId: string) {
    return `/projects-screen?projectId=${encodeURIComponent(projectId)}`;
}

/** Inverse of buildProjectQuickCaptureReturnTo: the project the capture route was opened from. */
export { getProjectQuickCaptureReturnToProjectId } from '@mindwtr/core/capture-modal-model';
