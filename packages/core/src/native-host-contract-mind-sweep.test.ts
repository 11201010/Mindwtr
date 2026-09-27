import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadTranslations } from './i18n/i18n-loader';
import {
    addMindSweepCapture,
    buildMindSweepView,
    getMindSweepCaptureTitle,
    INITIAL_MIND_SWEEP_STATE,
    type MindSweepState,
    type MindSweepView,
} from './mind-sweep-view-model';
import { createNativeHostContract } from './native-host-contract';
import { loadScreenFixture, normalize, openScreenHost, requestId, value, type ScreenHost } from './screen-parity.replay';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';

type Action = [string, ...string[]];
type Fixture = {
    timeZone: string;
    now: string;
    scenarios: { name: string; actions: Action[] }[];
    observations: Record<string, unknown[]>;
};
const fixture = loadScreenFixture<Fixture>('mind-sweep');

/** How a screen shows a view: the mobile harness's observation, built from the model. */
function observe(view: MindSweepView, draft: string) {
    const texts = [view.title, view.closeLabel];
    const buttons: unknown[] = [['mind-sweep-close', view.closeLabel, view.closeLabel, false, false]];
    if (view.intro) {
        texts.push(view.intro.text, view.intro.scopeLabel, ...view.intro.scopes.map((scope) => scope.label), view.intro.start.label);
        buttons.push(
            ...view.intro.scopes.map((scope) => [`mind-sweep-scope-${scope.value}`, null, scope.label, false, scope.selected]),
            ['mind-sweep-start', null, view.intro.start.label, false, false],
        );
    }
    const { group, summary } = view;
    if (group) {
        texts.push(group.title, group.progress, ...group.prompts.map((prompt) => `• ${prompt}`), group.add.label);
        if (group.addFailed) texts.push(group.addFailed);
        if (group.captured) texts.push(group.captured.label, ...group.captured.items.map((item) => `• ${item}`));
        texts.push(group.back.label, group.next.label);
        buttons.push(
            ['mind-sweep-add', null, group.add.label, group.add.disabled, false],
            ['mind-sweep-back', null, group.back.label, group.back.disabled, false],
            ['mind-sweep-next', null, group.next.label, false, false],
        );
    }
    if (summary) {
        texts.push(summary.title, summary.message, ...(summary.hint ? [summary.hint] : []), summary.finishLabel);
        buttons.push(['mind-sweep-finish', null, summary.finishLabel, false, false]);
    }
    return { texts, buttons, input: group ? [draft, group.placeholder] : null };
}

type Screen = { state: MindSweepState; draft: string; addFailed: boolean; closes: number };
type Driver = {
    view: (screen: Screen) => MindSweepView;
    /** Add: true when the capture landed. */
    add: (title: string) => Promise<boolean>;
};

/** Replays one scenario as the mobile screen runs it, through `driver`. */
async function replay(actions: Action[], driver: Driver, log: unknown[][], fail: (mode: string) => void) {
    const screen: Screen = { state: INITIAL_MIND_SWEEP_STATE, draft: '', addFailed: false, closes: 0 };
    const seen = { writes: 0, closes: 0 };
    const snapshot = () => {
        const observation = {
            ...observe(driver.view(screen), screen.draft),
            writes: log.slice(seen.writes),
            closes: screen.closes - seen.closes,
        };
        seen.writes = log.length;
        seen.closes = screen.closes;
        return normalize(observation);
    };
    const observations = [snapshot()];
    for (const [kind, arg] of actions) {
        const view = driver.view(screen);
        if (kind === 'failAdd') fail(arg);
        else if (kind === 'scope') screen.state = { ...screen.state, scope: view.intro!.scopes.find((scope) => scope.value === arg)!.value };
        else if (kind === 'start') screen.state = { ...screen.state, step: view.intro!.start.step };
        else if (kind === 'type') screen.draft = arg;
        else if (kind === 'add' || kind === 'submit') {
            const title = getMindSweepCaptureTitle(screen.draft);
            if (title && view.group) {
                if (await driver.add(title)) {
                    screen.state = { ...screen.state, captured: addMindSweepCapture(screen.state.captured, view.group.id, title) };
                    screen.draft = '';
                    screen.addFailed = false;
                } else {
                    screen.addFailed = true;
                }
            }
        } else if (kind === 'back') {
            if (!view.group!.back.disabled) screen.state = { ...screen.state, step: view.group!.back.step };
        } else if (kind === 'next') screen.state = { ...screen.state, step: view.group!.next.step };
        else if (kind === 'finish' || kind === 'close') screen.closes += 1;
        else throw new Error(`Unknown action ${kind}`);
        await flushPendingSave();
        observations.push(snapshot());
    }
    return observations;
}

describe('Mind Sweep: core and the native host contract', () => {
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

    /** A host whose addTask calls are logged as the mobile harness logs them; `fail` makes the next one refuse or throw. */
    const open = async (saveData?: (data: unknown) => Promise<void>) => {
        const log: unknown[][] = [];
        let failure: string | null = null;
        const host = await openScreenHost({
            data: {},
            record: { addTask: 2 },
            log,
            saveData,
            intercept: (_name) => {
                const mode = failure;
                failure = null;
                if (mode === 'refuse') return Promise.resolve({ success: false, error: 'disk full' });
                if (mode === 'throw') return Promise.reject(new Error('disk unavailable'));
                return undefined;
            },
        });
        return { host, log, fail: (mode: string) => { failure = mode; } };
    };

    it('has a fixture captured from React Native', () => {
        expect((fixture as unknown as { provenance: { capturedAt: string } }).provenance.capturedAt).toMatch(/^[0-9a-f]{40}$/);
        expect(fixture.scenarios.map((scenario) => scenario.name)).toEqual(Object.keys(fixture.observations));
    });

    describe.each(fixture.scenarios.map((scenario) => [scenario.name, scenario] as const))('replays the frozen React Native scenario: %s', (_name, scenario) => {
        it('through core called directly', async () => {
            freezeClock();
            const { log, fail } = await open();
            const observations = await replay(scenario.actions, {
                view: (screen) => buildMindSweepView({ ...screen, t }),
                // Mobile's handleAdd: the store call, then a refused or thrown result keeps the draft.
                add: async (title) => {
                    try {
                        const result = await useTaskStore.getState().addTask(title, { status: 'inbox' });
                        return result?.success === true;
                    } catch {
                        return false;
                    }
                },
            }, log, fail);
            expect(observations).toEqual(fixture.observations[scenario.name]);
        });

        it('through the native host contract', async () => {
            freezeClock();
            const { host, log, fail } = await open();
            const observations = await replay(scenario.actions, {
                view: (screen) => {
                    const view = value(host.getMindSweep(screen));
                    return { ...view, group: view.group && { ...view.group, captured: view.group.captured && { label: view.group.captured.label, items: view.group.captured.items } } };
                },
                add: async (title) => (await host.addMindSweepItem({ requestId: requestId(), title })).ok,
            }, log, fail);
            expect(observations).toEqual(fixture.observations[scenario.name]);
        });
    });

    it('serves core\'s view, with the captures windowed', async () => {
        freezeClock();
        const { host } = await open();
        const captured = { homeStuff: Array.from({ length: 105 }, (_, index) => `Item ${index + 1}`), peopleLife: ['Call mom'] };
        const state: MindSweepState = { scope: 'personal', step: 0, captured };
        const view = value(host.getMindSweep({ state, draft: 'x', addFailed: true }));
        const direct = buildMindSweepView({ state, draft: 'x', addFailed: true, t });
        const { version, revision, state: echoed, group, ...rest } = view;
        expect(version).toBe(1);
        expect(echoed).toEqual(state);
        const { captured: directCaptured, ...directGroup } = direct.group!;
        expect({ ...rest, group: { ...group!, captured: undefined } }).toEqual({ ...direct, group: { ...directGroup, captured: undefined } });
        expect(group!.captured).toEqual({ label: directCaptured!.label, total: 105, items: directCaptured!.items.slice(0, 100) });
        expect(view.summary).toBeNull();
        expect(direct.capturedCount).toBe(106);
        const next = value(host.getMindSweep({ state, draft: 'x', addFailed: true, offset: 100, limit: 100, revision }));
        expect(next.group!.captured).toEqual({ label: directCaptured!.label, total: 105, items: captured.homeStuff.slice(100) });
        // A later window of another screen state is stale.
        expect(host.getMindSweep({ state, draft: 'y', addFailed: true, offset: 100, limit: 100, revision }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.getMindSweep({ state, draft: 'x', addFailed: true, offset: 100, limit: 100 }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        // The first read starts at the intro.
        expect(value(host.getMindSweep())).toMatchObject({ phase: 'intro', state: INITIAL_MIND_SWEEP_STATE, group: null });
        // A new capture is a store edit: the revision moves.
        value(await host.addMindSweepItem({ requestId: requestId(), title: 'Fix sink' }));
        expect(value(host.getMindSweep({ state, draft: 'x', addFailed: true })).revision).not.toBe(revision);
    });

    it('adds the trimmed draft as an Inbox task under the request UUID, as mobile adds it', async () => {
        freezeClock();
        const direct = await open();
        await useTaskStore.getState().addTask('Fix the sink', { status: 'inbox' });
        const expected = useTaskStore.getState()._allTasks.map(({ id: _id, revBy: _revBy, ...task }) => task);
        expect(direct.log).toEqual([['addTask', 'Fix the sink', { status: 'inbox' }]]);

        const contract = await open();
        const id = requestId();
        expect(value(await contract.host.addMindSweepItem({ requestId: id, title: '  Fix the sink ' }))).toEqual({ id, title: 'Fix the sink' });
        expect(contract.log).toEqual([['addTask', 'Fix the sink', { status: 'inbox' }]]);
        expect(useTaskStore.getState()._allTasks.map(({ id: _id, revBy: _revBy, ...task }) => task)).toEqual(expected);
        expect(useTaskStore.getState()._tasksById.get(id)).toMatchObject({ title: 'Fix the sink', status: 'inbox' });
        // A replay after a restart (a new host, no receipt) finds the task and adds nothing.
        const tasks = useTaskStore.getState()._allTasks;
        const restarted = createNativeHostContract();
        value(await restarted.setLanguage({ storedLanguage: 'en', systemLocale: null }));
        value(await restarted.activate({ writeSafetyReady: true }));
        expect(value(await restarted.addMindSweepItem({ requestId: id, title: 'Fix the sink' }))).toEqual({ id, title: 'Fix the sink' });
        expect(useTaskStore.getState()._allTasks.filter((task) => task.title === 'Fix the sink')).toHaveLength(1);
        expect(useTaskStore.getState()._allTasks.map((task) => task.id)).toEqual(tasks.map((task) => task.id));
    });

    it('retries exactly after a failed save', async () => {
        freezeClock();
        const saveData = vi.fn().mockResolvedValue(undefined);
        const { host, log } = await open(saveData);
        const input = { requestId: requestId(), title: 'Call mom' };
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.addMindSweepItem(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
        expect(log).toEqual([['addTask', 'Call mom', { status: 'inbox' }]]);
        const landed = useTaskStore.getState()._allTasks;
        saveData.mockResolvedValue(undefined);
        const retried = await host.addMindSweepItem(input);
        expect(retried).toEqual({ ok: true, value: { id: input.requestId, title: 'Call mom' } });
        // The retry only saved: no second add, the same tasks, and storage holds the task.
        expect(log).toHaveLength(1);
        expect(useTaskStore.getState()._allTasks).toBe(landed);
        expect((saveData.mock.lastCall?.[0] as { tasks: { id: string }[] }).tasks.map((task) => task.id)).toEqual([input.requestId]);
        // A lost reply repeats the request: no write, no save.
        const saves = saveData.mock.calls.length;
        expect(await host.addMindSweepItem(input)).toEqual(retried);
        expect(saveData).toHaveBeenCalledTimes(saves);
        expect(await host.addMindSweepItem({ ...input, title: 'Call dad' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }, 20_000);

    it('refuses invalid input without writing', async () => {
        freezeClock();
        const { host, log } = await open();
        const invalid = { ok: false, error: { code: 'INVALID_INPUT' } };
        const read = (input: unknown) => expect(host.getMindSweep(input as never)).toMatchObject(invalid);
        read({ state: { scope: 'home' } });
        read({ state: { step: 6, scope: 'personal' } });
        read({ state: { step: -2 } });
        read({ state: { step: 1.5 } });
        read({ state: { captured: { nowhere: ['x'] } } });
        read({ state: { captured: { homeStuff: ['  '] } } });
        read({ state: { captured: { homeStuff: 'x' } } });
        read({ state: { extra: true } });
        read({ draft: 7 });
        read({ addFailed: 'yes' });
        read({ limit: 101 });
        read('x');
        // The summary is the step after the last cue list.
        expect(value(host.getMindSweep({ state: { scope: 'work', step: 4 } })).phase).toBe('summary');
        const add = async (input: unknown) => expect(await host.addMindSweepItem(input as never)).toMatchObject(invalid);
        await add({ requestId: requestId(), title: '   ' });
        await add({ requestId: requestId(), title: 7 });
        await add({ requestId: 'not-a-uuid', title: 'x' });
        await add({ requestId: requestId(), title: 'x'.repeat(10_001) });
        expect(log).toEqual([]);
        expect(useTaskStore.getState()._allTasks).toEqual([]);
    });

    it('is NOT_READY before native storage is activated', async () => {
        await flushPendingSave();
        resetForTests();
        setStorageAdapter({ getData: async () => ({ tasks: [], projects: [], sections: [], areas: [], settings: {} }), saveData: async () => undefined });
        const host = createNativeHostContract();
        expect(host.getMindSweep()).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.addMindSweepItem({ requestId: requestId(), title: 'x' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(useTaskStore.getState()._allTasks).toEqual([]);
    });
});
