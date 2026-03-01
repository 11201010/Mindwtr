import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TaskItem } from '../components/TaskItem';
import { Task, configureDateFormatting, safeFormatDate } from '@mindwtr/core';
import { LanguageProvider } from '../contexts/language-context';
import { useUiStore } from '../store/ui-store';

const mockTask: Task = {
    id: '1',
    title: 'Test Task',
    status: 'inbox',
    tags: [],
    contexts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

describe('TaskItem', () => {
    beforeEach(() => {
        useUiStore.setState({
            editingTaskId: null,
            expandedTaskIds: {},
        });
    });

    it('renders task title', () => {
        const { getByText } = render(
            <LanguageProvider>
                <TaskItem task={mockTask} />
            </LanguageProvider>
        );
        expect(getByText('Test Task')).toBeInTheDocument();
    });

    it('enters edit mode when Edit is clicked', () => {
        const { getAllByRole, getByDisplayValue } = render(
            <LanguageProvider>
                <TaskItem task={mockTask} />
            </LanguageProvider>
        );
        const editButtons = getAllByRole('button', { name: /edit/i });
        fireEvent.click(editButtons[0]);
        expect(getByDisplayValue('Test Task')).toBeInTheDocument();
    });

    it('does not render checkbox when not in selection mode', () => {
        const { queryByRole } = render(
            <LanguageProvider>
                <TaskItem task={mockTask} />
            </LanguageProvider>
        );
        expect(queryByRole('checkbox')).toBeNull();
    });

    it('toggles selection when checkbox is clicked in selection mode', () => {
        const onToggleSelect = vi.fn();
        const { getByRole } = render(
            <LanguageProvider>
                <TaskItem
                    task={mockTask}
                    selectionMode
                    isMultiSelected={false}
                    onToggleSelect={onToggleSelect}
                />
            </LanguageProvider>
        );
        const checkbox = getByRole('checkbox', { name: /select task/i });
        fireEvent.click(checkbox);
        expect(onToggleSelect).toHaveBeenCalledTimes(1);
    });

    it('shows due date metadata when compact details are enabled', () => {
        configureDateFormatting({ language: 'en', dateFormat: 'mdy', systemLocale: 'en-US' });
        const taskWithDueDate: Task = {
            ...mockTask,
            id: 'task-with-due-date',
            dueDate: '2026-03-20',
        };
        const { getByText } = render(
            <LanguageProvider>
                <TaskItem task={taskWithDueDate} compactMetaEnabled />
            </LanguageProvider>
        );
        expect(getByText(safeFormatDate('2026-03-20', 'P'))).toBeInTheDocument();
    });

    it('applies inset ring style when selected to avoid clipped borders', () => {
        const { container } = render(
            <LanguageProvider>
                <TaskItem task={mockTask} isSelected />
            </LanguageProvider>
        );
        const root = container.querySelector('[data-task-id="1"]');
        expect(root).toBeTruthy();
        expect(root?.className).toContain('ring-inset');
    });

    it('includes archived in the task status selector', () => {
        const { getByLabelText } = render(
            <LanguageProvider>
                <TaskItem task={mockTask} />
            </LanguageProvider>
        );
        const statusSelect = getByLabelText(/task status/i) as HTMLSelectElement;
        const archivedOption = Array.from(statusSelect.options).find((option) => option.value === 'archived');
        expect(archivedOption).toBeTruthy();
    });

    it('shows quick NEXT to WAITING action and opens due-date picker prompt', () => {
        const nextTask: Task = {
            ...mockTask,
            id: 'next-task',
            status: 'next',
        };
        const { getByRole, getByText, container } = render(
            <LanguageProvider>
                <TaskItem task={nextTask} />
            </LanguageProvider>
        );
        const waitingButton = getByRole('button', { name: /move to waiting and set due date/i });
        fireEvent.click(waitingButton);
        expect(getByText('Set follow-up / review date')).toBeInTheDocument();
        expect(container.querySelector('input[type="date"]')).toBeTruthy();
        expect(getByRole('button', { name: /skip/i })).toBeInTheDocument();
    });

    it('keeps details expanded after remount for the same task id', () => {
        const checklistTask: Task = {
            ...mockTask,
            id: 'checklist-task',
            checklist: [{ id: 'item-1', title: 'Checklist item', isCompleted: false }],
        };
        const firstRender = render(
            <LanguageProvider>
                <TaskItem task={checklistTask} />
            </LanguageProvider>
        );

        fireEvent.click(firstRender.getByRole('button', { name: /toggle task details/i }));
        expect(firstRender.getByText('Checklist item')).toBeInTheDocument();
        firstRender.unmount();

        const updatedTask: Task = {
            ...checklistTask,
            checklist: [{ id: 'item-1', title: 'Checklist item', isCompleted: true }],
            updatedAt: new Date(Date.now() + 1_000).toISOString(),
        };
        const secondRender = render(
            <LanguageProvider>
                <TaskItem task={updatedTask} />
            </LanguageProvider>
        );

        expect(secondRender.getByText('Checklist item')).toBeInTheDocument();
    });
});
