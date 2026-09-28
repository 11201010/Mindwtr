import { describe, expect, it } from 'vitest';
import { resolveWidgetLanguage } from './widget-payload';

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
