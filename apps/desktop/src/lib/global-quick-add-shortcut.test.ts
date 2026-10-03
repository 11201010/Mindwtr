import { describe, expect, it } from 'vitest';
import { en } from '@mindwtr/core/i18n/locales/en';
import { zhHans } from '@mindwtr/core/i18n/locales/zh-Hans';
import {
    GLOBAL_QUICK_ADD_SHORTCUT_ALTERNATE_N,
    GLOBAL_QUICK_ADD_SHORTCUT_ALTERNATE_Q,
    GLOBAL_QUICK_ADD_SHORTCUT_DEFAULT,
    GLOBAL_QUICK_ADD_SHORTCUT_DISABLED,
    GLOBAL_QUICK_ADD_SHORTCUT_LEGACY,
    formatGlobalQuickAddShortcutForDisplay,
    getDefaultGlobalQuickAddShortcut,
    getGlobalQuickAddShortcutOptions,
    matchesGlobalQuickAddShortcut,
    normalizeGlobalQuickAddShortcut,
} from './global-quick-add-shortcut';

const translateEnglish = (key: string) => en[key] ?? key;
const translateChinese = (key: string) => zhHans[key] ?? key;

describe('global quick add shortcut', () => {
    it('normalizes unknown values to default', () => {
        expect(normalizeGlobalQuickAddShortcut(undefined)).toBe(GLOBAL_QUICK_ADD_SHORTCUT_DEFAULT);
        expect(normalizeGlobalQuickAddShortcut('bad-value')).toBe(GLOBAL_QUICK_ADD_SHORTCUT_DEFAULT);
        expect(normalizeGlobalQuickAddShortcut(GLOBAL_QUICK_ADD_SHORTCUT_ALTERNATE_N)).toBe(
            GLOBAL_QUICK_ADD_SHORTCUT_ALTERNATE_N
        );
        expect(normalizeGlobalQuickAddShortcut(undefined, { isWindows: true })).toBe(
            GLOBAL_QUICK_ADD_SHORTCUT_DISABLED
        );
        expect(normalizeGlobalQuickAddShortcut(undefined, { isFlatpak: true })).toBe(
            GLOBAL_QUICK_ADD_SHORTCUT_DISABLED
        );
    });

    it('matches supported shortcut combinations', () => {
        expect(
            matchesGlobalQuickAddShortcut(
                new KeyboardEvent('keydown', { code: 'KeyM', ctrlKey: true, altKey: true }),
                GLOBAL_QUICK_ADD_SHORTCUT_DEFAULT
            )
        ).toBe(true);

        expect(
            matchesGlobalQuickAddShortcut(
                new KeyboardEvent('keydown', { code: 'KeyN', ctrlKey: true, altKey: true }),
                GLOBAL_QUICK_ADD_SHORTCUT_ALTERNATE_N
            )
        ).toBe(true);

        expect(
            matchesGlobalQuickAddShortcut(
                new KeyboardEvent('keydown', { code: 'KeyQ', ctrlKey: true, altKey: true }),
                GLOBAL_QUICK_ADD_SHORTCUT_ALTERNATE_Q
            )
        ).toBe(true);

        expect(
            matchesGlobalQuickAddShortcut(
                new KeyboardEvent('keydown', { code: 'KeyA', metaKey: true, shiftKey: true }),
                GLOBAL_QUICK_ADD_SHORTCUT_LEGACY
            )
        ).toBe(true);

        expect(
            matchesGlobalQuickAddShortcut(
                new KeyboardEvent('keydown', { code: 'KeyM', ctrlKey: true, altKey: true }),
                GLOBAL_QUICK_ADD_SHORTCUT_DISABLED
            )
        ).toBe(false);
    });

    it('uses platform-aware defaults and labels for options', () => {
        const macLabels = getGlobalQuickAddShortcutOptions(translateEnglish, { isMac: true }).map((option) => option.label);
        const nonMacLabels = getGlobalQuickAddShortcutOptions(translateEnglish, { isMac: false }).map((option) => option.label);
        const windowsLabels = getGlobalQuickAddShortcutOptions(translateEnglish, { isWindows: true }).map((option) => option.label);
        const flatpakLabels = getGlobalQuickAddShortcutOptions(translateEnglish, { isFlatpak: true }).map((option) => option.label);

        expect(macLabels).toContain('Ctrl+Option+M (recommended)');
        expect(macLabels).toContain('Cmd+Shift+A (legacy)');
        expect(nonMacLabels).toContain('Ctrl+Alt+M (recommended)');
        expect(windowsLabels).toContain('Ctrl+Alt+M (recommended)');
        expect(windowsLabels).toContain('Ctrl+Shift+A (legacy)');
        expect(windowsLabels).toContain('Disabled (default)');
        expect(flatpakLabels).toContain('Disabled (Flatpak default)');
    });

    it('localizes platform option labels using the current translation dictionary', () => {
        expect(getGlobalQuickAddShortcutOptions(translateChinese, { isWindows: true }).map((option) => option.label)).toEqual([
            'Ctrl+Alt+M（推荐）',
            'Ctrl+Alt+N',
            'Ctrl+Alt+Q',
            'Ctrl+Shift+A（旧版）',
            '禁用（默认）',
        ]);
        const macOptions = getGlobalQuickAddShortcutOptions(translateChinese, { isMac: true });
        expect(macOptions.find((option) => option.value === GLOBAL_QUICK_ADD_SHORTCUT_DEFAULT)?.label).toBe('Ctrl+Option+M（推荐）');
        expect(macOptions.find((option) => option.value === GLOBAL_QUICK_ADD_SHORTCUT_LEGACY)?.label).toBe('Cmd+Shift+A（旧版）');
        expect(macOptions.find((option) => option.value === GLOBAL_QUICK_ADD_SHORTCUT_DISABLED)?.label).toBe('禁用');
        const flatpakOptions = getGlobalQuickAddShortcutOptions(translateChinese, { isFlatpak: true });
        expect(flatpakOptions.find((option) => option.value === GLOBAL_QUICK_ADD_SHORTCUT_DISABLED)?.label).toBe('禁用（Flatpak 默认）');
        expect(flatpakOptions.find((option) => option.value === GLOBAL_QUICK_ADD_SHORTCUT_DEFAULT)?.label).toBe('Ctrl+Alt+M');
    });

    it('localizes disabled shortcut help while preserving keyboard names', () => {
        expect(formatGlobalQuickAddShortcutForDisplay(GLOBAL_QUICK_ADD_SHORTCUT_DISABLED, false, translateEnglish)).toBe('Disabled');
        expect(formatGlobalQuickAddShortcutForDisplay(GLOBAL_QUICK_ADD_SHORTCUT_DISABLED, false, translateChinese)).toBe('禁用');
        expect(formatGlobalQuickAddShortcutForDisplay(GLOBAL_QUICK_ADD_SHORTCUT_DEFAULT, true, translateChinese)).toBe('Ctrl+Option+M');
        expect(formatGlobalQuickAddShortcutForDisplay(GLOBAL_QUICK_ADD_SHORTCUT_LEGACY, false, translateChinese)).toBe('Ctrl+Shift+A');
    });

    it('resolves platform defaults', () => {
        expect(getDefaultGlobalQuickAddShortcut()).toBe(GLOBAL_QUICK_ADD_SHORTCUT_DEFAULT);
        expect(getDefaultGlobalQuickAddShortcut({ isWindows: true })).toBe(GLOBAL_QUICK_ADD_SHORTCUT_DISABLED);
        expect(getDefaultGlobalQuickAddShortcut({ isFlatpak: true })).toBe(GLOBAL_QUICK_ADD_SHORTCUT_DISABLED);
    });
});
