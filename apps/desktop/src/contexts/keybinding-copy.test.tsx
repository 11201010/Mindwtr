import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useTaskStore, type Task } from '@mindwtr/core';
import { KeybindingProvider } from './keybinding-context';
import { LanguageProvider } from './language-context';
import { useTaskListScope } from '../components/views/list/task-list-scope';
import { useTaskSelection } from '../components/views/list/useTaskSelection';
import { useUiStore } from '../store/ui-store';

const task = (id: string): Task => ({
    id, title: `Title ${id}`, description: `Description ${id}`, status: 'next', tags: [], contexts: [],
    createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
});
const tasks = [task('a'), task('b'), task('c')];
const initialUiState = useUiStore.getState();
const initialTaskState = useTaskStore.getState();
const writeText = vi.fn();
const showToast = vi.fn();

function List({ visible = tasks, highlighted = false }: { visible?: Task[]; highlighted?: boolean }) {
    const [index, setIndex] = useState(0);
    const selection = useTaskSelection(visible.map((item) => item.id));
    useTaskListScope({
        getTasks: () => visible,
        getSelectedIndex: () => index,
        setSelectedIndex: setIndex,
        getSelectedIds: () => selection.multiSelectedIds,
        getHighlightedTaskId: () => highlighted ? visible[index]?.id : undefined,

        toggleSelect: (item) => selection.toggleMultiSelect(item.id),
        t: (key) => key,
    });
    return <>
        <button data-sidebar-item>Sidebar</button>
        {visible.map((item, rowIndex) => <div key={`${item.id}:${rowIndex}`} data-task-id={item.id}>
            <button data-task-view-toggle onClick={() => selection.toggleMultiSelect(item.id)}>{item.title}</button>
        </div>)}
        <input aria-label="Input" />
        <textarea aria-label="Notes" />
        <div contentEditable suppressContentEditableWarning><span>Editable text</span></div>
        <p>Ordinary text</p>
    </>;
}

function Harness({ visible, highlighted }: { visible?: Task[]; highlighted?: boolean }) {
    return <LanguageProvider><KeybindingProvider currentView="inbox" onNavigate={vi.fn()}>
        <List visible={visible} highlighted={highlighted} />
    </KeybindingProvider></LanguageProvider>;
}

function copy(target: EventTarget = window, modifiers: KeyboardEventInit = { ctrlKey: true }) {
    const event = new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true, cancelable: true, ...modifiers });
    act(() => { target.dispatchEvent(event); });
    return event;
}

describe('task title copy shortcut', () => {
    beforeEach(() => {
        writeText.mockReset().mockResolvedValue(undefined);
        showToast.mockReset();
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
        useUiStore.setState({ editingTaskId: null, showToast });
        useTaskStore.setState((state) => ({ settings: { ...state.settings, keybindingStyle: 'vim' } }));
    });
    afterEach(() => {
        window.getSelection()?.removeAllRanges();
        vi.unstubAllGlobals();
        act(() => {
            useUiStore.setState(initialUiState, true);
            useTaskStore.setState(initialTaskState, true);
        });
    });

    it.each(['vim', 'standard', 'emacs'] as const)('copies the focused title with Ctrl+C and Cmd+C in %s mode', async (style) => {
        useTaskStore.setState((state) => ({ settings: { ...state.settings, keybindingStyle: style } }));
        render(<Harness />);
        screen.getByRole('button', { name: 'Title b' }).focus();
        expect(copy(document.activeElement!)).toHaveProperty('defaultPrevented', true);
        await waitFor(() => expect(showToast).toHaveBeenLastCalledWith('Title copied', 'success'));
        expect(writeText).toHaveBeenLastCalledWith('Title b');
        copy(document.activeElement!, { metaKey: true });
        expect(writeText).toHaveBeenCalledTimes(2);
    });

    it('copies only selected visible titles in display order and retains selection', async () => {
        const { rerender } = render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Title c' }));
        fireEvent.click(screen.getByRole('button', { name: 'Title a' }));
        copy();
        await waitFor(() => expect(showToast).toHaveBeenLastCalledWith('Titles copied', 'success'));
        expect(writeText).toHaveBeenLastCalledWith('Title a\nTitle c');
        rerender(<Harness visible={[tasks[2], tasks[1]]} />);
        copy();
        expect(writeText).toHaveBeenLastCalledWith('Title c');
    });

    it('copies a selected task repeated in visible groups only once with singular feedback', async () => {
        render(<Harness visible={[tasks[0], tasks[1], tasks[0]]} />);
        fireEvent.click(screen.getAllByRole('button', { name: 'Title a' })[0]);
        copy();
        expect(writeText).toHaveBeenCalledExactlyOnceWith('Title a');
        await waitFor(() => expect(showToast).toHaveBeenCalledExactlyOnceWith('Title copied', 'success'));
    });

    it('retains distinct selected tasks that have the same title', async () => {
        render(<Harness visible={[tasks[0], { ...tasks[1], title: 'Title a' }, tasks[0]]} />);
        const buttons = screen.getAllByRole('button', { name: 'Title a' });
        fireEvent.click(buttons[0]);
        fireEvent.click(buttons[1]);
        copy();
        expect(writeText).toHaveBeenCalledExactlyOnceWith('Title a\nTitle a');
        await waitFor(() => expect(showToast).toHaveBeenCalledExactlyOnceWith('Titles copied', 'success'));
    });

    it('keeps Vim title and title-plus-description copy available', () => {
        render(<Harness />);
        fireEvent.keyDown(window, { key: 'y' });
        fireEvent.keyDown(window, { key: 'y' });
        expect(writeText).toHaveBeenLastCalledWith('Title a');
        fireEvent.keyDown(window, { key: 'y' });
        fireEvent.keyDown(window, { key: 'i' });
        expect(writeText).toHaveBeenLastCalledWith('Title a\n\nDescription a');
    });

    it.each(['body', 'sidebar'])('preserves Ctrl/Cmd+C with tasks but no highlight while %s has focus', (focus) => {
        render(<Harness />);
        if (focus === 'sidebar') screen.getByRole('button', { name: 'Sidebar' }).focus();
        expect(copy(document.activeElement!).defaultPrevented).toBe(false);
        expect(copy(document.activeElement!, { metaKey: true }).defaultPrevented).toBe(false);
        expect(writeText).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('copies an explicitly highlighted task while focus is outside the list', async () => {
        render(<Harness highlighted />);
        screen.getByRole('button', { name: 'Sidebar' }).focus();
        expect(copy(document.activeElement!).defaultPrevented).toBe(true);
        expect(writeText).toHaveBeenCalledExactlyOnceWith('Title a');
        await waitFor(() => expect(showToast).toHaveBeenCalledExactlyOnceWith('Title copied', 'success'));
    });

    it('does not consume copy with no tasks', () => {
        render(<Harness visible={[]} />);
        expect(copy().defaultPrevented).toBe(false);
        expect(writeText).not.toHaveBeenCalled();
    });

    it.each(['Input', 'Notes', 'Editable text'])('preserves native copy in %s', (label) => {
        render(<Harness />);
        screen.getByRole('button', { name: 'Title a' }).focus();
        const target = label === 'Editable text' ? screen.getByText(label) : screen.getByLabelText(label);
        expect(copy(target).defaultPrevented).toBe(false);
        expect(writeText).not.toHaveBeenCalled();
    });

    it('preserves ordinary selected text', () => {
        render(<Harness />);
        screen.getByRole('button', { name: 'Title a' }).focus();
        const range = document.createRange();
        range.selectNodeContents(screen.getByText('Ordinary text'));
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
        expect(window.getSelection()?.toString()).toBe('Ordinary text');
        expect(copy().defaultPrevented).toBe(false);
        expect(writeText).not.toHaveBeenCalled();
    });

    it.each(['dialog', 'menu', 'listbox'])('leaves copy to an open %s', (role) => {
        render(<Harness />);
        screen.getByRole('button', { name: 'Title a' }).focus();
        const popup = document.createElement('div');
        popup.setAttribute('role', role);
        if (role === 'dialog') popup.setAttribute('aria-modal', 'true');
        document.body.append(popup);
        try {
            expect(copy().defaultPrevented).toBe(false);
            expect(writeText).not.toHaveBeenCalled();
        } finally { popup.remove(); }
    });

    it('honors a previously consumed shortcut and task editing', () => {
        render(<Harness />);
        screen.getByRole('button', { name: 'Title a' }).focus();
        const consume = (event: KeyboardEvent) => event.preventDefault();
        document.addEventListener('keydown', consume);
        try { copy(screen.getByRole('button', { name: 'Title a' })); }
        finally { document.removeEventListener('keydown', consume); }
        expect(writeText).not.toHaveBeenCalled();
        act(() => { useUiStore.setState({ editingTaskId: 'a' }); });
        expect(copy().defaultPrevented).toBe(false);
        expect(writeText).not.toHaveBeenCalled();
    });

    it('shows success only after clipboard completion and surfaces a failure', async () => {
        let resolve!: () => void;
        writeText.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
        render(<Harness />);
        screen.getByRole('button', { name: 'Title a' }).focus();
        copy();
        expect(showToast).not.toHaveBeenCalled();
        await act(async () => { resolve(); });
        expect(showToast).toHaveBeenCalledWith('Title copied', 'success');
        showToast.mockClear();
        writeText.mockRejectedValueOnce(new Error('Clipboard denied'));
        copy();
        await waitFor(() => expect(showToast).toHaveBeenCalledExactlyOnceWith('Could not copy task', 'error'));
    });
});
