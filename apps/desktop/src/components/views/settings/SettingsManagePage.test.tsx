import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore } from '@mindwtr/core';

import { SettingsManagePage } from './SettingsManagePage';

const initialTaskState = useTaskStore.getState();

const translations: Record<string, string> = {
    'areas.manage': 'Manage Areas',
    'common.delete': 'Delete',
    'contexts.tags': 'Tags',
    'contexts.title': 'Contexts',
    'people.title': 'People',
    'search.title': 'Search',
    'viewSections.somedaySections': 'Someday sections',
};

const translate = (key: string) => translations[key] ?? key;

describe('SettingsManagePage Someday sections', () => {
    beforeEach(() => {
        useTaskStore.setState(initialTaskState, true);
        useTaskStore.setState({
            _allAreas: [],
            _allPeople: [],
            _allTasks: [],
            settings: {
                gtd: {
                    viewSections: {
                        someday: [{ id: 'books', title: 'Books to read', order: 0 }],
                    },
                },
            },
        });
    });

    it('renders collapsed by default and deletes only the heading catalogue from Manage', async () => {
        const updateSettings = vi.fn(async () => undefined);
        const requestConfirmation = vi.fn(async () => true);
        useTaskStore.setState({ updateSettings });

        const view = render(
            <SettingsManagePage
                t={{ manage: 'Manage' }}
                translate={translate}
                requestConfirmation={requestConfirmation}
            />,
        );

        const toggle = view.getByRole('button', { name: /Someday sections\s*1/ });
        expect(view.queryByText('Books to read')).not.toBeInTheDocument();

        fireEvent.click(toggle);
        expect(view.getByDisplayValue('Books to read')).toBeInTheDocument();

        fireEvent.click(view.getByRole('button', { name: 'Delete' }));
        await waitFor(() => {
            expect(requestConfirmation).toHaveBeenCalledWith(expect.objectContaining({
                description: 'Delete "Books to read"?',
            }));
            expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
                gtd: expect.objectContaining({
                    viewSections: expect.objectContaining({ someday: [] }),
                }),
            }));
        });
    });

    it('counts assignment and exact person contexts once and opens a completed-inclusive person review', () => {
        useTaskStore.setState({
            _allPeople: [{
                id: 'person-alex',
                name: 'Alex',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
            }, {
                id: 'person-casey',
                name: 'Casey',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
            }],
            _allTasks: [
                { id: 'assigned', title: 'Assigned', status: 'waiting', assignedTo: 'Alex', tags: [], contexts: [], createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
                { id: 'context', title: 'Context', status: 'next', tags: [], contexts: ['@alex'], createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
                { id: 'both', title: 'Both', status: 'next', assignedTo: 'Alex', tags: [], contexts: ['@Alex'], createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
                { id: 'done', title: 'Done', status: 'done', tags: [], contexts: ['@Alex'], createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
                { id: 'hierarchical', title: 'Other', status: 'next', tags: [], contexts: ['@Alex/Office'], createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
                { id: 'archived-only', title: 'Archived', status: 'archived', assignedTo: 'Casey', tags: [], contexts: [], createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
            ],
        });
        const onOpenSearch = vi.fn();
        window.addEventListener('mindwtr:open-search', onOpenSearch);
        const view = render(
            <SettingsManagePage
                t={{ manage: 'Manage' }}
                translate={translate}
                requestConfirmation={vi.fn(async () => true)}
            />,
        );

        fireEvent.click(view.getByRole('button', { name: /People\s*2/ }));
        expect(view.getByRole('button', { name: /Casey.*1.*tasks/ })).toBeInTheDocument();
        fireEvent.click(view.getByRole('button', { name: /Alex.*4.*tasks.*Search/ }));

        expect(onOpenSearch).toHaveBeenCalledTimes(1);
        expect((onOpenSearch.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
            query: 'person:"Alex"',
            includeCompleted: true,
        });
        window.removeEventListener('mindwtr:open-search', onOpenSearch);
    });
});
