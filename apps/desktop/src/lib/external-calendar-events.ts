import { parseIcs, type ExternalCalendarEvent, type ExternalCalendarSubscription } from '@mindwtr/core';
import { ExternalCalendarService } from './external-calendar-service';
import { isTauriRuntime } from './runtime';

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
    if (isTauriRuntime()) {
        const mod: any = await import('@tauri-apps/plugin-http');
        const tauriFetch: any = mod.fetch;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await tauriFetch(url, { method: 'GET', signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.text();
        } finally {
            clearTimeout(timeout);
        }
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export async function fetchExternalCalendarEvents(
    rangeStart: Date,
    rangeEnd: Date,
): Promise<{
    calendars: ExternalCalendarSubscription[];
    events: ExternalCalendarEvent[];
}> {
    const calendars = await ExternalCalendarService.getCalendars();
    const enabled = calendars.filter((calendar) => calendar.enabled);
    if (enabled.length === 0) {
        return { calendars, events: [] };
    }

    const results = await Promise.allSettled(
        enabled.map(async (calendar) => {
            const text = await fetchTextWithTimeout(calendar.url, 15_000);
            return parseIcs(text, { sourceId: calendar.id, rangeStart, rangeEnd });
        })
    );

    const events: ExternalCalendarEvent[] = [];
    for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        events.push(...result.value);
    }

    return { calendars, events };
}
