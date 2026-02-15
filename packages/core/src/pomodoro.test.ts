import { describe, expect, it } from 'vitest';

import {
    createPomodoroState,
    DEFAULT_POMODORO_DURATIONS,
    formatPomodoroClock,
    getPomodoroPhaseSeconds,
    sanitizePomodoroDurations,
    tickPomodoroState,
} from './pomodoro';

describe('pomodoro helpers', () => {
    it('sanitizes durations into a safe range', () => {
        expect(sanitizePomodoroDurations({ focusMinutes: -2, breakMinutes: 500 })).toEqual({
            focusMinutes: 1,
            breakMinutes: 180,
        });
    });

    it('creates default focus state', () => {
        expect(createPomodoroState()).toEqual({
            phase: 'focus',
            remainingSeconds: DEFAULT_POMODORO_DURATIONS.focusMinutes * 60,
            isRunning: false,
            completedFocusSessions: 0,
        });
    });

    it('switches from focus to break and increments completed session', () => {
        const state = {
            phase: 'focus' as const,
            remainingSeconds: 1,
            isRunning: true,
            completedFocusSessions: 2,
        };
        const result = tickPomodoroState(state, { focusMinutes: 25, breakMinutes: 5 });
        expect(result.switchedPhase).toBe(true);
        expect(result.completedFocusSession).toBe(true);
        expect(result.state.phase).toBe('break');
        expect(result.state.isRunning).toBe(false);
        expect(result.state.remainingSeconds).toBe(getPomodoroPhaseSeconds('break', { focusMinutes: 25, breakMinutes: 5 }));
        expect(result.state.completedFocusSessions).toBe(3);
    });

    it('formats timer clock values', () => {
        expect(formatPomodoroClock(0)).toBe('00:00');
        expect(formatPomodoroClock(65)).toBe('01:05');
        expect(formatPomodoroClock(3605)).toBe('1:00:05');
    });
});
