import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Switch, Text, View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { buildNotificationsSettingsModel, getTranslator, type AppSettings } from '@mindwtr/core';

import { NotificationsSettingsScreen } from './notifications-settings-screen';

const { state } = vi.hoisted(() => ({
  state: {
    settings: {} as AppSettings,
    language: 'en' as 'en' | 'zh',
    exactAlarmsDenied: false,
    persistentCapture: false,
  },
}));

vi.mock('@mindwtr/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mindwtr/core')>();
  return { ...actual, useTaskStore: () => ({ settings: state.settings, updateSettings: vi.fn(async () => undefined) }) };
});
vi.mock('@react-native-community/datetimepicker', () => ({ default: () => null }));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: { children?: React.ReactNode }) => <View>{props.children}</View>,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({ bg: '#fff', cardBg: '#fff', border: '#ddd', text: '#111', secondaryText: '#666', tint: '#06f', filterBg: '#eee' }),
}));
vi.mock('@/lib/notification-service', () => ({
  requestNotificationPermission: vi.fn(async () => ({ granted: true, canAskAgain: true })),
  startMobileNotifications: vi.fn(async () => undefined),
}));
vi.mock('@/lib/persistent-capture-notification', () => ({
  applyPersistentCaptureNotification: vi.fn(),
  isPersistentCaptureSupported: () => true,
  readPersistentCaptureEnabled: vi.fn(async () => state.persistentCapture),
  writePersistentCaptureEnabled: vi.fn(async () => undefined),
}));
vi.mock('@/lib/exact-alarm-permission', () => ({
  isExactAlarmPermissionRelevant: () => true,
  openExactAlarmSettings: vi.fn(async () => undefined),
  refreshExactAlarmPermission: vi.fn(async () => !state.exactAlarmsDenied),
}));
vi.mock('./settings.hooks', () => ({
  useSettingsLocalization: () => ({ language: state.language, t: getTranslator(state.language) }),
  useSettingsScrollContent: () => ({}),
}));
vi.mock('./settings.shell', () => ({ SettingsTopBar: () => null }));

/** RN's screen as drawn: every text in order and each switch's value. */
async function renderScreen() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<NotificationsSettingsScreen />);
  });
  await act(async () => { await Promise.resolve(); });
  const texts = tree.root.findAllByType(Text).map((node) => node.props.children).filter((child): child is string => typeof child === 'string');
  const switches = tree.root.findAllByType(Switch).map((node) => node.props.value as boolean);
  act(() => tree.unmount());
  return { texts, switches };
}

describe('Settings › Notifications parity with core\'s model', () => {
  it.each([
    ['en', { notificationsEnabled: false }, false, false],
    ['en', { dailyDigestMorningEnabled: true, dailyDigestMorningTime: '06:30', weeklyReviewEnabled: true, weeklyReviewDay: 5, weeklyReviewTime: '19:15' }, true, true],
    ['zh', { notificationsEnabled: true, startDateNotificationsEnabled: false, dailyDigestEveningEnabled: true }, true, false],
  ] as const)('%s with %j, exact alarms denied %s, capture %s', async (language, settings, denied, capture) => {
    state.language = language;
    state.settings = settings as AppSettings;
    state.exactAlarmsDenied = denied;
    state.persistentCapture = capture;
    const rn = await renderScreen();
    const model = buildNotificationsSettingsModel({
      settings: settings as AppSettings,
      t: getTranslator(language),
      language,
      systemLocale: Intl.DateTimeFormat().resolvedOptions().locale,
      persistentCapture: { enabled: capture },
    });
    const { reminders, weeklyReview, dailyDigest } = model;
    const row = (item: { label: string; description: string }) => [item.label, item.description];
    const notice = denied && reminders.exactAlarmNotice
      ? [reminders.exactAlarmNotice.label, reminders.exactAlarmNotice.description, reminders.exactAlarmNotice.actionLabel]
      : [];
    expect(rn.texts).toEqual([
      ...row(reminders.enable), ...row(reminders.startReminders), ...row(reminders.dueReminders), ...notice, ...row(reminders.persistentCapture!),
      ...row(weeklyReview.enable), ...row(weeklyReview.day), ...row(weeklyReview.time),
      // The day picker (RN's modal; the test renderer draws it closed too).
      weeklyReview.day.pickerTitle, ...weeklyReview.day.options.map((option) => option.label),
      ...row(dailyDigest), ...row(dailyDigest.morning), ...row(dailyDigest.morningTime), ...row(dailyDigest.evening), ...row(dailyDigest.eveningTime),
    ]);
    expect(rn.switches).toEqual([reminders.enable, reminders.startReminders, reminders.dueReminders, reminders.persistentCapture!, weeklyReview.enable,
      dailyDigest.morning, dailyDigest.evening].map((toggle) => toggle.value));
  });
});
