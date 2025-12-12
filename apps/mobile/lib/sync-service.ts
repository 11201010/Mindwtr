import AsyncStorage from '@react-native-async-storage/async-storage';
import { mergeAppDataWithStats, AppData, MergeStats, useTaskStore, webdavGetJson, webdavPutJson } from '@mindwtr/core';
import { mobileStorage } from './storage-adapter';
import { readSyncFile, writeSyncFile } from './storage-file';

export const SYNC_PATH_KEY = '@mindwtr_sync_path';
export const SYNC_BACKEND_KEY = '@mindwtr_sync_backend';
export const WEBDAV_URL_KEY = '@mindwtr_webdav_url';
export const WEBDAV_USERNAME_KEY = '@mindwtr_webdav_username';
export const WEBDAV_PASSWORD_KEY = '@mindwtr_webdav_password';

export async function performMobileSync(syncPathOverride?: string): Promise<{ success: boolean; stats?: MergeStats; error?: string }> {
  const backend = (await AsyncStorage.getItem(SYNC_BACKEND_KEY)) === 'webdav' ? 'webdav' : 'file';

  let wroteLocal = false;
  try {
    let incomingData: AppData | null;
    if (backend === 'webdav') {
      const url = await AsyncStorage.getItem(WEBDAV_URL_KEY);
      if (!url) return { success: false, error: 'WebDAV URL not configured' };
      const username = (await AsyncStorage.getItem(WEBDAV_USERNAME_KEY)) || '';
      const password = (await AsyncStorage.getItem(WEBDAV_PASSWORD_KEY)) || '';
      incomingData = await webdavGetJson<AppData>(url, { username, password });
    } else {
      const syncPath = syncPathOverride || await AsyncStorage.getItem(SYNC_PATH_KEY);
      if (!syncPath) {
        return { success: false, error: 'No sync file configured' };
      }
      incomingData = await readSyncFile(syncPath);
      if (!incomingData) {
        return { success: false, error: 'Sync file not found' };
      }
    }

    const currentData = await mobileStorage.getData();
    const mergeResult = mergeAppDataWithStats(currentData, incomingData || { tasks: [], projects: [], settings: {} });
    const now = new Date().toISOString();

    const finalData: AppData = {
      ...mergeResult.data,
      settings: {
        ...mergeResult.data.settings,
        lastSyncAt: now,
        lastSyncStatus: 'success',
        lastSyncError: undefined,
        lastSyncStats: mergeResult.stats,
      },
    };

    await mobileStorage.saveData(finalData);
    wroteLocal = true;
    if (backend === 'webdav') {
      const url = await AsyncStorage.getItem(WEBDAV_URL_KEY);
      if (!url) return { success: false, error: 'WebDAV URL not configured' };
      const username = (await AsyncStorage.getItem(WEBDAV_USERNAME_KEY)) || '';
      const password = (await AsyncStorage.getItem(WEBDAV_PASSWORD_KEY)) || '';
      await webdavPutJson(url, finalData, { username, password });
    } else {
      const syncPath = syncPathOverride || await AsyncStorage.getItem(SYNC_PATH_KEY);
      if (!syncPath) return { success: false, error: 'No sync file configured' };
      await writeSyncFile(syncPath, finalData);
    }

    await useTaskStore.getState().fetchData();
    return { success: true, stats: mergeResult.stats };
  } catch (error) {
    const now = new Date().toISOString();
    try {
      if (wroteLocal) {
        await useTaskStore.getState().fetchData();
      }
      await useTaskStore.getState().updateSettings({
        lastSyncAt: now,
        lastSyncStatus: 'error',
        lastSyncError: String(error),
      });
    } catch (e) {
      console.error('[Mobile] Failed to persist sync error', e);
    }

    return { success: false, error: String(error) };
  }
}
