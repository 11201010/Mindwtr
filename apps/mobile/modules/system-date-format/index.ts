import { normalizeSystemDateFormat } from '@mindwtr/core/date';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/** Older clients and Expo Go keep the existing locale fallback. */
export function getSystemDateFormat(): string | undefined {
    if (Platform.OS !== 'ios') return undefined;
    try {
        const native = requireOptionalNativeModule<{ getShortDateFormat(): unknown }>('MindwtrSystemDateFormat');
        return normalizeSystemDateFormat(native?.getShortDateFormat());
    } catch {
        return undefined;
    }
}
