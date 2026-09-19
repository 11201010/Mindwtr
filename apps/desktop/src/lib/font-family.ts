import { isTauriRuntime } from './runtime';
import { invokeNativeOr } from './tauri-invoke';

export const FONT_FAMILY_STORAGE_KEY = 'mindwtr-font-family';
const MAX_FONT_FAMILY_LENGTH = 120;
// Tailwind's default sans stack, so "app default" renders exactly as before (#1244).
const DEFAULT_FONT_STACK = 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

/** Empty string means the app default (Tailwind's stack, which already resolves to the
 *  OS interface font on every platform). The value goes into a CSS custom property,
 *  so anything that could end the declaration or the family name is dropped. */
export function coerceDesktopFontFamily(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.replace(/[;{}<>"'\\\r\n]/g, '').trim().slice(0, MAX_FONT_FAMILY_LENGTH);
}

export function resolveDesktopFontStack(family: string): string {
    const name = coerceDesktopFontFamily(family);
    if (!name) return DEFAULT_FONT_STACK;
    return `"${name}", ${DEFAULT_FONT_STACK}`;
}

export function applyDesktopFontFamily(family: string): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const name = coerceDesktopFontFamily(family);
    if (!name) {
        root.style.removeProperty('--mindwtr-font-family');
        return;
    }
    root.style.setProperty('--mindwtr-font-family', resolveDesktopFontStack(name));
}

/** The native shell enumerates fonts; the plain web build has nothing to list. */
export function canListInstalledFonts(): boolean {
    return isTauriRuntime();
}

/** Installed font families from the desktop shell (see src-tauri system_fonts.rs). */
export async function loadInstalledFontFamilies(): Promise<string[]> {
    if (!isTauriRuntime()) return [];
    const families = await invokeNativeOr<unknown>([], 'list_system_fonts');
    if (!Array.isArray(families)) return [];
    return families.map(coerceDesktopFontFamily).filter((family) => family.length > 0);
}
