import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReviewFiltersBar } from './ReviewFiltersBar';

describe('ReviewFiltersBar', () => {
    it('exposes every status and count in one accessible compact selector', () => {
        const onSelect = vi.fn();
        render(
            <ReviewFiltersBar
                filterStatus="all"
                statusOptions={['inbox', 'next']}
                statusCounts={{ all: 2, inbox: 1, next: 1 }}
                onSelect={onSelect}
                t={(key) => ({
                    'review.openTasks': 'Open tasks',
                    'status.inbox': 'Inbox',
                    'status.next': 'Next',
                    'taskEdit.statusLabel': 'Status',
                })[key] ?? key}
            />
        );

        const compactSelector = screen.getByRole('combobox', { name: 'Status' });
        expect(compactSelector).toHaveTextContent('Open tasks (2)');
        fireEvent.click(compactSelector);
        expect(screen.getByRole('option', { name: 'Open tasks (2)' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Inbox (1)' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('option', { name: 'Next (1)' }));
        expect(onSelect).toHaveBeenCalledWith('next');
    });
});
