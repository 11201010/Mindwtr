import { describe, expect, it } from 'vitest';
import { getTranslationsSync } from './i18n-loader';

describe('i18n-loader sync fallback', () => {
    it('provides English translations synchronously for first render', () => {
        expect(getTranslationsSync('en')['app.name']).toBe('Mindwtr');
        expect(getTranslationsSync('zh')['nav.inbox']).toBe('Inbox');
    });
});
