import { requireNativeModule, type NativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { logWarn } from './app-log';

interface SyncPathBookmarksModule extends NativeModule {
  createBookmark(fileUri: string): Promise<string | null>;
  resolveBookmark(bookmarkBase64: string): Promise<string | null>;
}

let SyncPathBookmarks: SyncPathBookmarksModule | null = null;

try {
  SyncPathBookmarks = requireNativeModule<SyncPathBookmarksModule>('SyncPathBookmarks');
} catch {
  SyncPathBookmarks = null;
}

const isIosFileUri = (value: string): boolean => (
  Platform.OS === 'ios' && value.startsWith('file://')
);

export async function createSyncPathBookmark(fileUri?: string | null): Promise<string | null> {
  const trimmedUri = typeof fileUri === 'string' ? fileUri.trim() : '';
  if (!SyncPathBookmarks || !isIosFileUri(trimmedUri)) return null;

  try {
    const bookmark = await SyncPathBookmarks.createBookmark(trimmedUri);
    const normalizedBookmark = typeof bookmark === 'string' ? bookmark.trim() : '';
    return normalizedBookmark || null;
  } catch (error) {
    void logWarn('Failed to create iOS sync-folder bookmark', {
      scope: 'sync',
      extra: { error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

export async function resolveSyncPathBookmark(bookmarkBase64?: string | null): Promise<string | null> {
  const trimmedBookmark = typeof bookmarkBase64 === 'string' ? bookmarkBase64.trim() : '';
  if (!SyncPathBookmarks || Platform.OS !== 'ios' || !trimmedBookmark) return null;

  try {
    const resolvedUri = await SyncPathBookmarks.resolveBookmark(trimmedBookmark);
    const normalizedUri = typeof resolvedUri === 'string' ? resolvedUri.trim() : '';
    return normalizedUri || null;
  } catch (error) {
    void logWarn('Failed to resolve iOS sync-folder bookmark', {
      scope: 'sync',
      extra: { error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}
