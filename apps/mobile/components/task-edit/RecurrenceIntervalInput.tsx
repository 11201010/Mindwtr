import React from 'react';
import { TextInput } from 'react-native';
import {
    getRecurrenceIntervalDisplay as normalizeRecurrenceInterval,
    parseRecurrenceIntervalInput as parseRecurrenceIntervalDraft,
} from '@mindwtr/core';

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
