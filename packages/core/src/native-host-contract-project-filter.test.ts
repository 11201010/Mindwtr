import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeHostContract } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { Area, Project } from './types';

const date = '2026-09-01T00:00:00.000Z';
const area = (id: string, order: number): Area => ({
    id, name: id, order, color: '#abcdef', icon: 'home', createdAt: date, updatedAt: date,
});
const project = (id: string, extra: Partial<Project> = {}): Project => ({
    id, title: id, status: 'active', color: '#123456', order: 0, tagIds: [],
    createdAt: date, updatedAt: date, ...extra,
});
const ids = (groups: { projects: { id: string }[] }[]) => groups.flatMap(({ projects }) => projects.map(({ id }) => id));
const filtered = (host: ReturnType<typeof createNativeHostContract>, tagFilter: string) => {
    const result = host.getFilteredProjects({ tagFilter });
    if (!result.ok) throw new Error('Projects read failed');
    return result.value;
};

describe('native Projects tag filter', () => {
    const saveData = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        saveData.mockClear();
        setStorageAdapter({ getData: vi.fn().mockResolvedValue({
            tasks: [], projects: [], sections: [], areas: [], people: [], settings: {},
        }), saveData });
        useTaskStore.setState({
            _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false,
            editLockCount: 0, lastDataChangeAt: 0,
        });
    });

    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        vi.restoreAllMocks();
    });

    const activate = async () => {
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        await flushPendingSave();
        saveData.mockClear();
        return host;
    };

    it('matches RN all, exact, and untagged selection across status, Area, and focused order', async () => {
        const host = await activate();
        useTaskStore.setState({
            _allAreas: [area('a', 0), area('b', 1)],
            _allProjects: [
                project('ordinary', { areaId: 'a', tagIds: ['#work'], order: 0 }),
                project('focused', { areaId: 'a', tagIds: ['#work'], order: 9, isFocused: true }),
                project('waiting', { areaId: 'a', tagIds: ['#work'], status: 'waiting' }),
                project('archived', { areaId: 'a', tagIds: ['#work'], status: 'archived' }),
                project('elsewhere', { areaId: 'b', tagIds: ['#home'] }),
                project('untagged', { areaId: 'a' }),
                project('deleted', { areaId: 'a', tagIds: ['#gone'], deletedAt: date }),
            ],
        });
        const all = host.getFilteredProjects({ tagFilter: '__all__' });
        if (!all.ok) throw new Error('Projects read failed');
        expect(all.value.tagFilter).toBe('__all__');
        expect(all.value.tagInventory).toEqual({ values: ['#home', '#work'], hasUntagged: true });
        expect(ids(all.value.active)).toEqual(['focused', 'ordinary', 'untagged', 'elsewhere']);
        expect(ids(all.value.deferred)).toEqual(['waiting']);
        expect(ids(all.value.archived)).toEqual(['archived']);
        const legacy = host.getProjects();
        expect(legacy).toMatchObject({ ok: true, value: { active: all.value.active, deferred: all.value.deferred, archived: all.value.archived } });
        if (!legacy.ok) throw new Error('Legacy Projects read failed');
        expect(Object.keys(legacy.value).sort()).toEqual(['active', 'archived', 'deferred', 'revision', 'version']);

        const work = host.getFilteredProjects({ tagFilter: '#work' });
        if (!work.ok) throw new Error('Filtered Projects read failed');
        expect(ids(work.value.active)).toEqual(['focused', 'ordinary']);
        expect(ids(work.value.deferred)).toEqual(['waiting']);
        expect(ids(work.value.archived)).toEqual(['archived']);
        expect(work.value.tagInventory).toEqual(all.value.tagInventory);
        expect(ids(filtered(host, '__none__').active)).toEqual(['untagged']);

        useTaskStore.setState({ settings: { filters: { areaId: 'a', areaIds: ['a'], excludedAreaIds: [] } } });
        const selected = host.getFilteredProjects({ tagFilter: '__all__' });
        if (!selected.ok) throw new Error('Area-filtered Projects read failed');
        expect(ids(selected.value.active)).toEqual(['focused', 'ordinary', 'untagged']);
        expect(selected.value.tagInventory).toEqual(all.value.tagInventory);
        expect(saveData).not.toHaveBeenCalled();
    });

    it('keeps raw UTF-16 identity, including empty and reserved tokens', async () => {
        const host = await activate();
        useTaskStore.setState({ _allProjects: [
            project('composed', { tagIds: ['#caf\u00e9'] }),
            project('decomposed', { tagIds: ['#cafe\u0301'] }),
            project('empty', { tagIds: [''] }),
            project('reserved', { tagIds: ['__none__'] }),
            project('reserved-all', { tagIds: ['__all__'] }),
            project('bare'),
        ] });
        expect(ids(filtered(host, '#caf\u00e9').active)).toEqual(['composed']);
        expect(ids(filtered(host, '#cafe\u0301').active)).toEqual(['decomposed']);
        expect(ids(filtered(host, '').active)).toEqual(['empty']);
        expect(ids(filtered(host, '__none__').active)).toEqual(['bare']);
        expect(ids(filtered(host, '__all__').active)).toEqual(['bare', 'composed', 'decomposed', 'empty', 'reserved', 'reserved-all']);
        expect(ids(filtered(host, 'missing').active)).toEqual([]);
        expect(saveData).not.toHaveBeenCalled();
    });

    it('caches each exact selection and refreshes on entity, settings, and language changes', async () => {
        const host = await activate();
        useTaskStore.setState({ _allProjects: [project('one', { tagIds: ['#x'] })] });
        const first = host.getFilteredProjects({ tagFilter: '#x' });
        const repeat = host.getFilteredProjects({ tagFilter: '#x' });
        if (!first.ok || !repeat.ok) throw new Error('Projects read failed');
        expect(repeat.value).toBe(first.value);
        const other = host.getFilteredProjects({ tagFilter: '#y' });
        if (!other.ok) throw new Error('Projects read failed');
        expect(other.value).not.toBe(first.value);
        expect(ids(other.value.active)).toEqual([]);
        const switched = host.getFilteredProjects({ tagFilter: '#x' });
        if (!switched.ok) throw new Error('Projects read failed');
        expect(ids(switched.value.active)).toEqual(['one']);
        useTaskStore.setState({ _allProjects: [project('two', { tagIds: ['#x'] })] });
        const entity = host.getFilteredProjects({ tagFilter: '#x' });
        if (!entity.ok) throw new Error('Projects read failed');
        expect(ids(entity.value.active)).toEqual(['two']);
        expect(entity.value.revision).not.toBe(switched.value.revision);
        useTaskStore.setState({ settings: { taskSortBy: 'title' } });
        const settings = host.getFilteredProjects({ tagFilter: '#x' });
        if (!settings.ok) throw new Error('Projects read failed');
        expect(settings.value).not.toBe(entity.value);
        expect(settings.value.revision).not.toBe(entity.value.revision);
        expect(await host.setLanguage({ storedLanguage: 'zh', systemLocale: 'zh-CN' })).toMatchObject({ ok: true });
        const language = host.getFilteredProjects({ tagFilter: '#x' });
        if (!language.ok) throw new Error('Projects read failed');
        expect(language.value).not.toBe(settings.value);
        expect(language.value.revision).not.toBe(settings.value.revision);
        expect(saveData).not.toHaveBeenCalled();
    });

    it('rejects every non-object, extra field, non-string, and oversized input without a write', async () => {
        const host = await activate();
        const invalid: unknown[] = [null, [], 'x', {}, { tagFilter: null }, { tagFilter: 1 },
            { tagFilter: '#x', extra: true }, { tagFilter: 'x'.repeat(100001) }];
        for (const input of invalid) {
            expect(host.getFilteredProjects(input as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        expect(host.getFilteredProjects({ tagFilter: 'x'.repeat(100000) })).toMatchObject({ ok: true });
        expect(saveData).not.toHaveBeenCalled();
    });
});
