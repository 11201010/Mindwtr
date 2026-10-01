import React from 'react';
import { Platform, TextInput } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompletedAtPicker } from './completed-at-picker';

vi.mock('@react-native-community/datetimepicker', () => ({
    __esModule: true,
    default: (props: any) => React.createElement('DateTimePicker', props),
}));

const originalPlatformOs = Platform.OS;

describe('CompletedAtPicker', () => {
    afterEach(() => {
        Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatformOs });
    });

    it('reviews time spent before confirming an Android completion', () => {
        Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
        const onConfirm = vi.fn();
        const initial = new Date('2026-07-14T18:30:00.000Z');
        const selectedDate = new Date('2026-07-20T18:30:00.000Z');
        const selectedTime = new Date('2026-07-20T21:45:00.000Z');
        const expected = new Date(initial);
        expected.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
        expected.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);

        let tree!: renderer.ReactTestRenderer;
        act(() => {
            tree = renderer.create(
                <CompletedAtPicker
                    initialValue={initial.toISOString()}
                    initialTimeSpentMinutes={15}
                    showTimeSpent
                    onCancel={vi.fn()}
                    onConfirm={onConfirm}
                    t={(key) => ({
                        'common.cancel': 'Cancel',
                        'common.save': 'Save',
                        'task.completedAtPromptTitle': 'Completion time',
                        'taskEdit.timeSpentLabel': 'Time Spent',
                        'taskEdit.timeSpentPlaceholder': 'minutes',
                    })[key] ?? key}
                    tc={{
                        cardBg: '#111',
                        inputBg: '#222',
                        border: '#333',
                        text: '#fff',
                        secondaryText: '#aaa',
                        tint: '#3b82f6',
                    } as any}
                />
            );
        });

        act(() => {
            tree.root.findByType('DateTimePicker' as any).props.onChange(
                { type: 'set' },
                selectedDate
            );
        });
        act(() => {
            tree.root.findByType('DateTimePicker' as any).props.onChange(
                { type: 'set' },
                selectedTime
            );
        });

        expect(onConfirm).not.toHaveBeenCalled();
        const input = tree.root.findByType(TextInput);
        expect(input.props.value).toBe('15');
        act(() => input.props.onChangeText('45 minutes'));
        act(() => {
            tree.root.findByProps({ accessibilityLabel: 'Save' }).props.onPress();
        });

        expect(onConfirm).toHaveBeenCalledWith(expected.toISOString(), 45);
    });

    it('preserves an untouched iOS instant and normalizes the optional minutes on confirm', () => {
        Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
        const onConfirm = vi.fn();
        const initial = '2026-07-14T18:30:45.123Z';
        let tree!: renderer.ReactTestRenderer;
        act(() => {
            tree = renderer.create(<CompletedAtPicker initialValue={initial} initialTimeSpentMinutes={17}
                showTimeSpent onCancel={vi.fn()} onConfirm={onConfirm} t={(key) => key}
                tc={{ cardBg: '#111', inputBg: '#222', border: '#333', text: '#fff',
                    secondaryText: '#aaa', tint: '#3b82f6' } as any} />);
        });
        const input = tree.root.findByType(TextInput);
        expect(input.props.value).toBe('17');
        act(() => tree.root.findByProps({ accessibilityLabel: 'Save' }).props.onPress());
        expect(onConfirm).toHaveBeenLastCalledWith(initial, 17);
        act(() => input.props.onChangeText('100001 minutes'));
        act(() => tree.root.findByProps({ accessibilityLabel: 'Save' }).props.onPress());
        expect(onConfirm).toHaveBeenLastCalledWith(initial, 100_000);
        act(() => input.props.onChangeText(''));
        act(() => tree.root.findByProps({ accessibilityLabel: 'Save' }).props.onPress());
        expect(onConfirm).toHaveBeenLastCalledWith(initial, undefined);
    });
});
