import { describe, expect, it } from 'vitest';
import {
  formatSyncErrorMessage,
  getFileSyncBaseDir,
  isLikelyOfflineSyncError,
  isSyncFilePath,
  resolveBackend,
} from './sync-service-utils';

describe('mobile sync-service test utils', () => {
  it('normalizes backend values', () => {
    expect(resolveBackend('file')).toBe('file');
    expect(resolveBackend('webdav')).toBe('webdav');
    expect(resolveBackend('cloud')).toBe('cloud');
    expect(resolveBackend('off')).toBe('off');
    expect(resolveBackend('invalid')).toBe('off');
    expect(resolveBackend(null)).toBe('off');
  });

  it('formats WebDAV unauthorized errors with actionable text', () => {
    const error = Object.assign(new Error('HTTP 401'), { status: 401 });
    const message = formatSyncErrorMessage(error, 'webdav');
    expect(message).toContain('WebDAV unauthorized (401)');
  });

  it('detects sync file paths and resolves base directory', () => {
    expect(isSyncFilePath('/storage/data.json')).toBe(true);
    expect(isSyncFilePath('/storage/mindwtr-sync.json')).toBe(true);
    expect(isSyncFilePath('/storage/folder')).toBe(false);
    expect(getFileSyncBaseDir('/storage/folder/data.json')).toBe('/storage/folder');
    expect(getFileSyncBaseDir('/storage/folder/')).toBe('/storage/folder');
  });

  it('detects likely offline sync errors', () => {
    expect(isLikelyOfflineSyncError('TypeError: Network request failed')).toBe(true);
    expect(isLikelyOfflineSyncError('java.net.UnknownHostException: Unable to resolve host')).toBe(true);
    expect(isLikelyOfflineSyncError('Software caused connection abort')).toBe(true);
    expect(isLikelyOfflineSyncError('request failed: ECONNRESET')).toBe(true);
    expect(isLikelyOfflineSyncError('AxiosError: connect ETIMEDOUT')).toBe(true);
    expect(isLikelyOfflineSyncError('WebDAV unauthorized (401). Check folder URL')).toBe(false);
  });
});
