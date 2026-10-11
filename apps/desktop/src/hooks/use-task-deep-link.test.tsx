import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore, type Task } from '@mindwtr/core';
import { useTaskDeepLink } from './use-task-deep-link';
import { CalendarOpenTaskModal } from '../components/views/calendar/CalendarModals';
import { LanguageProvider } from '../contexts/language-context';
import { useUiStore } from '../store/ui-store';

const plugin = vi.hoisted(() => ({ current: vi.fn(), listen: vi.fn(), stop: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ getCurrent: plugin.current, onOpenUrl: plugin.listen }));
vi.mock('../lib/app-log', () => ({ logInfo: plugin.info, logWarn: plugin.warn }));
const t = (key: string) => key;
let receive!: (urls: string[]) => void;
const task: Task = { id: 'hidden /?&#', title: 'Private linked task', description: 'Private description', status: 'waiting',
    contexts: [], tags: [], createdAt: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:00:00Z', rev: 3 };
const url = `mindwtr://open?task=${encodeURIComponent(task.id)}`;
const initialState = useTaskStore.getState();
const initialUi = useUiStore.getState();
function Harness({ ready = true, enabled = true }: { ready?: boolean; enabled?: boolean }) {
    const controller = useTaskDeepLink(ready, enabled, t);
    return <LanguageProvider><CalendarOpenTaskModal controller={controller} readOnly={controller.openTask?.status === 'archived'} /></LanguageProvider>;
}

describe('desktop task link lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        plugin.current.mockResolvedValue(null);
        plugin.listen.mockImplementation(async (handler) => { receive = handler; return plugin.stop; });
        plugin.info.mockResolvedValue(undefined);
        plugin.warn.mockResolvedValue(undefined);
        useTaskStore.setState({ ...initialState, _allTasks: [task], _allProjects: [], settings: { filters: { areaId: 'different-area' } }, error: null,
            updateTask: vi.fn(), updateSettings: vi.fn(), addTask: vi.fn() });
        useUiStore.setState({ ...initialUi, editingTaskId: null, expandedTaskIds: {}, showToast: vi.fn() });
    });
    afterEach(() => { act(() => { useTaskStore.setState(initialState, true); useUiStore.setState(initialUi, true); }); });

    it('holds a cold link until successful hydration, then opens the real task dialog outside filters without writes', async () => {
        plugin.current.mockResolvedValue([url]);
        useUiStore.setState({ editingTaskId: 'other-edit' });
        const before = JSON.stringify(useTaskStore.getState().tasks);
        const { rerender } = render(<Harness ready={false} />);
        await waitFor(() => expect(plugin.current).toHaveBeenCalledOnce());
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(plugin.info).not.toHaveBeenCalled();
        rerender(<Harness ready />);
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(task.title));
        expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument();
        expect(useTaskStore.getState().updateTask).not.toHaveBeenCalled();
        expect(useUiStore.getState().editingTaskId).toBe('other-edit');
        expect(useTaskStore.getState().updateSettings).not.toHaveBeenCalled();
        expect(useTaskStore.getState().addTask).not.toHaveBeenCalled();
        expect(JSON.stringify(useTaskStore.getState().tasks)).toBe(before);
        expect(plugin.info).toHaveBeenCalledExactlyOnceWith('Task link route requested', {
            scope: 'routing', extra: { releaseCheck: 'v1.3.5/task-link-open', outcome: 'opened' },
        });
        expect(JSON.stringify(plugin.info.mock.calls)).not.toMatch(/Private|hidden|different-area/);
    });

    it('opens warm links and allows opening the same task after closing', async () => {
        render(<Harness />);
        await waitFor(() => expect(plugin.current).toHaveBeenCalledOnce());
        act(() => receive([url]));
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(task.title));
        fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        act(() => receive([url]));
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(task.title));
    });

    it.each([false, true])('opens archived tasks read-only, including archived after copy=%s', async (afterCopy) => {
        plugin.current.mockResolvedValue(afterCopy ? null : [url]);
        if (!afterCopy) useTaskStore.setState({ _allTasks: [{ ...task, status: 'archived' }] });
        render(<Harness />);
        await waitFor(() => expect(plugin.current).toHaveBeenCalledOnce());
        if (afterCopy) {
            act(() => useTaskStore.setState({ _allTasks: [{ ...task, status: 'archived' }] }));
            act(() => receive([url]));
        }
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(task.title));
        expect(useTaskStore.getState().tasks).toEqual([]);
        expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'e' });
        expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument();
        expect(useTaskStore.getState().updateTask).not.toHaveBeenCalled();
        expect(useTaskStore.getState().updateSettings).not.toHaveBeenCalled();
    });

    it.each(['missing', 'deleted'])('reports a %s task without fuzzy matching or creating data', async (kind) => {
        if (kind === 'deleted') useTaskStore.setState({ _allTasks: [{ ...task, deletedAt: '2026-10-11T10:00:00Z' }] });
        render(<Harness />);
        await waitFor(() => expect(plugin.current).toHaveBeenCalledOnce());
        act(() => receive([kind === 'deleted' ? url : 'mindwtr://open?task=Private%20linked%20task']));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(useUiStore.getState().showToast).toHaveBeenCalledWith(
            'This task is not in this library. It may have been deleted or not synced to this device.', 'error');
        expect(useTaskStore.getState().addTask).not.toHaveBeenCalled();
        expect(useTaskStore.getState().updateTask).not.toHaveBeenCalled();
        expect(plugin.info.mock.calls[0][1].extra.outcome).toBe('missing');
    });

    it('distinguishes failed hydration from an empty library and preserves the pending link for retry', async () => {
        plugin.current.mockResolvedValue([url]);
        useTaskStore.setState({ _allTasks: [], error: 'Data load failed' });
        const { rerender } = render(<Harness ready={false} />);
        await waitFor(() => expect(useUiStore.getState().showToast).toHaveBeenCalledWith('Data load failed', 'error'));
        expect(plugin.info).not.toHaveBeenCalled();
        act(() => useTaskStore.setState({ _allTasks: [task], error: null }));
        rerender(<Harness ready />);
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(task.title));
    });

    it('does not replay an older startup URL over a warm delivery during initialization', async () => {
        let resolveCurrent!: (urls: string[]) => void;
        plugin.current.mockReturnValue(new Promise<string[]>((resolve) => { resolveCurrent = resolve; }));
        render(<Harness />);
        await waitFor(() => expect(plugin.current).toHaveBeenCalledOnce());
        act(() => receive([url]));
        await act(async () => resolveCurrent(['mindwtr://open?task=missing']));
        expect(screen.getByRole('dialog')).toHaveTextContent(task.title);
        expect(useUiStore.getState().showToast).not.toHaveBeenCalled();
    });

    it('unsubscribes and ignores deliveries after unmount', async () => {
        const { unmount } = render(<Harness />);
        await waitFor(() => expect(plugin.current).toHaveBeenCalledOnce());
        unmount();
        expect(plugin.stop).toHaveBeenCalledOnce();
        act(() => receive([url]));
        expect(plugin.info).not.toHaveBeenCalled();
    });
});
