import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectsView } from './ProjectsView';

const setProjectView = vi.fn();
const showToast = vi.fn();
const requestConfirmation = vi.fn();

vi.mock('../ErrorBoundary', () => ({
    ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../PromptModal', () => ({
    PromptModal: () => null,
}));

vi.mock('./projects/AreaManagerModal', () => ({
    AreaManagerModal: () => null,
}));

vi.mock('./projects/ProjectsSidebar', () => ({
    ProjectsSidebar: () => <div data-testid="projects-sidebar">Projects sidebar</div>,
}));

vi.mock('./projects/ProjectWorkspace', () => ({
    ProjectWorkspace: () => <div data-testid="project-workspace">Workspace</div>,
}));

vi.mock('../../contexts/language-context', () => ({
    useLanguage: () => ({
        t: (key: string) => ({
            'projects.resizeSidebar': 'Resize projects panel',
        }[key] ?? key),
        language: 'en',
    }),
}));

vi.mock('../../hooks/useConfirmDialog', () => ({
    useConfirmDialog: () => ({
        requestConfirmation,
        confirmModal: null,
    }),
}));

vi.mock('../../hooks/usePerformanceMonitor', () => ({
    usePerformanceMonitor: () => ({
        enabled: false,
        metrics: {},
    }),
}));

vi.mock('../../config/performanceBudgets', () => ({
    checkBudget: vi.fn(),
}));

vi.mock('../../store/ui-store', () => ({
    useUiStore: (selector: (state: unknown) => unknown) => selector({
        projectView: { selectedProjectId: null },
        setProjectView,
        showToast,
    }),
}));

vi.mock('./projects/useAreaSidebarState', () => ({
    useAreaSidebarState: () => ({
        selectedArea: '__all__',
        sortedAreas: [],
        areaById: new Map(),
        areaFilterLabel: null,
        areaSensors: [],
        toggleAreaCollapse: vi.fn(),
        handleAreaDragEnd: vi.fn(),
        handleDeleteArea: vi.fn(),
    }),
}));

vi.mock('./projects/useProjectsViewStore', () => ({
    useProjectsViewStore: () => ({
        projects: [],
        tasks: [],
        sections: [],
        areas: [],
        addArea: vi.fn(),
        updateArea: vi.fn(),
        deleteArea: vi.fn(),
        reorderAreas: vi.fn(),
        reorderProjects: vi.fn(),
        reorderProjectTasks: vi.fn(),
        addProject: vi.fn(),
        updateProject: vi.fn(),
        deleteProject: vi.fn(),
        duplicateProject: vi.fn(),
        updateTask: vi.fn(),
        addSection: vi.fn(),
        updateSection: vi.fn(),
        deleteSection: vi.fn(),
        addTask: vi.fn(),
        toggleProjectFocus: vi.fn(),
        allTasks: [],
        highlightTaskId: null,
        setHighlightTask: vi.fn(),
        settings: {},
        getDerivedState: () => ({
            allContexts: [],
            allTags: [],
        }),
    }),
}));

describe('ProjectsView', () => {
    beforeEach(() => {
        setProjectView.mockReset();
        showToast.mockReset();
        requestConfirmation.mockReset();
        window.localStorage.clear();
    });

    it('allows keyboard resizing of the projects sidebar and persists the width', async () => {
        const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);

        render(<ProjectsView />);

        const separator = screen.getByRole('separator', { name: 'Resize projects panel' });
        const sidebar = screen.getByTestId('projects-sidebar').parentElement?.parentElement;

        expect(sidebar).not.toBeNull();
        expect(sidebar).toHaveStyle({ width: '304px' });

        fireEvent.keyDown(separator, { key: 'ArrowRight' });

        await waitFor(() => {
            expect(sidebar).toHaveStyle({ width: '328px' });
        });
        await waitFor(() => {
            expect(window.localStorage.getItem('mindwtr:projects:sidebarWidth')).toBe('328');
        });

        clientWidthSpy.mockRestore();
    });
});
