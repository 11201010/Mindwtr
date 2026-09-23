import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    createCoreBackend,
    createWriteRecorder,
    frozenObservation,
    loadProcessInboxFixture,
    observeProcessInbox,
    performProcessInboxAction,
    seedProcessInboxStore,
} from './process-inbox-model.replay';
import { loadTranslations } from './i18n/i18n-loader';
import {
    addProcessInboxToken,
    backProcessInboxStep,
    formatProcessInboxScheduleValue,
    INITIAL_PROCESS_INBOX_ANSWERS,
    resolveProcessInboxStep,
    type ProcessInboxAnswers,
} from './process-inbox-model';
import { resolveProcessInboxPlan } from './process-inbox-plan';
import { resetForTests } from './store';

const fixture = loadProcessInboxFixture();

describe('Process Inbox model parity with the mobile modal', () => {
    const originalTz = process.env.TZ;
    let t: (key: string) => string = (key) => key;
    beforeAll(async () => {
        process.env.TZ = fixture.timeZone;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(fixture.now));
        const english = await loadTranslations('en');
        t = (key) => english[key] ?? key;
    });
    afterAll(() => {
        vi.useRealTimers();
        resetForTests();
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });

    it.each(fixture.scenarios.map((scenario) => [scenario.name, scenario] as const))('replays "%s" exactly', async (_name, scenario) => {
        const recorder = createWriteRecorder();
        const toasts: unknown[] = [];
        await seedProcessInboxStore(fixture, scenario, recorder);
        const backend = createCoreBackend({ t, toasts });
        const observed = [observeProcessInbox(backend, recorder, toasts)];
        for (const action of scenario.actions) {
            await performProcessInboxAction(backend, action, t);
            observed.push(observeProcessInbox(backend, recorder, toasts));
        }
        expect(observed).toEqual(fixture.observations[scenario.name].map((observation) => frozenObservation(observation)));
    });

    // Mobile used to clear these after the next item had opened, so filing that item erased them.
    it('records the next item keeping its dates after Start later, Next, Incubate and Waiting', () => {
        const observations = fixture.observations['the next item keeps its dates after Start later, Next, Incubate and Waiting'];
        const dates = (taskId: string) => {
            const { draft } = observations.find((observation) => observation.taskId === taskId) as { draft: Record<string, { date: string } | null> };
            return [draft.startTime?.date, draft.dueDate?.date, draft.reviewAt?.date];
        };
        expect(dates('dated-1')).toEqual(['2026-10-01', '2026-10-10', '2026-10-03']);
        expect(dates('dated-2')).toEqual(['2026-10-02', '2026-10-11', '2026-10-04']);
        expect(dates('dated-3')).toEqual(['2026-10-06', '2026-10-12', '2026-10-07']);
        expect(dates('dated-4')).toEqual(['2026-10-08', '2026-10-13', '2026-10-09']);
        const startLater = fixture.observations['start later needs a date; date-only and default time'];
        expect((startLater.at(-1)!.writes[0] as unknown[])[2]).toMatchObject({ startTime: '2026-09-25T09:00', dueDate: '2026-09-30' });
    });
});

describe('Process Inbox steps', () => {
    const plan = (inboxProcessing: Record<string, unknown>, hidden?: string[]) => resolveProcessInboxPlan({
        gtd: { inboxProcessing, ...(hidden ? { taskEditor: { hidden: hidden as never } } : {}) },
    });
    const answers = (overrides: Partial<ProcessInboxAnswers>): ProcessInboxAnswers => ({ ...INITIAL_PROCESS_INBOX_ANSWERS, ...overrides });

    it('orders the guided questions by the two-minute settings and the project field', () => {
        const base = plan({});
        const first = plan({ twoMinuteFirst: true });
        const noTwoMinute = plan({ twoMinuteEnabled: false }, ['project']);
        expect(resolveProcessInboxStep(answers({}), 'guided', base)).toBe('actionable');
        expect(resolveProcessInboxStep(answers({ actionability: 'actionable' }), 'guided', base)).toBe('twoMinute');
        expect(resolveProcessInboxStep(answers({}), 'guided', first)).toBe('twoMinute');
        expect(resolveProcessInboxStep(answers({ twoMinute: 'no' }), 'guided', first)).toBe('actionable');
        expect(resolveProcessInboxStep(answers({ actionability: 'actionable' }), 'guided', noTwoMinute)).toBe('execution');
        expect(resolveProcessInboxStep(answers({ actionability: 'actionable', execution: 'defer' }), 'guided', noTwoMinute)).toBe('file');
        expect(resolveProcessInboxStep(answers({ actionability: 'actionable', twoMinute: 'no', execution: 'defer' }), 'guided', base)).toBe('oneAction');
        expect(resolveProcessInboxStep(answers({ actionability: 'actionable', twoMinute: 'no', execution: 'delegate' }), 'quick', base)).toBe('waiting');
        expect(resolveProcessInboxStep(answers({ actionability: 'incubate' }), 'quick', base)).toBe('incubate');
    });

    it('steps back one question and drops a project split only from the file step', () => {
        const base = plan({});
        const file = answers({ actionability: 'actionable', twoMinute: 'no', execution: 'defer', oneActionAnswered: true });
        expect(backProcessInboxStep(file, 'guided', base)).toEqual({ answers: { ...file, oneActionAnswered: false }, cancelProjectConversion: true });
        // Quick mode returns to its entry screen and keeps a started split, as mobile does.
        expect(backProcessInboxStep(file, 'quick', base)).toEqual({ answers: INITIAL_PROCESS_INBOX_ANSWERS, cancelProjectConversion: false });
    });

    it('keeps only the calendar day of a picked date, then adds the default time unless date-only', () => {
        expect(formatProcessInboxScheduleValue('2026-10-05', false, '09:00')).toBe('2026-10-05T09:00');
        expect(formatProcessInboxScheduleValue(new Date(2026, 9, 5, 15, 45), true, '09:00')).toBe('2026-10-05');
        expect(formatProcessInboxScheduleValue('2026-10-05', false, '')).toBe('2026-10-05');
    });

    it('files an unprefixed token by the section that asked for it', () => {
        const visible = { contexts: true, tags: true };
        expect(addProcessInboxToken({ tokenInput: ' focus ', kind: 'tag', visible, contexts: [], tags: [] })).toEqual({ contexts: [], tags: ['#focus'] });
        expect(addProcessInboxToken({ tokenInput: 'desk', visible, contexts: ['@desk'], tags: [] })).toEqual({ contexts: ['@desk'], tags: [] });
        expect(addProcessInboxToken({ tokenInput: '   ', visible, contexts: [], tags: [] })).toBeNull();
    });
});
