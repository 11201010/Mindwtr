import React, { memo } from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureDateFormatting, createDateFormatter, isActiveDateFormatDayFirst, safeFormatDate } from '@mindwtr/core';
import { LanguageProvider, useLanguage } from './language-context';

const mocks = vi.hoisted(() => ({
    pattern: 'dd.MM.yyyy',
    onChange: undefined as undefined | ((state: string) => void),
    remove: vi.fn(),
    logInfo: vi.fn(),
}));
vi.mock('react-native', () => ({
    Platform: { OS: 'ios' },
    AppState: { addEventListener: (_event: string, callback: (state: string) => void) => {
        mocks.onChange = callback;
        return { remove: mocks.remove };
    } },
}));
vi.mock('@/lib/workspace-session-storage', () => ({ workspaceSessionStorage: {} }));
vi.mock('@mindwtr/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@mindwtr/core')>()),
    getSystemDefaultLanguage: () => 'en',
    loadStoredLanguage: async () => 'en',
    loadTranslations: async () => ({}),
}));
vi.mock('../lib/app-log', () => ({ logError: vi.fn(), logInfo: mocks.logInfo }));
vi.mock('../lib/startup-profiler', () => ({ markStartupPhase: vi.fn(), measureStartupPhase: (_name: string, fn: () => unknown) => fn() }));
vi.mock('../modules/system-date-format', () => ({ getSystemDateFormat: () => mocks.pattern }));

const Display = memo(() => {
    const { language } = useLanguage();
    const preview = createDateFormatter({ language, systemLocale: 'en-DE', systemDateFormat: mocks.pattern });
    return React.createElement('date-display', { task: safeFormatDate('2026-09-22', 'P'), preview: preview('2026-09-22', 'P') });
});

describe('system date format on foreground', () => {
    afterEach(() => configureDateFormatting({ systemLocale: 'en-US' }));

    it('refreshes memoized visible consumers, preview and parsing before the foreground render', async () => {
        configureDateFormatting({ systemLocale: 'en-DE', systemDateFormat: 'dd.MM.yyyy' });
        let tree!: renderer.ReactTestRenderer;
        await act(async () => { tree = renderer.create(<LanguageProvider><Display /></LanguageProvider>); });
        const display = () => tree.root.findByType('date-display' as never).props;
        expect(display()).toMatchObject({ task: '22.09.2026', preview: '22.09.2026' });
        expect(isActiveDateFormatDayFirst()).toBe(true);
        act(() => mocks.onChange?.('background'));
        mocks.pattern = 'M/d/yy';
        act(() => mocks.onChange?.('active'));
        expect(display()).toMatchObject({ task: '9/22/26', preview: '9/22/26' });
        expect(isActiveDateFormatDayFirst()).toBe(false);
        const diagnosticCount = mocks.logInfo.mock.calls.length;
        act(() => mocks.onChange?.('active'));
        expect(mocks.logInfo).toHaveBeenCalledTimes(diagnosticCount);
        act(() => tree.unmount());
        expect(mocks.remove).toHaveBeenCalled();
    });
});
