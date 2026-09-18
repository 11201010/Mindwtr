import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore, type Task, type ViewSectionDefinition } from '@mindwtr/core';
import { LanguageProvider } from '../../contexts/language-context';
import { KeybindingProvider } from '../../contexts/keybinding-context';
import { useUiStore } from '../../store/ui-store';
import { ListView } from './ListView';

const logInfoMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../lib/app-log', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../lib/app-log')>(),
    logInfo: logInfoMock,
}));

const now = '2026-09-15T00:00:00.000Z';
const sections: ViewSectionDefinition[] = [
    { id: 'books', title: 'Books', order: 0 },
    { id: 'empty', title: 'Empty ideas', order: 1 },
];
const task = (id: string): Task => ({
    id, title: `Idea ${id}`, status: 'someday', tags: [], contexts: [], createdAt: now, updatedAt: now,
});
const initialTaskState = useTaskStore.getState();
const initialUiState = useUiStore.getState();

function seed(tasks: Task[], definitions = sections) {
    const batchUpdateTasks = vi.fn(async (updates: Array<{ id: string; updates: Partial<Task> }>) => {
        useTaskStore.setState((state) => {
            const updated = state.tasks.map((item) => {
                const update = updates.find((entry) => entry.id === item.id);
                return update ? { ...item, ...update.updates } : item;
            });
            return {
                tasks: updated,
                _allTasks: updated,
                _tasksById: new Map(updated.map((item) => [item.id, item])),
            };
        });
        return { success: true };
    });
    const updateSettings = vi.fn(async (updates: Record<string, unknown>) => {
        useTaskStore.setState((state) => ({ settings: { ...state.settings, ...updates } }));
    });
    useTaskStore.setState({
        tasks,
        _allTasks: tasks,
        _tasksById: new Map(tasks.map((item) => [item.id, item])),
        projects: [],
        _allProjects: [],
        areas: [],
        _allAreas: [],
        settings: { gtd: { viewSections: { someday: definitions } } },
        batchUpdateTasks,
        updateSettings,
        lastDataChangeAt: 1,
    });
    return { batchUpdateTasks, updateSettings };
}

function renderSomeday() {
    return render(
        <LanguageProvider>
            <KeybindingProvider currentView="someday" onNavigate={() => {}}>
                <ListView title="Someday" statusFilter="someday" />
            </KeybindingProvider>
        </LanguageProvider>,
    );
}

describe('desktop Someday section actions', () => {
    beforeEach(() => {
        act(() => {
            useTaskStore.setState(initialTaskState, true);
            useUiStore.setState(initialUiState, true);
        });
        logInfoMock.mockClear();
        useUiStore.setState((state) => ({
            ...state,
            showToast: vi.fn(),
            listFilters: { criteria: {}, open: false },
            listOptions: {
                ...state.listOptions,
                somedayGroupBy: 'none',
            },
        }));
    });

    it('opens Move to section from a real right-click task menu and saves to an empty definition', async () => {
        const { batchUpdateTasks } = seed([task('a')]);
        const view = renderSomeday();
        const row = view.container.querySelector('[data-task-id="a"]') as HTMLElement;
        fireEvent.contextMenu(row, { clientX: 30, clientY: 40 });
        const menu = await view.findByRole('menu');
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move to section…' }));

        const dialog = await view.findByRole('dialog', { name: 'Move to section…' });
        const picker = within(dialog).getByRole('combobox');
        expect(within(picker).getByRole('option', { name: 'No section' })).toBeInTheDocument();
        expect(within(picker).getByRole('option', { name: 'Empty ideas' })).toBeInTheDocument();
        expect(within(picker).getByRole('option', { name: /New section/ })).toBeInTheDocument();
        fireEvent.change(picker, { target: { value: 'empty' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(batchUpdateTasks).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(useUiStore.getState().showToast).toHaveBeenCalledWith(
            'Moved to Empty ideas (1)', 'success', 5000, expect.objectContaining({ label: 'Undo' }),
        ));
        expect(useTaskStore.getState().tasks[0].viewSectionIds?.someday).toBe('empty');
        expect(logInfoMock).toHaveBeenCalledWith('Someday section assignment saved', expect.objectContaining({
            extra: { releaseCheck: 'v1.3.1/someday-section-move', count: 1, operation: 'move' },
        }));

        const toast = useUiStore.getState().showToast as ReturnType<typeof vi.fn>;
        const undoAction = toast.mock.calls.find((call) => call[1] === 'success')?.[3] as { onClick: () => void };
        act(() => { undoAction.onClick(); });
        await waitFor(() => expect(useTaskStore.getState().tasks[0].viewSectionIds?.someday).toBeUndefined());
        await waitFor(() => expect(logInfoMock).toHaveBeenCalledWith('Someday section assignment saved', expect.objectContaining({
            extra: { releaseCheck: 'v1.3.1/someday-section-move', count: 1, operation: 'undo' },
        })));
    });

    it('offers the same picker for a selected bulk move', async () => {
        const { batchUpdateTasks } = seed([task('a'), task('b')]);
        const view = renderSomeday();
        fireEvent.click(view.getByRole('button', { name: 'Select' }));
        fireEvent.click(view.getByRole('button', { name: /Select all/i }));
        fireEvent.click(view.getByRole('button', { name: 'Move to section…' }));
        const dialog = await view.findByRole('dialog', { name: 'Move to section…' });
        fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'books' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(batchUpdateTasks).toHaveBeenCalledTimes(1));
        expect(batchUpdateTasks.mock.calls[0][0]).toHaveLength(2);
        expect(useTaskStore.getState().tasks.map((item) => item.viewSectionIds?.someday)).toEqual(['books', 'books']);
    });

    it('clears an existing assignment through No section from the task menu', async () => {
        seed([{ ...task('a'), viewSectionIds: { someday: 'books', waiting: 'wait' } }]);
        const view = renderSomeday();
        fireEvent.contextMenu(view.container.querySelector('[data-task-id="a"]') as HTMLElement);
        fireEvent.click(within(await view.findByRole('menu')).getByRole('menuitem', { name: 'Move to section…' }));
        const dialog = await view.findByRole('dialog', { name: 'Move to section…' });
        const picker = within(dialog).getByRole('combobox');
        expect(picker).toHaveValue('books');
        fireEvent.change(picker, { target: { value: '' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(useTaskStore.getState().tasks[0].viewSectionIds).toEqual({ waiting: 'wait' }));
    });

    it('keeps empty headings actionable and preassigns Add task to that Someday section', async () => {
        seed([]);
        useUiStore.setState((state) => ({ listOptions: { ...state.listOptions, somedayGroupBy: 'viewSection' } }));
        const event = vi.fn();
        window.addEventListener('mindwtr:quick-add', event);
        try {
            const view = renderSomeday();
            expect(view.getByText('Empty ideas')).toBeInTheDocument();
            fireEvent.click(view.getByRole('button', { name: 'Add task to Empty ideas' }));
            expect(event).toHaveBeenCalledTimes(1);
            expect((event.mock.calls[0][0] as CustomEvent).detail.initialProps).toEqual({
                status: 'someday', viewSectionIds: { someday: 'empty' },
            });
        } finally {
            window.removeEventListener('mindwtr:quick-add', event);
        }
    });

    it('creates a section from the Someday list action', async () => {
        const { updateSettings } = seed([], []);
        const view = renderSomeday();
        fireEvent.click(view.getByRole('button', { name: 'More options' }));
        fireEvent.click(view.getByRole('menuitem', { name: 'New section…' }));
        const dialog = await view.findByRole('dialog', { name: 'New section…' });
        fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'Films' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
        expect(useTaskStore.getState().settings?.gtd?.viewSections?.someday?.[0].title).toBe('Films');
    });

    it('keeps the New section title after a failed settings save so it can be retried', async () => {
        const { updateSettings } = seed([], []);
        updateSettings.mockRejectedValueOnce(new Error('disk unavailable'));
        const view = renderSomeday();
        fireEvent.click(view.getByRole('button', { name: 'More options' }));
        fireEvent.click(view.getByRole('menuitem', { name: 'New section…' }));
        const dialog = await view.findByRole('dialog', { name: 'New section…' });
        fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'Films' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not update Someday sections'));
        expect(within(dialog).getByRole('combobox')).toHaveValue('Films');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(useTaskStore.getState().settings?.gtd?.viewSections?.someday?.[0].title).toBe('Films'));
    });
});
