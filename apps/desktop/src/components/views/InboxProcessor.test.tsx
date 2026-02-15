import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { Area, Project, Task } from '@mindwtr/core';

import { InboxProcessor } from './InboxProcessor';

const nowIso = new Date().toISOString();

const inboxTask: Task = {
    id: 'task-1',
    title: 'Plan launch',
    status: 'inbox',
    tags: [],
    contexts: [],
    createdAt: nowIso,
    updatedAt: nowIso,
};

const createdProject: Project = {
    id: 'project-1',
    title: 'Plan launch',
    color: '#94a3b8',
    status: 'active',
    createdAt: nowIso,
    updatedAt: nowIso,
};

type RenderResult = {
    addProject: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
    deleteTask: ReturnType<typeof vi.fn>;
} & ReturnType<typeof render>;

const renderInboxProcessor = (): RenderResult => {
    const addProject = vi.fn(async () => createdProject);
    const updateTask = vi.fn(async () => undefined);
    const deleteTask = vi.fn(async () => undefined);
    const tasks = [inboxTask];
    const projects: Project[] = [];
    const areas: Area[] = [];

    const TestHarness = () => {
        const [isProcessing, setIsProcessing] = useState(false);
        return (
            <InboxProcessor
                t={(key) => key}
                isInbox
                tasks={tasks}
                projects={projects}
                areas={areas}
                addProject={addProject}
                updateTask={updateTask}
                deleteTask={deleteTask}
                allContexts={[]}
                isProcessing={isProcessing}
                setIsProcessing={setIsProcessing}
            />
        );
    };

    return {
        ...render(<TestHarness />),
        addProject,
        updateTask,
        deleteTask,
    };
};

describe('InboxProcessor', () => {
    it('routes actionable multi-step tasks directly to project conversion', async () => {
        const { getByRole, getByText, getByPlaceholderText, addProject, updateTask } = renderInboxProcessor();

        fireEvent.click(getByRole('button', { name: /process\.btn/i }));
        fireEvent.click(getByText('process.refineNext'));
        fireEvent.click(getByText('process.yesActionable'));
        fireEvent.click(getByText('process.moreThanOneStepYes'));

        fireEvent.change(getByPlaceholderText('taskEdit.titleLabel'), { target: { value: 'Draft next action' } });
        fireEvent.click(getByText('process.createProject'));

        await waitFor(() => {
            expect(addProject).toHaveBeenCalledTimes(1);
        });
        await waitFor(() => {
            expect(updateTask).toHaveBeenCalledWith(
                'task-1',
                expect.objectContaining({
                    title: 'Draft next action',
                    status: 'next',
                    projectId: 'project-1',
                }),
            );
        });
    });

    it('continues to normal two-minute flow when item is a single action', () => {
        const { getByRole, getByText } = renderInboxProcessor();

        fireEvent.click(getByRole('button', { name: /process\.btn/i }));
        fireEvent.click(getByText('process.refineNext'));
        fireEvent.click(getByText('process.yesActionable'));
        fireEvent.click(getByText('process.moreThanOneStepNo'));

        expect(getByText('process.twoMinDesc')).toBeInTheDocument();
    });
});
