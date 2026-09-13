import { act, fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore } from '@mindwtr/core';

import { LanguageProvider } from './contexts/language-context';
import { useUiStore } from './store/ui-store';

type SettingsModule = typeof import('./components/views/SettingsView');
type ReviewModule = typeof import('./components/views/ReviewView');

const lazyViews = vi.hoisted(() => {
    let resolveSettings!: (module: SettingsModule) => void;
    let resolveReview!: (module: ReviewModule) => void;

    return {
        settings: new Promise<SettingsModule>((resolve) => {
            resolveSettings = resolve;
        }),
        review: new Promise<ReviewModule>((resolve) => {
            resolveReview = resolve;
        }),
        resolveSettings: (module: SettingsModule) => resolveSettings(module),
        resolveReview: (module: ReviewModule) => resolveReview(module),
    };
});

vi.mock('./components/views/SettingsView', () => lazyViews.settings);
vi.mock('./components/views/ReviewView', () => lazyViews.review);

import App from './App';

const renderApp = () => render(
    <LanguageProvider>
        <App />
    </LanguageProvider>
);

const getContentWrapper = (container: HTMLElement) => (
    container.querySelector('[data-main-content] > div')
);

describe('App deferred navigation layout', () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.history.replaceState(null, '', '?view=calendar');
        useTaskStore.setState((state) => ({
            ...state,
            tasks: [],
            projects: [],
            sections: [],
            areas: [],
            _allTasks: [],
            _allProjects: [],
            _allSections: [],
            _allAreas: [],
            _tasksById: new Map(),
            _projectsById: new Map(),
            _sectionsById: new Map(),
            _areasById: new Map(),
            settings: {},
            isLoading: false,
            error: null,
        }));
        useUiStore.setState((state) => ({
            ...state,
            projectView: { selectedProjectId: null },
            toasts: [],
        }));
    });

    it('keeps rendered geometry during suspended navigation and commits only the latest view', async () => {
        const { container, getByRole, queryByRole } = renderApp();
        const content = () => getContentWrapper(container);

        expect(getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
        expect(content()).toHaveClass('max-w-screen-2xl');

        fireEvent.click(getByRole('button', { name: 'Settings' }));

        expect(getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
        expect(getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
        expect(content()).toHaveClass('max-w-screen-2xl');
        expect(content()).not.toHaveClass('max-w-none');

        fireEvent.click(getByRole('button', { name: 'Review' }));

        expect(getByRole('button', { name: 'Review' })).toHaveAttribute('aria-current', 'page');
        expect(getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
        expect(content()).toHaveClass('max-w-screen-2xl');

        await act(async () => {
            lazyViews.resolveSettings({
                SettingsView: () => React.createElement('h1', null, 'Deferred Settings'),
            } as SettingsModule);
            await lazyViews.settings;
        });

        expect(queryByRole('heading', { name: 'Deferred Settings' })).not.toBeInTheDocument();
        expect(getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
        expect(content()).toHaveClass('max-w-screen-2xl');

        await act(async () => {
            lazyViews.resolveReview({
                ReviewView: () => React.createElement('h1', null, 'Deferred Review'),
            } as ReviewModule);
            await lazyViews.review;
        });

        await waitFor(() => {
            expect(getByRole('heading', { name: 'Deferred Review' })).toBeInTheDocument();
            expect(content()).toHaveClass('max-w-6xl');
            expect(content()).not.toHaveClass('max-w-screen-2xl');
        });
    });
});
