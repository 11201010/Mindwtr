import { getFileSyncDir, isSyncFilePath as isCoreSyncFilePath, normalizeSyncBackend, type SyncBackend } from '@mindwtr/core';

const SYNC_FILE_NAME = 'data.json';
const LEGACY_SYNC_FILE_NAME = 'mindwtr-sync.json';
const AI_KEY_PATTERNS = [
  /sk-[A-Za-z0-9]{10,}/g,
  /sk-ant-[A-Za-z0-9]{10,}/g,
  /rk-[A-Za-z0-9]{10,}/g,
  /AIza[0-9A-Za-z\-_]{10,}/g,
];
const TOKEN_PATTERN = /(password|pass|token|access_token|api_key|apikey|authorization|username|user|secret|session|cookie)=([^\s&]+)/gi;
const AUTH_HEADER_PATTERN = /(Authorization:\s*)(Basic|Bearer)\s+[A-Za-z0-9+\/=._-]+/gi;
const OFFLINE_ERROR_PATTERNS = [
  /network request failed/i,
  /internet connection appears to be offline/i,
  /airplane mode/i,
  /unable to resolve host/i,
  /failed host lookup/i,
  /name or service not known/i,
  /nodename nor servname provided/i,
  /unknownhostexception/i,
  /eai_again/i,
  /enotfound/i,
  /network is unreachable/i,
  /no route to host/i,
  /software caused connection abort/i,
  /econnreset/i,
  /econnaborted/i,
  /etimedout/i,
  /failed to connect to/i,
];

const sanitizeMessage = (value: string): string => {
  let result = value;
  result = result.replace(AUTH_HEADER_PATTERN, '$1$2 [redacted]');
  result = result.replace(TOKEN_PATTERN, '$1=[redacted]');
  for (const pattern of AI_KEY_PATTERNS) {
    result = result.replace(pattern, '[redacted]');
  }
  return result;
};

export const formatSyncErrorMessage = (error: unknown, backend: SyncBackend): string => {
  const raw = sanitizeMessage(String(error));
  if (backend !== 'webdav') return raw;

  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  const unauthorized = status === 401 || /\(401\)/.test(raw) || /\b401\b/.test(raw);
  if (unauthorized) {
    return 'WebDAV unauthorized (401). Check folder URL, username, and app password.';
  }
  if (raw.includes('WebDAV URL not configured')) {
    return 'WebDAV folder URL is not configured. Save WebDAV settings first.';
  }
  return raw;
};

export const isLikelyOfflineSyncError = (errorOrMessage: unknown): boolean => {
  const message = String(errorOrMessage || '');
  return OFFLINE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

export const isSyncFilePath = (path: string) => isCoreSyncFilePath(path, SYNC_FILE_NAME, LEGACY_SYNC_FILE_NAME);

export const getFileSyncBaseDir = (syncPath: string) => {
  return getFileSyncDir(syncPath, SYNC_FILE_NAME, LEGACY_SYNC_FILE_NAME);
};

export const resolveBackend = (value: string | null): SyncBackend => normalizeSyncBackend(value);

export type { SyncBackend };
