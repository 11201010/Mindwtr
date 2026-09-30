import type { AppSettings } from './types';

export type GeneralPreferenceType = 'showTaskAge' | 'weekStart' | 'dateFormat' | 'timeFormat';
export type GeneralPreferenceWitness = { present: boolean; value: boolean | string | number | null;
    stampPresent: boolean; stamp: string | null };

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const iso = (value: unknown): value is string => typeof value === 'string' && value.length <= 40
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const legacyGeneralPreferenceNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000;

/** The one raw value and sync-group stamp that may enter a General journal. */
export const generalPreferenceWitness = (settings: AppSettings, type: GeneralPreferenceType): GeneralPreferenceWitness | null => {
    const value = type === 'showTaskAge' ? settings.appearance?.showTaskAge : settings[type];
    const present = value !== undefined && (type === 'showTaskAge'
        ? settings.appearance !== undefined && record(settings.appearance) && own(settings.appearance, 'showTaskAge')
        : own(settings, type));
    const group = type === 'showTaskAge' ? 'appearance' : 'language';
    const stamps = settings.syncPreferencesUpdatedAt;
    if (type === 'showTaskAge' && settings.appearance !== undefined && !record(settings.appearance)
        || stamps !== undefined && !record(stamps)) return null;
    const stampPresent = stamps !== undefined && own(stamps, group) && stamps[group] !== undefined;
    const stamp = stampPresent ? stamps?.[group] : null;
    if (present && !(type === 'showTaskAge' ? typeof value === 'boolean'
        : typeof value === 'string' && value.length <= 500 || legacyGeneralPreferenceNumber(value))
        || stampPresent && !iso(stamp)) return null;
    return { present, value: present ? value as boolean | string | number : null,
        stampPresent, stamp: stampPresent ? stamp! : null };
};
