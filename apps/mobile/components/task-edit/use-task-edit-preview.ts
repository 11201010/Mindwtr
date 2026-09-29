import React from 'react';
import type { Task } from '@mindwtr/core';
import { getTaskAIProjectContext } from '@mindwtr/core/ai-task-actions';

type UseTaskEditPreviewParams = {
    editedProjectId?: string;
    includeProjectContext?: boolean;
    onClose: () => void;
    onContextNavigate?: (context: string) => void;
    onProjectNavigate?: (projectId: string) => void;
    onTagNavigate?: (tag: string) => void;
    projectId?: string;
    projects: { id: string; title: string }[];
    task?: Task | null;
    tasks: Task[];
};

export function useTaskEditPreview({
    editedProjectId,
    includeProjectContext = true,
    onClose,
    onContextNavigate,
    onProjectNavigate,
    onTagNavigate,
    projectId,
    projects,
    task,
    tasks,
}: UseTaskEditPreviewParams) {
    const projectContext = React.useMemo(() => {
        if (!includeProjectContext) return null;
        return getTaskAIProjectContext({ projectId: editedProjectId ?? projectId, projects, tasks, taskId: task?.id });
    }, [editedProjectId, includeProjectContext, projectId, projects, task?.id, tasks]);

    const handlePreviewProjectPress = React.useCallback((nextProjectId: string) => {
        onClose();
        onProjectNavigate?.(nextProjectId);
    }, [onClose, onProjectNavigate]);

    const handlePreviewContextPress = React.useCallback((context: string) => {
        onClose();
        onContextNavigate?.(context);
    }, [onClose, onContextNavigate]);

    const handlePreviewTagPress = React.useCallback((tag: string) => {
        onClose();
        onTagNavigate?.(tag);
    }, [onClose, onTagNavigate]);

    return {
        handlePreviewContextPress,
        handlePreviewProjectPress,
        handlePreviewTagPress,
        projectContext,
    };
}
