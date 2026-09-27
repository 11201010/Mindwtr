import React from 'react';
import renderer from 'react-test-renderer';
import { Modal, ScrollView, TouchableOpacity } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { GeneralSettingsScreen } from './general-settings-screen';

// Core's General model runs for real; only the store is the test's.
vi.mock('@mindwtr/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mindwtr/core')>()),
  shallow: Object.is,
  useTaskStore: (selector: (state: unknown) => unknown) => selector({
    settings: { weekStart: 'monday', dateFormat: 'ymd', timeFormat: '24h' },
    updateSettings: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/contexts/theme-context', () => ({
  useTheme: () => ({ themeMode: 'dark', setThemeMode: vi.fn() }),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({
    bg: '#0f172a', cardBg: '#111827', filterBg: '#1f2937', border: '#334155',
    text: '#f8fafc', secondaryText: '#94a3b8', tint: '#3b82f6', danger: '#ef4444',
  }),
}));

vi.mock('@/lib/app-search-preference', () => ({
  isAppSearchSupported: () => false,
  readAppSearchIndexingEnabled: async () => false,
  writeAppSearchIndexingEnabled: async () => undefined,
}));
vi.mock('@/lib/app-search-service', () => ({
  enableAppSearchIndexing: async () => undefined,
  wipeAppSearchIndex: async () => undefined,
}));
vi.mock('@/lib/mobile-app-lock', () => ({
  authenticateWithDeviceLock: async () => ({ success: false }),
  getMobileAppLockErrorKey: () => 'appLock.failed',
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
}));

// Persian shows the calendar system picker too.
vi.mock('./settings.hooks', () => ({
  useSettingsLocalization: () => ({ language: 'fa', tr: (key: string) => key, t: (key: string) => key, setLanguage: vi.fn() }),
  useSettingsScrollContent: () => ({}),
}));

vi.mock('./settings.shell', () => ({
  SettingsTopBar: () => React.createElement('SettingsTopBar'),
}));

describe('GeneralSettingsScreen pickers', () => {
  it('tells a screen reader each option is a choice and which one is chosen', () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<GeneralSettingsScreen />);
    });

    // Closed modals still render their options in the test shim.
    const pickers = tree.root.findAllByType(Modal).map((modal) => modal.findByType(ScrollView).findAllByType(TouchableOpacity));
    // Theme, quick access, language, week start, date format, calendar system, time format.
    expect(pickers).toHaveLength(7);
    for (const options of pickers) {
      for (const option of options) {
        const checked = option.findAll((node) => String(node.type) === 'Icon' && node.props.name === 'checkmark').length > 0;
        expect(option.props.accessibilityRole).toBe('radio');
        expect(option.props.accessibilityState).toEqual({ selected: checked });
      }
      expect(options.filter((option) => option.props.accessibilityState?.selected)).toHaveLength(1);
    }
  });
});
