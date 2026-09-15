import { describe, expect, it } from 'vitest';
import { getDocsGuideUrl, getDocsLocale } from './docs-guidance';

describe('public documentation routing', () => {
    it.each([
        ['en', 'https://docs.mindwtr.app/data-sync/'],
        ['de', 'https://docs.mindwtr.app/de/data-sync/'],
        ['es', 'https://docs.mindwtr.app/es/data-sync/'],
        ['fr', 'https://docs.mindwtr.app/fr/data-sync/'],
        ['zh', 'https://docs.mindwtr.app/zh-Hans/data-sync/'],
        ['zh-Hant', 'https://docs.mindwtr.app/zh-Hant/data-sync/'],
        ['uk', 'https://docs.mindwtr.app/data-sync/'],
    ])('routes %s to %s', (language, expected) => {
        expect(getDocsGuideUrl('data-sync/', language)).toBe(expected);
    });

    it.each([
        ['en', 'sync-encryption'],
        ['de', 'sync-verschlusselung'],
        ['es', 'cifrado-de-la-sincronizacion'],
        ['fr', 'chiffrement-de-la-synchronisation'],
        ['zh', '同步加密'],
        ['zh-Hant', '同步加密'],
        ['uk', 'sync-encryption'],
    ])('uses the generated encryption heading for %s', (language, anchor) => {
        expect(getDocsGuideUrl('data-sync/', language, 'sync-encryption'))
            .toBe(`${getDocsGuideUrl('data-sync/', language)}#${encodeURIComponent(anchor)}`);
    });

    it('uses a localized start guide anchor and keeps English for unsupported languages', () => {
        expect(getDocsGuideUrl('start/getting-started', 'fr', 'basic-workflow'))
            .toBe('https://docs.mindwtr.app/fr/start/getting-started#flux-de-base');
        expect(getDocsGuideUrl('start/getting-started', 'uk', 'basic-workflow'))
            .toBe('https://docs.mindwtr.app/start/getting-started#the-basic-workflow');
        expect(getDocsLocale(undefined)).toBe('en');
    });
});
