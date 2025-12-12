import { getNextScheduledAt, translations, type Language, Task, useTaskStore } from '@mindwtr/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotificationContentInput, NotificationResponse, Subscription } from 'expo-notifications';
import Constants from 'expo-constants';

type NotificationsApi = typeof import('expo-notifications');

type ScheduledEntry = { scheduledAtIso: string; notificationId: string };

const scheduledByTask = new Map<string, ScheduledEntry>();
const scheduledDigestByKind = new Map<'morning' | 'evening', string>();
let digestConfigKey: string | null = null;
let started = false;
let responseSubscription: Subscription | null = null;

let Notifications: NotificationsApi | null = null;

const LANGUAGE_STORAGE_KEY = 'mindwtr-language';

async function loadNotifications(): Promise<NotificationsApi | null> {
  if (Notifications) return Notifications;

  // Skip notifications in Expo Go (not supported in newer SDKs)
  if (Constants.appOwnership === 'expo') {
    return null;
  }

  try {
    const mod = await import('expo-notifications');
    Notifications = mod;
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    return mod;
  } catch (error) {
    console.warn('[Notifications] expo-notifications unavailable:', error);
    return null;
  }
}

async function getCurrentLanguage(): Promise<Language> {
  try {
    const saved = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'zh') return 'zh';
    return 'en';
  } catch {
    return 'en';
  }
}

function parseTimeOfDay(value: string | undefined, fallback: { hour: number; minute: number }) {
  if (!value) return fallback;
  const [h, m] = value.split(':');
  const hour = Number.parseInt(h, 10);
  const minute = Number.parseInt(m, 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  if (hour < 0 || hour > 23) return fallback;
  if (minute < 0 || minute > 59) return fallback;
  return { hour, minute };
}

async function ensurePermission(api: NotificationsApi) {
  const { status } = await api.getPermissionsAsync();
  if (status === 'granted') return true;
  const request = await api.requestPermissionsAsync();
  return request.status === 'granted';
}

async function cancelDailyDigests(api: NotificationsApi) {
  for (const id of scheduledDigestByKind.values()) {
    await api.cancelScheduledNotificationAsync(id).catch(() => { });
  }
  scheduledDigestByKind.clear();
}

async function rescheduleDailyDigest(api: NotificationsApi) {
  const { settings } = useTaskStore.getState();

  const notificationsEnabled = settings.notificationsEnabled !== false;
  const morningEnabled = settings.dailyDigestMorningEnabled === true;
  const eveningEnabled = settings.dailyDigestEveningEnabled === true;
  const morningTime = settings.dailyDigestMorningTime || '09:00';
  const eveningTime = settings.dailyDigestEveningTime || '20:00';

  const nextKey = JSON.stringify({
    notificationsEnabled,
    morningEnabled,
    eveningEnabled,
    morningTime,
    eveningTime,
  });
  if (nextKey === digestConfigKey) return;
  digestConfigKey = nextKey;

  await cancelDailyDigests(api);
  if (!notificationsEnabled) return;
  if (!morningEnabled && !eveningEnabled) return;

  const language = await getCurrentLanguage();
  const tr = translations[language];

  if (morningEnabled) {
    const { hour, minute } = parseTimeOfDay(settings.dailyDigestMorningTime, { hour: 9, minute: 0 });
    const id = await api.scheduleNotificationAsync({
      content: {
        title: tr['digest.morningTitle'],
        body: tr['digest.morningBody'],
        data: { kind: 'daily-digest', when: 'morning' },
      } as any,
      trigger: { hour, minute, repeats: true } as any,
    });
    scheduledDigestByKind.set('morning', id);
  }

  if (eveningEnabled) {
    const { hour, minute } = parseTimeOfDay(settings.dailyDigestEveningTime, { hour: 20, minute: 0 });
    const id = await api.scheduleNotificationAsync({
      content: {
        title: tr['digest.eveningTitle'],
        body: tr['digest.eveningBody'],
        data: { kind: 'daily-digest', when: 'evening' },
      } as any,
      trigger: { hour, minute, repeats: true } as any,
    });
    scheduledDigestByKind.set('evening', id);
  }
}

async function scheduleForTask(api: NotificationsApi, task: Task, when: Date) {
  const content: NotificationContentInput = {
    title: task.title,
    body: task.description || '',
    data: { taskId: task.id },
    categoryIdentifier: 'task-reminder',
  };

  const secondsUntil = Math.max(1, Math.floor((when.getTime() - Date.now()) / 1000));
  const id = await api.scheduleNotificationAsync({
    content,
    trigger: { seconds: secondsUntil, repeats: false } as any,
  });

  scheduledByTask.set(task.id, { scheduledAtIso: when.toISOString(), notificationId: id });
}

async function rescheduleAll(api: NotificationsApi) {
  const now = new Date();
  const { tasks } = useTaskStore.getState();

  for (const task of tasks) {
    const next = getNextScheduledAt(task, now);
    if (!next) continue;
    if (next.getTime() <= now.getTime()) continue;

    const existing = scheduledByTask.get(task.id);
    const nextIso = next.toISOString();

    if (existing && existing.scheduledAtIso === nextIso) continue;

    if (existing) {
      await api.cancelScheduledNotificationAsync(existing.notificationId).catch(() => { });
    }

    await scheduleForTask(api, task, next);
  }
}

async function snoozeTask(api: NotificationsApi, taskId: string, minutes: number) {
  const { tasks } = useTaskStore.getState();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const snoozeAt = new Date(Date.now() + minutes * 60 * 1000);
  await scheduleForTask(api, task, snoozeAt);
}

export async function startMobileNotifications() {
  if (started) return;
  started = true;

  const api = await loadNotifications();
  if (!api || typeof api.scheduleNotificationAsync !== 'function') return;

  const granted = await ensurePermission(api);
  if (!granted) return;

  await api.setNotificationCategoryAsync('task-reminder', [
    {
      identifier: 'snooze10',
      buttonTitle: 'Snooze 10m',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'open',
      buttonTitle: 'Open',
      options: { opensAppToForeground: true },
    },
  ]).catch(() => { });

  await rescheduleAll(api);
  await rescheduleDailyDigest(api);

  useTaskStore.subscribe(() => {
    rescheduleAll(api).catch(console.error);
    rescheduleDailyDigest(api).catch(console.error);
  });

  responseSubscription?.remove();
  responseSubscription = api.addNotificationResponseReceivedListener((response: NotificationResponse) => {
    const taskId = (response.notification.request.content.data as any)?.taskId as string | undefined;
    if (response.actionIdentifier === 'snooze10' && taskId) {
      snoozeTask(api, taskId, 10).catch(console.error);
    }
  });
}

export async function stopMobileNotifications() {
  responseSubscription?.remove();
  responseSubscription = null;

  if (Notifications) {
    for (const entry of scheduledByTask.values()) {
      await Notifications.cancelScheduledNotificationAsync(entry.notificationId).catch(() => { });
    }
    for (const id of scheduledDigestByKind.values()) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => { });
    }
  }

  scheduledByTask.clear();
  scheduledDigestByKind.clear();
  digestConfigKey = null;
  started = false;
}
