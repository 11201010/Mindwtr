import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { AppData, Area, Project, Task } from '@mindwtr/core';

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
    order: 0,
    tagIds: [],
    createdAt: nowIso,
    updatedAt: nowIso,
};

type RenderResult = {
    addProject: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
    deleteTask: ReturnType<typeof vi.fn>;
} & ReturnType<typeof render>;

const renderInboxProcessor = (settings?: AppData['settings']): RenderResult => {
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
                settings={settings}
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
    it('opens in quick mode when configured as the default inbox processing mode', () => {
        const { getByRole, getByText, queryByText } = renderInboxProcessor({
            gtd: {
                inboxProcessing: {
                    defaultMode: 'quick',
                },
            },
        });

        fireEvent.click(getByRole('button', { name: /process\.btn/i }));

        expect(getByText('process.quickDesc')).toBeInTheDocument();
        expect(queryByText('process.refineDesc')).not.toBeInTheDocument();
    });

    it('routes actionable multi-step tasks directly to project conversion', async () => {
        const { getByRole, getByText, addProject, updateTask } = renderInboxProcessor();

        fireEvent.click(getByRole('button', { name: /process\.btn/i }));
        fireEvent.click(getByText('process.refineNext'));
        fireEvent.click(getByText('process.yesActionable'));
        fireEvent.click(getByText('process.moreThanOneStepYes'));

        fireEvent.click(getByText('process.createProject'));

        await waitFor(() => {
            expect(addProject).toHaveBeenCalledTimes(1);
        });
        await waitFor(() => {
            expect(updateTask).toHaveBeenCalledWith(
                'task-1',
                expect.objectContaining({
                    title: 'Plan launch',
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

    it('merges the two-minute shortcut into the actionable step by default', async () => {
        const { getByRole, getByText, updateTask } = renderInboxProcessor();

        fireEvent.click(getByRole('button', { name: /process\.btn/i }));
        fireEvent.click(getByText('process.refineNext'));

        fireEvent.click(getByText('process.doneIt'));

        await waitFor(() => {
            expect(updateTask).toHaveBeenCalledWith(
                'task-1',
                expect.objectContaining({
                    status: 'done',
                }),
            );
        });
    });

    it('keeps scheduling and reference branches hidden by default', () => {
        const { getByRole, getByText, queryByText } = renderInboxProcessor();

        fireEvent.click(getByRole('button', { name: /process\.btn/i }));
        fireEvent.click(getByText('process.refineNext'));

        expect(queryByText('process.reference')).not.toBeInTheDocument();

        fireEvent.click(getByText('process.yesActionable'));
        fireEvent.click(getByText('process.moreThanOneStepNo'));
        fireEvent.click(getByText('process.takesLonger'));

        expect(getByText('process.nextStepDesc')).toBeInTheDocument();
        expect(queryByText('taskEdit.startDateLabel')).not.toBeInTheDocument();
    });

    it('shows scheduling and reference options when enabled in settings', () => {
        const { getByRole, getByText } = renderInboxProcessor({
            gtd: {
                inboxProcessing: {
                    scheduleEnabled: true,
                    referenceEnabled: true,
                },
            },
        });

        fireEvent.click(getByRole('button', { name: /process\.btn/i }));
        fireEvent.click(getByText('process.refineNext'));

        expect(getByText('process.reference')).toBeInTheDocument();

        fireEvent.click(getByText('process.yesActionable'));
        fireEvent.click(getByText('process.moreThanOneStepNo'));
        fireEvent.click(getByText('process.takesLonger'));

        expect(getByText('taskEdit.startDateLabel')).toBeInTheDocument();
    });

    it('processes a task from quick mode with schedule, contexts, tags, and priority', async () => {
        const { getByRole, getByLabelText, updateTask } = renderInboxProcessor({
            features: {
                priorities: true,
            },
            gtd: {
                inboxProcessing: {
                    scheduleEnabled: true,
                },
            },
        });

        fireEvent.click(getByRole('button', { name: /process\.btn/i }));
        fireEvent.click(getByRole('button', { name: 'process.modeQuick' }));

        fireEvent.change(getByLabelText('taskEdit.titleLabel'), {
            target: { value: 'Clarified task' },
        });
        fireEvent.change(getByLabelText('taskEdit.descriptionLabel'), {
            target: { value: 'Updated description' },
        });
        fireEvent.change(getByLabelText('taskEdit.contextsLabel'), {
            target: { value: '@home, @desk' },
        });
        fireEvent.change(getByLabelText('taskEdit.tagsLabel'), {
            target: { value: '#deep, #writing' },
        });
        fireEvent.click(getByRole('button', { name: 'priority.high' }));
        fireEvent.change(getByLabelText('taskEdit.startDateLabel'), {
            target: { value: '2026-03-23' },
        });

        fireEvent.click(getByRole('button', { name: 'process.next' }));

        await waitFor(() => {
            expect(updateTask).toHaveBeenCalledWith(
                'task-1',
                expect.objectContaining({
                    title: 'Clarified task',
                    description: 'Updated description',
                    status: 'next',
                    contexts: ['@home', '@desk'],
                    tags: ['#deep', '#writing'],
                    priority: 'high',
                    startTime: '2026-03-23',
                }),
            );
        });
    });

    it('processes a task from guided mode with priority in the context step', async () => {
        const { getByRole, getByText, updateTask } = renderInboxProcessor({
            features: {
                priorities: true,
            },
        });

        fireEvent.click(getByRole('button', { name: /process\.btn/i }));
        fireEvent.click(getByText('process.refineNext'));
        fireEvent.click(getByText('process.yesActionable'));
        fireEvent.click(getByText('process.moreThanOneStepNo'));
        fireEvent.click(getByText('process.takesLonger'));
        fireEvent.click(getByText('process.doIt'));
        fireEvent.click(getByRole('button', { name: 'priority.urgent' }));
        fireEvent.click(getByRole('button', { name: /process\.next/ }));
        fireEvent.click(getByRole('button', { name: /process\.noProject/ }));

        await waitFor(() => {
            expect(updateTask).toHaveBeenCalledWith(
                'task-1',
                expect.objectContaining({
                    status: 'next',
                    priority: 'urgent',
                }),
            );
        });
    });

    it('moves delegated tasks to waiting with assignedTo instead of mutating the description', async () => {
        const { getByRole, getByText, getByPlaceholderText, updateTask } = renderInboxProcessor();

        fireEvent.click(getByRole('button', { name: /process\.btn/i }));
        fireEvent.click(getByText('process.refineNext'));
        fireEvent.click(getByText('process.yesActionable'));
        fireEvent.click(getByText('process.moreThanOneStepNo'));
        fireEvent.click(getByText('process.takesLonger'));
        fireEvent.click(getByText('process.delegate'));
        fireEvent.change(getByPlaceholderText('process.delegateWhoPlaceholder'), {
            target: { value: 'Alex' },
        });

        fireEvent.click(getByText('process.delegateMoveToWaiting'));

        await waitFor(() => {
            expect(updateTask).toHaveBeenCalledWith(
                'task-1',
                expect.objectContaining({
                    status: 'waiting',
                    assignedTo: 'Alex',
                }),
            );
        });

        const [, updates] = updateTask.mock.calls.at(-1) as [string, Task];
        expect(updates.description).toBeUndefined();
    });
});
