import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import { ConfirmModal } from './ConfirmModal';

describe('ConfirmModal', () => {
    it('renders via portal outside transformed ancestors', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        const { container, getByRole } = render(
            <div style={{ transform: 'translateY(50px)' }}>
                <ConfirmModal
                    isOpen
                    title="Delete task"
                    description="Delete selected tasks?"
                    confirmLabel="Delete"
                    cancelLabel="Cancel"
                    onConfirm={onConfirm}
                    onCancel={onCancel}
                />
            </div>,
        );

        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(getByRole('dialog')).toBeInTheDocument();
    });

    it('supports confirm/cancel actions', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        const { getByText } = render(
            <ConfirmModal
                isOpen
                title="Delete task"
                description="Delete selected tasks?"
                confirmLabel="Delete"
                cancelLabel="Cancel"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />,
        );

        fireEvent.click(getByText('Delete'));
        fireEvent.click(getByText('Cancel'));

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
