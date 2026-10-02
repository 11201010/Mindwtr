import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import { DEFAULT_TASK_EDITOR_HIDDEN, DEFAULT_TASK_EDITOR_ORDER } from './task-editor-layout';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, AppSettings, Project, Section, Task } from './types';

const AT = '2026-10-02T12:00:00.000Z';
const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: id, status: 'next', tags: [], contexts: [], createdAt: AT, updatedAt: AT, ...extra,
});
const project = (id: string): Project => ({
    id, title: id, status: 'active', color: '#123456', order: 0, tagIds: [], createdAt: AT, updatedAt: AT,
});
const section: Section = {
    id: 's-live', projectId: 'p-live', title: 'Live section', order: 0, createdAt: AT, updatedAt: AT,
};
const fixture = (settings: AppSettings): AppData => ({
    tasks: [
        task('unassigned', { projectId: 'p-live' }),
        task('moving', { projectId: 'p-empty' }),
        task('waiting', { status: 'waiting' }),
        task('populated', { projectId: 'p-live', sectionId: 's-live', assignedTo: 'Sam', location: 'Lab',
            priority: 'high', timeEstimate: '30min' }),
    ],
    projects: [project('p-live'), project('p-empty')], sections: [section], areas: [], people: [], settings,
});
const migratedSettings = (): AppSettings => ({
    gtd: { taskEditor: { defaultsVersion: 5, hidden: [...DEFAULT_TASK_EDITOR_HIDDEN] } },
});
const customSettings = (): AppSettings => ({
    gtd: { taskEditor: { defaultsVersion: 5, order: [...DEFAULT_TASK_EDITOR_ORDER],
        hidden: [...DEFAULT_TASK_EDITOR_HIDDEN] } },
});
const value = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

async function open(settings: AppSettings) {
    await flushPendingSave();
    resetForTests();
    const persisted = fixture(settings);
    const saveData = vi.fn().mockResolvedValue(undefined);
    setStorageAdapter({ getData: async () => structuredClone(persisted), saveData });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0 } as never);
    const host = createNativeHostContract();
    expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
    await flushPendingSave();
    saveData.mockClear();
    const saved = structuredClone(persisted);
    const tasks = structuredClone(useTaskStore.getState()._allTasks);
    const currentSettings = structuredClone(useTaskStore.getState().settings);
    const editor = (id: string) => value(host.getTaskEditorModel({ id }));
    const picker = (id: string, draft: ReturnType<typeof editor>['draft']) =>
        value(host.getTaskDraftDestinationPicker({ id, draft, query: '' }));
    const unchanged = () => {
        expect(persisted).toEqual(saved);
        expect(useTaskStore.getState()._allTasks).toEqual(tasks);
        expect(useTaskStore.getState().settings).toEqual(currentSettings);
        expect(saveData).not.toHaveBeenCalled();
    };
    return { host, editor, picker, unchanged };
}

const fields = (model: ReturnType<Awaited<ReturnType<typeof open>>['editor']>) =>
    model.layout.sections.flatMap((group) => group.fields);

afterEach(async () => { await flushPendingSave(); resetForTests(); vi.restoreAllMocks(); });

describe('native Task Editor inherits historical RN visibility rules', () => {
    it('reveals an unassigned live Project Section and an empty Waiting person under migration defaults', async () => {
        const env = await open(migratedSettings());
        const unassigned = env.editor('unassigned');
        expect(unassigned.draft.sectionId).toBe('');
        expect(fields(unassigned)).toContain('section');
        expect(env.picker('unassigned', unassigned.draft).section).toMatchObject({ visible: true,
            choices: [{ id: '', selected: true, patch: { sectionId: '' } },
                { id: 's-live', selected: false, patch: { sectionId: 's-live' } }] });

        const waiting = env.editor('waiting');
        expect(waiting.draft.assignedTo).toBe('');
        expect(fields(waiting)).toContain('assignedTo');

        const emptyProject = env.editor('moving');
        expect(fields(emptyProject)).not.toContain('section');
        expect(env.picker('moving', emptyProject.draft).section.visible).toBe(false);
        const moved = value(env.host.editTaskDraft({ id: 'moving', draft: emptyProject.draft,
            edit: { type: 'fields', patch: { projectId: 'p-live', sectionId: '', areaId: '' } } }));
        expect(moved.draft).toMatchObject({ projectId: 'p-live', sectionId: '', areaId: '' });
        expect(fields(moved)).toContain('section');
        expect(env.picker('moving', moved.draft).section.visible).toBe(true);
        expect(env.editor('moving').draft.projectId).toBe('p-empty');

        const editedStatus = value(env.host.editTaskDraft({ id: 'moving', draft: moved.draft,
            edit: { type: 'fields', patch: { status: 'waiting' } } }));
        expect(editedStatus.draft).toMatchObject({ projectId: 'p-live', status: 'waiting', assignedTo: '' });
        expect(fields(editedStatus)).toContain('assignedTo');
        expect(env.editor('moving').draft.status).toBe('next');
        env.unchanged();
    });

    it('honors explicit empty hides while still revealing populated Section, person and Location', async () => {
        const env = await open(customSettings());
        const unassigned = env.editor('unassigned');
        expect(fields(unassigned)).not.toContain('section');
        expect(env.picker('unassigned', unassigned.draft).section).toMatchObject({ visible: false, choices: [] });
        expect(fields(env.editor('waiting'))).not.toContain('assignedTo');
        const populated = env.editor('populated');
        for (const field of ['section', 'assignedTo', 'location', 'priority', 'timeEstimate'] as const) {
            expect(fields(populated)).toContain(field);
        }
        expect(env.picker('populated', populated.draft).section.visible).toBe(true);
        expect(populated.draft).toMatchObject({ sectionId: 's-live', assignedTo: 'Sam', location: 'Lab',
            priority: 'high', timeEstimate: '30min' });
        env.unchanged();
    });

    it('suppresses feature-disabled Priority and Time Estimate without clearing their saved values', async () => {
        const off = await open({ ...customSettings(), features: { priorities: false, timeEstimates: false } });
        const hidden = off.editor('populated');
        expect(hidden.draft).toMatchObject({ priority: 'high', timeEstimate: '30min',
            sectionId: 's-live', assignedTo: 'Sam', location: 'Lab' });
        expect(fields(hidden)).not.toContain('priority');
        expect(fields(hidden)).not.toContain('timeEstimate');
        expect(fields(hidden)).toEqual(expect.arrayContaining(['section', 'assignedTo', 'location']));
        off.unchanged();

        const on = await open({ ...customSettings(), features: { priorities: true, timeEstimates: true } });
        const restored = on.editor('populated');
        expect(restored.draft).toMatchObject({ priority: 'high', timeEstimate: '30min' });
        expect(fields(restored)).toEqual(expect.arrayContaining(['priority', 'timeEstimate']));
        on.unchanged();
    });
});
