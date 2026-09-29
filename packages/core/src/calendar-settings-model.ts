/**
 * Settings › Advanced › Calendar's rules, as React Native's
 * `apps/mobile/components/settings/calendar-settings-screen.tsx` applies them:
 * the push card's calendar choices and hints, the device calendar selection,
 * the ICS subscription list edits, the Area choice (#1305), and the screen's
 * texts and toasts. React Native's screen and the native host contract
 * (native-host-contract-settings-calendar.ts) both call these.
 *
 * The device side lives in external-calendar-feeds.ts (feeds, device calendar
 * reads and choices) and calendar-push-service.ts (push options, the Mindwtr
 * calendar).
 */
import { CALENDAR_PUSH_COLOR_OPTIONS, normalizeCalendarPushColor, type CalendarPushTargetCalendar } from './calendar-push-service';
import {
    EXTERNAL_CALENDAR_COLORS,
    hasExplicitExternalCalendarColor,
    normalizeExternalCalendarColor,
    themeExternalCalendarDisplayColor,
} from './external-calendar-colors';
import type { SystemCalendarSettings } from './external-calendar-feeds';
import { tFallback, type I18nTemplateValues } from './i18n';
import type { ExternalCalendarSubscription } from './ics';
import type { Area } from './types';

type Translate = (key: string) => string;
type TranslateText = (key: string, values?: I18nTemplateValues) => string;

export type CalendarSettingsToast = { title: string; message: string; tone: 'success' | 'warning' | 'info'; durationMs?: number };

// ---------------------------------------------------------------------------
// Push: the calendar choices.

export type CalendarPushTargetOption = { id: string | null; name: string; description: string; color?: string };

export type CalendarPushTargetChoices = {
    options: CalendarPushTargetOption[];
    /** "Local calendar targets stay on this device…": the Mindwtr calendar or a local calendar is chosen. */
    localHint: boolean;
    /** "For a separate color in Google Calendar…": a shared account calendar is chosen. */
    sharedAccountHint: boolean;
    /** The Mindwtr calendar's colors: the Mindwtr calendar the app manages is chosen. */
    showColors: boolean;
};

export function describeCalendarPushTarget(calendar: CalendarPushTargetCalendar, tr: TranslateText): string {
    const kind = calendar.isMindwtrDedicated
        ? calendar.isLocalOnly
            ? tr('settings.calendarMobile.dedicatedLocalCalendar')
            : tr('settings.calendarMobile.dedicatedAccountCalendar')
        : calendar.isLocalOnly
            ? tr('settings.calendarMobile.sharedLocalCalendar')
            : tr('settings.calendarMobile.sharedAccountCalendar');
    return calendar.sourceName ? `${kind} · ${calendar.sourceName}` : kind;
}

/**
 * The calendars a user may push to, in React Native's order: "Mindwtr calendar"
 * (the one the app makes; `id` null) unless an account calendar named Mindwtr
 * exists, then the writable calendars, without the managed one or a local
 * Mindwtr calendar beside an account one unless it is the chosen target.
 *
 * "Mindwtr calendar" says where that calendar is: where the one the app made
 * lives, else where the app will make it (calendar-push-service.ts): on Android
 * on the account of the first calendar the phone owns, on iOS on the local source.
 */
export function buildCalendarPushTargetChoices(input: {
    targets: readonly CalendarPushTargetCalendar[];
    targetId: string | null;
    color: string;
    tr: TranslateText;
    /** 'android' or 'ios'. */
    platform: string;
}): CalendarPushTargetChoices {
    const { targets, targetId, color, tr } = input;
    const selected = targetId ? targets.find((calendar) => calendar.id === targetId) : null;
    const hasDedicatedAccount = targets.some((calendar) => calendar.isMindwtrDedicated && !calendar.isLocalOnly);
    const managed = targets.find((calendar) => calendar.isMindwtrManaged);
    const managedLocalOnly = managed ? managed.isLocalOnly : input.platform !== 'android';
    const managedKind = managedLocalOnly
        ? tr('settings.calendarMobile.dedicatedLocalCalendar')
        : tr('settings.calendarMobile.dedicatedAccountCalendar');
    const defaultLocal: CalendarPushTargetOption = {
        id: null,
        name: tr('settings.calendarMobile.mindwtrCalendar'),
        description: managed?.sourceName ? `${managedKind} · ${managed.sourceName}` : managedKind,
        color,
    };
    return {
        options: [
            ...(!hasDedicatedAccount || targetId === null ? [defaultLocal] : []),
            ...targets
                .filter((calendar) => {
                    if (calendar.isMindwtrManaged && calendar.id !== targetId) return false;
                    if (hasDedicatedAccount && calendar.isMindwtrDedicated && calendar.isLocalOnly && calendar.id !== targetId) {
                        return false;
                    }
                    return true;
                })
                .map((calendar) => ({
                    id: calendar.id as string | null,
                    name: calendar.name,
                    description: describeCalendarPushTarget(calendar, tr),
                    color: calendar.color,
                })),
        ],
        localHint: targetId === null ? managedLocalOnly : Boolean(selected?.isLocalOnly),
        sharedAccountHint: Boolean(selected && !selected.isMindwtrDedicated && !selected.isLocalOnly),
        showColors: targetId === null || selected?.isMindwtrManaged === true,
    };
}

/** The color to store, or null when `picked` is the stored one: re-picking must not recreate the Mindwtr calendar (Android). */
export const planCalendarPushColor = (current: string, picked: string): string | null => (
    normalizeCalendarPushColor(picked) === normalizeCalendarPushColor(current) ? null : picked
);

/**
 * Whether Delete Mindwtr calendar left the chosen push calendar (and the events pushed to it):
 * the stored choice before the delete and after it. The delete clears a choice it removed.
 */
export const keptPushTargetEvents = (before: string | null, after: string | null): boolean => before !== null && after === before;

export const getCalendarPushColorLabel = (t: Translate): string => (
    tFallback(t, 'settings.calendarMobile.mindwtrCalendarColor', 'Mindwtr calendar color')
);

export const getCalendarPushColorDescription = (t: Translate): string => tFallback(
    t,
    'settings.calendarMobile.mindwtrCalendarColorDesc',
    'Applies to the Mindwtr-created calendar; shared account calendars keep their own color.',
);

export const getCalendarPushColorOptions = (current: string, t: Translate) => CALENDAR_PUSH_COLOR_OPTIONS.map((color) => ({
    color: color as string,
    selected: color.toUpperCase() === current.toUpperCase(),
    accessibilityLabel: `${getCalendarPushColorLabel(t)} ${color}`,
}));

// ---------------------------------------------------------------------------
// Device calendars.

/**
 * The selection after one calendar's switch: "all" again once every calendar is
 * on. Null when the device lists no calendar.
 */
export function nextDeviceCalendarSelection(input: {
    calendarIds: readonly string[];
    selectAll: boolean;
    selectedCalendarIds: readonly string[];
    calendarId: string;
    enabled: boolean;
}): Pick<SystemCalendarSettings, 'selectAll' | 'selectedCalendarIds'> | null {
    const allIds = [...input.calendarIds];
    if (allIds.length === 0) return null;
    const currentSelection = input.selectAll
        ? allIds
        : Array.from(new Set(input.selectedCalendarIds.filter((id) => allIds.includes(id))));
    const nextSelection = input.enabled
        ? Array.from(new Set([...currentSelection, input.calendarId]))
        : currentSelection.filter((id) => id !== input.calendarId);
    const selectAll = nextSelection.length === allIds.length;
    return { selectAll, selectedCalendarIds: selectAll ? [] : nextSelection };
}

/** The stored selection without calendars the device no longer has; null when nothing drops. */
export function pruneDeviceCalendarSelection(
    stored: Pick<SystemCalendarSettings, 'selectAll' | 'selectedCalendarIds'>,
    calendarIds: readonly string[],
): string[] | null {
    if (stored.selectAll) return null;
    const validIds = new Set(calendarIds);
    const filtered = stored.selectedCalendarIds.filter((id) => validIds.has(id));
    if (filtered.length === stored.selectedCalendarIds.length
        && filtered.every((id, index) => id === stored.selectedCalendarIds[index])) {
        return null;
    }
    return filtered;
}

export const toggleCalendarAreaId = (current: readonly string[], areaId: string): string[] => (
    current.includes(areaId) ? current.filter((id) => id !== areaId) : [...current, areaId]
);

// ---------------------------------------------------------------------------
// The Area choice (#1305).

export type CalendarAreaChoice = {
    /** "Show in Areas: Work, Home" (all Areas while none is chosen). */
    label: string;
    options: { areaId: string; label: string; checked: boolean }[];
};

/** Null while there is no Area: the screen then shows no choice. */
export function buildCalendarAreaChoice(selectedIds: readonly string[], areas: readonly Area[], t: Translate): CalendarAreaChoice | null {
    const areaOptions = areas.filter((area) => !area.deletedAt);
    if (areaOptions.length === 0) return null;
    const names = areaOptions.filter((area) => selectedIds.includes(area.id)).map((area) => area.name).join(', ');
    return {
        label: `${t('settings.calendarShowInAreas')}: ${selectedIds.length === 0 ? t('settings.calendarAllAreas') : names || t('settings.calendarAllAreas')}`,
        options: areaOptions.map((area) => ({
            areaId: area.id,
            label: `${selectedIds.includes(area.id) ? '☑' : '☐'} ${area.name}`,
            checked: selectedIds.includes(area.id),
        })),
    };
}

// ---------------------------------------------------------------------------
// ICS subscriptions.

/** Which list the screen shows on open, and whether it rewrites the device copy (the synced list wins). */
export function resolveCalendarFeedsOnLoad(
    synced: ExternalCalendarSubscription[] | undefined,
    stored: readonly ExternalCalendarSubscription[],
): { feeds: ExternalCalendarSubscription[]; saveDeviceCopy: boolean } {
    if (Array.isArray(synced)) {
        return { feeds: synced, saveDeviceCopy: synced.length > 0 || stored.length > 0 };
    }
    return { feeds: [...stored], saveDeviceCopy: false };
}

/** A new subscription (no color: an unset color lets a feed hint or the default apply, #974); null without a URL. */
export function addCalendarFeed(
    feeds: readonly ExternalCalendarSubscription[],
    input: { id: string; name: string; url: string; defaultName: string },
): ExternalCalendarSubscription[] | null {
    const url = input.url.trim();
    if (!url) return null;
    const name = (input.name.trim() || input.defaultName).trim();
    return [...feeds, { id: input.id, name, url, enabled: true }];
}

/** A picked local .ics file: named as typed, else after the file. */
export function addCalendarFile(
    feeds: readonly ExternalCalendarSubscription[],
    input: { id: string; name: string; fileName: string | null | undefined; uri: string; defaultName: string },
): ExternalCalendarSubscription[] {
    const fileName = (input.fileName || input.uri.split('/').pop() || '').trim();
    const inferredName = fileName.replace(/\.ics$/iu, '').trim();
    const name = (input.name.trim() || inferredName || input.defaultName).trim();
    return [...feeds, { id: input.id, name, url: input.uri.trim(), enabled: true }];
}

export const setCalendarFeedEnabled = (feeds: readonly ExternalCalendarSubscription[], id: string, enabled: boolean): ExternalCalendarSubscription[] => (
    feeds.map((feed) => (feed.id === id ? { ...feed, enabled } : feed))
);

/**
 * `undefined` is the Auto swatch: the pick is dropped so a feed hint or the default applies (#974).
 * Null for a color no swatch has, and for the color the subscription already has (nothing to write).
 */
export function setCalendarFeedColor(
    feeds: readonly ExternalCalendarSubscription[],
    id: string,
    color: string | undefined,
): ExternalCalendarSubscription[] | null {
    const normalized = color === undefined ? undefined : normalizeExternalCalendarColor(color);
    if (color !== undefined && !normalized) return null;
    if (feeds.find((feed) => feed.id === id)?.color === normalized) return null;
    return feeds.map((feed) => {
        if (feed.id !== id) return feed;
        if (normalized) return { ...feed, color: normalized };
        const { color: _cleared, ...rest } = feed;
        return rest;
    });
}

export const toggleCalendarFeedArea = (feeds: readonly ExternalCalendarSubscription[], id: string, areaId: string): ExternalCalendarSubscription[] => (
    feeds.map((feed) => (feed.id === id ? { ...feed, areaIds: toggleCalendarAreaId(feed.areaIds ?? [], areaId) } : feed))
);

export const removeCalendarFeed = (feeds: readonly ExternalCalendarSubscription[], id: string): ExternalCalendarSubscription[] => (
    feeds.filter((feed) => feed.id !== id)
);

/** A subscription's URL as the list shows it: the scheme, the host (without credentials) and the end of the path. */
export const maskCalendarFeedUrl = (url: string): string => {
    // A URL's user name and password never show, whatever its scheme (webcal:// too).
    const trimmed = url.trim().replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1');
    if (!trimmed) return '';
    const match = trimmed.match(/^(https?:\/\/)?([^/?#]+)([^?#]*)/i);
    if (!match) {
        return trimmed.length <= 8 ? '...' : `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
    }
    const protocol = match[1] ?? '';
    const host = (match[2] ?? '').replace(/^.*@/, '');
    const path = match[3] ?? '';
    const lastSegment = path.split('/').filter(Boolean).pop() ?? '';
    const suffix = lastSegment ? `...${lastSegment.slice(-6)}` : '...';
    return `${protocol}${host}/${suffix}`;
};

/** A subscription's swatches: Auto, then each pickable color (filled in the theme's stand-in). */
export function getCalendarFeedColorOptions(feed: ExternalCalendarSubscription, t: Translate, themePreset?: string) {
    const explicit = hasExplicitExternalCalendarColor(feed.id, feed.color);
    return [
        { color: null as string | null, fill: null as string | null, selected: !explicit, accessibilityLabel: `${feed.name} ${t('taskEdit.textDirection.auto')}` },
        ...EXTERNAL_CALENDAR_COLORS.map((color) => ({
            color: color as string | null,
            // Fill only — the stored pick stays canonical (#974).
            fill: themeExternalCalendarDisplayColor(color, themePreset) as string | null,
            selected: explicit && feed.color === color,
            accessibilityLabel: `${feed.name} ${color}`,
        })),
    ];
}

// ---------------------------------------------------------------------------
// Test: this month's events.

export function getCalendarTestRange(now: Date): { start: Date; end: Date } {
    return {
        start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
    };
}

export const isChineseCalendarSettingsLanguage = (language: string): boolean => language === 'zh' || language === 'zh-Hant';

// ---------------------------------------------------------------------------
// Toasts, as React Native shows them.

export const calendarSettingsToasts = (tr: TranslateText, t: Translate) => ({
    loadWritableCalendarsFailed: (): CalendarSettingsToast => ({
        title: tr('settings.syncMobile.error'), message: tr('settings.calendarMobile.failedToLoadWritableCalendars'), tone: 'warning', durationMs: 4200,
    }),
    pushPermissionRequired: (): CalendarSettingsToast => ({
        title: tr('settings.calendarMobile.permissionRequired'),
        message: tr('settings.calendarMobile.calendarAccessIsRequiredToPushTasksToYourCalendar'),
        tone: 'warning',
        durationMs: 4200,
    }),
    pushDisabled: (): CalendarSettingsToast => ({
        title: tr('settings.calendarMobile.calendarSyncDisabled'),
        message: tr('settings.calendarMobile.tasksWillNoLongerBePushedToYourCalendarExisting'),
        tone: 'info',
        durationMs: 4200,
    }),
    pushTargetUpdated: (): CalendarSettingsToast => ({
        title: tr('settings.calendarMobile.calendarTargetUpdated'),
        message: tr('settings.calendarMobile.dueDateTasksWillBeWrittenToTheSelectedCalendar'),
        tone: 'success',
        durationMs: 3200,
    }),
    pushColorUpdated: (updated: boolean): CalendarSettingsToast => ({
        title: tFallback(t, 'settings.calendarMobile.calendarColorUpdated', 'Calendar color updated'),
        message: updated
            ? tFallback(t, 'settings.calendarMobile.calendarColorUpdatedMessage', 'Mindwtr calendar color was updated.')
            : tFallback(t, 'settings.calendarMobile.calendarColorSavedMessage', 'Mindwtr will use this color when it creates the calendar.'),
        tone: 'success',
        durationMs: 3000,
    }),
    /** After Delete Mindwtr calendar; `keptTargetEvents` (keptPushTargetEvents): the chosen calendar, not the app's, kept its pushed events. */
    mindwtrCalendarDeleted: (keptTargetEvents: boolean): CalendarSettingsToast => ({
        title: tr('settings.calendarMobile.calendarDeleted'),
        message: keptTargetEvents
            ? tr('settings.calendarMobile.mindwtrCalendarRemovedPushedEventsKept')
            : tr('settings.calendarMobile.theMindwtrCalendarAndAllItsEventsHaveBeenRemoved'),
        tone: 'success',
        durationMs: 3500,
    }),
    loadDeviceCalendarsFailed: (): CalendarSettingsToast => ({
        title: tr('settings.syncMobile.error'), message: tr('settings.calendarMobile.failedToLoadDeviceCalendarSettings'), tone: 'warning', durationMs: 4200,
    }),
    loadSavedCalendarsFailed: (): CalendarSettingsToast => ({
        title: tr('settings.syncMobile.error'), message: tr('settings.calendarMobile.failedToLoadSavedCalendars'), tone: 'warning', durationMs: 4200,
    }),
    localFileAdded: (): CalendarSettingsToast => ({
        title: tr('settings.calendarMobile.localIcsFileAdded'),
        message: tr('settings.calendarMobile.localIcsFilesAreReadOnly'),
        tone: 'success',
        durationMs: 3500,
    }),
    /** Test's answer: the events loaded, or a failure when a subscription could not be read. */
    testResult: (count: number, failedFeeds: number, language: string): CalendarSettingsToast => (
        failedFeeds > 0 ? calendarSettingsToasts(tr, t).testFailed() : calendarSettingsToasts(tr, t).testLoaded(count, language)
    ),
    testLoaded: (count: number, language: string): CalendarSettingsToast => ({
        title: tr('common.success'),
        message: isChineseCalendarSettingsLanguage(language) ? `已加载 ${count} 个日程` : `Loaded ${count} events`,
        tone: 'success',
    }),
    testFailed: (): CalendarSettingsToast => ({
        title: tr('settings.syncMobile.error'), message: tr('settings.calendarMobile.failedToLoadEvents'), tone: 'warning',
    }),
});
