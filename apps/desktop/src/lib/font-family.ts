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

/** What the renderer will do with bold text in a family (#1244).
 *
 *  `real` — it has a bold face and draws it. `synthesized` — it has none, so the renderer
 *  fakes one by smearing the regular face, which looks doubled and blurry. `fallback` —
 *  the family did not resolve at all, so this is some other font's answer. `unknown` —
 *  the measurement could not run. */
export type BoldFaceCheck = 'real' | 'synthesized' | 'fallback' | 'unknown';

// Any name no font can have, to measure what an unresolved family falls back to.
const MISSING_FAMILY = 'MindwtrNoSuchFamily';
const BOLD_PROBE_TEXT = 'Handgloves quick brown fox';

/** Whether the renderer has a real bold face for `family`, or will fake it.
 *
 *  A synthesized bold is applied when the glyph is drawn, not when it is measured, so it
 *  moves nothing: a family with one face measures identically at weight 400 and 700,
 *  while a family with a real bold face measures wider. A family the renderer cannot find
 *  measures like the fallback font, which has its own bold and would otherwise read as
 *  `real`, so that case is ruled out first. */
export function checkBoldFace(family: string): BoldFaceCheck {
    const name = coerceDesktopFontFamily(family);
    if (!name || typeof document === 'undefined') return 'unknown';
    let measure: CanvasRenderingContext2D | null = null;
    try {
        measure = document.createElement('canvas').getContext('2d');
    } catch {
        return 'unknown';
    }
    if (!measure) return 'unknown';
    const width = (weight: number, on: string): number => {
        measure.font = `${weight} 40px "${on}"`;
        return measure.measureText(BOLD_PROBE_TEXT).width;
    };
    const missingRegular = width(400, MISSING_FAMILY);
    const missingBold = width(700, MISSING_FAMILY);
    const regular = width(400, name);
    const bold = width(700, name);
    if (!regular || !bold) return 'unknown';
    if (regular === missingRegular && bold === missingBold) return 'fallback';
    return regular === bold ? 'synthesized' : 'real';
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
