import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CalendarOpenTaskModal } from './CalendarModals';

const editTrigger = vi.fn();

vi.mock('../../TaskItem', () => ({
    TaskItem: () => (
        <div data-task-id="task-1">
            <button type="button" data-task-edit-trigger onClick={editTrigger}>edit</button>
            <input aria-label="note" />
        </div>
    ),
}));

const controller = {
    closeOpenTask: vi.fn(),
    openProject: null,
    openTask: { id: 'task-1', title: 'Call bank', status: 'next' },
    t: (key: string) => key,
} as never;

describe('CalendarOpenTaskModal', () => {
    // #1241: the global list shortcuts are muted while a modal dialog is open, so the
    // pop-up must answer the edit key itself, and without a prior click on the row.
    it('opens the editor from the edit shortcut without selecting the row first', () => {
        editTrigger.mockClear();
        render(<CalendarOpenTaskModal controller={controller} />);

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'e' });
        expect(editTrigger).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', shiftKey: true });
        expect(editTrigger).toHaveBeenCalledTimes(2);
    });

    it('leaves the key alone while typing in a field or with a modifier held', () => {
        editTrigger.mockClear();
        render(<CalendarOpenTaskModal controller={controller} />);

        fireEvent.keyDown(screen.getByLabelText('note'), { key: 'e' });
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'e', ctrlKey: true });
        expect(editTrigger).not.toHaveBeenCalled();
    });
});
