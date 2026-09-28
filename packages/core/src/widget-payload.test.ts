import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadTranslations } from './i18n/i18n-loader';
import type { AppData, AppSettings, Task } from './types';
import { buildWidgetPayload, resolveWidgetLanguage } from './widget-payload';

describe('resolveWidgetLanguage', () => {
    it('falls back to the device language, as the app does, when no language was chosen', () => {
        expect(resolveWidgetLanguage(null, undefined, 'es')).toBe('es');
        expect(resolveWidgetLanguage(null, 'system', 'ja')).toBe('ja');
        expect(resolveWidgetLanguage('system', 'system', 'zh')).toBe('zh');
        expect(resolveWidgetLanguage('unknown', undefined, 'uk')).toBe('uk');
    });

    it('keeps a chosen language ahead of the device language', () => {
        expect(resolveWidgetLanguage('zh', 'system', 'es')).toBe('zh');
        expect(resolveWidgetLanguage('en', undefined, 'es')).toBe('en');
        expect(resolveWidgetLanguage('en', 'de', 'es')).toBe('de');
        expect(resolveWidgetLanguage(null, undefined)).toBe('en');
    });
});

describe('widget times', () => {
    const originalTz = process.env.TZ;
    beforeAll(async () => {
        process.env.TZ = 'UTC';
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-28T15:30:00.000Z'));
        await loadTranslations('en');
    });
    afterAll(() => {
        vi.useRealTimers();
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });

    const task = (id: string, extra: Partial<Task>): Task => ({
        id, title: id, status: 'next', tags: [], contexts: [],
        createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', ...extra,
    });
    const times = (settings: Partial<AppSettings>) => {
        const data: AppData = {
            tasks: [task('due-tonight', { dueDate: '2026-09-28T21:30:00', startTime: '2026-09-28T08:05:00' })],
            projects: [], sections: [], areas: [], settings: settings as AppSettings,
        };
        const payload = buildWidgetPayload(data, 'en', { systemLocale: 'en-US' });
        const row = payload.sections.find((section) => section.key === 'schedule')?.items[0];
        return { due: row?.dueLabel, start: row?.startLabel };
    };

    it('reads a 24-hour or 12-hour setting as the app does', () => {
        expect(times({ timeFormat: '24h' })).toEqual({ due: '21:30', start: 'Today 08:05' });
        expect(times({ timeFormat: '12h' })).toEqual({ due: '09:30 PM', start: 'Today 08:05 AM' });
    });

    it('keeps the language form under the System setting', () => {
        const system = times({});
        expect(system.due).toMatch(/^9:30\sPM$/);
        expect(system.start).toMatch(/^Today 8:05\sAM$/);
    });
});
