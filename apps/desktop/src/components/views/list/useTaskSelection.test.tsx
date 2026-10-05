import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { Task } from '@mindwtr/core';

import { useTaskSelection } from './useTaskSelection';

describe('useTaskSelection', () => {
    it('owns range selection, visibility pruning, and mode reset', () => {
        let selection!: ReturnType<typeof useTaskSelection>;

        function Probe({ visibleIds }: { visibleIds: string[] }) {
            selection = useTaskSelection(visibleIds);
            return null;
        }

        let root!: renderer.ReactTestRenderer;
        act(() => {
            root = renderer.create(<Probe visibleIds={['a', 'b', 'c', 'd']} />);
        });
        act(() => {
            selection.toggleMultiSelect('b');
            selection.toggleMultiSelect('d', { range: true });
        });

        expect(selection.selectionMode).toBe(true);
        expect(selection.selectedIdsArray).toEqual(['b', 'c', 'd']);

        act(() => {
            root.update(<Probe visibleIds={['b', 'd']} />);
        });
        expect(selection.selectedIdsArray).toEqual(['b', 'd']);

        act(() => {
            selection.exitSelectionMode();
        });
        expect(selection.selectionMode).toBe(false);
        expect(selection.selectedIdsArray).toEqual([]);
    });

    it('exits selection mode when the last selected task is toggled off', () => {
        let selection!: ReturnType<typeof useTaskSelection>;

        function Probe() {
            selection = useTaskSelection(['a']);
            return null;
        }

        act(() => {
            renderer.create(<Probe />);
        });
        act(() => {
            selection.toggleMultiSelect('a');
            selection.toggleMultiSelect('a');
        });

        expect(selection.selectionMode).toBe(false);
        expect(selection.selectedIdsArray).toEqual([]);
    });

    it('owns write outcomes and only clears selection after success', async () => {
        let selection!: ReturnType<typeof useTaskSelection>;
        const onActionError = vi.fn();
        const showToast = vi.fn();
        const batchMoveTasks = vi
            .fn()
            .mockResolvedValueOnce({ success: false, error: 'nope' })
            .mockResolvedValueOnce({ success: true });

        function Probe() {
            selection = useTaskSelection(['a'], {
                batchMoveTasks,
                onActionError,
                showToast,
            });
            return null;
        }

        act(() => {
            renderer.create(<Probe />);
        });
        act(() => {
            selection.toggleMultiSelect('a');
        });
        await act(async () => {
            await selection.moveSelectedTasks('next');
        });
        expect(selection.selectedIdsArray).toEqual(['a']);
        expect(onActionError).toHaveBeenCalledWith('move', expect.any(Error));
        expect(showToast).toHaveBeenCalledWith('Failed to move selected tasks', 'error');

        await act(async () => {
            await selection.moveSelectedTasks('done');
        });
        expect(batchMoveTasks).toHaveBeenLastCalledWith(['a'], 'done');
        expect(selection.selectionMode).toBe(false);
        expect(selection.selectedIdsArray).toEqual([]);
    });

    it('builds each selected task destination patch separately and keeps status separate', async () => {
        let selection!: ReturnType<typeof useTaskSelection>;
        const tasksById = new Map([
            ['a', { id: 'a', projectId: 'project-1', sectionId: 'section-a', status: 'next' } as Task],
            ['b', { id: 'b', projectId: 'project-1', sectionId: 'section-b', status: 'waiting' } as Task],
            ['c', { id: 'c', projectId: 'project-2', sectionId: 'section-c', status: 'inbox' } as Task],
        ]);
        const batchUpdateTasks = vi.fn().mockResolvedValue({ success: true });
        const batchMoveTasks = vi.fn();
        function Probe() {
            selection = useTaskSelection(['a', 'b', 'c'], { tasksById, batchUpdateTasks, batchMoveTasks });
            return null;
        }
        act(() => { renderer.create(<Probe />); });
        for (const [destination, patches] of [
            [{ kind: 'project', id: 'project-1' }, [
                { projectId: 'project-1', sectionId: 'section-a', areaId: undefined },
                { projectId: 'project-1', sectionId: 'section-b', areaId: undefined },
            ]],
            [{ kind: 'project', id: 'project-2' }, [
                { projectId: 'project-2', sectionId: undefined, areaId: undefined },
                { projectId: 'project-2', sectionId: undefined, areaId: undefined },
            ]],
            [{ kind: 'area', id: 'area-1' }, [
                { projectId: undefined, sectionId: undefined, areaId: 'area-1' },
                { projectId: undefined, sectionId: undefined, areaId: 'area-1' },
            ]],
            [{ kind: 'none' }, [
                { projectId: undefined, sectionId: undefined, areaId: undefined },
                { projectId: undefined, sectionId: undefined, areaId: undefined },
            ]],
        ] as const) {
            act(() => { selection.toggleMultiSelect('a'); selection.toggleMultiSelect('b'); });
            await act(async () => { await selection.moveSelectedTasksToDestination(destination); });
            expect(batchUpdateTasks).toHaveBeenLastCalledWith([
                { id: 'a', updates: patches[0] }, { id: 'b', updates: patches[1] },
            ]);
            expect(selection.selectedIdsArray).toEqual([]);
        }
        expect(batchMoveTasks).not.toHaveBeenCalled();
    });

    it('preserves selection and reports destination write failures until successful write acknowledgment', async () => {
        let selection!: ReturnType<typeof useTaskSelection>;
        const showToast = vi.fn();
        const onActionError = vi.fn();
        let finishWrite!: (result: { success: boolean }) => void;
        const batchUpdateTasks = vi.fn()
            .mockResolvedValueOnce({ success: false, error: 'save failed' })
            .mockRejectedValueOnce(new Error('write rejected'))
            .mockImplementationOnce(() => new Promise((resolve) => { finishWrite = resolve; }));
        const tasksById = new Map([['a', { id: 'a' } as Task]]);
        function Probe() {
            selection = useTaskSelection(['a'], { tasksById, batchUpdateTasks, showToast, onActionError });
            return null;
        }
        act(() => { renderer.create(<Probe />); });
        act(() => { selection.toggleMultiSelect('a'); });
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await act(async () => { await selection.moveSelectedTasksToDestination({ kind: 'none' }); });
            expect(selection.selectedIdsArray).toEqual(['a']);
            expect(selection.selectionMode).toBe(true);
        }
        expect(onActionError).toHaveBeenCalledTimes(2);
        expect(showToast).toHaveBeenLastCalledWith('Failed to update selected tasks', 'error');
        let pending!: Promise<boolean>;
        act(() => { pending = selection.moveSelectedTasksToDestination({ kind: 'none' }); });
        expect(selection.selectedIdsArray).toEqual(['a']);
        expect(selection.activeAction).toBe('update');
        await act(async () => { finishWrite({ success: true }); await pending; });
        expect(selection.selectedIdsArray).toEqual([]);
        expect(selection.selectionMode).toBe(false);
    });

    it('owns delete undo registration and feedback', async () => {
        let selection!: ReturnType<typeof useTaskSelection>;
        const restoreTask = vi.fn().mockResolvedValue({ success: true });
        const showToast = vi.fn();

        function Probe() {
            selection = useTaskSelection(['a'], {
                batchDeleteTasks: vi.fn().mockResolvedValue({ success: true }),
                restoreTask,
                showToast,
            });
            return null;
        }

        act(() => {
            renderer.create(<Probe />);
        });
        act(() => {
            selection.toggleMultiSelect('a');
        });
        await act(async () => {
            await selection.deleteSelectedTasks();
        });

        const undoAction = showToast.mock.calls[showToast.mock.calls.length - 1]?.[3];
        expect(showToast).toHaveBeenCalledWith(
            'Task deleted',
            'info',
            5000,
            expect.objectContaining({ label: 'Undo' }),
        );
        await act(async () => {
            undoAction?.onClick();
            await Promise.resolve();
        });
        expect(restoreTask).toHaveBeenCalledWith('a');
    });
});
