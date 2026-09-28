import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from '../store';
import type { StorageAdapter } from '../storage';
import type { AppData, Section, Task } from '../types';
import { buildNewSection, projectSectionOrderMax, sectionDeleteEffect } from './section-actions';

const NOW = '2026-07-24T12:00:00.000Z';

describe('section actions', () => {
    let saveData: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        saveData = vi.fn().mockResolvedValue(undefined);
        const storage: StorageAdapter = {
            getData: vi.fn().mockResolvedValue({
                tasks: [],
                projects: [],
                sections: [],
                areas: [],
                people: [],
                settings: {},
            }),
            saveData,
        };
        setStorageAdapter(storage);
        useTaskStore.setState({
            tasks: [],
            projects: [],
            sections: [],
            areas: [],
            people: [],
            settings: {},
            error: null,
            _allTasks: [],
            _allProjects: [],
            _allSections: [],
            _allAreas: [],
            _allPeople: [],
            lastDataChangeAt: 0,
        });
        vi.useFakeTimers();
        vi.setSystemTime(new Date(NOW));
    });

    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('deletes a section while detaching its tasks and persists the full snapshot', async () => {
        const { addProject, addSection, addTask, deleteSection } = useTaskStore.getState();
        const project = await addProject('Launch', '#3b82f6');
        expect(project).not.toBeNull();
        if (!project) return;
        const section = await addSection(project.id, 'Planning');
        expect(section).not.toBeNull();
        if (!section) return;
        const task = await addTask('Draft plan', {
            projectId: project.id,
            sectionId: section.id,
            status: 'next',
        });
        expect(task.success).toBe(true);
        if (!task.success) return;

        const result = await deleteSection(section.id);
        await flushPendingSave();

        expect(result).toEqual({ success: true });
        expect(useTaskStore.getState().sections).toEqual([]);
        expect(useTaskStore.getState()._allSections.find((item) => item.id === section.id)).toMatchObject({
            deletedAt: NOW,
            updatedAt: NOW,
            rev: 2,
        });
        expect(useTaskStore.getState()._allTasks.find((item) => item.id === task.id)).toMatchObject({
            projectId: project.id,
            sectionId: undefined,
            rev: 2,
        });

        const saved = saveData.mock.calls.at(-1)?.[0] as AppData;
        expect(saved.sections.find((item) => item.id === section.id)?.deletedAt).toBe(NOW);
        expect(saved.tasks.find((item) => item.id === task.id)?.sectionId).toBeUndefined();
    });

    it('uses the shared Section factory for RN initial props and finite order fallback', async () => {
        const project = await useTaskStore.getState().addProject('Launch', '#3b82f6');
        if (!project) throw new Error('project creation failed');
        const existing = await useTaskStore.getState().addSection(project.id, 'Earlier');
        if (!existing) throw new Error('section creation failed');
        const initialProps = { description: 'Keep details', isCollapsed: true,
            order: Number.POSITIVE_INFINITY, createdAt: '2025-01-01T00:00:00.000Z' };
        const created = await useTaskStore.getState().addSection(project.id, '  Planned  ', initialProps);
        if (!created) throw new Error('section creation failed');
        const expected = buildNewSection({ id: created.id, projectId: project.id, title: '  Planned  ',
            initialProps, orderMax: projectSectionOrderMax([existing], project.id),
            deviceId: created.revBy!, now: NOW });
        expect(created).toEqual(expected);
        expect(created).toMatchObject({ title: 'Planned', order: 1, isCollapsed: true,
            description: 'Keep details', createdAt: initialProps.createdAt });
    });

    it('plans the tombstone and every linked Task detach without changing raw fields', () => {
        const before: Section = { id: 'target', projectId: 'parent', title: 'Keep', order: 3,
            description: null as never, rev: 4, revBy: 'old', createdAt: NOW, updatedAt: NOW };
        const tasks: Task[] = [
            { id: 'live', title: 'Live', status: 'next', projectId: 'parent', sectionId: 'target',
                tags: [], contexts: [], rev: 2, createdAt: NOW, updatedAt: NOW },
            { id: 'deleted', title: 'Deleted', status: 'next', projectId: 'other', sectionId: 'target',
                deletedAt: NOW, tags: [], contexts: [], rev: 7, createdAt: NOW, updatedAt: NOW },
        ];
        const effect = sectionDeleteEffect(before, tasks, 'new-device', NOW);
        expect(effect.section.after).toEqual({ ...before, deletedAt: NOW, updatedAt: NOW,
            rev: 5, revBy: 'new-device' });
        expect(effect.tasks.map((pair) => pair.after)).toEqual(tasks.map((task) => ({ ...task,
            sectionId: undefined, updatedAt: NOW, rev: task.rev! + 1, revBy: 'new-device' })));
    });
});
