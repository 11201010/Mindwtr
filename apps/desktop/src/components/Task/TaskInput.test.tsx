import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { TaskInput } from './TaskInput';

function Harness({ tokens }: { tokens: string[] }) {
    const [value, setValue] = useState('');

    return (
        <>
            <TaskInput
                value={value}
                onChange={setValue}
                projects={[]}
                contexts={tokens}
            />
            <div data-testid="value">{value}</div>
        </>
    );
}

describe('TaskInput autocomplete', () => {
    it('suggests custom contexts for @ trigger', () => {
        render(<Harness tokens={['@home', '@work', '@personal']} />);

        fireEvent.change(screen.getByRole('combobox'), {
            target: { value: '@per', selectionStart: 4 },
        });

        expect(screen.getByRole('option', { name: '@personal' })).toBeInTheDocument();
    });

    it('suggests tags for # trigger and inserts selected tag', async () => {
        render(<Harness tokens={['#urgent', '#ops', '@work']} />);

        fireEvent.change(screen.getByRole('combobox'), {
            target: { value: '#urg', selectionStart: 4 },
        });

        fireEvent.click(screen.getByRole('option', { name: '#urgent' }));

        await waitFor(() => {
            expect(screen.getByTestId('value').textContent).toBe('#urgent');
        });
    });
});
