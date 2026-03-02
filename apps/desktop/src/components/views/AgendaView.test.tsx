import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useTaskStore, type Task } from '@mindwtr/core';
import { LanguageProvider } from '../../contexts/language-context';
import { AgendaView } from './AgendaView';

const nowIso = '2026-02-28T12:00:00.000Z';

const focusedTask: Task = {
    id: 'focused-task',
    title: 'Focused task',
    status: 'next',
    isFocusedToday: true,
    checklist: [
        { id: 'item-1', title: 'Checklist item', isCompleted: false },
    ],
    tags: [],
    contexts: [],
    createdAt: nowIso,
    updatedAt: nowIso,
};

const renderAgenda = () => render(
    <LanguageProvider>
        <AgendaView />
    </LanguageProvider>
);

describe('AgendaView', () => {
    beforeEach(() => {
        useTaskStore.setState({
            tasks: [focusedTask],
            _allTasks: [focusedTask],
            projects: [],
            _allProjects: [],
            areas: [],
            _allAreas: [],
            settings: {},
            highlightTaskId: null,
        });
    });

    it('keeps focus task details open when checklist items are toggled', async () => {
        const { getByRole, getByText } = renderAgenda();

        fireEvent.click(getByRole('button', { name: /toggle task details/i }));
        const checklistItem = getByText('Checklist item');
        expect(checklistItem).toBeInTheDocument();

        fireEvent.click(checklistItem);

        expect(getByText('Checklist item')).toBeInTheDocument();
    });

    it('shows non-next tasks with start time today in Starting / Available', () => {
        const now = new Date();
        const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0).toISOString();
        const startTodayTask: Task = {
            id: 'start-today-task',
            title: 'Start today inbox task',
            status: 'inbox',
            startTime: startToday,
            tags: [],
            contexts: [],
            createdAt: nowIso,
            updatedAt: nowIso,
        };

        useTaskStore.setState({
            tasks: [startTodayTask],
            _allTasks: [startTodayTask],
            projects: [],
            _allProjects: [],
            areas: [],
            _allAreas: [],
            settings: {},
            highlightTaskId: null,
        });

        const { getByRole, getByText } = renderAgenda();

        expect(getByRole('heading', { name: /starting \/ available/i })).toBeInTheDocument();
        expect(getByText('Start today inbox task')).toBeInTheDocument();
    });
});
