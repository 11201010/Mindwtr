import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewHeaderActions, ViewHeaderActionsTarget } from './ViewHeaderActions';

describe('ViewHeaderActions', () => {
    it('keeps standalone view actions inline', () => {
        const { container } = render(<ViewHeaderActions><button>Filters</button></ViewHeaderActions>);
        expect(within(container).getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    });

    it('moves current view actions into the shared header and removes old actions on tab changes', () => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        const onClick = vi.fn();
        const { container, rerender, unmount } = render(
            <ViewHeaderActionsTarget.Provider value={target}>
                <ViewHeaderActions><button onClick={onClick}>Done filters</button></ViewHeaderActions>
            </ViewHeaderActionsTarget.Provider>,
        );
        expect(within(container).queryByRole('button')).toBeNull();
        fireEvent.click(within(target).getByRole('button', { name: 'Done filters' }));
        expect(onClick).toHaveBeenCalledOnce();
        rerender(
            <ViewHeaderActionsTarget.Provider value={target}>
                <ViewHeaderActions><button>Archived filters</button></ViewHeaderActions>
            </ViewHeaderActionsTarget.Provider>,
        );
        expect(screen.queryByRole('button', { name: 'Done filters' })).toBeNull();
        expect(within(target).getByRole('button', { name: 'Archived filters' })).toBeInTheDocument();
        unmount();
        expect(target.childElementCount).toBe(0);
        target.remove();
    });
});
