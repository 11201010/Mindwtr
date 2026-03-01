import { shallow, useTaskStore } from '@mindwtr/core';
import { useUiStore } from '../../store/ui-store';

export const useTaskItemStoreState = () =>
    useTaskStore(
        (state) => ({
            updateTask: state.updateTask,
            deleteTask: state.deleteTask,
            moveTask: state.moveTask,
            projects: state.projects,
            sections: state.sections,
            areas: state.areas,
            settings: state.settings,
            duplicateTask: state.duplicateTask,
            resetTaskChecklist: state.resetTaskChecklist,
            restoreTask: state.restoreTask,
            highlightTaskId: state.highlightTaskId,
            setHighlightTask: state.setHighlightTask,
            addProject: state.addProject,
            addArea: state.addArea,
            addSection: state.addSection,
            lockEditing: state.lockEditing,
            unlockEditing: state.unlockEditing,
        }),
        shallow
    );

export const useTaskItemUiState = (taskId: string) =>
    useUiStore(
        (state) => ({
            setProjectView: state.setProjectView,
            editingTaskId: state.editingTaskId,
            setEditingTaskId: state.setEditingTaskId,
            isTaskExpanded: Boolean(state.expandedTaskIds[taskId]),
            setTaskExpanded: state.setTaskExpanded,
            toggleTaskExpanded: state.toggleTaskExpanded,
            showToast: state.showToast,
        }),
        shallow
    );
