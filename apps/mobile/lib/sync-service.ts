import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppData, MergeStats, useTaskStore, webdavGetJson, webdavPutJson, cloudGetJson, cloudPutJson, flushPendingSave, performSyncCycle, findOrphanedAttachments, removeOrphanedAttachmentsFromData, webdavDeleteFile, cloudDeleteFile } from '@mindwtr/core';
import { mobileStorage } from './storage-adapter';
import { logSyncError, sanitizeLogMessage } from './app-log';
import { readSyncFile, writeSyncFile } from './storage-file';
import { getBaseSyncUrl, getCloudBaseUrl, sanitizeAppDataForRemote, syncCloudAttachments, syncFileAttachments, syncWebdavAttachments } from './attachment-sync';
import * as FileSystem from 'expo-file-system/legacy';
import {
  SYNC_PATH_KEY,
  SYNC_BACKEND_KEY,
  WEBDAV_URL_KEY,
  WEBDAV_USERNAME_KEY,
  WEBDAV_PASSWORD_KEY,
  CLOUD_URL_KEY,
  CLOUD_TOKEN_KEY,
} from './sync-constants';

const DEFAULT_SYNC_TIMEOUT_MS = 30_000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SYNC_FILE_NAME = 'data.json';
const LEGACY_SYNC_FILE_NAME = 'mindwtr-sync.json';

const normalizeWebdavUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.replace(/\/+$/, '');
  return trimmed.toLowerCase().endsWith('.json') ? trimmed : `${trimmed}/${SYNC_FILE_NAME}`;
};

const normalizeCloudUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.replace(/\/+$/, '');
  return trimmed.toLowerCase().endsWith('/data') ? trimmed : `${trimmed}/data`;
};

const shouldRunAttachmentCleanup = (lastCleanupAt?: string): boolean => {
  if (!lastCleanupAt) return true;
  const parsed = Date.parse(lastCleanupAt);
  if (Number.isNaN(parsed)) return true;
  return Date.now() - parsed >= CLEANUP_INTERVAL_MS;
};

const deleteAttachmentFile = async (uri?: string): Promise<void> => {
  if (!uri) return;
  if (uri.startsWith('content://') || /^https?:\/\//i.test(uri)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (error) {
    console.warn('Failed to delete attachment file', error);
  }
};

const isSyncFilePath = (path: string) =>
  path.endsWith(`/${SYNC_FILE_NAME}`) || path.endsWith(`/${LEGACY_SYNC_FILE_NAME}`);

const getFileSyncBaseDir = (syncPath: string) => {
  const trimmed = syncPath.replace(/\/+$/, '');
  if (isSyncFilePath(trimmed)) {
    return trimmed.replace(/\/[^/]+$/, '');
  }
  return trimmed;
};

type SyncBackend = 'file' | 'webdav' | 'cloud' | 'off';

const resolveBackend = (value: string | null): SyncBackend => {
  switch (value) {
    case 'webdav':
    case 'cloud':
    case 'off':
    case 'file':
      return value;
    default:
      return 'file';
  }
};

let syncInFlight: Promise<{ success: boolean; stats?: MergeStats; error?: string }> | null = null;
let syncQueued = false;

export async function performMobileSync(syncPathOverride?: string): Promise<{ success: boolean; stats?: MergeStats; error?: string }> {
  if (syncInFlight) {
    syncQueued = true;
    return syncInFlight;
  }
  syncInFlight = (async () => {
    const rawBackend = await AsyncStorage.getItem(SYNC_BACKEND_KEY);
    const backend: SyncBackend = resolveBackend(rawBackend);

    if (backend === 'off') {
      return { success: true };
    }

    let step = 'init';
    let syncUrl: string | undefined;
    let wroteLocal = false;
    try {
      let webdavConfig: { url: string; username: string; password: string } | null = null;
      let cloudConfig: { url: string; token: string } | null = null;
      let fileSyncPath: string | null = null;
      step = 'flush';
      await flushPendingSave();
      if (backend === 'file') {
        fileSyncPath = syncPathOverride || await AsyncStorage.getItem(SYNC_PATH_KEY);
        if (!fileSyncPath) {
          return { success: true };
        }
        if (!fileSyncPath.startsWith('content://') && !isSyncFilePath(fileSyncPath)) {
          const trimmed = fileSyncPath.replace(/\/+$/, '');
          fileSyncPath = `${trimmed}/${SYNC_FILE_NAME}`;
        }
      }
      const syncResult = await performSyncCycle({
        readLocal: async () => await mobileStorage.getData(),
        readRemote: async () => {
          if (backend === 'webdav') {
            const url = await AsyncStorage.getItem(WEBDAV_URL_KEY);
            if (!url) throw new Error('WebDAV URL not configured');
            syncUrl = normalizeWebdavUrl(url);
            const username = (await AsyncStorage.getItem(WEBDAV_USERNAME_KEY)) || '';
            const password = (await AsyncStorage.getItem(WEBDAV_PASSWORD_KEY)) || '';
            webdavConfig = { url: syncUrl, username, password };
            return await webdavGetJson<AppData>(syncUrl, { username, password, timeoutMs: DEFAULT_SYNC_TIMEOUT_MS });
          }
          if (backend === 'cloud') {
            const url = await AsyncStorage.getItem(CLOUD_URL_KEY);
            if (!url) throw new Error('Self-hosted URL not configured');
            syncUrl = normalizeCloudUrl(url);
            const token = (await AsyncStorage.getItem(CLOUD_TOKEN_KEY)) || '';
            cloudConfig = { url: syncUrl, token };
            return await cloudGetJson<AppData>(syncUrl, { token, timeoutMs: DEFAULT_SYNC_TIMEOUT_MS });
          }
          if (!fileSyncPath) {
            throw new Error('No sync folder configured');
          }
          return await readSyncFile(fileSyncPath);
        },
        writeLocal: async (data) => {
          await mobileStorage.saveData(data);
          wroteLocal = true;
        },
        writeRemote: async (data) => {
          const sanitized = sanitizeAppDataForRemote(data);
          if (backend === 'webdav') {
            if (!webdavConfig?.url) throw new Error('WebDAV URL not configured');
            await webdavPutJson(webdavConfig.url, sanitized, { username: webdavConfig.username, password: webdavConfig.password, timeoutMs: DEFAULT_SYNC_TIMEOUT_MS });
            return;
          }
          if (backend === 'cloud') {
            if (!cloudConfig?.url) throw new Error('Self-hosted URL not configured');
            await cloudPutJson(cloudConfig.url, sanitized, { token: cloudConfig.token, timeoutMs: DEFAULT_SYNC_TIMEOUT_MS });
            return;
          }
          if (!fileSyncPath) throw new Error('No sync folder configured');
          await writeSyncFile(fileSyncPath, sanitized);
        },
        onStep: (next) => {
          step = next;
        },
      });

      let mergedData = syncResult.data;

      const webdavConfigValue = webdavConfig as { url: string; username: string; password: string } | null;
      const cloudConfigValue = cloudConfig as { url: string; token: string } | null;

      if (backend === 'webdav' && webdavConfigValue?.url) {
        step = 'attachments';
        const baseSyncUrl = getBaseSyncUrl(webdavConfigValue.url);
        const mutated = await syncWebdavAttachments(mergedData, webdavConfigValue, baseSyncUrl);
        if (mutated) {
          await mobileStorage.saveData(mergedData);
          wroteLocal = true;
        }
      }

      if (backend === 'cloud' && cloudConfigValue?.url) {
        step = 'attachments';
        const baseSyncUrl = getCloudBaseUrl(cloudConfigValue.url);
        const mutated = await syncCloudAttachments(mergedData, cloudConfigValue, baseSyncUrl);
        if (mutated) {
          await mobileStorage.saveData(mergedData);
          wroteLocal = true;
        }
      }

      if (backend === 'file' && fileSyncPath) {
        step = 'attachments';
        const mutated = await syncFileAttachments(mergedData, fileSyncPath);
        if (mutated) {
          await mobileStorage.saveData(mergedData);
          wroteLocal = true;
        }
      }

      if (shouldRunAttachmentCleanup(mergedData.settings.attachments?.lastCleanupAt)) {
        step = 'attachments_cleanup';
        const orphaned = findOrphanedAttachments(mergedData);
        if (orphaned.length > 0) {
          const isFileBackend = backend === 'file';
          const isWebdavBackend = backend === 'webdav' && webdavConfigValue?.url;
          const isCloudBackend = backend === 'cloud' && cloudConfigValue?.url;
          const fileBaseDir = isFileBackend && fileSyncPath && !fileSyncPath.startsWith('content://')
            ? getFileSyncBaseDir(fileSyncPath)
            : null;

          for (const attachment of orphaned) {
            await deleteAttachmentFile(attachment.uri);
            if (attachment.cloudKey) {
              try {
                if (isWebdavBackend && webdavConfigValue) {
                  const baseSyncUrl = getBaseSyncUrl(webdavConfigValue.url);
                  await webdavDeleteFile(`${baseSyncUrl}/${attachment.cloudKey}`, {
                    username: webdavConfigValue.username,
                    password: webdavConfigValue.password,
                    timeoutMs: DEFAULT_SYNC_TIMEOUT_MS,
                  });
                } else if (isCloudBackend && cloudConfigValue) {
                  const baseSyncUrl = getCloudBaseUrl(cloudConfigValue.url);
                  await cloudDeleteFile(`${baseSyncUrl}/${attachment.cloudKey}`, {
                    token: cloudConfigValue.token,
                    timeoutMs: DEFAULT_SYNC_TIMEOUT_MS,
                  });
                } else if (fileBaseDir) {
                  const targetPath = `${fileBaseDir}/${attachment.cloudKey}`;
                  await FileSystem.deleteAsync(targetPath, { idempotent: true });
                }
              } catch (error) {
                console.warn('Failed to delete remote attachment', error);
              }
            }
          }
          mergedData = removeOrphanedAttachmentsFromData(mergedData);
        }
        mergedData.settings.attachments = {
          ...mergedData.settings.attachments,
          lastCleanupAt: new Date().toISOString(),
        };
        await mobileStorage.saveData(mergedData);
        wroteLocal = true;
      }

      step = 'refresh';
      await useTaskStore.getState().fetchData();
      return { success: true, stats: syncResult.stats };
    } catch (error) {
      const now = new Date().toISOString();
      const logPath = await logSyncError(error, { backend, step, url: syncUrl });
      const logHint = logPath ? ` (log: ${logPath})` : '';
      const safeMessage = sanitizeLogMessage(String(error));
      try {
        if (wroteLocal) {
          await useTaskStore.getState().fetchData();
        }
        await useTaskStore.getState().updateSettings({
          lastSyncAt: now,
          lastSyncStatus: 'error',
          lastSyncError: `${safeMessage}${logHint}`,
        });
      } catch (e) {
        console.error('[Mobile] Failed to persist sync error', e);
      }

      return { success: false, error: `${safeMessage}${logHint}` };
    }
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
    if (syncQueued) {
      syncQueued = false;
      void performMobileSync(syncPathOverride);
    }
  }
}
