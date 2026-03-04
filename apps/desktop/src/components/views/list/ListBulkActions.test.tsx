import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ListBulkActions } from './ListBulkActions';

const t = (key: string) => {
    const labels: Record<string, string> = {
        'bulk.selected': 'selected',
        'status.inbox': 'Inbox',
        'status.next': 'Next',
        'status.waiting': 'Waiting',
        'status.someday': 'Someday',
        'status.reference': 'Reference',
        'status.done': 'Done',
        'bulk.addTag': 'Add Tag',
        'bulk.addContext': 'Add Context',
        'bulk.removeContext': 'Remove Context',
        'bulk.delete': 'Delete',
        'projects.areaLabel': 'Area',
        'taskEdit.noAreaOption': 'No area',
    };
    return labels[key] ?? key;
};

describe('ListBulkActions', () => {
    it('assigns selected area from bulk action select', () => {
        const onAssignArea = vi.fn();

        render(
            <ListBulkActions
                selectionCount={2}
                onMoveToStatus={() => undefined}
                onAssignArea={onAssignArea}
                areaOptions={[{ id: 'area-1', name: 'Work' }]}
                onAddTag={() => undefined}
                onAddContext={() => undefined}
                onRemoveContext={() => undefined}
                onDelete={() => undefined}
                t={t}
            />
        );

        fireEvent.change(screen.getByRole('combobox', { name: 'Area' }), {
            target: { value: 'area-1' },
        });

        expect(onAssignArea).toHaveBeenCalledWith('area-1');
    });

    it('assigns no area when no-area option is selected', () => {
        const onAssignArea = vi.fn();

        render(
            <ListBulkActions
                selectionCount={1}
                onMoveToStatus={() => undefined}
                onAssignArea={onAssignArea}
                areaOptions={[{ id: 'area-1', name: 'Work' }]}
                onAddTag={() => undefined}
                onAddContext={() => undefined}
                onRemoveContext={() => undefined}
                onDelete={() => undefined}
                t={t}
            />
        );

        fireEvent.change(screen.getByRole('combobox', { name: 'Area' }), {
            target: { value: '__NO_AREA__' },
        });

        expect(onAssignArea).toHaveBeenCalledWith(null);
    });
});
