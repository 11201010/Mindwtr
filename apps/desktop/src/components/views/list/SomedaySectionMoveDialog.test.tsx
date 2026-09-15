import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ViewSectionDefinition } from '@mindwtr/core';
import { LanguageProvider } from '../../../contexts/language-context';
import { SomedaySectionMoveSaveError, type SomedaySectionMove } from '../../../lib/someday-section-move';
import { SomedaySectionMoveDialog } from './SomedaySectionMoveDialog';

const sections: ViewSectionDefinition[] = [
    { id: 'books', title: 'Books', order: 0 },
    { id: 'empty', title: 'Empty ideas', order: 1 },
];
const t = (key: string) => ({
    'viewSections.moveToSection': 'Move to section…',
    'viewSections.moveFailed': 'Could not move tasks to the section.',
    'viewSections.updateFailed': 'Could not update Someday sections.',
    'viewSections.noSection': 'No section',
    'viewSections.add': 'New section…',
    'bulk.selected': 'selected',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.retry': 'Retry',
} as Record<string, string>)[key] ?? key;

function renderDialog(props: {
    onCreateSection?: (title: string) => Promise<string | null>;
    onApply?: (id: string | undefined, pending?: SomedaySectionMove) => Promise<void>;
    onCancel?: () => void;
} = {}) {
    return render(
        <LanguageProvider>
            <SomedaySectionMoveDialog
                sections={sections}
                selectedCount={2}
                initialSectionId="books"
                t={t}
                onCreateSection={props.onCreateSection ?? vi.fn(async () => null)}
                onApply={props.onApply ?? vi.fn(async () => {})}
                onCancel={props.onCancel ?? vi.fn()}
            />
        </LanguageProvider>,
    );
}

describe('Someday section move picker errors', () => {
    it('keeps selection and Undo snapshot for a failed flush, then retries without another batch move', async () => {
        const pendingMove: SomedaySectionMove = {
            changedCount: 2,
            destinationId: 'empty',
            destinationTitle: 'Empty ideas',
            previous: [{ id: 'a', sectionId: 'books' }, { id: 'b' }],
        };
        const onApply = vi.fn()
            .mockRejectedValueOnce(new SomedaySectionMoveSaveError(pendingMove, new Error('disk unavailable')))
            .mockResolvedValueOnce(undefined);
        const onCancel = vi.fn();
        const view = renderDialog({ onApply, onCancel });
        const dialog = view.getByRole('dialog', { name: 'Move to section…' });
        fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'empty' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not move tasks'));
        expect(onApply).toHaveBeenCalledTimes(1);
        expect(within(dialog).getByRole('combobox')).toHaveValue('empty');
        expect(within(dialog).getByRole('combobox')).toBeDisabled();
        expect(within(dialog).getByRole('button', { name: 'Close' })).toBeEnabled();
        expect(onCancel).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
        expect(onApply).toHaveBeenLastCalledWith('empty', pendingMove);
    });

    it('keeps the selected destination and tasks after New section creation fails', async () => {
        const onCreateSection = vi.fn(async () => null);
        const onApply = vi.fn(async () => {});
        const view = renderDialog({ onCreateSection, onApply });
        const moveDialog = view.getByRole('dialog', { name: 'Move to section…' });
        fireEvent.change(within(moveDialog).getByRole('combobox'), { target: { value: '__new-someday-section__' } });
        const createDialog = await view.findByRole('dialog', { name: 'New section…' });
        fireEvent.change(within(createDialog).getByRole('combobox'), { target: { value: 'Films' } });
        fireEvent.click(within(createDialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(onCreateSection).toHaveBeenCalledWith('Films'));
        await waitFor(() => expect(within(createDialog).getByRole('alert')).toHaveTextContent('Could not update Someday sections'));
        expect(within(createDialog).getByRole('combobox')).toHaveValue('Films');
        expect(within(createDialog).getByRole('button', { name: 'Save' })).toBeEnabled();
        expect(within(moveDialog).getByRole('combobox')).toHaveValue('books');
        expect(moveDialog).toHaveTextContent('2 selected');
        expect(onApply).not.toHaveBeenCalled();
    });
});
