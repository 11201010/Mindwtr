import type { Language } from './i18n/i18n-types';
import type { Task, TextDirection } from './types';

const RTL_CHAR_REGEX = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
const RTL_LANGUAGES = new Set<Language>(['ar']);

export function detectTextDirection(text: string): 'ltr' | 'rtl' {
    return RTL_CHAR_REGEX.test(text) ? 'rtl' : 'ltr';
}

export function isRtlLanguage(language?: string | null): boolean {
    if (!language) return false;
    return RTL_LANGUAGES.has(language as Language);
}

export function resolveAutoTextDirection(text: string, language?: string | null): 'ltr' | 'rtl' {
    if (RTL_CHAR_REGEX.test(text)) return 'rtl';
    return isRtlLanguage(language) ? 'rtl' : 'ltr';
}

export function resolveTextDirection(text: string, direction?: TextDirection, language?: string | null): 'ltr' | 'rtl' {
    if (direction === 'rtl' || direction === 'ltr') return direction;
    return resolveAutoTextDirection(text, language);
}

export function resolveTaskTextDirection(task: Task, language?: string | null): 'ltr' | 'rtl' {
    const combined = [task.title, task.description].filter(Boolean).join(' ').trim();
    return resolveAutoTextDirection(combined, language);
}
