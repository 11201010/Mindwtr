import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import type { ThemeColors } from '@/hooks/use-theme-colors';
import { TaskEditCustomRecurrenceModal } from './TaskEditCustomRecurrenceModal';

vi.mock('../../lib/use-android-keyboard-inset', () => ({
    useAndroidKeyboardInset: () => 0,
}));

const styles = new Proxy({}, { get: () => ({}) }) as Record<string, never>;
const tc = {
    tint: '#2563eb',
    filterBg: '#f1f5f9',
    border: '#cbd5e1',
    onTint: '#ffffff',
    secondaryText: '#64748b',
    text: '#0f172a',
    cardBg: '#ffffff',
    inputBg: '#f8fafc',
} as unknown as ThemeColors;

const renderModal = (
    customMonthDays: number[],
    toggleCustomMonthDay = vi.fn(),
    setCustomInterval = vi.fn(),
) => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
        tree = renderer.create(
            <TaskEditCustomRecurrenceModal
                customInterval={1}
                customMode="date"
                customMonthDays={customMonthDays}
                customOrdinal="1"
                customWeekday="MO"
                onClose={vi.fn()}
                onSave={vi.fn()}
                recurrenceWeekdayButtons={[{ key: 'MO', label: 'Mån' }]}
                recurrenceWeekdayLabels={{ MO: 'Mån' }}
                setCustomInterval={setCustomInterval}
                setCustomMode={vi.fn()}
                toggleCustomMonthDay={toggleCustomMonthDay}
                setCustomOrdinal={vi.fn()}
                setCustomWeekday={vi.fn()}
                styles={styles}
                t={(key) => key === 'recurrence.lastDay'
                    ? 'Sista dagen'
                    : key === 'recurrence.lastDayOfMonth'
                        ? 'Sista dagen i månaden'
                        : key}
                tc={tc}
                visible
            />,
        );
    });
    return tree;
};

const renderControlledModal = (initialInterval: number) => {
    const savedIntervals = vi.fn();
    let reopen!: () => void;
    let tree!: renderer.ReactTestRenderer;

    function Harness() {
        const [customInterval, setCustomInterval] = React.useState(initialInterval);
        const [visible, setVisible] = React.useState(true);
        reopen = () => setVisible(true);
        return (
            <TaskEditCustomRecurrenceModal
                customInterval={customInterval}
                customMode="date"
                customMonthDays={[15]}
                customOrdinal="1"
                customWeekday="MO"
                onClose={() => setVisible(false)}
                onSave={() => savedIntervals(customInterval)}
                recurrenceWeekdayButtons={[{ key: 'MO', label: 'Mån' }]}
                recurrenceWeekdayLabels={{ MO: 'Mån' }}
                setCustomInterval={setCustomInterval}
                setCustomMode={vi.fn()}
                toggleCustomMonthDay={vi.fn()}
                setCustomOrdinal={vi.fn()}
                setCustomWeekday={vi.fn()}
                styles={styles}
                t={(key) => key}
                tc={tc}
                visible={visible}
            />
        );
    }

    act(() => {
        tree = renderer.create(<Harness />);
    });
    return { reopen, savedIntervals, tree };
};

const findModalButton = (tree: renderer.ReactTestRenderer, label: string) => tree.root
    .findAllByType(TouchableOpacity)
    .find((node) => node.findAllByType(Text).some((text) => text.props.children === label));

describe('TaskEditCustomRecurrenceModal', () => {
    it('lets the monthly interval be cleared before entering a new digit', () => {
        const setCustomInterval = vi.fn();
        const tree = renderModal([15], vi.fn(), setCustomInterval);
        const intervalInput = tree.root.findByType(TextInput);

        act(() => intervalInput.props.onChangeText(''));
        expect(intervalInput.props.value).toBe('');
        expect(setCustomInterval).toHaveBeenCalledWith(1);

        act(() => intervalInput.props.onChangeText('3'));
        expect(intervalInput.props.value).toBe('3');
        expect(setCustomInterval).toHaveBeenCalledWith(3);
    });

    it('commits a cleared existing interval before Save without relying on blur', () => {
        const { savedIntervals, tree } = renderControlledModal(2);
        const intervalInput = tree.root.findByType(TextInput);

        act(() => intervalInput.props.onChangeText(''));
        expect(intervalInput.props.value).toBe('');
        act(() => findModalButton(tree, 'common.save')?.props.onPress());

        expect(savedIntervals).toHaveBeenCalledWith(1);
    });

    it('resets a transient empty draft after Cancel and reopen with the same interval', () => {
        const { reopen, tree } = renderControlledModal(1);
        const intervalInput = tree.root.findByType(TextInput);

        act(() => intervalInput.props.onChangeText(''));
        expect(intervalInput.props.value).toBe('');
        act(() => findModalButton(tree, 'common.cancel')?.props.onPress());
        act(reopen);

        expect(tree.root.findByType(TextInput).props.value).toBe('1');
    });

    it('uses the translated last-day label while selected state conveys removal', () => {
        const toggleCustomMonthDay = vi.fn();
        const tree = renderModal([-1, 15], toggleCustomMonthDay);
        const toggle = tree.root.findAllByType(TouchableOpacity).find(
            (node) => node.props.accessibilityLabel === 'Sista dagen i månaden',
        );

        expect(toggle).toBeTruthy();
        expect(toggle?.props.accessibilityState).toEqual({ selected: true });
        act(() => toggle?.props.onPress());
        expect(toggleCustomMonthDay).toHaveBeenCalledWith(-1);
    });
});
