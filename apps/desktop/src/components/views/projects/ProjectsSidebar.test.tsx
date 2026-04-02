import { useEffect, useMemo, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '@mindwtr/core';
import { describe, expect, it, vi } from 'vitest';

import { ProjectsSidebar } from './ProjectsSidebar';

const now = '2026-04-02T12:00:00.000Z';
const noAreaId = '__no_area__';
const allTagsId = '__all__';
const noTagsId = '__none__';

const translations: Record<string, string> = {
    'common.cancel': 'Cancel',
    'projects.activeSection': 'Active projects',
    'projects.allTags': 'All tags',
    'projects.areaLabel': 'Area',
    'projects.create': 'Create',
    'projects.deferredSection': 'Deferred projects',
    'projects.duplicate': 'Duplicate',
    'projects.noArea': 'No area',
    'projects.noNextAction': 'No next action',
    'projects.projectName': 'Project name',
    'projects.tagFilter': 'Tag filter',
    'projects.title': 'Projects',
};

const t = (key: string) => translations[key] ?? key;

function buildProject(id: string, title: string, order: number): Project {
    return {
        id,
        title,
        status: 'active',
        color: '#22c55e',
        order,
        tagIds: [],
        createdAt: now,
        updatedAt: now,
    };
}

function SidebarHarness() {
    const [projects, setProjects] = useState<Project[]>([
        buildProject('project-alpha', 'Alpha', 0),
        buildProject('project-beta', 'Beta', 1),
    ]);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>('project-alpha');
    const selectedProject = useMemo(
        () => projects.find((project) => project.id === selectedProjectId) ?? null,
        [projects, selectedProjectId]
    );
    const [editTitle, setEditTitle] = useState(selectedProject?.title ?? '');

    useEffect(() => {
        setEditTitle(selectedProject?.title ?? '');
    }, [selectedProject?.id, selectedProject?.title]);

    return (
        <div>
            <label>
                Project title
                <input
                    aria-label="Project title"
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    onBlur={() => {
                        if (!selectedProjectId) return;
                        const nextTitle = editTitle.trim();
                        if (!nextTitle) return;
                        setProjects((current) => current.map((project) => (
                            project.id === selectedProjectId
                                ? { ...project, title: nextTitle, updatedAt: now }
                                : project
                        )));
                    }}
                />
            </label>
            <div data-testid="selected-project-id">{selectedProjectId}</div>
            <ProjectsSidebar
                t={t}
                selectedTag={allTagsId}
                noAreaId={noAreaId}
                allTagsId={allTagsId}
                noTagsId={noTagsId}
                tagOptions={{ list: [], hasNoTags: true }}
                isCreating={false}
                isCreatingProject={false}
                newProjectTitle=""
                onStartCreate={vi.fn()}
                onCancelCreate={vi.fn()}
                onCreateProject={vi.fn()}
                onChangeNewProjectTitle={vi.fn()}
                onSelectTag={vi.fn()}
                groupedActiveProjects={[[noAreaId, projects]]}
                groupedDeferredProjects={[]}
                areaById={new Map()}
                collapsedAreas={{}}
                onToggleAreaCollapse={vi.fn()}
                showDeferredProjects={false}
                onToggleDeferredProjects={vi.fn()}
                selectedProjectId={selectedProjectId}
                onSelectProject={setSelectedProjectId}
                getProjectColor={(project) => project.color}
                tasksByProject={{}}
                projects={projects}
                toggleProjectFocus={vi.fn()}
                updateProject={vi.fn()}
                reorderProjects={vi.fn()}
                onDuplicateProject={vi.fn()}
            />
        </div>
    );
}

function renderSidebarWithSpy(onSelectProject = vi.fn()) {
    const projects = [
        buildProject('project-alpha', 'Alpha', 0),
        buildProject('project-beta', 'Beta', 1),
    ];

    render(
        <ProjectsSidebar
            t={t}
            selectedTag={allTagsId}
            noAreaId={noAreaId}
            allTagsId={allTagsId}
            noTagsId={noTagsId}
            tagOptions={{ list: [], hasNoTags: true }}
            isCreating={false}
            isCreatingProject={false}
            newProjectTitle=""
            onStartCreate={vi.fn()}
            onCancelCreate={vi.fn()}
            onCreateProject={vi.fn()}
            onChangeNewProjectTitle={vi.fn()}
            onSelectTag={vi.fn()}
            groupedActiveProjects={[[noAreaId, projects]]}
            groupedDeferredProjects={[]}
            areaById={new Map()}
            collapsedAreas={{}}
            onToggleAreaCollapse={vi.fn()}
            showDeferredProjects={false}
            onToggleDeferredProjects={vi.fn()}
            selectedProjectId={'project-alpha'}
            onSelectProject={onSelectProject}
            getProjectColor={(project) => project.color}
            tasksByProject={{}}
            projects={projects}
            toggleProjectFocus={vi.fn()}
            updateProject={vi.fn()}
            reorderProjects={vi.fn()}
            onDuplicateProject={vi.fn()}
        />
    );

    return { onSelectProject };
}

describe('ProjectsSidebar', () => {
    it('selects a project on primary mouse down so blur-driven rerenders cannot swallow the switch', () => {
        const { onSelectProject } = renderSidebarWithSpy();

        fireEvent.mouseDown(screen.getByText('Beta'), { button: 0 });

        expect(onSelectProject).toHaveBeenCalledWith('project-beta');
    });

    it('does not select a project when clicking its drag handle', () => {
        const { onSelectProject } = renderSidebarWithSpy();

        fireEvent.click(screen.getAllByTitle('Drag')[0]);

        expect(onSelectProject).not.toHaveBeenCalled();
    });

    it('does not select a project when pressing its focus toggle', () => {
        const { onSelectProject } = renderSidebarWithSpy();

        fireEvent.mouseDown(screen.getAllByLabelText('Add to focus')[0], { button: 0 });

        expect(onSelectProject).not.toHaveBeenCalled();
    });

    it('switches projects with one click while the current title input blurs and rerenders', async () => {
        const user = userEvent.setup();

        render(<SidebarHarness />);

        const titleInput = screen.getByLabelText('Project title');
        await user.clear(titleInput);
        await user.type(titleInput, 'Alpha updated');
        await user.click(screen.getByText('Beta'));

        await waitFor(() => {
            expect(screen.getByTestId('selected-project-id')).toHaveTextContent('project-beta');
        });

        expect(screen.getByText('Alpha updated')).toBeInTheDocument();
    });
});
