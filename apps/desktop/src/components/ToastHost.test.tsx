import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUiStore } from '../store/ui-store';
import { ToastHost } from './ToastHost';

vi.mock('../contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key === 'common.dismiss' ? 'Dismiss' : key }),
}));

const showToast = (...args: Parameters<ReturnType<typeof useUiStore.getState>['showToast']>) => {
    act(() => useUiStore.getState().showToast(...args));
};

describe('ToastHost', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useUiStore.setState({ toasts: [] });
    });

    afterEach(() => {
        act(() => useUiStore.setState({ toasts: [] }));
        vi.useRealTimers();
    });

    it('uses an opaque surface while retaining severity borders', () => {
        showToast('Success', 'success', 0);
        showToast('Error', 'error', 0);
        showToast('Info', 'info', 0);
        render(<ToastHost />);

        const statuses = screen.getAllByRole('status');
        statuses.forEach((toast) => expect(toast).toHaveClass('bg-popover', 'text-popover-foreground'));
        expect(statuses[0]).toHaveClass('border-success');
        expect(statuses[1]).toHaveClass('border-destructive');
        expect(statuses[2]).toHaveClass('border-border');
        statuses.forEach((toast) => {
            expect(toast.className).not.toContain('bg-success/10');
            expect(toast.className).not.toContain('bg-destructive/10');
        });
    });

    it('pauses a toast added while the host is already hovered', async () => {
        render(<ToastHost />);
        showToast('First', 'info', 1000);
        const host = screen.getByRole('status').parentElement!;

        await act(async () => vi.advanceTimersByTimeAsync(400));
        fireEvent.pointerEnter(host);
        showToast('Second', 'info', 1000);
        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(screen.getAllByRole('status')).toHaveLength(2);

        fireEvent.pointerLeave(host);
        await act(async () => vi.advanceTimersByTimeAsync(600));
        expect(screen.queryByText('First')).not.toBeInTheDocument();
        expect(screen.getByText('Second')).toBeInTheDocument();
        await act(async () => vi.advanceTimersByTimeAsync(400));
        expect(screen.queryByText('Second')).not.toBeInTheDocument();
    });

    it('keeps focus paused after hover ends and allows the action to dismiss', async () => {
        const action = vi.fn();
        render(<ToastHost />);
        showToast('Retry sync', 'error', 1000, { label: 'Retry', onClick: action });
        const toast = screen.getByRole('status');
        const host = toast.parentElement!;
        const actionButton = within(toast).getByRole('button', { name: 'Retry' });

        fireEvent.pointerEnter(host);
        fireEvent.focus(actionButton);
        fireEvent.pointerLeave(host);
        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(screen.getByText('Retry sync')).toBeInTheDocument();

        fireEvent.click(actionButton);
        expect(action).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Retry sync')).not.toBeInTheDocument();
    });

    it('resumes a hovered toast when the host unmounts and keeps dismiss operable', async () => {
        const view = render(<ToastHost />);
        showToast('Unmounted', 'info', 1000);
        fireEvent.pointerEnter(screen.getByRole('status').parentElement!);

        view.unmount();
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(useUiStore.getState().toasts).toHaveLength(0);

        render(<ToastHost />);
        showToast('Dismiss me', 'info', 1000);
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument();
    });
});
