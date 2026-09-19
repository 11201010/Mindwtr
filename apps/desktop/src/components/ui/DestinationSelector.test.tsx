import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Area, Project } from '@mindwtr/core';

import { DestinationSelector } from './DestinationSelector';

const projects: Project[] = [{
    id: 'project-work',
    title: 'Work',
    status: 'active',
    color: '#2563eb',
    order: 0,
    tagIds: [],
    createdAt: '',
    updatedAt: '',
}];
const areas: Area[] = [{
    id: 'area-home',
    name: 'Home',
    color: '#16a34a',
    order: 0,
    createdAt: '',
    updatedAt: '',
}];

function setInputValue(input: HTMLInputElement, value: string) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input),
        'value',
    )?.set;
    act(() => {
        nativeSetter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

const renderSelector = (overrides: Partial<Parameters<typeof DestinationSelector>[0]> = {}) => render(
    <DestinationSelector
        projects={projects}
        areas={areas}
        value={{ kind: 'none' }}
        onChange={vi.fn()}
        onCreateProject={vi.fn(async () => 'project-new')}
        onCreateArea={vi.fn(async () => 'area-new')}
        destinationLabel="Destination"
        projectsLabel="Projects"
        areasLabel="Areas"
        noneLabel="None"
        searchPlaceholder="Search"
        noMatchesLabel="No matches"
        createProjectLabel="New project"
        createAreaLabel="New area"
        {...overrides}
    />,
);

describe('DestinationSelector', () => {
    it('does not offer inactive projects while still naming the current assignment', () => {
        const archivedProject: Project = {
            ...projects[0],
            id: 'project-archived',
            title: 'Archived plan',
            status: 'archived',
        };
        const { getByRole, queryByRole } = renderSelector({
            projects: [...projects, archivedProject],
            value: { kind: 'project', id: archivedProject.id },
        });

        const trigger = getByRole('button', { name: 'Destination' });
        expect(trigger).toHaveTextContent('Archived plan');
        fireEvent.click(trigger);
        expect(queryByRole('option', { name: 'Archived plan' })).not.toBeInTheDocument();
        expect(getByRole('option', { name: 'Work' })).toBeInTheDocument();
    });

    it('uses exact project matches instead of offering duplicate creation', () => {
        const onChange = vi.fn();
        const { getByRole, getByLabelText, queryByRole } = renderSelector({ onChange });

        fireEvent.click(getByRole('button', { name: 'Destination' }));
        const search = getByLabelText('Search') as HTMLInputElement;
        setInputValue(search, 'Work');

        expect(queryByRole('button', { name: /New project:/ })).not.toBeInTheDocument();
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(onChange).toHaveBeenCalledExactlyOnceWith({ kind: 'project', id: 'project-work' });
    });

    it('ignores Enter on an empty search instead of picking the first project', () => {
        const onChange = vi.fn();
        const { getByRole, getByLabelText } = renderSelector({ onChange });

        fireEvent.click(getByRole('button', { name: 'Destination' }));
        fireEvent.keyDown(getByLabelText('Search'), { key: 'Enter' });

        expect(onChange).not.toHaveBeenCalled();
        expect(getByRole('listbox', { name: 'Destination' })).toBeInTheDocument();
    });

    it('runs the only create action offered when Enter finds no match', async () => {
        const onChange = vi.fn();
        const onCreateProject = vi.fn(async () => 'project-garden');
        const { getByRole, getByLabelText } = renderSelector({
            onChange,
            onCreateProject,
            onCreateArea: undefined,
        });

        fireEvent.click(getByRole('button', { name: 'Destination' }));
        setInputValue(getByLabelText('Search') as HTMLInputElement, 'Garden');
        fireEvent.keyDown(getByLabelText('Search'), { key: 'Enter' });

        await waitFor(() => expect(onCreateProject).toHaveBeenCalledWith('Garden'));
        await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: 'project', id: 'project-garden' }));
    });

    it('invalidates a pending creation when closed and reopened', async () => {
        let finishCreate!: (id: string | null) => void;
        const onChange = vi.fn();
        const onCreateProject = vi.fn(() => new Promise<string | null>((resolve) => {
            finishCreate = resolve;
        }));
        const { getByRole, getByLabelText } = renderSelector({ onChange, onCreateProject });

        const trigger = getByRole('button', { name: 'Destination' });
        fireEvent.click(trigger);
        setInputValue(getByLabelText('Search') as HTMLInputElement, 'Garden');
        fireEvent.click(getByRole('button', { name: 'New project: “Garden”' }));

        fireEvent.click(trigger);
        fireEvent.click(trigger);
        await act(async () => finishCreate('project-garden'));

        await waitFor(() => expect(onChange).not.toHaveBeenCalled());
        expect(getByRole('listbox', { name: 'Destination' })).toBeInTheDocument();
    });

    it('absorbs a rejected creation and leaves the picker retryable', async () => {
        const onCreateProject = vi.fn(async () => { throw new Error('create failed'); });
        const { getByRole, getByLabelText } = renderSelector({ onCreateProject });

        fireEvent.click(getByRole('button', { name: 'Destination' }));
        setInputValue(getByLabelText('Search') as HTMLInputElement, 'Garden');
        fireEvent.click(getByRole('button', { name: 'New project: “Garden”' }));

        await waitFor(() => expect(getByRole('button', { name: 'New project: “Garden”' })).toBeEnabled());
    });
});
