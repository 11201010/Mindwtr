import { useState, type KeyboardEventHandler } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AutocompleteTextInput } from './AutocompleteTextInput';

function ControlledAutocomplete({
    suggestions,
    createLabel,
    onCreate,
    onKeyDown,
    showAllWhenEmpty,
    maxSuggestions,
}: {
    suggestions: readonly string[];
    createLabel?: string;
    onCreate?: (value: string) => void | Promise<void>;
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
    showAllWhenEmpty?: boolean;
    maxSuggestions?: number;
}) {
    const [value, setValue] = useState('');
    return (
        <AutocompleteTextInput
            aria-label="Assignee"
            value={value}
            onChange={setValue}
            suggestions={suggestions}
            createLabel={createLabel}
            onCreate={onCreate}
            onKeyDown={onKeyDown}
            showAllWhenEmpty={showAllWhenEmpty}
            maxSuggestions={maxSuggestions}
        />
    );
}

describe('AutocompleteTextInput', () => {
    it('accepts the highlighted known person on Enter when person creation is enabled', () => {
        const onCreate = vi.fn();
        render(
            <ControlledAutocomplete
                suggestions={['Jim Smith']}
                createLabel="New Person"
                onCreate={onCreate}
            />
        );

        const input = screen.getByRole('combobox', { name: 'Assignee' });
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'Jim' } });

        expect(screen.getByRole('option', { name: 'Jim Smith' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(input).toHaveValue('Jim Smith');
        expect(onCreate).not.toHaveBeenCalled();
    });

    it('offers and runs an explicit New Person action for an unmatched name', () => {
        const onCreate = vi.fn();
        render(
            <ControlledAutocomplete
                suggestions={['Jim Smith']}
                createLabel="New Person"
                onCreate={onCreate}
            />
        );

        const input = screen.getByRole('combobox', { name: 'Assignee' });
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: '  Avery Stone  ' } });

        expect(screen.getByRole('option', { name: 'New Person: Avery Stone' })).toBeInTheDocument();
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onCreate).toHaveBeenCalledWith('Avery Stone');
        expect(input).toHaveValue('Avery Stone');
    });

    it('preserves generic form Enter behavior until an option is arrow-selected', () => {
        const onKeyDown = vi.fn();
        render(
            <ControlledAutocomplete
                suggestions={['Jim Smith']}
                onKeyDown={onKeyDown}
            />
        );

        const input = screen.getByRole('combobox', { name: 'Assignee' });
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'Jim' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(input).toHaveValue('Jim');
        expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }));

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(input).toHaveValue('Jim Smith');
    });

    it('opens the whole list on focus when asked, then narrows it as the user types', () => {
        render(<ControlledAutocomplete suggestions={['Inter', 'Roboto', 'Zilla Slab']} showAllWhenEmpty maxSuggestions={10} />);

        const input = screen.getByRole('combobox', { name: 'Assignee' });
        expect(screen.queryAllByRole('option')).toHaveLength(0);
        fireEvent.focus(input);
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Inter', 'Roboto', 'Zilla Slab']);

        fireEvent.change(input, { target: { value: 'rob' } });
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Roboto']);
    });
});
