import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskItem } from '../components/TaskItem';
import { Task } from '@mindwtr/core';
import { LanguageProvider } from '../contexts/language-context';

// Mock store
const mocks = vi.hoisted(() => ({
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    moveTask: vi.fn(),
}));

vi.mock('@mindwtr/core', async () => {
    const actual = await vi.importActual('@mindwtr/core');
    return {
        ...actual,
        useTaskStore: () => ({
            updateTask: mocks.updateTask,
            deleteTask: mocks.deleteTask,
            moveTask: mocks.moveTask,
            projects: [],
        }),
    };
});

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
    it('renders task title', () => {
        render(
            <LanguageProvider>
                <TaskItem task={mockTask} />
            </LanguageProvider>
        );
        expect(screen.getByText('Test Task')).toBeInTheDocument();
    });

    it('enters edit mode on click', () => {
        render(
            <LanguageProvider>
                <TaskItem task={mockTask} />
            </LanguageProvider>
        );
        fireEvent.click(screen.getByText('Test Task'));
        expect(screen.getByDisplayValue('Test Task')).toBeInTheDocument();
    });

    it('does not render checkbox when not in selection mode', () => {
        render(
            <LanguageProvider>
                <TaskItem task={mockTask} />
            </LanguageProvider>
        );
        expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('toggles selection when checkbox is clicked in selection mode', () => {
        const onToggleSelect = vi.fn();
        render(
            <LanguageProvider>
                <TaskItem
                    task={mockTask}
                    selectionMode
                    isMultiSelected={false}
                    onToggleSelect={onToggleSelect}
                />
            </LanguageProvider>
        );
        const checkbox = screen.getByRole('checkbox', { name: 'Select task' });
        fireEvent.click(checkbox);
        expect(onToggleSelect).toHaveBeenCalledTimes(1);
    });
});
