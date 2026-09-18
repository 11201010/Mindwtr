import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectTaskToolbarMenu } from './ProjectTaskToolbarMenu';

const renderMenu = (onToggleColumns = vi.fn()) => {
    render(
        <ProjectTaskToolbarMenu
            triggerLabel="More options: Tasks"
            columnsLabel="Columns"
            columnsLayout={false}
            showColumns
            onToggleColumns={onToggleColumns}
            completedLabel="Show completed"
            showCompletedTasks={false}
            completedTaskCount={3}
            showCompletedControl
            onToggleShowCompletedTasks={vi.fn()}
            addSectionLabel="Add section"
            showAddSection
            onAddSection={vi.fn()}
        />,
    );
};

describe('ProjectTaskToolbarMenu', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns focus to the trigger after an in-place action', () => {
        const onToggleColumns = vi.fn();
        renderMenu(onToggleColumns);
        const trigger = screen.getByRole('button', { name: 'More options: Tasks' });

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Columns' }));

        expect(onToggleColumns).toHaveBeenCalledTimes(1);
        expect(trigger).toHaveFocus();
    });

    it('uses measured trigger and panel geometry to flip and constrain the menu', () => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            if (this.getAttribute('role') === 'menu') {
                return { top: 0, bottom: 200, left: 0, right: 220, width: 220, height: 200 } as DOMRect;
            }
            if (this.getAttribute('aria-haspopup') === 'menu') {
                return { top: 560, bottom: 588, left: 282, right: 310, width: 28, height: 28 } as DOMRect;
            }
            return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
        });
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
        renderMenu();

        fireEvent.click(screen.getByRole('button', { name: 'More options: Tasks' }));
        const menu = screen.getByRole('menu');

        expect(menu.style.top).toBe('356px');
        expect(menu.style.left).toBe('90px');
        expect(menu.style.maxHeight).toBe('548px');
        expect(menu.style.overflowY).toBe('auto');
    });
});
