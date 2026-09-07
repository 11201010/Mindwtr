import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUiStore } from './ui-store';

describe('desktop toast timers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useUiStore.setState({ toasts: [] });
    });

    afterEach(() => {
        useUiStore.setState({ toasts: [] });
        vi.useRealTimers();
    });

    it('expires normally after its duration', async () => {
        useUiStore.getState().showToast('Saved', 'success', 1000);

        await vi.advanceTimersByTimeAsync(999);
        expect(useUiStore.getState().toasts).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(useUiStore.getState().toasts).toHaveLength(0);
    });

    it('pauses and resumes from the remaining duration', async () => {
        useUiStore.getState().showToast('Syncing', 'info', 1000);
        const id = useUiStore.getState().toasts[0].id;

        await vi.advanceTimersByTimeAsync(400);
        useUiStore.getState().pauseToast(id, 'pointer');
        await vi.advanceTimersByTimeAsync(2000);
        expect(useUiStore.getState().toasts).toHaveLength(1);

        useUiStore.getState().resumeToast(id, 'pointer');
        await vi.advanceTimersByTimeAsync(599);
        expect(useUiStore.getState().toasts).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(useUiStore.getState().toasts).toHaveLength(0);
    });

    it('resumes only after both pointer and focus pauses clear', async () => {
        useUiStore.getState().showToast('Needs attention', 'error', 1000);
        const id = useUiStore.getState().toasts[0].id;

        await vi.advanceTimersByTimeAsync(200);
        useUiStore.getState().pauseToast(id, 'pointer');
        useUiStore.getState().pauseToast(id, 'focus');
        useUiStore.getState().resumeToast(id, 'pointer');
        await vi.advanceTimersByTimeAsync(2000);
        expect(useUiStore.getState().toasts).toHaveLength(1);

        useUiStore.getState().resumeToast(id, 'focus');
        await vi.advanceTimersByTimeAsync(800);
        expect(useUiStore.getState().toasts).toHaveLength(0);
    });

    it.each([0, -1])('preserves immediate expiry for a %i ms duration', async (durationMs) => {
        useUiStore.getState().showToast('Immediate', 'info', durationMs);
        expect(useUiStore.getState().toasts).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(0);
        expect(useUiStore.getState().toasts).toHaveLength(0);
    });

    it('clears timers when toast state is reset directly', () => {
        useUiStore.getState().showToast('Reset me', 'info', 1000);
        expect(vi.getTimerCount()).toBe(1);

        useUiStore.setState({ toasts: [] });
        expect(vi.getTimerCount()).toBe(0);
    });
});
