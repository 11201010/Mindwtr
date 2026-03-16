import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAsyncStorageGetItem,
  mockAsyncStorageSetItem,
  mockStoreSubscribe,
  mockAlarmDeleteAlarm,
  mockAlarmDeleteRepeatingAlarm,
  mockAlarmRemoveAllFiredNotifications,
  mockAlarmRemoveFiredNotification,
  mockAlarmScheduleAlarm,
  mockPermissionsAndroidCheck,
  mockPermissionsAndroidRequest,
} = vi.hoisted(() => ({
  mockAsyncStorageGetItem: vi.fn(),
  mockAsyncStorageSetItem: vi.fn(),
  mockStoreSubscribe: vi.fn(() => () => undefined),
  mockAlarmDeleteAlarm: vi.fn(),
  mockAlarmDeleteRepeatingAlarm: vi.fn(),
  mockAlarmRemoveAllFiredNotifications: vi.fn(),
  mockAlarmRemoveFiredNotification: vi.fn(),
  mockAlarmScheduleAlarm: vi.fn(async () => ({ id: 99 })),
  mockPermissionsAndroidCheck: vi.fn(async () => true),
  mockPermissionsAndroidRequest: vi.fn(async () => 'granted'),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: mockAsyncStorageGetItem,
    setItem: mockAsyncStorageSetItem,
  },
}));

vi.mock('react-native', () => ({
  NativeEventEmitter: class {
    addListener() {
      return { remove: () => undefined };
    }
  },
  NativeModules: {},
  PermissionsAndroid: {
    PERMISSIONS: { POST_NOTIFICATIONS: 'POST_NOTIFICATIONS' },
    RESULTS: { GRANTED: 'granted', NEVER_ASK_AGAIN: 'never_ask_again' },
    check: mockPermissionsAndroidCheck,
    request: mockPermissionsAndroidRequest,
  },
  Platform: {
    OS: 'android',
    Version: 34,
  },
}));

vi.mock('react-native-alarm-notification', () => ({
  default: {
    parseDate: (date: Date) => date.toISOString(),
    scheduleAlarm: mockAlarmScheduleAlarm,
    deleteAlarm: mockAlarmDeleteAlarm,
    deleteRepeatingAlarm: mockAlarmDeleteRepeatingAlarm,
    removeFiredNotification: mockAlarmRemoveFiredNotification,
    removeAllFiredNotifications: mockAlarmRemoveAllFiredNotifications,
  },
}));

vi.mock('@mindwtr/core', () => ({
  getNextScheduledAt: vi.fn(() => null),
  getSystemDefaultLanguage: vi.fn(() => 'en'),
  getTranslations: vi.fn(async () => ({
    'digest.morningTitle': 'Morning',
    'digest.morningBody': 'Morning body',
    'digest.eveningTitle': 'Evening',
    'digest.eveningBody': 'Evening body',
    'digest.weeklyReviewTitle': 'Weekly review',
    'digest.weeklyReviewBody': 'Weekly review body',
    'review.projectsStep': 'Review project',
  })),
  hasTimeComponent: vi.fn(() => false),
  loadStoredLanguage: vi.fn(async () => 'en'),
  parseTimeOfDay: vi.fn((value: string | undefined, fallback: { hour: number; minute: number }) => {
    if (!value) return fallback;
    const [hour, minute] = value.split(':').map((part) => Number(part));
    return {
      hour: Number.isFinite(hour) ? hour : fallback.hour,
      minute: Number.isFinite(minute) ? minute : fallback.minute,
    };
  }),
  safeParseDate: vi.fn((value?: string) => (value ? new Date(value) : null)),
  useTaskStore: {
    getState: () => ({ settings: {}, tasks: [], projects: [] }),
    subscribe: mockStoreSubscribe,
  },
}));

vi.mock('./app-log', () => ({
  logWarn: vi.fn(async () => undefined),
}));

import {
  __localNotificationTestUtils,
  setLocalNotificationOpenHandler,
  startLocalMobileNotifications,
  stopLocalMobileNotifications,
} from './notification-service-local';

describe('notification-service-local', () => {
  beforeEach(() => {
    mockAsyncStorageGetItem.mockReset();
    mockAsyncStorageSetItem.mockReset();
    mockStoreSubscribe.mockClear();
    mockAlarmDeleteAlarm.mockReset();
    mockAlarmDeleteRepeatingAlarm.mockReset();
    mockAlarmRemoveAllFiredNotifications.mockReset();
    mockAlarmRemoveFiredNotification.mockReset();
    mockAlarmScheduleAlarm.mockReset();
    mockAlarmScheduleAlarm.mockResolvedValue({ id: 99 });
    mockPermissionsAndroidCheck.mockReset();
    mockPermissionsAndroidRequest.mockReset();
    mockPermissionsAndroidCheck.mockResolvedValue(true);
    mockPermissionsAndroidRequest.mockResolvedValue('granted');
    __localNotificationTestUtils.resetForTests();
  });

  afterEach(() => {
    __localNotificationTestUtils.resetForTests();
  });

  it('retries loading the alarm map after a failed storage read', async () => {
    mockAsyncStorageGetItem
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(JSON.stringify({ 'task:1': { id: 42 } }));

    await __localNotificationTestUtils.loadAlarmMapIfNeeded();
    expect(__localNotificationTestUtils.isAlarmMapLoaded()).toBe(false);
    expect(__localNotificationTestUtils.getAlarmMapSnapshot().size).toBe(0);

    await __localNotificationTestUtils.loadAlarmMapIfNeeded();
    expect(__localNotificationTestUtils.isAlarmMapLoaded()).toBe(true);
    expect(__localNotificationTestUtils.getAlarmMapSnapshot().get('task:1')).toEqual({ id: 42 });
  });

  it('clears the notification open handler when the service stops', async () => {
    const handler = vi.fn();
    setLocalNotificationOpenHandler(handler);

    expect(__localNotificationTestUtils.getNotificationOpenHandler()).toBe(handler);

    await stopLocalMobileNotifications();

    expect(__localNotificationTestUtils.getNotificationOpenHandler()).toBeNull();
  });

  it('clears persisted alarms when Android notification permission is denied on startup', async () => {
    mockAsyncStorageGetItem.mockResolvedValue(JSON.stringify({ 'task:1': { id: 42 } }));
    mockPermissionsAndroidCheck.mockResolvedValue(false);
    mockPermissionsAndroidRequest.mockResolvedValue('never_ask_again');

    await startLocalMobileNotifications();

    expect(mockAlarmDeleteAlarm).toHaveBeenCalledWith(42);
    expect(mockAlarmDeleteRepeatingAlarm).toHaveBeenCalledWith(42);
    expect(mockAlarmRemoveFiredNotification).toHaveBeenCalledWith(42);
    expect(mockAlarmRemoveAllFiredNotifications).toHaveBeenCalledTimes(1);
    expect(__localNotificationTestUtils.getAlarmMapSnapshot().size).toBe(0);
    expect(mockAsyncStorageSetItem).toHaveBeenCalledWith('mindwtr:local:alarms:v1', '{}');
  });
});
