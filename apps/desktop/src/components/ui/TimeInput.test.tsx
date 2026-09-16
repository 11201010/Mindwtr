import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
    TimeInput,
    formatClockTimeForInput,
    parseClockTimeDraft,
    resolveTimeInputFormat,
} from './TimeInput';

describe('TimeInput helpers', () => {
    it('keeps explicit 24-hour time deterministic in a 12-hour locale', () => {
        expect(resolveTimeInputFormat('24h', 'en-US')).toBe('24h');
        expect(formatClockTimeForInput('13:59', '24h')).toBe('13:59');
        expect(formatClockTimeForInput('00:00', '24h')).toBe('00:00');
        expect(formatClockTimeForInput('12:00', '24h')).toBe('12:00');
        expect(formatClockTimeForInput('23:59', '24h')).toBe('23:59');
    });

    it('formats and parses midnight, noon, and afternoon in 12-hour mode', () => {
        expect(formatClockTimeForInput('00:00', '12h')).toBe('12:00 AM');
        expect(formatClockTimeForInput('12:00', '12h')).toBe('12:00 PM');
        expect(formatClockTimeForInput('23:59', '12h')).toBe('11:59 PM');
        expect(parseClockTimeDraft('12:00 am', '12h')).toBe('00:00');
        expect(parseClockTimeDraft('12 PM', '12h')).toBe('12:00');
        expect(parseClockTimeDraft('1:59 p.m.', '12h')).toBe('13:59');
        expect(parseClockTimeDraft('13:59', '12h')).toBe('13:59');
        expect(parseClockTimeDraft('1:59', '12h')).toBeNull();
    });

    it('derives system hour cycle from the device locale', () => {
        expect(resolveTimeInputFormat('system', 'en-US')).toBe('12h');
        expect(resolveTimeInputFormat('system', 'en-GB')).toBe('24h');
    });

    it('strictly rejects out-of-range or incomplete input', () => {
        expect(parseClockTimeDraft('24:00', '24h')).toBeNull();
        expect(parseClockTimeDraft('25:00', '24h')).toBeNull();
        expect(parseClockTimeDraft('13:60', '24h')).toBeNull();
        expect(parseClockTimeDraft('13:', '24h')).toBeNull();
        expect(parseClockTimeDraft('13:59 PM', '24h')).toBeNull();
        expect(parseClockTimeDraft('0:30 PM', '12h')).toBeNull();
        expect(parseClockTimeDraft('13:30 PM', '12h')).toBeNull();
    });
});

describe('TimeInput', () => {
    function ControlledInput({
        initialValue = '09:30',
        timeFormat = '24h',
        onChange = vi.fn(),
    }: {
        initialValue?: string;
        timeFormat?: 'system' | '12h' | '24h';
        onChange?: (value: string) => void;
    }) {
        const [value, setValue] = useState(initialValue);
        return (
            <>
                <TimeInput
                    aria-label="Time"
                    value={value}
                    timeFormat={timeFormat}
                    locale="en-US"
                    onChange={(next) => {
                        onChange(next);
                        setValue(next);
                    }}
                />
            </>
        );
    }

    it('preserves incomplete drafts without clearing the last valid value, then rolls back on blur', () => {
        const onChange = vi.fn();
        render(<ControlledInput onChange={onChange} />);
        const input = screen.getByLabelText('Time');

        input.focus();
        fireEvent.change(input, { target: { value: '13:' } });
        expect(input).toHaveValue('13:');
        expect(onChange).not.toHaveBeenCalled();

        fireEvent.blur(input);
        expect(input).toHaveValue('09:30');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps the previous time when replacement typing starts by clearing the field', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<ControlledInput onChange={onChange} />);
        const input = screen.getByLabelText('Time');
        await user.clear(input);
        await user.type(input, '13:');
        await user.tab();
        expect(input).toHaveValue('09:30');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('commits an intentional clear on Enter before form submission', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<ControlledInput onChange={onChange} />);
        const input = screen.getByLabelText('Time');
        await user.clear(input);
        await user.keyboard('{Enter}');
        expect(onChange).toHaveBeenCalledExactlyOnceWith('');
    });

    it('commits complete typing without rewriting the active draft or caret', () => {
        const onChange = vi.fn();
        render(<ControlledInput onChange={onChange} />);
        const input = screen.getByLabelText('Time');

        input.focus();
        fireEvent.change(input, { target: { value: '13:59' } });

        expect(onChange).toHaveBeenCalledExactlyOnceWith('13:59');
        expect(input).toHaveValue('13:59');
        expect(document.activeElement).toBe(input);
    });

    it('blocks invalid Enter, restores on Escape, and commits a valid value on Tab blur', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
        render(
            <form onSubmit={onSubmit}>
                <ControlledInput onChange={onChange} />
                <button type="submit">Submit</button>
            </form>
        );
        const input = screen.getByLabelText('Time');

        input.focus();
        fireEvent.change(input, { target: { value: '13:' } });
        await user.keyboard('{Enter}');
        expect(onSubmit).not.toHaveBeenCalled();
        expect(input).toHaveValue('13:');

        await user.keyboard('{Escape}');
        expect(input).toHaveValue('09:30');

        fireEvent.change(input, { target: { value: '23:59' } });
        await user.tab();
        expect(onChange).toHaveBeenCalledWith('23:59');
        expect(input).toHaveValue('23:59');
    });

    it('emits an explicit clear but never emits malformed text', () => {
        const onChange = vi.fn();
        render(<ControlledInput onChange={onChange} />);
        const input = screen.getByLabelText('Time');

        fireEvent.change(input, { target: { value: 'not a time' } });
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(input, { target: { value: '' } });
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.blur(input);
        expect(onChange).toHaveBeenCalledExactlyOnceWith('');
    });

    it('reformats when the preference changes', () => {
        const { rerender } = render(
            <TimeInput aria-label="Time" value="13:59" timeFormat="24h" locale="en-US" onChange={vi.fn()} />
        );
        const input = screen.getByLabelText('Time');
        expect(input).toHaveValue('13:59');
        input.focus();

        rerender(
            <TimeInput aria-label="Time" value="13:59" timeFormat="12h" locale="en-US" onChange={vi.fn()} />
        );
        expect(screen.getByLabelText('Time')).toHaveValue('1:59 PM');
    });

    it('derives system time from the device locale independently of the date-control language', () => {
        render(
            <TimeInput
                aria-label="Time"
                lang="en-US-u-hc-h12"
                value="13:59"
                timeFormat="system"
                locale="en-GB"
                onChange={vi.fn()}
            />
        );

        expect(screen.getByLabelText('Time')).toHaveValue('13:59');
        expect(screen.getByLabelText('Time')).toHaveAttribute('lang', 'en-US-u-hc-h12');
    });

    it('applies external resets and clears while focused', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <TimeInput aria-label="Time" value="09:30" timeFormat="24h" locale="en-US" onChange={onChange} />
        );
        const input = screen.getByLabelText('Time');
        input.focus();
        fireEvent.change(input, { target: { value: '13:' } });

        rerender(
            <TimeInput aria-label="Time" value="23:15" timeFormat="24h" locale="en-US" onChange={onChange} />
        );
        expect(input).toHaveValue('23:15');
        expect(document.activeElement).toBe(input);

        rerender(
            <TimeInput aria-label="Time" value="" timeFormat="24h" locale="en-US" onChange={onChange} />
        );
        expect(input).toHaveValue('');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('forwards disabled state, refs, and keyboard handlers', () => {
        const ref = { current: null as HTMLInputElement | null };
        const onKeyDown = vi.fn();
        render(
            <TimeInput
                ref={ref}
                aria-label="Time"
                value="13:59"
                timeFormat="24h"
                locale="en-US"
                disabled
                onKeyDown={onKeyDown}
                onChange={vi.fn()}
            />
        );
        const input = screen.getByLabelText('Time');
        expect(input).toBeDisabled();
        expect(ref.current).toBe(input);
        fireEvent.keyDown(input, { key: 'ArrowLeft' });
        expect(onKeyDown).toHaveBeenCalledOnce();
    });
});
