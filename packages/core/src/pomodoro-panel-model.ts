/**
 * The Focus screen's Pomodoro card as data, as React Native draws it (apps/mobile/components/pomodoro-panel.tsx):
 * the folded row or the full card, every word, which controls are off while the session loads, and the action each
 * control sends. The native host contract draws it (native-host-contract-pomodoro.ts); RN's parity test compares
 * RN's card with it. RN's card is shown only while the Pomodoro feature is on.
 */
import { tFallback } from './i18n';
import type { MobilePomodoroControllerState } from './pomodoro-controller';
import { formatPomodoroClock, getPomodoroFocusSessionsCompletedToday, getPomodoroPresetOptions } from './pomodoro';
import type { AppSettings, Task } from './types';

type Translate = (key: string) => string;

/** A control's action, as runPomodoroAction takes it: each is the state it asks for, so a replay changes nothing more. */
export type PomodoroPanelAction =
    | { type: 'run'; value: boolean }
    | { type: 'reset' }
    | { type: 'phase'; value: 'focus' | 'break' }
    | { type: 'preset'; focusMinutes: number; breakMinutes: number }
    | { type: 'selectTask'; taskId: string | null }
    | { type: 'collapse'; value: boolean }
    | { type: 'markDone'; taskId: string };

export type PomodoroPanelModel = {
    /** The card folded down to its time row (RN's `@mindwtr_pomodoro_collapsed`). */
    collapsed: boolean;
    /** The fold button: its spoken label and the action it sends. */
    collapseToggle: { label: string; action: PomodoroPanelAction };
    title: string;
    phase: 'focus' | 'break';
    phaseLabel: string;
    running: boolean;
    clock: string;
    /** The folded row's status: the phase, then Running or Paused. */
    status: string;
    /** RN's loading row while the stored session loads; every control is off then. */
    loading: string | null;
    presets: { id: string; label: string; active: boolean; action: PomodoroPanelAction }[];
    sessions: string;
    /** The linked task's row, while Link task is on in Settings › GTD › Pomodoro. */
    link: {
        label: string;
        value: string;
        changeLabel: string;
        markDone: { label: string; accessibilityLabel: string; action: PomodoroPanelAction } | null;
    } | null;
    primary: { label: string; action: PomodoroPanelAction };
    reset: { label: string; action: PomodoroPanelAction };
    switchPhase: { label: string; action: PomodoroPanelAction };
    /** The finished phase's line, until the next start, reset, switch or Task done. */
    event: string | null;
    /** The task picker's words; its rows come with getPomodoroTaskPicker. */
    picker: { title: string; timerOnly: { label: string; selected: boolean; action: PomodoroPanelAction }; empty: string };
};

export type PomodoroPanelInput = {
    session: MobilePomodoroControllerState;
    settings: AppSettings;
    /** The store's visible tasks (RN's `useTaskStore().tasks`): the linked task is found among them. */
    tasks: readonly Task[];
    collapsed: boolean;
    t: Translate;
};

/** The task the timer is linked to, as RN's card finds it: only while Link task is on, and only a visible task. */
export const getPomodoroLinkedTask = (session: MobilePomodoroControllerState, settings: AppSettings, tasks: readonly Task[]): Task | undefined => (
    settings.gtd?.pomodoro?.linkTask === true && session.selectedTaskId ? tasks.find((task) => task.id === session.selectedTaskId) : undefined
);

/**
 * RN's card clears a linked task that is no longer a visible task (deleted, or gone after a sync) while Link task is on.
 */
export const isPomodoroLinkedTaskGone = (session: MobilePomodoroControllerState, settings: AppSettings, tasks: readonly Task[]): boolean => (
    settings.gtd?.pomodoro?.linkTask === true && !!session.selectedTaskId && !tasks.some((task) => task.id === session.selectedTaskId)
);

export function buildPomodoroPanelModel(input: PomodoroPanelInput): PomodoroPanelModel {
    const { session, settings, t } = input;
    const { durations, timerState, lastEvent, sessionHistory } = session;
    const linkTaskEnabled = settings.gtd?.pomodoro?.linkTask === true;
    const selectedTask = getPomodoroLinkedTask(session, settings, input.tasks);
    const phaseLabel = timerState.phase === 'focus'
        ? tFallback(t, 'pomodoro.phaseFocusShort', 'Focus')
        : tFallback(t, 'pomodoro.phaseBreakShort', 'Break');
    const runningLabel = tFallback(t, 'pomodoro.running', 'Running');
    const pausedLabel = tFallback(t, 'pomodoro.paused', 'Paused');
    const selectedTaskLabel = tFallback(t, 'pomodoro.selectedTask', 'Timer task');
    const timerOnlyLabel = tFallback(t, 'pomodoro.timerOnly', 'Timer only');
    return {
        collapsed: input.collapsed,
        collapseToggle: {
            label: input.collapsed ? tFallback(t, 'pomodoro.expand', 'Expand timer') : tFallback(t, 'pomodoro.collapse', 'Collapse timer'),
            action: { type: 'collapse', value: !input.collapsed },
        },
        title: tFallback(t, 'pomodoro.mobileTitle', 'Pomodoro Timer'),
        phase: timerState.phase,
        phaseLabel,
        running: timerState.isRunning,
        clock: formatPomodoroClock(timerState.remainingSeconds),
        status: `${phaseLabel} · ${timerState.isRunning ? runningLabel : pausedLabel}`,
        loading: session.isHydrating ? tFallback(t, 'common.loading', 'Loading...') : null,
        presets: getPomodoroPresetOptions(settings.gtd?.pomodoro?.customDurations).map((preset) => ({
            id: preset.id,
            label: preset.label,
            active: durations.focusMinutes === preset.focusMinutes && durations.breakMinutes === preset.breakMinutes,
            action: { type: 'preset', focusMinutes: preset.focusMinutes, breakMinutes: preset.breakMinutes },
        })),
        sessions: `${tFallback(t, 'pomodoro.sessionsDone', 'Focus sessions completed')}: ${getPomodoroFocusSessionsCompletedToday(sessionHistory)}`,
        link: linkTaskEnabled ? {
            label: selectedTaskLabel,
            value: selectedTask?.title ?? timerOnlyLabel,
            changeLabel: selectedTask ? tFallback(t, 'common.change', 'Change') : tFallback(t, 'pomodoro.linkTask', 'Link task'),
            markDone: selectedTask ? {
                label: tFallback(t, 'pomodoro.taskDoneShort', 'Task done'),
                accessibilityLabel: tFallback(t, 'pomodoro.markTaskDone', 'Mark task done'),
                action: { type: 'markDone', taskId: selectedTask.id },
            } : null,
        } : null,
        primary: {
            label: timerState.isRunning ? tFallback(t, 'common.pause', 'Pause') : tFallback(t, 'common.start', 'Start'),
            action: { type: 'run', value: !timerState.isRunning },
        },
        reset: { label: tFallback(t, 'common.reset', 'Reset'), action: { type: 'reset' } },
        switchPhase: {
            label: timerState.phase === 'focus'
                ? tFallback(t, 'pomodoro.switchToBreak', 'Switch to Break')
                : tFallback(t, 'pomodoro.switchToFocus', 'Switch to Focus'),
            action: { type: 'phase', value: timerState.phase === 'focus' ? 'break' : 'focus' },
        },
        event: lastEvent
            ? lastEvent === 'focus-finished'
                ? tFallback(t, 'pomodoro.focusComplete', 'Focus session complete. Take a short break.')
                : tFallback(t, 'pomodoro.breakComplete', 'Break complete. Ready for the next focus session.')
            : null,
        picker: {
            title: selectedTaskLabel,
            timerOnly: { label: timerOnlyLabel, selected: !session.selectedTaskId, action: { type: 'selectTask', taskId: null } },
            empty: tFallback(t, 'pomodoro.noTask', 'No available focus task'),
        },
    };
}

/**
 * The picker's tasks, as RN's Focus screen passes them to the card: Today's Focus, Today, Next actions and Review due,
 * once each, in that order, without deleted ones.
 */
export function getPomodoroPickerTasks(lists: { focusedTasks: readonly Task[]; schedule: readonly Task[]; nextActions: readonly Task[]; reviewDue: readonly Task[] }): Task[] {
    const byId = new Map<string, Task>();
    [...lists.focusedTasks, ...lists.schedule, ...lists.nextActions, ...lists.reviewDue].forEach((task) => {
        if (task.deletedAt) return;
        byId.set(task.id, task);
    });
    return Array.from(byId.values());
}
