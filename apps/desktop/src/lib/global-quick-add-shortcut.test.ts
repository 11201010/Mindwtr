import { describe, expect, it } from 'vitest';
import {
    GLOBAL_QUICK_ADD_SHORTCUT_ALTERNATE_N,
    GLOBAL_QUICK_ADD_SHORTCUT_ALTERNATE_Q,
    GLOBAL_QUICK_ADD_SHORTCUT_DEFAULT,
    GLOBAL_QUICK_ADD_SHORTCUT_DISABLED,
    GLOBAL_QUICK_ADD_SHORTCUT_LEGACY,
    getDefaultGlobalQuickAddShortcut,
    getGlobalQuickAddShortcutOptions,
    matchesGlobalQuickAddShortcut,
    normalizeGlobalQuickAddShortcut,
} from './global-quick-add-shortcut';

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
        const macLabels = getGlobalQuickAddShortcutOptions({ isMac: true }).map((option) => option.label);
        const nonMacLabels = getGlobalQuickAddShortcutOptions({ isMac: false }).map((option) => option.label);
        const windowsLabels = getGlobalQuickAddShortcutOptions({ isWindows: true }).map((option) => option.label);

        expect(macLabels).toContain('Ctrl+Option+M (recommended)');
        expect(nonMacLabels).toContain('Ctrl+Alt+M (recommended)');
        expect(windowsLabels).toContain('Ctrl+Shift+A (recommended)');
        expect(windowsLabels).toContain('Disabled (default)');
    });

    it('resolves platform defaults', () => {
        expect(getDefaultGlobalQuickAddShortcut()).toBe(GLOBAL_QUICK_ADD_SHORTCUT_DEFAULT);
        expect(getDefaultGlobalQuickAddShortcut({ isWindows: true })).toBe(GLOBAL_QUICK_ADD_SHORTCUT_DISABLED);
    });
});
