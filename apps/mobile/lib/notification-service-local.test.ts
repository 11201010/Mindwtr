import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAsyncStorageGetItem,
  mockAsyncStorageSetItem,
  mockStoreSubscribe,
} = vi.hoisted(() => ({
  mockAsyncStorageGetItem: vi.fn(),
  mockAsyncStorageSetItem: vi.fn(),
  mockStoreSubscribe: vi.fn(() => () => undefined),
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
    check: vi.fn(async () => true),
    request: vi.fn(async () => 'granted'),
  },
  Platform: {
    OS: 'android',
    Version: 34,
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
  stopLocalMobileNotifications,
} from './notification-service-local';

describe('notification-service-local', () => {
  beforeEach(() => {
    mockAsyncStorageGetItem.mockReset();
    mockAsyncStorageSetItem.mockReset();
    mockStoreSubscribe.mockClear();
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
});
