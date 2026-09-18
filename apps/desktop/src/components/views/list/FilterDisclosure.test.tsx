import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FilterCategory } from './FilterDisclosure';

describe('FilterCategory', () => {
    it('announces the current summary while keeping a stable control name', () => {
        const props = { id: 'test-projects', label: 'Projects', expanded: false, onToggle: vi.fn() };
        const { rerender } = render(<FilterCategory {...props} summary="All">Options</FilterCategory>);
        expect(screen.getByRole('button', { name: 'Projects' })).toHaveAccessibleDescription('All');
        rerender(<FilterCategory {...props} summary="Garden, Work">Options</FilterCategory>);
        expect(screen.getByRole('button', { name: 'Projects' })).toHaveAccessibleDescription('Garden, Work');
    });
});
