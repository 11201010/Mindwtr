import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createPomodoroState,
    DEFAULT_POMODORO_DURATIONS,
    formatPomodoroClock,
    POMODORO_PRESETS,
    PomodoroDurations,
    PomodoroState,
    resetPomodoroState,
    Task,
    tickPomodoroState,
    useTaskStore,
} from '@mindwtr/core';
import { Play, Pause, RotateCcw, TimerReset, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../contexts/language-context';

interface PomodoroPanelProps {
    tasks: Task[];
}

type PomodoroEvent = 'focus-finished' | 'break-finished' | null;

type PomodoroSnapshot = {
    durations: PomodoroDurations;
    timerState: PomodoroState;
    selectedTaskId?: string;
    lastEvent: PomodoroEvent;
    updatedAtMs: number;
};

const createInitialSnapshot = (): PomodoroSnapshot => ({
    durations: DEFAULT_POMODORO_DURATIONS,
    timerState: createPomodoroState(DEFAULT_POMODORO_DURATIONS),
    selectedTaskId: undefined,
    lastEvent: null,
    updatedAtMs: Date.now(),
});

const advancePomodoro = (
    timerState: PomodoroState,
    durations: PomodoroDurations,
    elapsedSeconds: number
): { timerState: PomodoroState; lastEvent: PomodoroEvent } => {
    let nextState = timerState;
    let lastEvent: PomodoroEvent = null;
    for (let i = 0; i < elapsedSeconds; i += 1) {
        const next = tickPomodoroState(nextState, durations);
        nextState = next.state;
        if (next.switchedPhase) {
            lastEvent = next.completedFocusSession ? 'focus-finished' : 'break-finished';
        }
    }
    return { timerState: nextState, lastEvent };
};

const reconcileSnapshot = (snapshot: PomodoroSnapshot, nowMs: number): PomodoroSnapshot => {
    if (!snapshot.timerState.isRunning) {
        return { ...snapshot, updatedAtMs: nowMs };
    }
    const elapsedSeconds = Math.floor((nowMs - snapshot.updatedAtMs) / 1000);
    if (elapsedSeconds <= 0) return snapshot;
    const advanced = advancePomodoro(snapshot.timerState, snapshot.durations, elapsedSeconds);
    const updatedAtMs = snapshot.updatedAtMs + elapsedSeconds * 1000;
    return {
        ...snapshot,
        timerState: advanced.timerState,
        lastEvent: advanced.lastEvent ?? snapshot.lastEvent,
        updatedAtMs,
    };
};

let persistedSnapshot: PomodoroSnapshot = createInitialSnapshot();

export function PomodoroPanel({ tasks }: PomodoroPanelProps) {
    const updateTask = useTaskStore((state) => state.updateTask);
    const { t } = useLanguage();
    const resolveText = useCallback((key: string, fallback: string) => {
        const value = t(key);
        return value === key ? fallback : value;
    }, [t]);
    const [snapshot, setSnapshot] = useState<PomodoroSnapshot>(() => {
        persistedSnapshot = reconcileSnapshot(persistedSnapshot, Date.now());
        return persistedSnapshot;
    });

    const commitSnapshot = useCallback((updater: (prev: PomodoroSnapshot) => PomodoroSnapshot) => {
        setSnapshot((prev) => {
            const next = updater(prev);
            persistedSnapshot = next;
            return next;
        });
    }, []);

    useEffect(() => {
        if (tasks.length === 0) {
            if (!snapshot.selectedTaskId) return;
            commitSnapshot((prev) => ({ ...prev, selectedTaskId: undefined }));
            return;
        }
        if (snapshot.selectedTaskId && tasks.some((task) => task.id === snapshot.selectedTaskId)) return;
        commitSnapshot((prev) => ({ ...prev, selectedTaskId: tasks[0].id }));
    }, [commitSnapshot, snapshot.selectedTaskId, tasks]);

    useEffect(() => {
        if (!snapshot.timerState.isRunning) return;
        const intervalId = window.setInterval(() => {
            commitSnapshot((prev) => reconcileSnapshot(prev, Date.now()));
        }, 1000);
        return () => window.clearInterval(intervalId);
    }, [commitSnapshot, snapshot.timerState.isRunning]);

    const durations = snapshot.durations;
    const timerState = snapshot.timerState;
    const selectedTaskId = snapshot.selectedTaskId;
    const lastEvent = snapshot.lastEvent;

    const selectedTask = useMemo(
        () => (selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) : undefined),
        [selectedTaskId, tasks]
    );

    const phaseLabelRaw = timerState.phase === 'focus' ? t('pomodoro.phaseFocus') : t('pomodoro.phaseBreak');
    const phaseLabel = phaseLabelRaw.startsWith('pomodoro.') ? (timerState.phase === 'focus' ? 'Focus session' : 'Break') : phaseLabelRaw;
    const cardTitleRaw = t('pomodoro.title');
    const cardTitle = cardTitleRaw.startsWith('pomodoro.') ? 'Pomodoro Focus' : cardTitleRaw;
    const subtitleRaw = t('pomodoro.subtitle');
    const subtitle = subtitleRaw.startsWith('pomodoro.') ? 'Work one task at a time.' : subtitleRaw;
    const sessionCountRaw = t('pomodoro.sessionsDone');
    const sessionCountLabel = sessionCountRaw.startsWith('pomodoro.') ? 'Focus sessions completed' : sessionCountRaw;
    const switchPhaseRaw = t('pomodoro.switchPhase');
    const switchPhaseLabel = switchPhaseRaw.startsWith('pomodoro.') ? 'Switch phase' : switchPhaseRaw;
    const markDoneRaw = t('pomodoro.markTaskDone');
    const markDoneLabel = markDoneRaw.startsWith('pomodoro.') ? 'Mark done' : markDoneRaw;
    const noTaskRaw = t('pomodoro.noTask');
    const noTaskLabel = noTaskRaw.startsWith('pomodoro.') ? 'No available focus task' : noTaskRaw;
    const focusDoneRaw = t('pomodoro.focusComplete');
    const focusDoneLabel = focusDoneRaw.startsWith('pomodoro.') ? 'Focus session complete. Take a short break.' : focusDoneRaw;
    const breakDoneRaw = t('pomodoro.breakComplete');
    const breakDoneLabel = breakDoneRaw.startsWith('pomodoro.') ? 'Break complete. Ready for the next focus session.' : breakDoneRaw;

    const handleApplyPreset = (focusMinutes: number, breakMinutes: number) => {
        const nextDurations = { focusMinutes, breakMinutes };
        commitSnapshot((prev) => {
            const reconciled = reconcileSnapshot(prev, Date.now());
            return {
                ...reconciled,
                durations: nextDurations,
                timerState: resetPomodoroState(reconciled.timerState, nextDurations, reconciled.timerState.phase),
                lastEvent: null,
                updatedAtMs: Date.now(),
            };
        });
    };

    const handleToggleRun = () => {
        commitSnapshot((prev) => {
            const reconciled = reconcileSnapshot(prev, Date.now());
            return {
                ...reconciled,
                timerState: { ...reconciled.timerState, isRunning: !reconciled.timerState.isRunning },
                updatedAtMs: Date.now(),
            };
        });
    };

    const handleReset = () => {
        commitSnapshot((prev) => {
            const reconciled = reconcileSnapshot(prev, Date.now());
            return {
                ...reconciled,
                timerState: resetPomodoroState(reconciled.timerState, reconciled.durations, reconciled.timerState.phase),
                lastEvent: null,
                updatedAtMs: Date.now(),
            };
        });
    };

    const handleSwitchPhase = () => {
        commitSnapshot((prev) => {
            const reconciled = reconcileSnapshot(prev, Date.now());
            return {
                ...reconciled,
                timerState: resetPomodoroState(
                    reconciled.timerState,
                    reconciled.durations,
                    reconciled.timerState.phase === 'focus' ? 'break' : 'focus'
                ),
                lastEvent: null,
                updatedAtMs: Date.now(),
            };
        });
    };

    const handleMarkTaskDone = async () => {
        if (!selectedTask) return;
        await updateTask(selectedTask.id, { status: 'done', isFocusedToday: false });
        commitSnapshot((prev) => ({ ...prev, lastEvent: null }));
    };

    return (
        <section className="bg-card border border-border rounded-xl p-4 space-y-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="font-semibold text-lg">{cardTitle}</h3>
                    <p className="text-xs text-muted-foreground">{subtitle}</p>
                </div>
                <span
                    className={cn(
                        'text-xs px-2 py-1 rounded-full border font-medium',
                        timerState.phase === 'focus'
                            ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-700/40'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700/40'
                    )}
                >
                    {phaseLabel}
                </span>
            </header>

            <div className="flex flex-wrap gap-2">
                {POMODORO_PRESETS.map((preset) => {
                    const active = durations.focusMinutes === preset.focusMinutes && durations.breakMinutes === preset.breakMinutes;
                    return (
                        <button
                            key={preset.id}
                            type="button"
                            onClick={() => handleApplyPreset(preset.focusMinutes, preset.breakMinutes)}
                            className={cn(
                                'text-xs px-2.5 py-1.5 rounded-full border transition-colors',
                                active
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                            )}
                        >
                            {preset.label}
                        </button>
                    );
                })}
            </div>

            <div className="text-center">
                <p className="font-mono text-5xl leading-none tracking-wider">{formatPomodoroClock(timerState.remainingSeconds)}</p>
                <p className="text-xs text-muted-foreground mt-2">
                    {sessionCountLabel}: {timerState.completedFocusSessions}
                </p>
            </div>

            <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                    {resolveText('taskEdit.title', 'Task')}
                </label>
                <select
                    className="w-full text-sm px-3 py-2 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                    value={selectedTaskId ?? ''}
                    onChange={(event) => {
                        const nextId = event.target.value || undefined;
                        commitSnapshot((prev) => ({ ...prev, selectedTaskId: nextId }));
                    }}
                >
                    {tasks.length === 0 ? (
                        <option value="">{noTaskLabel}</option>
                    ) : (
                        tasks.map((task) => (
                            <option key={task.id} value={task.id}>
                                {task.title}
                            </option>
                        ))
                    )}
                </select>
            </div>

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={handleToggleRun}
                    disabled={!selectedTask}
                    className={cn(
                        'inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded border transition-colors',
                        selectedTask
                            ? 'bg-primary text-primary-foreground border-primary hover:opacity-90'
                            : 'bg-muted text-muted-foreground border-border cursor-not-allowed opacity-60'
                    )}
                >
                    {timerState.isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {timerState.isRunning
                        ? resolveText('common.pause', 'Pause')
                        : resolveText('common.start', 'Start')}
                </button>
                <button
                    type="button"
                    onClick={handleReset}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-border bg-muted/50 text-muted-foreground hover:bg-muted transition-colors"
                >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {resolveText('common.reset', 'Reset')}
                </button>
                <button
                    type="button"
                    onClick={handleSwitchPhase}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-border bg-muted/50 text-muted-foreground hover:bg-muted transition-colors"
                >
                    <TimerReset className="w-3.5 h-3.5" />
                    {switchPhaseLabel}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        void handleMarkTaskDone();
                    }}
                    disabled={!selectedTask}
                    className={cn(
                        'inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded border transition-colors',
                        selectedTask
                            ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-500'
                            : 'bg-muted text-muted-foreground border-border cursor-not-allowed opacity-60'
                    )}
                >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {markDoneLabel}
                </button>
            </div>

            {lastEvent && (
                <p className="text-xs text-muted-foreground">
                    {lastEvent === 'focus-finished' ? focusDoneLabel : breakDoneLabel}
                </p>
            )}
        </section>
    );
}
