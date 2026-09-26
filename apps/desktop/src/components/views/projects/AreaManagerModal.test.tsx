import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Area } from '@mindwtr/core';

import { AreaManagerModal } from './AreaManagerModal';

const now = '2026-09-26T00:00:00.000Z';
const home: Area = { id: 'home', name: 'Home', order: 0, color: '#22c55e', createdAt: now, updatedAt: now };

const renderModal = (newAreaName: string, onCreateArea = vi.fn()) => {
    render(
        <AreaManagerModal
            sortedAreas={[home]}
            areaSensors={[] as never}
            onDragEnd={vi.fn()}
            onDeleteArea={vi.fn()}
            onUpdateArea={vi.fn()}
            newAreaColor="#3b82f6"
            onChangeNewAreaColor={vi.fn()}
            newAreaName={newAreaName}
            onChangeNewAreaName={vi.fn()}
            onCreateArea={onCreateArea}
            onSortByName={vi.fn()}
            onSortByColor={vi.fn()}
            onClose={vi.fn()}
            t={(key) => key}
        />,
    );
    return onCreateArea;
};

describe('AreaManagerModal new area', () => {
    it('refuses a name a live area has: Create is off and the line says why', () => {
        const onCreateArea = renderModal(' HOME ');
        expect(screen.getByText('An area with this name already exists.')).toBeInTheDocument();
        const create = screen.getByRole('button', { name: 'projects.create' });
        expect(create).toBeDisabled();
        fireEvent.click(create);
        expect(onCreateArea).not.toHaveBeenCalled();
    });

    it('offers Create for a new name', () => {
        renderModal('Garden');
        expect(screen.queryByText('An area with this name already exists.')).toBeNull();
        expect(screen.getByRole('button', { name: 'projects.create' })).toBeEnabled();
    });
});
