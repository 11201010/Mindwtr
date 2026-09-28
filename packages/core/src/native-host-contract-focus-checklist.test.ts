import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyFocusChecklistEdit, buildFocusChecklistPageModel, type FocusChecklistEdit, type FocusChecklistPageModel } from './focus-checklist-model';
import { loadTranslations } from './i18n/i18n-loader';
import { createNativeHostContract } from './native-host-contract';
import type { NativeFocusChecklistEdit } from './native-host-contract-focus-checklist';
import { loadScreenFixture, normalize, openScreenHost, requestId, restartScreenHost, value, type ScreenHost } from './screen-parity.replay';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { Task } from './types';

type Action = [string, ...unknown[]];
type Fixture = {
    timeZone: string;
    now: string;
    tasks: Task[];
    scenarios: { name: string; id: string | string[]; actions: Action[] }[];
    observations: Record<string, unknown[]>;
};
const fixture = loadScreenFixture<Fixture>('focus-checklist');

/** The page as the mobile harness observes it, built from the model. */
function observe(page: FocusChecklistPageModel) {
    if (page.title === null) return { texts: [page.missingText], buttons: [['button', page.backLabel, null, false, 0]], inputs: [] };
    return {
        texts: [page.title, ...(page.emptyText ? [page.emptyText] : []), page.addLabel],
        buttons: [
            ['button', page.backLabel, null, false, 0],
            ...page.items.flatMap((item) => [
                ['checkbox', item.checkboxLabel, { checked: item.isCompleted }, item.isCompleted, item.isCompleted ? 1 : 0],
                ['button', item.deleteLabel, null, false, 0],
            ]),
            ['button', page.addLabel, null, false, 0],
        ],
        inputs: page.items.map((item) => [item.title, item.placeholder, item.inputLabel, item.isCompleted, item.isCompleted ? 'line-through' : null]),
    };
}

type Driver = {
    page: (id: string) => FocusChecklistPageModel;
    /** One edit; the toast message when it failed. */
    edit: (id: string, action: Action, newId: () => string) => Promise<string | null>;
};

async function replay(scenario: Fixture['scenarios'][number], driver: Driver, log: unknown[][], fail: (mode: string) => void) {
    const id = Array.isArray(scenario.id) ? scenario.id[0] : scenario.id;
    const toasts: unknown[] = [];
    const navigation: unknown[] = [];
    let uuid = 0;
    const seen = { writes: 0, toasts: 0, navigation: 0 };
    const snapshot = () => {
        const observation = {
            ...observe(driver.page(id)),
            toasts: toasts.slice(seen.toasts),
            writes: log.slice(seen.writes),
            navigation: navigation.slice(seen.navigation),
        };
        seen.writes = log.length;
        seen.toasts = toasts.length;
        seen.navigation = navigation.length;
        return normalize(observation);
    };
    const observations = [snapshot()];
    for (const action of scenario.actions) {
        if (action[0] === 'fail') fail(action[1] as string);
        else if (action[0] === 'back') navigation.push(['back']);
        else {
            const message = await driver.edit(id, action, () => `uuid-${++uuid}`);
            if (message !== null) toasts.push(['error', driver.page(id).error.title, message, 4200]);
        }
        await flushPendingSave();
        observations.push(snapshot());
    }
    return observations;
}

describe('Focus checklist page: core and the native host contract', () => {
    const originalTz = process.env.TZ;
    let t: (key: string) => string = (key) => key;
    beforeAll(async () => {
        process.env.TZ = fixture.timeZone;
        const english = await loadTranslations('en');
        t = (key) => english[key] ?? key;
    });
    afterAll(() => {
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });
    afterEach(async () => {
        vi.useRealTimers();
        await flushPendingSave();
        resetForTests();
        vi.restoreAllMocks();
    });
    const freezeClock = () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(fixture.now));
    };
    const open = async (options: { tasks?: Task[]; saveData?: (data: unknown) => Promise<void> } = {}) => {
        const log: unknown[][] = [];
        let failure: string | null = null;
        const host = await openScreenHost({
            data: { tasks: options.tasks ?? fixture.tasks },
            record: { updateTask: null },
            log,
            saveData: options.saveData,
            intercept: () => {
                const mode = failure;
                failure = null;
                if (mode === 'refuse') return Promise.resolve({ success: false, error: 'disk full' });
                if (mode === 'refuseSilent') return Promise.resolve({ success: false });
                if (mode === 'throw') return Promise.reject(new Error('disk unavailable'));
                return undefined;
            },
        });
        return { host, log, fail: (mode: string) => { failure = mode; } };
    };
    const visible = (id: string) => useTaskStore.getState().tasks.find((task) => task.id === id);
    const directPage = (id: string) => {
        const task = visible(id);
        return buildFocusChecklistPageModel({ task, checklist: task?.checklist ?? [], t });
    };
    const contractPage = (host: ScreenHost) => (id: string): FocusChecklistPageModel => {
        const { items, ...view } = value(host.getFocusChecklist({ id }));
        return {
            backLabel: view.backLabel, missingText: view.missingText, title: view.title, emptyText: view.emptyText,
            items: items.map(({ index: _index, edits: _edits, ...item }) => item), addLabel: view.addLabel, error: view.error,
        };
    };

    it('has a fixture captured from React Native', () => {
        expect((fixture as unknown as { provenance: { capturedAt: string } }).provenance.capturedAt).toMatch(/^[0-9a-f]{40}$/);
        expect(fixture.scenarios.map((scenario) => scenario.name)).toEqual(Object.keys(fixture.observations));
    });

    describe.each(fixture.scenarios.map((scenario) => [scenario.name, scenario] as const))('replays the frozen React Native scenario: %s', (_name, scenario) => {
        it('through core called directly', async () => {
            freezeClock();
            const { log, fail } = await open();
            const observations = await replay(scenario, {
                page: directPage,
                // Mobile's commitChecklist: the whole checklist after the edit, settled as settleStoreAction settles it.
                edit: async (id, action, newId) => {
                    const task = visible(id)!;
                    const change: FocusChecklistEdit = action[0] === 'add'
                        ? { kind: 'add', id: newId() }
                        : action[0] === 'rename'
                            ? { kind: 'rename', index: action[1] as number, text: action[2] as string }
                            : { kind: action[0] as 'toggle' | 'remove', index: action[1] as number };
                    try {
                        const result = await useTaskStore.getState().updateTask(task.id, { checklist: applyFocusChecklistEdit(task.checklist ?? [], change) });
                        if (result && result.success === false) return (typeof result.error === 'string' && result.error.trim()) || directPage(id).error.fallbackMessage;
                        return null;
                    } catch (error) {
                        return (error as Error).message || directPage(id).error.fallbackMessage;
                    }
                },
            }, log, fail);
            expect(observations).toEqual(fixture.observations[scenario.name]);
        });

        it('through the native host contract', async () => {
            freezeClock();
            const { host, log, fail } = await open();
            const observations = await replay(scenario, {
                page: contractPage(host),
                edit: async (id, action, newId) => {
                    const { items, taskRevision } = value(host.getFocusChecklist({ id }));
                    const edit: NativeFocusChecklistEdit = action[0] === 'add'
                        ? { kind: 'add', itemId: newId() }
                        : action[0] === 'rename'
                            ? { kind: 'rename', index: action[1] as number, itemId: items[action[1] as number].id, text: action[2] as string }
                            : items[action[1] as number].edits[action[0] as 'toggle' | 'remove'];
                    const result = await host.editFocusChecklist({ requestId: requestId(), id, taskRevision: taskRevision!, edit });
                    return result.ok ? null : result.error.message;
                },
            }, log, fail);
            expect(observations).toEqual(fixture.observations[scenario.name]);
        });
    });

    it('serves core\'s page with each item\'s edits, windowed under a revision', async () => {
        freezeClock();
        const checklist = Array.from({ length: 105 }, (_, index) => ({ id: `c-${index}`, title: `Item ${index}`, isCompleted: index % 2 === 0 }));
        const { host } = await open({ tasks: [...fixture.tasks, { ...fixture.tasks[1], id: 't-long', checklist }] });
        const first = value(host.getFocusChecklist({ id: 't-long' }));
        const model = buildFocusChecklistPageModel({ task: visible('t-long'), checklist, t });
        const { items, ...rest } = model;
        expect(first).toMatchObject({ ...rest, version: 1, id: 't-long', found: true, total: 105 });
        expect(first.items).toHaveLength(100);
        expect(first.items[1]).toEqual({
            ...items[1],
            index: 1,
            edits: { toggle: { kind: 'toggle', index: 1, itemId: 'c-1', isCompleted: true }, remove: { kind: 'remove', index: 1, itemId: 'c-1' } },
        });
        const second = value(host.getFocusChecklist({ id: 't-long', offset: 100, limit: 100, revision: first.revision }));
        expect([...first.items, ...second.items].map(({ index: _index, edits: _edits, ...item }) => item)).toEqual(items);
        // A write moves the revision: a later window is stale.
        value(await host.editFocusChecklist({ requestId: requestId(), id: 't-long', taskRevision: first.taskRevision!, edit: first.items[0].edits.toggle }));
        expect(host.getFocusChecklist({ id: 't-long', offset: 100, limit: 100, revision: first.revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.getFocusChecklist({ id: 't-long', offset: 100, limit: 100 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        // Mobile finds the task among the visible tasks only.
        for (const id of ['t-archived', 't-deleted', 't-missing']) {
            expect(value(host.getFocusChecklist({ id }))).toMatchObject({ found: false, title: null, missingText: 'No tasks found', total: 0, items: [], taskRevision: null });
        }
    });

    it('writes each edit as mobile writes it, against the task revision it was made on', async () => {
        freezeClock();
        const { host, log } = await open();
        const page = () => value(host.getFocusChecklist({ id: 't-trip' }));
        const edits: NativeFocusChecklistEdit[] = [
            page().items[0].edits.toggle,
            { kind: 'rename', index: 1, itemId: 'c-chargers', text: 'Phone\ncharger' },
            { kind: 'add', itemId: 'new-item' },
            page().items[2].edits.remove,
        ];
        const revisions: string[] = [];
        for (const edit of edits) {
            const before = visible('t-trip')!.checklist!;
            const taskRevision = page().taskRevision!;
            revisions.push(taskRevision);
            const change: FocusChecklistEdit = edit.kind === 'add' ? { kind: 'add', id: edit.itemId } : edit.kind === 'rename'
                ? { kind: 'rename', index: edit.index, text: edit.text } : { kind: edit.kind, index: edit.index };
            const result = value(await host.editFocusChecklist({ requestId: requestId(), id: 't-trip', taskRevision, edit }));
            expect(result.changed).toBe(true);
            expect(log.at(-1)).toEqual(['updateTask', 't-trip', { checklist: applyFocusChecklistEdit(before, change) }]);
            expect(result.checklist).toEqual(visible('t-trip')!.checklist);
            // The answer carries the revision the next edit is made on.
            expect(result.taskRevision).toBe(page().taskRevision);
            expect(result.taskRevision).not.toBe(taskRevision);
        }
        log.length = 0;
        // An edit made on an older revision is stale, whatever it asks for: nothing is written.
        for (const [index, edit] of edits.entries()) {
            expect(await host.editFocusChecklist({ requestId: requestId(), id: 't-trip', taskRevision: revisions[index], edit }))
                .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        // On the current revision, a tick to the value it has writes nothing; an item that is not at that position is refused.
        const current = page();
        expect(value(await host.editFocusChecklist({
            requestId: requestId(), id: 't-trip', taskRevision: current.taskRevision!, edit: { ...current.items[0].edits.toggle, isCompleted: current.items[0].isCompleted },
        }))).toMatchObject({ changed: false, taskRevision: current.taskRevision });
        expect(await host.editFocusChecklist({ requestId: requestId(), id: 't-trip', taskRevision: current.taskRevision!, edit: { kind: 'toggle', index: 0, itemId: 'c-chargers', isCompleted: false } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.editFocusChecklist({ requestId: requestId(), id: 't-trip', taskRevision: current.taskRevision!, edit: { kind: 'add', itemId: 'new-item' } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(log).toEqual([]);
    });

    it('a replay after a restart never undoes a later edit; a retry on the same host answers from its receipt', async () => {
        freezeClock();
        const { host, log } = await open();
        const page = () => value(host.getFocusChecklist({ id: 't-trip' }));
        const tick = { requestId: requestId(), id: 't-trip', taskRevision: page().taskRevision!, edit: page().items[0].edits.toggle };
        const ticked = value(await host.editFocusChecklist(tick));
        const untick = value(await host.editFocusChecklist({ requestId: requestId(), id: 't-trip', taskRevision: ticked.taskRevision, edit: page().items[0].edits.toggle }));
        const rename = { requestId: requestId(), id: 't-trip', taskRevision: untick.taskRevision, edit: { kind: 'rename' as const, index: 1, itemId: 'c-chargers', text: 'Cables' } };
        const renamed = value(await host.editFocusChecklist(rename));
        value(await host.editFocusChecklist({ requestId: requestId(), id: 't-trip', taskRevision: renamed.taskRevision, edit: { ...rename.edit, text: 'Chargers' } }));
        log.length = 0;
        // The same host still holds the receipts: the answer is the first one, with no write.
        expect(await host.editFocusChecklist(tick)).toEqual({ ok: true, value: ticked });
        // A new host has none: the replays are stale and write nothing.
        const restarted = await restartScreenHost();
        expect(await restarted.editFocusChecklist(tick)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await restarted.editFocusChecklist(rename)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(log).toEqual([]);
        expect(visible('t-trip')!.checklist!.slice(0, 2)).toEqual([
            { id: 'c-passport', title: 'Passport', isCompleted: false },
            { id: 'c-chargers', title: 'Chargers', isCompleted: true },
        ]);
    });

    it.each([
        ['a tick', { kind: 'toggle', index: 0, itemId: 'c-passport', isCompleted: true }],
        ['a rename', { kind: 'rename', index: 0, itemId: 'c-passport', text: 'Visa' }],
        ['a delete', { kind: 'remove', index: 2, itemId: 'c-blank' }],
        ['an add', { kind: 'add', itemId: 'c-new' }],
    ] as const)('retries %s exactly after a failed save', async (_name, edit) => {
        freezeClock();
        const saveData = vi.fn().mockResolvedValue(undefined);
        const { host, log } = await open({ saveData });
        const input = { requestId: requestId(), id: 't-trip', taskRevision: value(host.getFocusChecklist({ id: 't-trip' })).taskRevision!, edit: edit as NativeFocusChecklistEdit };
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.editFocusChecklist(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
        expect(log).toHaveLength(1);
        const landed = visible('t-trip')!.checklist;
        saveData.mockResolvedValue(undefined);
        const retried = await host.editFocusChecklist(input);
        expect(retried).toEqual({ ok: true, value: { changed: true, checklist: landed, taskRevision: value(host.getFocusChecklist({ id: 't-trip' })).taskRevision } });
        // The retry only saved: no second write, and storage holds the edit.
        expect(log).toHaveLength(1);
        expect(visible('t-trip')!.checklist).toBe(landed);
        const saved = saveData.mock.lastCall?.[0] as { tasks: Task[] };
        expect(saved.tasks.find((task) => task.id === 't-trip')!.checklist).toEqual(landed);
        // A lost reply repeats the request: no write, no save.
        const saves = saveData.mock.calls.length;
        expect(await host.editFocusChecklist(input)).toEqual(retried);
        expect(saveData).toHaveBeenCalledTimes(saves);
        expect(await host.editFocusChecklist({ ...input, id: 't-list' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }, 20_000);

    it('refuses invalid input without writing', async () => {
        freezeClock();
        const { host, log } = await open();
        const invalid = { ok: false, error: { code: 'INVALID_INPUT' } };
        expect(host.getFocusChecklist({} as never)).toMatchObject(invalid);
        expect(host.getFocusChecklist({ id: '' })).toMatchObject(invalid);
        expect(host.getFocusChecklist({ id: 't-trip', limit: 0 })).toMatchObject(invalid);
        const taskRevision = value(host.getFocusChecklist({ id: 't-trip' })).taskRevision!;
        const edit = async (input: unknown) => expect(await host.editFocusChecklist({ requestId: requestId(), id: 't-trip', taskRevision, ...(input as object) } as never)).toMatchObject(invalid);
        await edit({ edit: { kind: 'toggle', index: 0, itemId: 'c-passport', isCompleted: true }, taskRevision: undefined });
        await edit({ edit: { kind: 'toggle', index: 0, itemId: 'c-passport', isCompleted: true }, taskRevision: 7 });
        await edit({ edit: { kind: 'toggle', index: 0, itemId: 'c-passport' } });
        await edit({ edit: { kind: 'toggle', index: -1, itemId: 'c-passport', isCompleted: true } });
        await edit({ edit: { kind: 'rename', index: 0, itemId: 'c-passport', text: 7 } });
        await edit({ edit: { kind: 'rename', index: 0, itemId: 'c-passport', text: 'x'.repeat(10_001) } });
        await edit({ edit: { kind: 'add' } });
        await edit({ edit: { kind: 'move', index: 0, itemId: 'c-passport' } });
        await edit({ edit: { kind: 'remove', index: 0, itemId: 'c-passport' }, id: '' });
        await edit({ edit: { kind: 'remove', index: 0, itemId: 'c-passport' }, requestId: 'not-a-uuid' });
        expect(await host.editFocusChecklist({ requestId: requestId(), id: 't-archived', taskRevision, edit: { kind: 'add', itemId: 'x' } }))
            .toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
        expect(log).toEqual([]);
    });

    it('is NOT_READY before native storage is activated', async () => {
        await flushPendingSave();
        resetForTests();
        setStorageAdapter({ getData: async () => ({ tasks: fixture.tasks, projects: [], sections: [], areas: [], settings: {} }), saveData: async () => undefined });
        const host = createNativeHostContract();
        expect(host.getFocusChecklist({ id: 't-trip' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.editFocusChecklist({ requestId: requestId(), id: 't-trip', taskRevision: 'x', edit: { kind: 'add', itemId: 'x' } }))
            .toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    });
});
