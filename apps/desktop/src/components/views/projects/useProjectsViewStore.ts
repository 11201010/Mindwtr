import { shallow, useTaskStore } from '@mindwtr/core';

export const useProjectsViewStore = () =>
    useTaskStore(
        (state) => ({
            projects: state.projects,
            tasks: state.tasks,
            sections: state.sections,
            areas: state.areas,
            addArea: state.addArea,
            updateArea: state.updateArea,
            deleteArea: state.deleteArea,
            reorderAreas: state.reorderAreas,
            reorderProjects: state.reorderProjects,
            reorderProjectTasks: state.reorderProjectTasks,
            addProject: state.addProject,
            updateProject: state.updateProject,
            deleteProject: state.deleteProject,
            duplicateProject: state.duplicateProject,
            updateTask: state.updateTask,
            addSection: state.addSection,
            updateSection: state.updateSection,
            deleteSection: state.deleteSection,
            addTask: state.addTask,
            toggleProjectFocus: state.toggleProjectFocus,
            allTasks: state._allTasks,
            highlightTaskId: state.highlightTaskId,
            setHighlightTask: state.setHighlightTask,
            settings: state.settings,
            getDerivedState: state.getDerivedState,
        }),
        shallow
    );
