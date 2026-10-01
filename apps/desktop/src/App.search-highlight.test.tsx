import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore } from '@mindwtr/core';
import App from './App';
import { LanguageProvider } from './contexts/language-context';
import { useUiStore } from './store/ui-store';

const searchProps = vi.hoisted(() => ({
    onNavigate: null as null | ((view: string, id?: string, options?: { highlightTaskId?: string }) => void),
}));

vi.mock('./components/GlobalSearch', () => ({
    GlobalSearch: (props: { onNavigate: typeof searchProps.onNavigate }) => {
        searchProps.onNavigate = props.onNavigate;
        return null;
    },
}));

Object.defineProperty(window, 'electronAPI', {
    value: {
        saveData: vi.fn(),
        getData: vi.fn().mockResolvedValue({ tasks: [], projects: [], sections: [], areas: [], settings: {} }),
    },
    writable: true,
});

describe('App search highlight (#1262)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.history.replaceState(null, '', '/');
        searchProps.onNavigate = null;
        useTaskStore.setState((state) => ({
            ...state,
            tasks: [], projects: [], sections: [], areas: [],
            _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [],
            _tasksById: new Map(), _projectsById: new Map(), _sectionsById: new Map(), _areasById: new Map(),
            settings: {}, isLoading: false, error: null, highlightTaskId: null,
        }));
        useUiStore.setState((state) => ({ ...state, projectView: { selectedProjectId: null }, toasts: [] }));
    });

    it('highlights a search result only once its destination view is on screen', async () => {
        render(<LanguageProvider><App /></LanguageProvider>);
        expect(screen.getByRole('heading', { name: 'Focus' })).toBeInTheDocument();
        expect(searchProps.onNavigate).toBeTypeOf('function');

        let focusOnScreenWhenHighlighted: boolean | null = null;
        const unsubscribe = useTaskStore.subscribe((state) => {
            if (state.highlightTaskId && focusOnScreenWhenHighlighted === null) {
                focusOnScreenWhenHighlighted = screen.queryByRole('heading', { name: 'Focus' }) !== null;
            }
        });
        try {
            await act(async () => {
                searchProps.onNavigate?.('projects', 'task-1', { highlightTaskId: 'task-1' });
            });
            await waitFor(() => expect(useTaskStore.getState().highlightTaskId).toBe('task-1'));
            expect(focusOnScreenWhenHighlighted).toBe(false);
        } finally {
            unsubscribe();
        }
    });
});
