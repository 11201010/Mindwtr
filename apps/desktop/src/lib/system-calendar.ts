import type { ExternalCalendarEvent, ExternalCalendarSubscription } from '@mindwtr/core';
import { isTauriRuntime } from './runtime';
import { reportError } from './report-error';

export type SystemCalendarPermissionStatus = 'undetermined' | 'granted' | 'denied' | 'unsupported';

type MacOsCalendarReadResult = {
    permission: SystemCalendarPermissionStatus;
    calendars: ExternalCalendarSubscription[];
    events: ExternalCalendarEvent[];
};

const UNSUPPORTED_RESULT: MacOsCalendarReadResult = {
    permission: 'unsupported',
    calendars: [],
    events: [],
};

const normalizePermissionStatus = (value: unknown): SystemCalendarPermissionStatus => {
    if (value === 'undetermined' || value === 'granted' || value === 'denied' || value === 'unsupported') {
        return value;
    }
    return 'denied';
};

const isMacOsEnvironment = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const source = `${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
    return source.includes('mac');
};

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const mod = await import('@tauri-apps/api/core');
    return mod.invoke<T>(command as never, args as never);
}

export async function getSystemCalendarPermissionStatus(): Promise<SystemCalendarPermissionStatus> {
    if (!isTauriRuntime() || !isMacOsEnvironment()) return 'unsupported';
    try {
        const status = await tauriInvoke<string>('get_macos_calendar_permission_status');
        return normalizePermissionStatus(status);
    } catch (error) {
        reportError('Failed to read macOS calendar permission status', error);
        return 'denied';
    }
}

export async function requestSystemCalendarPermission(): Promise<SystemCalendarPermissionStatus> {
    if (!isTauriRuntime() || !isMacOsEnvironment()) return 'unsupported';
    try {
        const status = await tauriInvoke<string>('request_macos_calendar_permission');
        return normalizePermissionStatus(status);
    } catch (error) {
        reportError('Failed to request macOS calendar permission', error);
        return 'denied';
    }
}

export async function fetchSystemCalendarEvents(rangeStart: Date, rangeEnd: Date): Promise<MacOsCalendarReadResult> {
    if (!isTauriRuntime() || !isMacOsEnvironment()) return UNSUPPORTED_RESULT;
    try {
        const payload = await tauriInvoke<MacOsCalendarReadResult>('get_macos_calendar_events', {
            rangeStart: rangeStart.toISOString(),
            rangeEnd: rangeEnd.toISOString(),
        });
        return {
            permission: normalizePermissionStatus(payload?.permission),
            calendars: Array.isArray(payload?.calendars) ? payload.calendars : [],
            events: Array.isArray(payload?.events) ? payload.events : [],
        };
    } catch (error) {
        reportError('Failed to read macOS EventKit events', error);
        return {
            permission: 'denied',
            calendars: [],
            events: [],
        };
    }
}

