import { useCallback } from 'react';
import type { Project, Section } from '@mindwtr/core';
import { isTauriRuntime } from '../../../lib/runtime';

type UseProjectSectionActionsParams = {
    t: (key: string) => string;
    selectedProject: Project | undefined;
    setEditingSectionId: (id: string | null) => void;
    setSectionDraft: (value: string) => void;
    setShowSectionPrompt: (value: boolean) => void;
    deleteSection: (id: string) => void;
    updateSection: (id: string, updates: Partial<Section>) => void;
    setSectionNotesOpen: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
    setSectionTaskTargetId: (value: string | null) => void;
    setSectionTaskDraft: (value: string) => void;
    setShowSectionTaskPrompt: (value: boolean) => void;
};

export function useProjectSectionActions({
    t,
    selectedProject,
    setEditingSectionId,
    setSectionDraft,
    setShowSectionPrompt,
    deleteSection,
    updateSection,
    setSectionNotesOpen,
    setSectionTaskTargetId,
    setSectionTaskDraft,
    setShowSectionTaskPrompt,
}: UseProjectSectionActionsParams) {
    const handleAddSection = useCallback(() => {
        if (!selectedProject) return;
        setEditingSectionId(null);
        setSectionDraft('');
        setShowSectionPrompt(true);
    }, [selectedProject, setEditingSectionId, setSectionDraft, setShowSectionPrompt]);

    const handleRenameSection = useCallback((section: Section) => {
        setEditingSectionId(section.id);
        setSectionDraft(section.title);
        setShowSectionPrompt(true);
    }, [setEditingSectionId, setSectionDraft, setShowSectionPrompt]);

    const handleDeleteSection = useCallback(async (section: Section) => {
        const confirmed = isTauriRuntime()
            ? await import('@tauri-apps/plugin-dialog').then(({ confirm }) =>
                confirm(t('projects.deleteSectionConfirm'), {
                    title: t('projects.sectionsLabel'),
                    kind: 'warning',
                }),
            )
            : window.confirm(t('projects.deleteSectionConfirm'));
        if (confirmed) {
            deleteSection(section.id);
        }
    }, [deleteSection, t]);

    const handleToggleSection = useCallback((section: Section) => {
        updateSection(section.id, { isCollapsed: !section.isCollapsed });
    }, [updateSection]);

    const handleToggleSectionNotes = useCallback((sectionId: string) => {
        setSectionNotesOpen((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
    }, [setSectionNotesOpen]);

    const handleOpenSectionTaskPrompt = useCallback((sectionId: string) => {
        setSectionTaskTargetId(sectionId);
        setSectionTaskDraft('');
        setShowSectionTaskPrompt(true);
    }, [setSectionTaskDraft, setSectionTaskTargetId, setShowSectionTaskPrompt]);

    return {
        handleAddSection,
        handleRenameSection,
        handleDeleteSection,
        handleToggleSection,
        handleToggleSectionNotes,
        handleOpenSectionTaskPrompt,
    };
}
