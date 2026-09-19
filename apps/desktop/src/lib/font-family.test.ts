import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isTauriRuntime: vi.fn(() => false),
    invokeNativeOr: vi.fn(async (fallback: unknown) => fallback),
}));

vi.mock('./runtime', () => ({ isTauriRuntime: mocks.isTauriRuntime }));
vi.mock('./tauri-invoke', () => ({ invokeNativeOr: mocks.invokeNativeOr }));

import {
    applyDesktopFontFamily,
    canListInstalledFonts,
    coerceDesktopFontFamily,
    loadInstalledFontFamilies,
    resolveDesktopFontStack,
} from './font-family';

describe('font-family (#1244)', () => {
    afterEach(() => {
        document.documentElement.style.removeProperty('--mindwtr-font-family');
        mocks.isTauriRuntime.mockReturnValue(false);
        mocks.invokeNativeOr.mockReset();
        mocks.invokeNativeOr.mockImplementation(async (fallback: unknown) => fallback);
    });

    it('keeps a family name safe for a CSS custom property', () => {
        expect(coerceDesktopFontFamily('  Inter ')).toBe('Inter');
        expect(coerceDesktopFontFamily('Segoe UI"; color: red; {')).toBe('Segoe UI color: red');
        expect(coerceDesktopFontFamily(42)).toBe('');
        expect(coerceDesktopFontFamily('x'.repeat(200))).toHaveLength(120);
    });

    it('builds a stack that always falls back to the default fonts', () => {
        expect(resolveDesktopFontStack('')).toMatch(/^ui-sans-serif, system-ui/);
        expect(resolveDesktopFontStack('Inter')).toMatch(/^"Inter", ui-sans-serif/);
    });

    it('sets and clears the root custom property', () => {
        applyDesktopFontFamily('Inter');
        expect(document.documentElement.style.getPropertyValue('--mindwtr-font-family')).toContain('"Inter"');
        applyDesktopFontFamily('');
        expect(document.documentElement.style.getPropertyValue('--mindwtr-font-family')).toBe('');
    });

    it('lists installed families only through the native shell', async () => {
        expect(canListInstalledFonts()).toBe(false);
        await expect(loadInstalledFontFamilies()).resolves.toEqual([]);
        expect(mocks.invokeNativeOr).not.toHaveBeenCalled();

        mocks.isTauriRuntime.mockReturnValue(true);
        mocks.invokeNativeOr.mockResolvedValue(['Cascadia Code', ' Inter ', '', 42]);
        expect(canListInstalledFonts()).toBe(true);
        await expect(loadInstalledFontFamilies()).resolves.toEqual(['Cascadia Code', 'Inter']);
        expect(mocks.invokeNativeOr).toHaveBeenCalledWith([], 'list_system_fonts');
    });
});
