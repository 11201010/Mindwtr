import type { Language } from './i18n-types';
import { autoTranslate } from './i18n-translate';

import { en } from './i18n/locales/en';
import { zh } from './i18n/locales/zh';
import { esOverrides } from './i18n/locales/es';
import { hiOverrides } from './i18n/locales/hi';
import { arOverrides } from './i18n/locales/ar';
import { deOverrides } from './i18n/locales/de';
import { ruOverrides } from './i18n/locales/ru';
import { jaOverrides } from './i18n/locales/ja';
import { frOverrides } from './i18n/locales/fr';
import { ptOverrides } from './i18n/locales/pt';
import { koOverrides } from './i18n/locales/ko';
import { itOverrides } from './i18n/locales/it';
import { trOverrides } from './i18n/locales/tr';

const buildTranslations = (lang: Language, overrides: Record<string, string>) => {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(en)) {
        result[key] = overrides[key] ?? autoTranslate(value, lang);
    }
    return result;
};

const es = buildTranslations('es', esOverrides);
const hi = buildTranslations('hi', hiOverrides);
const ar = buildTranslations('ar', arOverrides);
const de = buildTranslations('de', deOverrides);
const ru = buildTranslations('ru', ruOverrides);
const ja = buildTranslations('ja', jaOverrides);
const fr = buildTranslations('fr', frOverrides);
const pt = buildTranslations('pt', ptOverrides);
const ko = buildTranslations('ko', koOverrides);
const it = buildTranslations('it', itOverrides);
const tr = buildTranslations('tr', trOverrides);

export const translations: Record<Language, Record<string, string>> = {
    en,
    zh,
    es,
    hi,
    ar,
    de,
    ru,
    ja,
    fr,
    pt,
    ko,
    it,
    tr,
};
