import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    days: 0, loading: false, error: null as string | null, editLockCount: 0, editingTaskId: null as string | null,
    run: vi.fn(async () => ({ success: true })),
}));
vi.mock('@mindwtr/core', () => ({
    isArchiveRetentionDays: (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 36500,
    useTaskStore: Object.assign(
        (selector: (state: unknown) => unknown) => selector({ settings: { gtd: { archiveRetentionDays: harness.days } } }),
        { getState: () => ({ isLoading: harness.loading, error: harness.error, editLockCount: harness.editLockCount, runArchiveRetention: harness.run }) },
    ),
}));
vi.mock('../store/ui-store', () => ({ useUiStore: { getState: () => ({ editingTaskId: harness.editingTaskId }) } }));
vi.mock('../lib/app-log', () => ({ logError: vi.fn(async () => undefined) }));

import { useArchiveRetentionRunner } from './useArchiveRetentionRunner';

const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

describe('useArchiveRetentionRunner', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        harness.days = 0; harness.loading = false; harness.error = null;
        harness.editLockCount = 0; harness.editingTaskId = null; harness.run.mockClear();
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    });
    afterEach(() => {
        vi.useRealTimers();
        if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
    });

    it('does not schedule work for Never, sandbox, or before hydration', async () => {
        const { rerender, unmount } = renderHook(({ hydrated, disabled }) => useArchiveRetentionRunner(hydrated, disabled), {
            initialProps: { hydrated: false, disabled: false },
        });
        harness.days = 30;
        rerender({ hydrated: true, disabled: true });
        await act(async () => { vi.advanceTimersByTime(30 * 60 * 1000); window.dispatchEvent(new Event('focus')); });
        expect(harness.run).not.toHaveBeenCalled();
        rerender({ hydrated: true, disabled: false });
        expect(harness.run).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('runs while visible and skips editor, loading, and hidden intervals', async () => {
        harness.days = 30;
        harness.editingTaskId = 'editing';
        const { unmount } = renderHook(() => useArchiveRetentionRunner(true, false));
        expect(harness.run).not.toHaveBeenCalled();
        harness.editingTaskId = null;
        harness.editLockCount = 1;
        act(() => window.dispatchEvent(new Event('focus')));
        expect(harness.run).not.toHaveBeenCalled();
        harness.editLockCount = 0;
        act(() => window.dispatchEvent(new Event('focus')));
        expect(harness.run).toHaveBeenCalledTimes(1);
        await act(async () => { await Promise.resolve(); });
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        act(() => vi.advanceTimersByTime(15 * 60 * 1000));
        expect(harness.run).toHaveBeenCalledTimes(1);
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        harness.loading = true;
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        expect(harness.run).toHaveBeenCalledTimes(1);
        harness.loading = false;
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        expect(harness.run).toHaveBeenCalledTimes(2);
        unmount();
    });
});
