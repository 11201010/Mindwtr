import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    createCoreBackend,
    createWriteRecorder,
    frozenObservation,
    loadProcessInboxFixture,
    observeProcessInbox,
    performProcessInboxAction,
    seedProcessInboxStore,
    type ProcessInboxScenario,
    type ReplayBackend,
    type ReplayView,
} from './process-inbox-model.replay';
import { createDateFormatter } from './date';
import { getTranslator, tFallback } from './i18n';
import { loadTranslations } from './i18n/i18n-loader';
import {
    createNativeHostContract,
    type NativeInboxProcessingResult,
    type NativeInboxProcessingView,
} from './native-host-contract';
import { buildProcessInboxStepView, INITIAL_PROCESS_INBOX_ANSWERS } from './process-inbox-model';
import { resolveProcessInboxPlan } from './process-inbox-plan';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { noopStorage } from './storage';
import { createTaskSimilarityIndex } from './task-similarity';
import { generateUUID } from './uuid';

const fixture = loadProcessInboxFixture();
const scenario = (name: string) => fixture.scenarios.find((entry) => entry.name.startsWith(name))!;
const CONTRACT_FIELDS = ['taskId', 'back', 'fileIt', 'progress', 'returning', 'draft'] as const;

/** The contract as a replay backend: every action is one host call. */
function createContractBackend(host: ReturnType<typeof createNativeHostContract>, toasts: unknown[]): ReplayBackend {
    const started = host.startInboxProcessing();
    if (!started.ok) throw new Error(started.error.message);
    let view: NativeInboxProcessingView | null = started.value.view;
    const sessionId = started.value.sessionId;
    const expectOk = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        return result.value;
    };
    const apply = (result: NativeInboxProcessingResult) => {
        if (result.notice) toasts.push([result.notice.tone, result.notice.title, result.notice.message, null]);
        if (result.toast) toasts.push(['info', null, result.toast.message, result.toast.undoLabel]);
        view = result.view;
    };
    const request = () => ({ sessionId: sessionId!, taskId: view!.taskId, step: view!.step });
    return {
        view: () => (view ? { ...view, progressLabel: view.progress.label } as ReplayView : null),
        async edit(edit) {
            view = expectOk(host.getInboxProcessingStep({ ...request(), edit }));
        },
        async choose(choice) {
            apply(expectOk(await host.commitInboxProcessingStep({ ...request(), decision: { choice }, requestId: generateUUID() })));
        },
        async skip() {
            apply(expectOk(await host.skipInboxProcessingTask({ sessionId: sessionId!, taskId: view!.taskId, requestId: generateUUID() })));
        },
        async submitProjectSearch() {
            await this.choose('submitProjectSearch');
        },
        async toggleMode() {
            view = expectOk(host.getInboxProcessingStep({ ...request(), mode: view!.mode === 'quick' ? 'guided' : 'quick' }));
        },
    };
}

describe('native host contract: Process Inbox', () => {
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

    // Revisions and quick dates read the clock.
    const freezeClock = () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(fixture.now));
    };

    const openHost = async (entry: ProcessInboxScenario, saveData?: (data: unknown) => Promise<void>) => {
        const recorder = createWriteRecorder();
        await seedProcessInboxStore(fixture, entry, recorder, { saveData });
        const host = createNativeHostContract();
        expect(await host.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
        return { host, recorder };
    };

    const replay = async (entry: ProcessInboxScenario, makeBackend: (toasts: unknown[]) => ReplayBackend, recorder: ReturnType<typeof createWriteRecorder>) => {
        const toasts: unknown[] = [];
        const backend = makeBackend(toasts);
        const observed = [observeProcessInbox(backend, recorder, toasts)];
        for (const action of entry.actions) {
            await performProcessInboxAction(backend, action, t);
            observed.push(observeProcessInbox(backend, recorder, toasts));
        }
        return observed;
    };

    it.each(fixture.scenarios.map((entry) => [entry.name, entry] as const))('replays "%s" like mobile, through core', async (_name, entry) => {
        freezeClock();
        const { host, recorder } = await openHost(entry);
        const contract = await replay(entry, (toasts) => createContractBackend(host, toasts), recorder);

        // The same steps, choices, drafts, writes and messages as core's functions called directly.
        const coreRecorder = createWriteRecorder();
        await seedProcessInboxStore(fixture, entry, coreRecorder);
        const core = await replay(entry, (toasts) => createCoreBackend({ t, toasts }), coreRecorder);
        expect(contract).toEqual(core.map((observation) => frozenObservation(observation, CONTRACT_FIELDS)));
        expect(contract).toEqual(fixture.observations[entry.name].map((observation) => frozenObservation(observation, CONTRACT_FIELDS)));
    });

    it('keeps the next item\'s dates after Start later, Next, Incubate and Waiting', async () => {
        freezeClock();
        const entry = scenario('the next item keeps its dates');
        const { host, recorder } = await openHost(entry);
        const contract = await replay(entry, (toasts) => createContractBackend(host, toasts), recorder);
        const opened = (taskId: string) => contract.find((observation) => observation.taskId === taskId)!;
        expect(opened('dated-1')).toMatchObject({ draft: { startTime: { date: '2026-10-01' }, dueDate: { date: '2026-10-10' }, reviewAt: { date: '2026-10-03' } } });
        expect(opened('dated-2')).toMatchObject({ draft: { startTime: { date: '2026-10-02' }, dueDate: { date: '2026-10-11' }, reviewAt: { date: '2026-10-04' } } });
        expect(opened('dated-3')).toMatchObject({ draft: { startTime: { date: '2026-10-06' }, dueDate: { date: '2026-10-12' }, reviewAt: { date: '2026-10-07' } } });
        expect(opened('dated-4')).toMatchObject({ draft: { startTime: { date: '2026-10-08' }, dueDate: { date: '2026-10-13' }, reviewAt: { date: '2026-10-09' } } });
        expect((contract.at(-1)!.writes[0] as unknown[])[2]).toMatchObject({ startTime: '2026-10-08', dueDate: '2026-10-13', reviewAt: '2026-10-09' });
    });

    it('builds the step view with core\'s view function and formats dates through the host formatter', async () => {
        freezeClock();
        const entry = scenario('start later');
        const { host } = await openHost(entry);
        const started = host.startInboxProcessing({ mode: 'guided' });
        expect(started).toMatchObject({ ok: true, value: { queue: { total: 3, taskIds: ['inbox-a', 'inbox-c', 'inbox-b'] } } });
        if (!started.ok || !started.value.view) return;
        const { version, revision, sessionId, taskId, progress, draft, ...view } = started.value.view;
        expect({ version, sessionId, taskId, progress }).toEqual({
            version: 1, sessionId: started.value.sessionId, taskId: 'inbox-a', progress: { processed: 0, total: 3, label: '0/3 tasks' },
        });
        expect(revision).toEqual(expect.any(String));
        const state = useTaskStore.getState();
        const task = state._tasksById.get('inbox-a')!;
        const formatDate = createDateFormatter({ language: 'en', dateFormat: state.settings.dateFormat, calendarSystem: state.settings.calendarSystem, timeFormat: state.settings.timeFormat, systemLocale: null });
        expect(view).toEqual(buildProcessInboxStepView({
            task, draft, answers: INITIAL_PROCESS_INBOX_ANSWERS, mode: 'guided', plan: resolveProcessInboxPlan(state.settings),
            settings: state.settings, tasks: state.tasks, projects: state.projects, areas: state.areas, people: state.people,
            similarityIndex: createTaskSimilarityIndex(state._allTasks), t: getTranslator('en'), formatDate, now: new Date(),
        }));

        const sessionIdValue = started.value.sessionId!;
        const later = await host.commitInboxProcessingStep({
            sessionId: sessionIdValue, taskId: 'inbox-a', step: 'actionable', decision: { choice: 'later' }, requestId: generateUUID(),
        });
        expect(later).toMatchObject({ ok: true, value: { notice: null, toast: null, view: { step: 'later', dateRow: { field: 'startTime', display: 'Not set' } } } });
        const picked = host.getInboxProcessingStep({
            sessionId: sessionIdValue, taskId: 'inbox-a', step: 'later', edit: { type: 'setDate', field: 'startTime', value: '2026-10-05' },
        });
        expect(picked).toMatchObject({ ok: true, value: { dateRow: { date: '2026-10-05', display: formatDate('2026-10-05', 'P') } } });
        // The notice for a missing date is a result, not an error.
        const cleared = host.getInboxProcessingStep({
            sessionId: sessionIdValue, taskId: 'inbox-a', step: 'later', edit: { type: 'setDate', field: 'startTime', value: null },
        });
        expect(cleared.ok).toBe(true);
        expect(await host.commitInboxProcessingStep({
            sessionId: sessionIdValue, taskId: 'inbox-a', step: 'later', decision: { choice: 'fileIt' }, requestId: generateUUID(),
        })).toMatchObject({ ok: true, value: {
            notice: { tone: 'warning', message: tFallback(t, 'process.laterStartRequired', 'Choose a start date for Later.') },
            toast: null,
            view: { taskId: 'inbox-a', step: 'later' },
        } });
    });

    it('retries a failed save exactly: one write, then the same next step', async () => {
        freezeClock();
        const saveData = vi.fn().mockResolvedValue(undefined);
        const entry = scenario('guided next action');
        const { host, recorder } = await openHost(entry, saveData);
        const started = host.startInboxProcessing();
        if (!started.ok || !started.value.view) throw new Error('No session');
        const sessionId = started.value.sessionId!;
        for (const [step, choice] of [['actionable', 'actionable'], ['twoMinute', 'no'], ['execution', 'defer'], ['oneAction', 'single']] as const) {
            expect(await host.commitInboxProcessingStep({ sessionId, taskId: 'inbox-a', step, decision: { choice }, requestId: generateUUID() }))
                .toMatchObject({ ok: true });
        }
        recorder.log.length = 0;
        const input = { sessionId, taskId: 'inbox-a', step: 'file', decision: { choice: 'fileIt' }, requestId: generateUUID() };
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.commitInboxProcessingStep(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } });
        const written = useTaskStore.getState()._tasksById.get('inbox-a');
        expect(written).toMatchObject({ status: 'next' });
        expect(recorder.log).toHaveLength(1);

        saveData.mockResolvedValue(undefined);
        const retried = await host.commitInboxProcessingStep(input);
        expect(retried).toMatchObject({ ok: true, value: {
            notice: null,
            toast: { message: 'Call Alice about the launch moved to Next', undoLabel: 'Undo' },
            view: { taskId: 'inbox-c', step: 'actionable', progress: { label: '1/2 tasks' } },
        } });
        expect(recorder.log).toHaveLength(1);
        expect(useTaskStore.getState()._tasksById.get('inbox-a')).toBe(written);
        expect((saveData.mock.lastCall?.[0] as { tasks: Array<{ id: string; status: string }> }).tasks.find(({ id }) => id === 'inbox-a')?.status).toBe('next');
        // A lost reply repeats the request once more: still no write.
        const saves = saveData.mock.calls.length;
        expect(await host.commitInboxProcessingStep(input)).toEqual(retried);
        expect(recorder.log).toHaveLength(1);
        expect(saveData).toHaveBeenCalledTimes(saves);
        expect(await host.commitInboxProcessingStep({ ...input, decision: { choice: 'back' } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('retries the last decision after a failed save, then reports the queue done', async () => {
        freezeClock();
        const saveData = vi.fn().mockResolvedValue(undefined);
        const { host, recorder } = await openHost(scenario('skipping the last item'), saveData);
        const started = host.startInboxProcessing();
        if (!started.ok || !started.value.view) throw new Error('No session');
        const input = {
            sessionId: started.value.sessionId!, taskId: 'inbox-c', step: 'actionable', decision: { choice: 'trash' }, requestId: generateUUID(),
        };
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await host.commitInboxProcessingStep(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        saveData.mockResolvedValue(undefined);
        expect(await host.commitInboxProcessingStep(input)).toEqual({ ok: true, value: {
            view: null, notice: null, toast: { message: 'Plan trip moved to Trash', undoLabel: 'Undo' },
        } });
        expect(recorder.log).toEqual([['deleteTask', 'inbox-c']]);
        expect(host.getInboxProcessingStep({ sessionId: input.sessionId, taskId: 'inbox-c', step: 'actionable' }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });

    it('keeps a write that waits for its save through twenty later requests and four new sessions', async () => {
        freezeClock();
        const saveData = vi.fn().mockResolvedValue(undefined);
        const { host, recorder } = await openHost(scenario('project search'), saveData);
        const started = host.startInboxProcessing();
        if (!started.ok || !started.value.view) throw new Error('No session');
        const sessionId = started.value.sessionId!;
        const commit = (step: string, choice: string, requestId = generateUUID()) => host.commitInboxProcessingStep({
            sessionId, taskId: 'inbox-a', step, decision: { choice }, requestId,
        });
        for (const [step, choice] of [['actionable', 'actionable'], ['twoMinute', 'no'], ['execution', 'defer'], ['oneAction', 'single']]) {
            expect(await commit(step, choice)).toMatchObject({ ok: true });
        }
        expect(host.getInboxProcessingStep({ sessionId, taskId: 'inbox-a', step: 'file', edit: { type: 'set', field: 'projectSearch', value: 'Garden' } }))
            .toMatchObject({ ok: true });
        const owed = generateUUID();
        saveData.mockRejectedValue(new Error('disk unavailable'));
        expect(await commit('file', 'submitProjectSearch', owed)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        for (let cycle = 0; cycle < 10; cycle += 1) {
            expect(await commit('file', 'back')).toMatchObject({ ok: true, value: { view: { step: 'oneAction' } } });
            expect(await commit('oneAction', 'single')).toMatchObject({ ok: true, value: { view: { step: 'file' } } });
        }
        for (let index = 0; index < 4; index += 1) expect(host.startInboxProcessing()).toMatchObject({ ok: true });

        saveData.mockClear();
        saveData.mockResolvedValue(undefined);
        const retried = await commit('file', 'submitProjectSearch', owed);
        expect(retried).toMatchObject({ ok: true, value: { view: { step: 'file', draft: { projectSearch: '' } } } });
        expect(saveData).toHaveBeenCalledTimes(1);
        expect(useTaskStore.getState().persistenceFailure).toBeNull();
        expect(recorder.log.filter(([action]) => action === 'addProject')).toEqual([['addProject', 'Garden', '#94a3b8', '<undefined>']]);
        if (retried.ok) {
            const garden = useTaskStore.getState().projects.find((project) => project.title === 'Garden');
            expect(retried.value.view?.draft.projectId).toBe(garden?.id);
        }
    }, 30_000);

    it('refuses a fifth session while four sessions each wait for a save, and frees them once one saves', async () => {
        freezeClock();
        const saveData = vi.fn().mockResolvedValue(undefined);
        const { host } = await openHost(scenario('project search'), saveData);
        saveData.mockRejectedValue(new Error('disk unavailable'));
        const owed: Array<() => ReturnType<typeof host.commitInboxProcessingStep>> = [];
        for (let index = 0; index < 4; index += 1) {
            const started = host.startInboxProcessing();
            if (!started.ok || !started.value.view) throw new Error('No session');
            const sessionId = started.value.sessionId!;
            const request = { sessionId, taskId: 'inbox-a', step: 'actionable', decision: { choice: 'trash' }, requestId: generateUUID() };
            owed.push(() => host.commitInboxProcessingStep(request));
            expect(await owed[index]()).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
            // The item is gone from the queue; restore it so the next session opens it.
            expect((await useTaskStore.getState().restoreTask('inbox-a')).success).toBe(true);
        }
        expect(host.startInboxProcessing()).toMatchObject({ ok: false, error: { code: 'ACTION_FAILED' } });
        saveData.mockResolvedValue(undefined);
        expect(await owed[0]()).toMatchObject({ ok: true });
        expect(host.startInboxProcessing()).toMatchObject({ ok: true });
    }, 60_000);

    it('refuses a session whose item changed elsewhere, a stale step, and an ended session', async () => {
        freezeClock();
        const { host } = await openHost(scenario('guided next action'));
        const started = host.startInboxProcessing();
        if (!started.ok || !started.value.view) throw new Error('No session');
        const sessionId = started.value.sessionId!;
        const base = { sessionId, taskId: 'inbox-a' };
        expect(host.getInboxProcessingStep({ ...base, step: 'twoMinute' })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.getInboxProcessingStep({ ...base, step: 'actionable', edit: { type: 'setPriority', value: 'someday' as never } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.commitInboxProcessingStep({ ...base, step: 'actionable', decision: { choice: 'fileIt' }, requestId: generateUUID() }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

        expect((await useTaskStore.getState().updateTask('inbox-a', { title: 'Edited on another device' })).success).toBe(true);
        expect(host.getInboxProcessingStep({ ...base, step: 'actionable' })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        const before = useTaskStore.getState()._tasksById.get('inbox-a');
        expect(await host.commitInboxProcessingStep({ ...base, step: 'actionable', decision: { choice: 'trash' }, requestId: generateUUID() }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await host.skipInboxProcessingTask({ ...base, requestId: generateUUID() }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(useTaskStore.getState()._tasksById.get('inbox-a')).toBe(before);

        const restarted = host.startInboxProcessing();
        expect(restarted).toMatchObject({ ok: true, value: { view: { taskId: 'inbox-a', capture: { title: 'Edited on another device' } } } });
        expect(host.endInboxProcessing({ sessionId })).toEqual({ ok: true, value: null });
        expect(host.getInboxProcessingStep({ ...base, step: 'actionable' })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        // The four most recent sessions stay open.
        const ids = Array.from({ length: 4 }, () => {
            const next = host.startInboxProcessing();
            return next.ok ? next.value.sessionId! : '';
        });
        if (!restarted.ok) return;
        expect(host.getInboxProcessingStep({ sessionId: restarted.value.sessionId!, taskId: 'inbox-a', step: 'actionable' }))
            .toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(host.getInboxProcessingStep({ sessionId: ids[0], taskId: 'inbox-a', step: 'actionable' })).toMatchObject({ ok: true });
    });

    it('returns no session for an empty Inbox', async () => {
        freezeClock();
        const { host } = await openHost({ name: 'empty', settings: 'base', taskIds: [], actions: [] });
        expect(host.startInboxProcessing()).toEqual({ ok: true, value: { sessionId: null, queue: { total: 0, taskIds: [] }, view: null } });
        expect(host.startInboxProcessing({ mode: 'fast' as never })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('is NOT_READY until storage is activated', async () => {
        setStorageAdapter(noopStorage);
        const host = createNativeHostContract();
        const input = { sessionId: 's', taskId: 't', step: 'actionable', requestId: generateUUID() };
        expect(host.startInboxProcessing()).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(host.getInboxProcessingStep(input)).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.commitInboxProcessingStep({ ...input, decision: { choice: 'actionable' } })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(await host.skipInboxProcessingTask(input)).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        expect(host.endInboxProcessing({ sessionId: 's' })).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    });
});
