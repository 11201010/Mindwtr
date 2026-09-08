import React from 'react';
import { TextInput } from 'react-native';
import { RECURRENCE_INTERVAL_MAX } from '@mindwtr/core';

const normalizeRecurrenceInterval = (value: number): number => (
    Number.isFinite(value) && value > 0
        ? Math.min(Math.round(value), RECURRENCE_INTERVAL_MAX)
        : 1
);

const parseRecurrenceIntervalDraft = (value: string): number | null => {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0
        ? normalizeRecurrenceInterval(parsed)
        : null;
};

type RecurrenceIntervalInputProps = Pick<
    React.ComponentProps<typeof TextInput>,
    'accessibilityHint' | 'accessibilityLabel' | 'style'
> & {
    interval: number;
    onIntervalChange: (interval: number) => void;
};

export function RecurrenceIntervalInput({
    accessibilityHint,
    accessibilityLabel,
    interval,
    onIntervalChange,
    style,
}: RecurrenceIntervalInputProps) {
    const normalizedInterval = normalizeRecurrenceInterval(interval);
    const [draftValue, setDraftValue] = React.useState(String(normalizedInterval));
    const pendingIntervalEcho = React.useRef<number | null>(null);

    React.useEffect(() => {
        if (pendingIntervalEcho.current === normalizedInterval) {
            pendingIntervalEcho.current = null;
            return;
        }
        pendingIntervalEcho.current = null;
        setDraftValue(String(normalizedInterval));
    }, [normalizedInterval]);

    const updateCanonicalInterval = (value: number) => {
        pendingIntervalEcho.current = value;
        onIntervalChange(value);
    };

    const handleChangeText = (value: string) => {
        setDraftValue(value);
        updateCanonicalInterval(parseRecurrenceIntervalDraft(value) ?? 1);
    };

    const handleBlur = () => {
        const committed = parseRecurrenceIntervalDraft(draftValue) ?? 1;
        setDraftValue(String(committed));
        updateCanonicalInterval(committed);
    };

    return (
        <TextInput
            value={draftValue}
            onChangeText={handleChangeText}
            onBlur={handleBlur}
            keyboardType="number-pad"
            style={style}
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={accessibilityHint}
        />
    );
}
