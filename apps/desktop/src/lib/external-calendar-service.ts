import {
    generateUUID,
    normalizeExternalCalendarColor,
    type ExternalCalendarSubscription,
} from '@mindwtr/core';
import { isTauriRuntime } from './runtime';
import { reportError } from './report-error';
import { invokeNative } from './tauri-invoke';

const EXTERNAL_CALENDARS_KEY = 'mindwtr-external-calendars';

function safeJsonParse<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function sanitizeCalendars(calendars: ExternalCalendarSubscription[]): ExternalCalendarSubscription[] {
    return calendars
        .filter((c) => c && typeof c.url === 'string')
        .map((c) => ({
            id: c.id || generateUUID(),
            name: (c.name || 'Calendar').trim() || 'Calendar',
            url: (c.url || '').trim(),
            enabled: c.enabled !== false,
            color: normalizeExternalCalendarColor(c.color),
            ...(Array.isArray(c.areaIds) ? { areaIds: c.areaIds } : {}),
        }))
        .filter((c) => c.url.length > 0);
}

export class ExternalCalendarService {
    static async getCalendars(): Promise<ExternalCalendarSubscription[]> {
        if (!isTauriRuntime()) {
            return sanitizeCalendars(safeJsonParse(localStorage.getItem(EXTERNAL_CALENDARS_KEY), []));
        }

        try {
            const calendars = await invokeNative<ExternalCalendarSubscription[]>('get_external_calendars');
            return sanitizeCalendars(calendars);
        } catch (error) {
            reportError('Failed to read external calendars', error);
            return sanitizeCalendars(safeJsonParse(localStorage.getItem(EXTERNAL_CALENDARS_KEY), []));
        }
    }

    static async setCalendars(calendars: ExternalCalendarSubscription[]): Promise<void> {
        const sanitized = sanitizeCalendars(calendars);
        if (!isTauriRuntime()) {
            localStorage.setItem(EXTERNAL_CALENDARS_KEY, JSON.stringify(sanitized));
            return;
        }

        try {
            await invokeNative('set_external_calendars', { calendars: sanitized });
        } catch (error) {
            reportError('Failed to save external calendars', error);
            localStorage.setItem(EXTERNAL_CALENDARS_KEY, JSON.stringify(sanitized));
        }
    }
}
