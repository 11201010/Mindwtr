import type { Language } from './i18n-types';

const translationsCache = new Map<Language, Record<string, string>>();
let loadPromise: Promise<void> | null = null;
async function ensureLoaded() {
    if (!loadPromise) {
        loadPromise = (async () => {
            const loadModule = async () => {
                if (typeof require === 'function') {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    try {
                        return require('./i18n-translations') as typeof import('./i18n-translations');
                    } catch {
                        // Fall back to dynamic import for web/desktop bundlers.
                    }
                }
                return import('./i18n-translations');
            };
            const mod = await loadModule();
            const { translations } = mod;
            if (!translations) return;
            (Object.keys(translations) as Language[]).forEach((lang) => {
                translationsCache.set(lang, translations[lang]);
            });
        })().catch((error) => {
            loadPromise = null;
            throw error;
        });
    }
    await loadPromise;
}

export async function loadTranslations(lang: Language): Promise<Record<string, string>> {
    await ensureLoaded();
    return translationsCache.get(lang) || translationsCache.get('en') || {};
}

export async function getTranslations(lang: Language): Promise<Record<string, string>> {
    return loadTranslations(lang);
}

export function getTranslationsSync(lang: Language): Record<string, string> {
    return translationsCache.get(lang) || translationsCache.get('en') || {};
}
