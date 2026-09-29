import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInlineMarkdownPreview } from './markdown';
import { createMarkdownLinkLookup, resolveMarkdownInline } from './markdown-blocks';
import { createNativeHostContract } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { StorageAdapter } from './storage';
import type { Project, Task } from './types';

const createdAt = '2026-09-01T00:00:00.000Z';
const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: id, status: 'next', tags: [], contexts: [], createdAt, updatedAt: createdAt, ...extra,
});
const project = (id: string, extra: Partial<Project> = {}): Project => ({
    id, title: id, status: 'active', color: '#123456', order: 0, tagIds: [], createdAt, updatedAt: createdAt, ...extra,
});

describe('native row description', () => {
    afterEach(async () => {
        vi.useRealTimers();
        await flushPendingSave();
        resetForTests();
        vi.restoreAllMocks();
    });

    it('resolves the shared preview on displayed rows and refreshes references when source arrays change', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 8, 23, 10, 0));
        const referencedTask = task('任务 α', { projectId: '项目 β' });
        const referencedProject = project('项目 β');
        const description = '# **Bold** *italic* ~~strike~~ `code` [[task:任务 α|Task]] [[project:项目 β|Project]] '
            + '[[task:missing|Gone task]] [[project:missing|Gone project]] '
            + '[web](https://example.com) [mail](mailto:a@example.com) [phone](tel:123) '
            + '[script](javascript:alert(1)) [file](file:///tmp/secret)';
        const source = task('source', { description });
        const empty = task('empty', { description: '' });
        const tasks = [source, empty, referencedTask];
        const projects = [referencedProject];
        const saveData = vi.fn().mockResolvedValue(undefined);
        setStorageAdapter({
            getData: vi.fn().mockResolvedValue({ tasks, projects, sections: [], areas: [], people: [], settings: {} }),
            saveData,
        } satisfies StorageAdapter);
        useTaskStore.setState({
            _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
        });
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        saveData.mockClear();
        const before = useTaskStore.getState();
        const storedTasks = before._allTasks;
        const storedProjects = before._allProjects;
        const storedSettings = before.settings;
        const first = host.getFocus({ limit: 20 });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const rows = first.value.sections.flatMap((section) => section.rows);
        const sourceRow = rows.find((row) => row.id === source.id)!;
        const emptyRow = rows.find((row) => row.id === empty.id)!;
        const preview = getInlineMarkdownPreview(description);
        expect(sourceRow.meta.descriptionPreview).toBe(preview);
        expect(sourceRow.meta.description).toEqual({
            inline: resolveMarkdownInline(preview, createMarkdownLinkLookup(storedTasks, storedProjects)),
            labels: { deletedTask: 'deleted task', deletedProject: 'deleted project' },
        });
        expect(sourceRow.meta.description?.inline).toEqual(expect.arrayContaining([
            { type: 'bold', text: 'Bold' }, { type: 'italic', text: 'italic' },
            { type: 'strike', text: 'strike' }, { type: 'code', text: 'code' },
            { type: 'link', text: 'Task', target: { kind: 'task', id: referencedTask.id, projectId: referencedProject.id } },
            { type: 'link', text: 'Project', target: { kind: 'project', id: referencedProject.id } },
            { type: 'deletedReference', text: 'Gone task', entityType: 'task' },
            { type: 'deletedReference', text: 'Gone project', entityType: 'project' },
            { type: 'link', text: 'web', target: { kind: 'external', href: 'https://example.com' } },
            { type: 'link', text: 'mail', target: { kind: 'external', href: 'mailto:a@example.com' } },
            { type: 'link', text: 'phone', target: { kind: 'external', href: 'tel:123' } },
            { type: 'text', text: 'script' }, { type: 'text', text: 'file' },
        ]));
        expect(emptyRow.meta.descriptionPreview).toBeNull();
        expect(emptyRow.meta.description).toBeUndefined();
        expect(useTaskStore.getState()._allTasks).toBe(storedTasks);
        expect(useTaskStore.getState()._allProjects).toBe(storedProjects);
        expect(useTaskStore.getState().settings).toBe(storedSettings);
        expect(saveData).not.toHaveBeenCalled();

        useTaskStore.setState({
            _allTasks: storedTasks.map((entry) => entry.id === referencedTask.id ? { ...entry, deletedAt: createdAt } : entry),
            _allProjects: storedProjects.map((entry) => ({ ...entry, deletedAt: createdAt })),
        });
        expect(host.getFocusSectionWindow({ key: 'next', offset: 0, limit: 20, revision: first.value.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        const second = host.getFocus({ limit: 20 });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        const secondSource = second.value.sections.flatMap((section) => section.rows).find((row) => row.id === source.id)!;
        expect(secondSource.meta.description?.inline).toEqual(resolveMarkdownInline(
            preview, createMarkdownLinkLookup(useTaskStore.getState()._allTasks, useTaskStore.getState()._allProjects),
        ));
        expect(secondSource.meta.description?.inline).toEqual(expect.arrayContaining([
            { type: 'deletedReference', text: 'Task', entityType: 'task' },
            { type: 'deletedReference', text: 'Project', entityType: 'project' },
        ]));
        expect(saveData).not.toHaveBeenCalled();
    });
});
