import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AndroidCaptureIntentSection } from './android-capture-intent-section';

const nativeMocks = vi.hoisted(() => ({
    getCaptureIntentConfig: vi.fn(),
    isSupported: vi.fn(() => true),
    setCaptureIntentEnabled: vi.fn(),
}));
const clipboardMocks = vi.hoisted(() => ({ setStringAsync: vi.fn() }));
const showToast = vi.hoisted(() => vi.fn());

vi.mock('@/modules/android-widget', () => nativeMocks);
vi.mock('expo-clipboard', () => clipboardMocks);
vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({
        bg: '#0f172a',
        cardBg: '#111827',
        border: '#334155',
        text: '#f8fafc',
        secondaryText: '#94a3b8',
        tint: '#3b82f6',
    }),
}));
vi.mock('@/contexts/toast-context', () => ({
    useToast: () => ({ showToast }),
}));
vi.mock('./settings.hooks', () => ({
    useSettingsLocalization: () => ({
        tr: (key: string) => ({
            'settings.automationCapture': 'Automation capture',
            'settings.automationCaptureDesc': 'Allow trusted automation apps with your token to queue text to Inbox. Captures appear the next time Mindwtr opens.',
            'settings.automationCaptureToken': 'Capture token',
            'settings.automationCaptureCopyToken': 'Copy token',
            'settings.automationCaptureCopied': 'Capture token copied.',
            'settings.automationCaptureCopyFailed': "Couldn't copy the capture token.",
            'settings.automationCaptureLoadFailed': "Couldn't load automation capture settings.",
            'settings.automationCaptureUpdateFailed': "Couldn't update automation capture settings.",
        }[key] ?? key),
    }),
}));

const TOKEN = 'ab'.repeat(32);
const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

async function renderSection() {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
        tree = renderer.create(<AndroidCaptureIntentSection />);
        await settle();
    });
    return tree;
}

describe('AndroidCaptureIntentSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        nativeMocks.isSupported.mockReturnValue(true);
        nativeMocks.getCaptureIntentConfig.mockResolvedValue({ enabled: false, token: null });
        nativeMocks.setCaptureIntentEnabled.mockImplementation(async (enabled: boolean) => (
            enabled ? { enabled: true, token: TOKEN } : { enabled: false, token: null }
        ));
        clipboardMocks.setStringAsync.mockResolvedValue(true);
    });

    it('loads off, enables, copies the selectable token, and disables with native-confirmed state', async () => {
        const tree = await renderSection();
        expect(tree.root.findByProps({ testID: 'android-capture-intent-section' })).toBeTruthy();
        expect(tree.root.findByProps({ testID: 'android-capture-intent-switch' }).props).toMatchObject({
            value: false,
            disabled: false,
        });

        await act(async () => {
            tree.root.findByProps({ testID: 'android-capture-intent-switch' }).props.onValueChange(true);
            await settle();
        });
        expect(nativeMocks.setCaptureIntentEnabled).toHaveBeenCalledWith(true);
        expect(tree.root.findByProps({ testID: 'android-capture-intent-token' }).props).toMatchObject({
            selectable: true,
            children: TOKEN,
        });

        await act(async () => {
            tree.root.findByProps({ testID: 'android-capture-intent-copy' }).props.onPress();
            await settle();
        });
        expect(clipboardMocks.setStringAsync).toHaveBeenCalledWith(TOKEN);
        expect(showToast).toHaveBeenCalledWith({ message: 'Capture token copied.', tone: 'info' });

        await act(async () => {
            tree.root.findByProps({ testID: 'android-capture-intent-switch' }).props.onValueChange(false);
            await settle();
        });
        expect(nativeMocks.setCaptureIntentEnabled).toHaveBeenLastCalledWith(false);
        expect(tree.root.findByProps({ testID: 'android-capture-intent-switch' }).props.value).toBe(false);
        expect(tree.root.findAllByProps({ testID: 'android-capture-intent-token' })).toHaveLength(0);
    });

    it('keeps confirmed state when a native mutation fails and surfaces the error', async () => {
        nativeMocks.getCaptureIntentConfig.mockResolvedValue({ enabled: true, token: TOKEN });
        nativeMocks.setCaptureIntentEnabled.mockRejectedValue(new Error('disk full'));
        const tree = await renderSection();

        await act(async () => {
            tree.root.findByProps({ testID: 'android-capture-intent-switch' }).props.onValueChange(false);
            await settle();
        });

        expect(tree.root.findByProps({ testID: 'android-capture-intent-switch' }).props.value).toBe(true);
        expect(showToast).toHaveBeenCalledWith({
            message: "Couldn't update automation capture settings.",
            tone: 'error',
        });
    });

    it('disables unknown state and surfaces a config load failure', async () => {
        nativeMocks.getCaptureIntentConfig.mockRejectedValue(new Error('corrupt'));
        const tree = await renderSection();

        expect(tree.root.findByProps({ testID: 'android-capture-intent-switch' }).props.disabled).toBe(true);
        expect(showToast).toHaveBeenCalledWith({
            message: "Couldn't load automation capture settings.",
            tone: 'error',
        });
    });

    it('omits the section when the optional Android native module is unavailable', async () => {
        nativeMocks.isSupported.mockReturnValue(false);
        const tree = await renderSection();

        expect(tree.toJSON()).toBeNull();
        expect(nativeMocks.getCaptureIntentConfig).not.toHaveBeenCalled();
    });
});
