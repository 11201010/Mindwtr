import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { AppData, Attachment } from '@mindwtr/core';
import {
  validateAttachmentForUpload,
  cloudGetFile,
  cloudPutFile,
  computeSha256Hex,
  globalProgressTracker,
  webdavGetFile,
  webdavFileExists,
  webdavMakeDirectory,
  webdavPutFile,
  withRetry,
  createWebdavDownloadBackoff,
  isWebdavRateLimitedError,
  getErrorStatus,
} from '@mindwtr/core';
import {
  SYNC_BACKEND_KEY,
  SYNC_PATH_KEY,
  CLOUD_URL_KEY,
  CLOUD_TOKEN_KEY,
  WEBDAV_PASSWORD_KEY,
  WEBDAV_URL_KEY,
  WEBDAV_USERNAME_KEY,
} from './sync-constants';
import { logInfo, logWarn, sanitizeLogMessage } from './app-log';

const ATTACHMENTS_DIR_NAME = 'attachments';
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const StorageAccessFramework = (FileSystem as any).StorageAccessFramework;
const WEBDAV_ATTACHMENT_RETRY_OPTIONS = { maxAttempts: 5, baseDelayMs: 2000, maxDelayMs: 60_000 };
const WEBDAV_ATTACHMENT_MIN_INTERVAL_MS = 400;
const WEBDAV_ATTACHMENT_COOLDOWN_MS = 60_000;
const WEBDAV_ATTACHMENT_MAX_DOWNLOADS_PER_SYNC = 10;
const WEBDAV_ATTACHMENT_MAX_UPLOADS_PER_SYNC = 10;
const WEBDAV_ATTACHMENT_MISSING_BACKOFF_MS = 15 * 60_000;
const WEBDAV_ATTACHMENT_ERROR_BACKOFF_MS = 2 * 60_000;
const webdavDownloadBackoff = createWebdavDownloadBackoff({
  missingBackoffMs: WEBDAV_ATTACHMENT_MISSING_BACKOFF_MS,
  errorBackoffMs: WEBDAV_ATTACHMENT_ERROR_BACKOFF_MS,
});

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const map = new Uint8Array(256);
  map.fill(255);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    map[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return map;
})();

const downloadLocks = new Map<string, Promise<Attachment | null>>();

const FILE_BACKEND_VALIDATION_CONFIG = {
  maxFileSizeBytes: Number.POSITIVE_INFINITY,
  blockedMimeTypes: [],
};

const logAttachmentWarn = (message: string, error?: unknown) => {
  const extra = error ? { error: sanitizeLogMessage(error instanceof Error ? error.message : String(error)) } : undefined;
  void logWarn(message, { scope: 'attachment', extra });
};

const logAttachmentInfo = (message: string, extra?: Record<string, string>) => {
  void logInfo(message, { scope: 'attachment', extra });
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getWebdavDownloadBackoff = (attachmentId: string): number | null => {
  return webdavDownloadBackoff.getBlockedUntil(attachmentId);
};

const setWebdavDownloadBackoff = (attachmentId: string, error: unknown): void => {
  webdavDownloadBackoff.setFromError(attachmentId, error);
};

const pruneWebdavDownloadBackoff = (): void => {
  webdavDownloadBackoff.prune();
};

const reportProgress = (
  attachmentId: string,
  operation: 'upload' | 'download',
  loaded: number,
  total: number,
  status: 'active' | 'completed' | 'failed',
  error?: string
) => {
  const percentage = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  globalProgressTracker.updateProgress(attachmentId, {
    operation,
    bytesTransferred: loaded,
    totalBytes: total,
    percentage,
    status,
    error,
  });
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    const hasB1 = typeof b1 === 'number';
    const hasB2 = typeof b2 === 'number';
    const triplet = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);

    out += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
    out += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
    out += hasB1 ? BASE64_ALPHABET[(triplet >> 6) & 0x3f] : '=';
    out += hasB2 ? BASE64_ALPHABET[triplet & 0x3f] : '=';
  }
  return out;
};

const encodeBase64Utf8 = (value: string): string => {
  const Encoder = typeof TextEncoder === 'function' ? TextEncoder : undefined;
  if (Encoder) {
    return bytesToBase64(new Encoder().encode(value));
  }
  try {
    const encoded = encodeURIComponent(value);
    const bytes: number[] = [];
    for (let i = 0; i < encoded.length; i += 1) {
      const ch = encoded[i];
      if (ch === '%') {
        const hex = encoded.slice(i + 1, i + 3);
        bytes.push(Number.parseInt(hex, 16));
        i += 2;
      } else {
        bytes.push(ch.charCodeAt(0));
      }
    }
    return bytesToBase64(new Uint8Array(bytes));
  } catch {
    const bytes = new Uint8Array(value.split('').map((ch) => ch.charCodeAt(0) & 0xff));
    return bytesToBase64(bytes);
  }
};

const buildBasicAuthHeader = (username?: string, password?: string): string | null => {
  if (!username && !password) return null;
  return `Basic ${encodeBase64Utf8(`${username || ''}:${password || ''}`)}`;
};

const buildBearerAuthHeader = (token?: string): string | null => {
  if (!token) return null;
  return `Bearer ${token}`;
};

const resolveUploadType = (): any => {
  const types = (FileSystem as any).FileSystemUploadType;
  return types?.BINARY_CONTENT ?? types?.BINARY ?? undefined;
};

const uploadWebdavFileWithFileSystem = async (
  url: string,
  fileUri: string,
  contentType: string,
  username: string,
  password: string,
  onProgress?: (sent: number, total: number) => void,
  totalBytes?: number
): Promise<boolean> => {
  const uploadAsync = (FileSystem as any).uploadAsync;
  if (typeof uploadAsync !== 'function') return false;
  if (!fileUri.startsWith('file://')) return false;

  const authHeader = buildBasicAuthHeader(username, password);
  const headers: Record<string, string> = {
    'Content-Type': contentType || DEFAULT_CONTENT_TYPE,
  };
  if (authHeader) headers.Authorization = authHeader;

  const uploadType = resolveUploadType();
  const createUploadTask = (FileSystem as any).createUploadTask;
  if (typeof createUploadTask === 'function' && onProgress) {
    const task = createUploadTask(
      url,
      fileUri,
      {
        httpMethod: 'PUT',
        headers,
        uploadType,
      },
      (event: { totalBytesSent?: number; totalBytesExpectedToSend?: number }) => {
        const sent = Number(event.totalBytesSent ?? 0);
        const expected = Number(event.totalBytesExpectedToSend ?? totalBytes ?? 0);
        if (expected > 0) {
          onProgress(sent, expected);
        }
      }
    );
    const result = await task.uploadAsync();
    const status = Number((result as { status?: number } | null)?.status ?? 0);
    if (status && (status < 200 || status >= 300)) {
      const error = new Error(`WebDAV File PUT failed (${status})`);
      (error as { status?: number }).status = status;
      throw error;
    }
    return true;
  }

  const result = await uploadAsync(url, fileUri, { httpMethod: 'PUT', headers, uploadType });
  const status = Number((result as { status?: number } | null)?.status ?? 0);
  if (status && (status < 200 || status >= 300)) {
    const error = new Error(`WebDAV File PUT failed (${status})`);
    (error as { status?: number }).status = status;
    throw error;
  }
  if (onProgress && Number.isFinite(totalBytes ?? NaN) && (totalBytes ?? 0) > 0) {
    onProgress(totalBytes ?? 0, totalBytes ?? 0);
  }
  return true;
};

const uploadCloudFileWithFileSystem = async (
  url: string,
  fileUri: string,
  contentType: string,
  token: string,
  onProgress?: (sent: number, total: number) => void,
  totalBytes?: number
): Promise<boolean> => {
  const uploadAsync = (FileSystem as any).uploadAsync;
  if (typeof uploadAsync !== 'function') return false;
  if (!fileUri.startsWith('file://')) return false;

  const authHeader = buildBearerAuthHeader(token);
  const headers: Record<string, string> = {
    'Content-Type': contentType || DEFAULT_CONTENT_TYPE,
  };
  if (authHeader) headers.Authorization = authHeader;

  const uploadType = resolveUploadType();
  const createUploadTask = (FileSystem as any).createUploadTask;
  if (typeof createUploadTask === 'function' && onProgress) {
    const task = createUploadTask(
      url,
      fileUri,
      {
        httpMethod: 'PUT',
        headers,
        uploadType,
      },
      (event: { totalBytesSent?: number; totalBytesExpectedToSend?: number }) => {
        const sent = Number(event.totalBytesSent ?? 0);
        const expected = Number(event.totalBytesExpectedToSend ?? totalBytes ?? 0);
        if (expected > 0) {
          onProgress(sent, expected);
        }
      }
    );
    const result = await task.uploadAsync();
    const status = Number((result as { status?: number } | null)?.status ?? 0);
    if (status && (status < 200 || status >= 300)) {
      const error = new Error(`Cloud File PUT failed (${status})`);
      (error as { status?: number }).status = status;
      throw error;
    }
    return true;
  }

  const result = await uploadAsync(url, fileUri, { httpMethod: 'PUT', headers, uploadType });
  const status = Number((result as { status?: number } | null)?.status ?? 0);
  if (status && (status < 200 || status >= 300)) {
    const error = new Error(`Cloud File PUT failed (${status})`);
    (error as { status?: number }).status = status;
    throw error;
  }
  if (onProgress && Number.isFinite(totalBytes ?? NaN) && (totalBytes ?? 0) > 0) {
    onProgress(totalBytes ?? 0, totalBytes ?? 0);
  }
  return true;
};

const base64ToBytes = (base64: string): Uint8Array => {
  const sanitized = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  const outputLength = Math.max(0, (sanitized.length * 3) / 4 - padding);
  const bytes = new Uint8Array(outputLength);
  let buffer = 0;
  let bits = 0;
  let index = 0;

  for (let i = 0; i < sanitized.length; i += 1) {
    const ch = sanitized.charCodeAt(i);
    if (sanitized[i] === '=') break;
    const value = BASE64_LOOKUP[ch];
    if (value === 255) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (index < bytes.length) {
        bytes[index] = (buffer >> bits) & 0xff;
      }
      index += 1;
    }
  }
  return bytes;
};

const extractExtension = (value?: string): string => {
  if (!value) return '';
  const stripped = value.split('?')[0].split('#')[0];
  const leaf = stripped.split(/[\\/]/).pop() || '';
  const match = leaf.match(/\.[A-Za-z0-9]{1,8}$/);
  return match ? match[0].toLowerCase() : '';
};

const buildTempUri = (targetUri: string): string => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return `${targetUri}.tmp-${suffix}`;
};

const isTempAttachmentFile = (name: string): boolean => {
  return name.includes('.tmp-') || name.endsWith('.tmp') || name.endsWith('.partial');
};

const writeBytesSafely = async (targetUri: string, bytes: Uint8Array): Promise<void> => {
  const base64 = bytesToBase64(bytes);
  const tempUri = buildTempUri(targetUri);
  await FileSystem.writeAsStringAsync(tempUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  try {
    await FileSystem.moveAsync({ from: tempUri, to: targetUri });
  } catch (error) {
    await FileSystem.writeAsStringAsync(targetUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    try {
      await FileSystem.deleteAsync(tempUri, { idempotent: true });
    } catch {
      // Ignore cleanup errors for temp file.
    }
  }
};

const copyFileSafely = async (sourceUri: string, targetUri: string): Promise<void> => {
  const tempUri = buildTempUri(targetUri);
  await FileSystem.copyAsync({ from: sourceUri, to: tempUri });
  try {
    await FileSystem.moveAsync({ from: tempUri, to: targetUri });
  } catch (error) {
    await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
    try {
      await FileSystem.deleteAsync(tempUri, { idempotent: true });
    } catch {
      // Ignore cleanup errors for temp file.
    }
  }
};

const validateAttachmentHash = async (attachment: Attachment, bytes: Uint8Array): Promise<void> => {
  const expected = attachment.fileHash;
  if (!expected || expected.length !== 64) return;
  const computed = await computeSha256Hex(bytes);
  if (!computed) return;
  if (computed.toLowerCase() !== expected.toLowerCase()) {
    throw new Error('Integrity validation failed');
  }
};

export const buildCloudKey = (attachment: Attachment): string => {
  const ext = extractExtension(attachment.title) || extractExtension(attachment.uri);
  return `${ATTACHMENTS_DIR_NAME}/${attachment.id}${ext}`;
};

export const getBaseSyncUrl = (fullUrl: string): string => {
  const trimmed = fullUrl.replace(/\/+$/, '');
  if (trimmed.toLowerCase().endsWith('.json')) {
    const lastSlash = trimmed.lastIndexOf('/');
    return lastSlash >= 0 ? trimmed.slice(0, lastSlash) : trimmed;
  }
  return trimmed;
};

export const getCloudBaseUrl = (fullUrl: string): string => {
  const trimmed = fullUrl.replace(/\/+$/, '');
  if (trimmed.toLowerCase().endsWith('/data')) {
    return trimmed.slice(0, -'/data'.length);
  }
  return trimmed;
};

type WebDavConfig = { url: string; username: string; password: string };
type CloudConfig = { url: string; token: string };

const loadWebDavConfig = async (): Promise<WebDavConfig | null> => {
  const url = await AsyncStorage.getItem(WEBDAV_URL_KEY);
  if (!url) return null;
  return {
    url,
    username: (await AsyncStorage.getItem(WEBDAV_USERNAME_KEY)) || '',
    password: (await AsyncStorage.getItem(WEBDAV_PASSWORD_KEY)) || '',
  };
};

const loadCloudConfig = async (): Promise<CloudConfig | null> => {
  const url = await AsyncStorage.getItem(CLOUD_URL_KEY);
  if (!url) return null;
  return {
    url,
    token: (await AsyncStorage.getItem(CLOUD_TOKEN_KEY)) || '',
  };
};

const getAttachmentsDir = async (): Promise<string | null> => {
  const base = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!base) return null;
  const normalized = base.endsWith('/') ? base : `${base}/`;
  const dir = `${normalized}${ATTACHMENTS_DIR_NAME}/`;
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('already exists')) {
      logAttachmentWarn('Failed to ensure attachments directory', error);
    }
  }
  return dir;
};

export const cleanupAttachmentTempFiles = async (): Promise<void> => {
  const dir = await getAttachmentsDir();
  if (!dir) return;
  try {
    const entries = await FileSystem.readDirectoryAsync(dir);
    for (const entry of entries) {
      if (!isTempAttachmentFile(entry)) continue;
      try {
        await FileSystem.deleteAsync(`${dir}${entry}`, { idempotent: true });
      } catch (error) {
        logAttachmentWarn('Failed to remove temp attachment file', error);
      }
    }
  } catch (error) {
    logAttachmentWarn('Failed to scan temp attachment files', error);
  }
};

const isSyncFilePath = (path: string) =>
  /(?:^|[\\/])(data\.json|mindwtr-sync\.json)$/i.test(path);

const resolveSafSyncDir = async (syncUri: string): Promise<{ type: 'saf'; dirUri: string; attachmentsDirUri: string } | null> => {
  if (!StorageAccessFramework?.readDirectoryAsync) return null;
  const prefixMatch = syncUri.match(/^(content:\/\/[^/]+)/);
  if (!prefixMatch) return null;
  const prefix = prefixMatch[1];
  const treeMatch = syncUri.match(/\/tree\/([^/]+)/);
  let parentTreeUri: string | null = null;
  let parentDocumentUri: string | null = null;
  if (treeMatch) {
    parentTreeUri = `${prefix}/tree/${treeMatch[1]}`;
    parentDocumentUri = `${parentTreeUri}/document/${treeMatch[1]}`;
  } else {
    const docMatch = syncUri.match(/\/document\/([^/]+)/);
    if (!docMatch) return null;
    const docId = decodeURIComponent(docMatch[1]);
    const colonIndex = docId.indexOf(':');
    if (colonIndex === -1) return null;
    const volume = docId.slice(0, colonIndex + 1);
    const path = docId.slice(colonIndex + 1);
    const lastSlash = path.lastIndexOf('/');
    const parentPath = lastSlash >= 0 ? path.slice(0, lastSlash) : '';
    const parentId = parentPath ? `${volume}${parentPath}` : volume;
    const parentIdEncoded = encodeURIComponent(parentId);
    parentTreeUri = `${prefix}/tree/${parentIdEncoded}`;
    parentDocumentUri = `${parentTreeUri}/document/${parentIdEncoded}`;
  }
  if (!parentTreeUri) return null;
  const directoryCandidates = parentDocumentUri ? [parentDocumentUri, parentTreeUri] : [parentTreeUri];
  let attachmentsDirUri: string | null = null;
  for (const candidate of directoryCandidates) {
    try {
      const entries = await StorageAccessFramework.readDirectoryAsync(candidate);
      const decoded: Array<{ entry: string; decoded: string }> = entries.map((entry: string) => ({
        entry,
        decoded: decodeURIComponent(entry),
      }));
      const matchEntry = decoded.find((item) =>
        item.decoded.endsWith(`/${ATTACHMENTS_DIR_NAME}`) || item.decoded.endsWith(`:${ATTACHMENTS_DIR_NAME}`)
      );
      attachmentsDirUri = matchEntry?.entry ?? null;
      if (attachmentsDirUri) break;
    } catch (error) {
      // Continue to fallback URI variant before logging.
      if (candidate === directoryCandidates[directoryCandidates.length - 1]) {
        logAttachmentWarn('Failed to read SAF directory for attachments', error);
      }
    }
  }
  if (!attachmentsDirUri) {
    for (const candidate of directoryCandidates) {
      try {
        attachmentsDirUri = await StorageAccessFramework.makeDirectoryAsync(candidate, ATTACHMENTS_DIR_NAME);
        if (attachmentsDirUri) break;
      } catch (error) {
        if (candidate === directoryCandidates[directoryCandidates.length - 1]) {
          logAttachmentWarn('Failed to create SAF attachments directory', error);
        }
      }
    }
  }
  if (!attachmentsDirUri) return null;
  return { type: 'saf', dirUri: directoryCandidates[0], attachmentsDirUri };
};

const resolveFileSyncDir = async (
  syncPath: string
): Promise<{ type: 'file'; dirUri: string; attachmentsDirUri: string } | { type: 'saf'; dirUri: string; attachmentsDirUri: string } | null> => {
  if (!syncPath) return null;
  if (syncPath.startsWith('content://')) {
    const resolved = await resolveSafSyncDir(syncPath);
    if (resolved) return resolved;
    return null;
  }

  const normalized = syncPath.replace(/\/+$/, '');
  const isFilePath = isSyncFilePath(normalized);
  const baseDir = isFilePath ? normalized.replace(/\/[^/]+$/, '') : normalized;
  if (!baseDir) return null;
  const dirUri = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
  const attachmentsDirUri = `${dirUri}${ATTACHMENTS_DIR_NAME}/`;
  try {
    await FileSystem.makeDirectoryAsync(attachmentsDirUri, { intermediates: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('already exists')) {
      logAttachmentWarn('Failed to ensure sync attachments directory', error);
    }
  }
  return { type: 'file', dirUri, attachmentsDirUri };
};

const findSafEntry = async (dirUri: string, fileName: string): Promise<string | null> => {
  if (!StorageAccessFramework?.readDirectoryAsync) return null;
  try {
    const entries = await StorageAccessFramework.readDirectoryAsync(dirUri);
    const decoded: Array<{ entry: string; decoded: string }> = entries.map((entry: string) => ({
      entry,
      decoded: decodeURIComponent(entry),
    }));
    const matchEntry = decoded.find((item) =>
      item.decoded.endsWith(`/${fileName}`) || item.decoded.endsWith(`:${fileName}`)
    );
    return matchEntry?.entry ?? null;
  } catch (error) {
    logAttachmentWarn('Failed to read SAF directory', error);
    return null;
  }
};

const readFileAsBytes = async (uri: string): Promise<Uint8Array> => {
  if (uri.startsWith('content://')) {
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      return base64ToBytes(base64);
    } catch (error) {
      if (!StorageAccessFramework?.readAsStringAsync) {
        throw error;
      }
      const base64 = await StorageAccessFramework.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return base64ToBytes(base64);
    }
  }
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return base64ToBytes(base64);
};

const getAttachmentByteSize = async (attachment: Attachment, uri: string): Promise<number | null> => {
  if (typeof attachment.size === 'number') return attachment.size;
  if (uri.startsWith('content://')) return attachment.size ?? null;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && typeof info.size === 'number' ? info.size : null;
  } catch (error) {
    logAttachmentWarn('Failed to read attachment size', error);
    return attachment.size ?? null;
  }
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const fileExists = async (uri: string): Promise<boolean> => {
  if (uri.startsWith('content://')) return true;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch (error) {
    logAttachmentWarn('Failed to check attachment file', error);
    return false;
  }
};

export const persistAttachmentLocally = async (attachment: Attachment): Promise<Attachment> => {
  if (attachment.kind !== 'file') return attachment;
  const uri = attachment.uri || '';
  if (!uri || /^https?:\/\//i.test(uri)) return attachment;

  const attachmentsDir = await getAttachmentsDir();
  if (!attachmentsDir) return attachment;

  if (uri.startsWith(attachmentsDir)) return attachment;

  const ext = extractExtension(attachment.title) || extractExtension(uri);
  const filename = `${attachment.id}${ext}`;
  const targetUri = `${attachmentsDir}${filename}`;
  try {
    logAttachmentInfo('Cache attachment start', {
      id: attachment.id,
      title: attachment.title || 'attachment',
      uri,
      size: Number.isFinite(attachment.size ?? NaN) ? String(attachment.size) : 'unknown',
    });
    const alreadyExists = await fileExists(targetUri);
    if (!alreadyExists) {
      if (uri.startsWith('content://')) {
        const bytes = await readFileAsBytes(uri);
        await writeBytesSafely(targetUri, bytes);
      } else {
        await copyFileSafely(uri, targetUri);
      }
    }
    let size = attachment.size;
    if (!Number.isFinite(size ?? NaN)) {
      const info = await FileSystem.getInfoAsync(targetUri);
      if (info.exists && typeof info.size === 'number') {
        size = info.size;
      }
    }
    logAttachmentInfo('Cache attachment done', {
      id: attachment.id,
      uri: targetUri,
      size: Number.isFinite(size ?? NaN) ? String(size) : 'unknown',
    });
    return {
      ...attachment,
      uri: targetUri,
      size,
      localStatus: 'available',
    };
  } catch (error) {
    logAttachmentWarn('Failed to cache attachment locally', error);
    return attachment;
  }
};

export const syncWebdavAttachments = async (
  appData: AppData,
  webDavConfig: WebDavConfig,
  baseSyncUrl: string
): Promise<boolean> => {
  let lastRequestAt = 0;
  let blockedUntil = 0;
  const waitForSlot = async (): Promise<void> => {
    const now = Date.now();
    if (blockedUntil && now < blockedUntil) {
      throw new Error(`WebDAV rate limited for ${blockedUntil - now}ms`);
    }
    const elapsed = now - lastRequestAt;
    if (elapsed < WEBDAV_ATTACHMENT_MIN_INTERVAL_MS) {
      await sleep(WEBDAV_ATTACHMENT_MIN_INTERVAL_MS - elapsed);
    }
    lastRequestAt = Date.now();
  };
  const handleRateLimit = (error: unknown): boolean => {
    if (!isWebdavRateLimitedError(error)) return false;
    blockedUntil = Date.now() + WEBDAV_ATTACHMENT_COOLDOWN_MS;
    logAttachmentWarn('WebDAV rate limited; pausing attachment sync', error);
    return true;
  };

  const attachmentsDirUrl = `${baseSyncUrl}/${ATTACHMENTS_DIR_NAME}`;
  try {
    await webdavMakeDirectory(attachmentsDirUrl, {
      username: webDavConfig.username,
      password: webDavConfig.password,
    });
  } catch (error) {
    logAttachmentWarn('Failed to ensure WebDAV attachments directory', error);
  }

  const attachmentsDir = await getAttachmentsDir();

  const attachmentsById = new Map<string, Attachment>();
  for (const task of appData.tasks) {
    for (const attachment of task.attachments || []) {
      attachmentsById.set(attachment.id, attachment);
    }
  }
  for (const project of appData.projects) {
    for (const attachment of project.attachments || []) {
      attachmentsById.set(attachment.id, attachment);
    }
  }

  pruneWebdavDownloadBackoff();

  logAttachmentInfo('WebDAV attachment sync start', {
    count: String(attachmentsById.size),
  });

  let didMutate = false;
  const downloadQueue: Attachment[] = [];
  let abortedByRateLimit = false;
  let uploadCount = 0;
  let uploadLimitLogged = false;
  for (const attachment of attachmentsById.values()) {
    if (attachment.kind !== 'file') continue;
    if (attachment.deletedAt) continue;
    if (abortedByRateLimit) break;

    const uri = attachment.uri || '';
    const isHttp = /^https?:\/\//i.test(uri);
    const isContent = uri.startsWith('content://');
    const hasLocalPath = Boolean(uri) && !isHttp;
    logAttachmentInfo('WebDAV attachment check', {
      id: attachment.id,
      title: attachment.title || 'attachment',
      uri,
      cloud: attachment.cloudKey ? 'set' : 'missing',
      localStatus: attachment.localStatus || '',
      uriKind: isHttp ? 'http' : (isContent ? 'content' : 'file'),
    });
    const existsStart = Date.now();
    const existsLocally = hasLocalPath ? await fileExists(uri) : false;
    logAttachmentInfo('WebDAV attachment exists check', {
      id: attachment.id,
      exists: existsLocally ? 'true' : 'false',
      ms: String(Date.now() - existsStart),
    });
    const nextStatus: Attachment['localStatus'] = (existsLocally || isContent || isHttp) ? 'available' : 'missing';
    if (attachment.localStatus !== nextStatus) {
      attachment.localStatus = nextStatus;
      didMutate = true;
    }
    if (existsLocally || isContent || isHttp) {
      webdavDownloadBackoff.deleteEntry(attachment.id);
    }

    if (attachment.cloudKey && hasLocalPath && existsLocally && !isHttp) {
      try {
        const remoteExists = await withRetry(
          async () => {
            await waitForSlot();
            return await webdavFileExists(`${baseSyncUrl}/${attachment.cloudKey}`, {
              username: webDavConfig.username,
              password: webDavConfig.password,
            });
          },
          WEBDAV_ATTACHMENT_RETRY_OPTIONS
        );
        logAttachmentInfo('WebDAV attachment remote exists', {
          id: attachment.id,
          exists: remoteExists ? 'true' : 'false',
        });
        if (!remoteExists) {
          attachment.cloudKey = undefined;
          webdavDownloadBackoff.deleteEntry(attachment.id);
          didMutate = true;
        }
      } catch (error) {
        if (handleRateLimit(error)) {
          abortedByRateLimit = true;
          break;
        }
        logAttachmentWarn('WebDAV attachment remote check failed', error);
      }
    }

    if (!attachment.cloudKey && !hasLocalPath) {
      logAttachmentInfo('Skip upload (no local uri)', {
        id: attachment.id,
        title: attachment.title || 'attachment',
      });
      continue;
    }
    if (hasLocalPath && !existsLocally && !isHttp && !isContent) {
      if (!attachment.cloudKey) {
        logAttachmentWarn(`Attachment file missing for ${attachment.title}`, new Error(`uri:${uri}`));
        continue;
      }
    }

    if (!attachment.cloudKey && hasLocalPath && existsLocally && !isHttp) {
      if (uploadCount >= WEBDAV_ATTACHMENT_MAX_UPLOADS_PER_SYNC) {
        if (!uploadLimitLogged) {
          logAttachmentInfo('WebDAV attachment upload limit reached', {
            limit: String(WEBDAV_ATTACHMENT_MAX_UPLOADS_PER_SYNC),
          });
          uploadLimitLogged = true;
        }
        continue;
      }
      uploadCount += 1;
      try {
        const size = await getAttachmentByteSize(attachment, uri);
        const validation = await validateAttachmentForUpload(attachment, size);
        if (!validation.valid) {
          logAttachmentWarn(`Attachment validation failed (${validation.error}) for ${attachment.title}`);
          continue;
        }
        const cloudKey = buildCloudKey(attachment);
        const startedAt = Date.now();
        reportProgress(attachment.id, 'upload', 0, size ?? 0, 'active');
        const uploadUrl = `${baseSyncUrl}/${cloudKey}`;
        const uploadBytes = size ?? 0;
        let uploadedWithFileSystem = false;
        if (uploadUrl) {
          logAttachmentInfo('WebDAV attachment upload start', {
            id: attachment.id,
            bytes: String(uploadBytes),
            cloudKey,
          });
          uploadedWithFileSystem = await withRetry(
            async () => {
              await waitForSlot();
              return await uploadWebdavFileWithFileSystem(
                uploadUrl,
                uri,
                attachment.mimeType || DEFAULT_CONTENT_TYPE,
                webDavConfig.username,
                webDavConfig.password,
                (loaded, total) => reportProgress(attachment.id, 'upload', loaded, total, 'active'),
                uploadBytes
              );
            },
            {
              ...WEBDAV_ATTACHMENT_RETRY_OPTIONS,
              onRetry: (error, attempt, delayMs) => {
                logAttachmentInfo('Retrying WebDAV attachment upload', {
                  id: attachment.id,
                  attempt: String(attempt + 1),
                  delayMs: String(delayMs),
                  error: sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
                });
              },
            }
          );
        }
        if (!uploadedWithFileSystem) {
          const readStart = Date.now();
          logAttachmentInfo('WebDAV attachment read start', {
            id: attachment.id,
            uri,
          });
          const fileData = await readFileAsBytes(uri);
          logAttachmentInfo('WebDAV attachment read done', {
            id: attachment.id,
            bytes: String(fileData.byteLength),
            ms: String(Date.now() - readStart),
          });
          const buffer = toArrayBuffer(fileData);
          await withRetry(
            async () => {
              await waitForSlot();
              return await webdavPutFile(
                uploadUrl,
                buffer,
                attachment.mimeType || DEFAULT_CONTENT_TYPE,
                {
                  username: webDavConfig.username,
                  password: webDavConfig.password,
                }
              );
            },
            {
              ...WEBDAV_ATTACHMENT_RETRY_OPTIONS,
              onRetry: (error, attempt, delayMs) => {
                logAttachmentInfo('Retrying WebDAV attachment upload', {
                  id: attachment.id,
                  attempt: String(attempt + 1),
                  delayMs: String(delayMs),
                  error: sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
                });
              },
            }
          );
        }
        attachment.cloudKey = cloudKey;
        attachment.localStatus = 'available';
        didMutate = true;
        reportProgress(attachment.id, 'upload', size ?? 0, size ?? 0, 'completed');
        logAttachmentInfo('Attachment uploaded', {
          id: attachment.id,
          bytes: String(size ?? 0),
          ms: String(Date.now() - startedAt),
        });
      } catch (error) {
        if (handleRateLimit(error)) {
          abortedByRateLimit = true;
          break;
        }
        reportProgress(
          attachment.id,
          'upload',
          0,
          attachment.size ?? 0,
          'failed',
          error instanceof Error ? error.message : String(error)
        );
        logAttachmentWarn(`Failed to upload attachment ${attachment.title}`, error);
      }
    }

    if (attachment.cloudKey && !existsLocally && !isContent && !isHttp) {
      downloadQueue.push(attachment);
    }
  }

  if (attachmentsDir && !abortedByRateLimit) {
    let downloadCount = 0;
    for (const attachment of downloadQueue) {
      if (attachment.kind !== 'file') continue;
      if (attachment.deletedAt) continue;
      if (abortedByRateLimit) break;
      if (!attachment.cloudKey) continue;
      if (getWebdavDownloadBackoff(attachment.id)) continue;
      if (downloadCount >= WEBDAV_ATTACHMENT_MAX_DOWNLOADS_PER_SYNC) {
        logAttachmentInfo('WebDAV attachment download limit reached', {
          limit: String(WEBDAV_ATTACHMENT_MAX_DOWNLOADS_PER_SYNC),
        });
        break;
      }
      downloadCount += 1;

      const cloudKey = attachment.cloudKey;
      try {
        const downloadUrl = `${baseSyncUrl}/${cloudKey}`;
        const fileData = await withRetry(
          async () => {
            await waitForSlot();
            return await webdavGetFile(downloadUrl, {
              username: webDavConfig.username,
              password: webDavConfig.password,
              onProgress: (loaded, total) => reportProgress(attachment.id, 'download', loaded, total, 'active'),
            });
          },
          WEBDAV_ATTACHMENT_RETRY_OPTIONS
        );
        const bytes = fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : new Uint8Array(fileData as ArrayBuffer);
        await validateAttachmentHash(attachment, bytes);
        const filename = cloudKey.split('/').pop() || `${attachment.id}${extractExtension(attachment.title)}`;
        const targetUri = `${attachmentsDir}${filename}`;
        await writeBytesSafely(targetUri, bytes);
        attachment.uri = targetUri;
        if (attachment.localStatus !== 'available') {
          attachment.localStatus = 'available';
          didMutate = true;
        }
        webdavDownloadBackoff.deleteEntry(attachment.id);
        reportProgress(attachment.id, 'download', bytes.length, bytes.length, 'completed');
      } catch (error) {
        if (handleRateLimit(error)) {
          abortedByRateLimit = true;
          break;
        }
        const status = getErrorStatus(error);
        if (status === 404 && attachment.cloudKey) {
          attachment.cloudKey = undefined;
          webdavDownloadBackoff.deleteEntry(attachment.id);
          didMutate = true;
          logAttachmentInfo('Cleared missing WebDAV cloud key after 404', {
            id: attachment.id,
          });
        } else {
          setWebdavDownloadBackoff(attachment.id, error);
        }
        if (attachment.localStatus !== 'missing') {
          attachment.localStatus = 'missing';
          didMutate = true;
        }
        reportProgress(
          attachment.id,
          'download',
          0,
          attachment.size ?? 0,
          'failed',
          error instanceof Error ? error.message : String(error)
        );
        logAttachmentWarn(`Failed to download attachment ${attachment.title}`, error);
      }
    }
  }

  if (abortedByRateLimit) {
    logAttachmentWarn('WebDAV attachment sync aborted due to rate limiting');
  }
  logAttachmentInfo('WebDAV attachment sync done', {
    mutated: didMutate ? 'true' : 'false',
  });
  return didMutate;
};

export const syncCloudAttachments = async (
  appData: AppData,
  cloudConfig: CloudConfig,
  baseSyncUrl: string
): Promise<boolean> => {
  await getAttachmentsDir();

  const attachmentsById = new Map<string, Attachment>();
  for (const task of appData.tasks) {
    for (const attachment of task.attachments || []) {
      attachmentsById.set(attachment.id, attachment);
    }
  }
  for (const project of appData.projects) {
    for (const attachment of project.attachments || []) {
      attachmentsById.set(attachment.id, attachment);
    }
  }

  let didMutate = false;
  for (const attachment of attachmentsById.values()) {
    if (attachment.kind !== 'file') continue;
    if (attachment.deletedAt) continue;

    const uri = attachment.uri || '';
    const isHttp = /^https?:\/\//i.test(uri);
    const isContent = uri.startsWith('content://');
    const hasLocalPath = Boolean(uri) && !isHttp;
    const existsLocally = hasLocalPath ? await fileExists(uri) : false;
    const nextStatus: Attachment['localStatus'] = (existsLocally || isContent || isHttp) ? 'available' : 'missing';
    if (attachment.localStatus !== nextStatus) {
      attachment.localStatus = nextStatus;
      didMutate = true;
    }

    if (!attachment.cloudKey && hasLocalPath && existsLocally && !isHttp) {
      try {
        let fileSize = await getAttachmentByteSize(attachment, uri);
        let fileData: Uint8Array | null = null;
        if (!Number.isFinite(fileSize ?? NaN)) {
          fileData = await readFileAsBytes(uri);
          fileSize = fileData.byteLength;
        }

        const validation = await validateAttachmentForUpload(attachment, fileSize);
        if (!validation.valid) {
          logAttachmentWarn(`Attachment validation failed (${validation.error}) for ${attachment.title}`);
          continue;
        }
        const totalBytes = Math.max(0, Number(fileSize ?? 0));
        reportProgress(attachment.id, 'upload', 0, totalBytes, 'active');
        const cloudKey = buildCloudKey(attachment);
        const uploadUrl = `${baseSyncUrl}/${cloudKey}`;
        const uploadedWithFileSystem = await uploadCloudFileWithFileSystem(
          uploadUrl,
          uri,
          attachment.mimeType || DEFAULT_CONTENT_TYPE,
          cloudConfig.token,
          (loaded, total) => reportProgress(attachment.id, 'upload', loaded, total, 'active'),
          totalBytes
        );
        if (!uploadedWithFileSystem) {
          const uploadBytes = fileData ?? await readFileAsBytes(uri);
          const buffer = toArrayBuffer(uploadBytes);
          await cloudPutFile(
            uploadUrl,
            buffer,
            attachment.mimeType || DEFAULT_CONTENT_TYPE,
            { token: cloudConfig.token }
          );
        }
        attachment.cloudKey = cloudKey;
        if (!Number.isFinite(attachment.size ?? NaN) && Number.isFinite(fileSize ?? NaN)) {
          attachment.size = Number(fileSize);
        }
        attachment.localStatus = 'available';
        didMutate = true;
        reportProgress(attachment.id, 'upload', totalBytes, totalBytes, 'completed');
      } catch (error) {
        reportProgress(
          attachment.id,
          'upload',
          0,
          attachment.size ?? 0,
          'failed',
          error instanceof Error ? error.message : String(error)
        );
        logAttachmentWarn(`Failed to upload attachment ${attachment.title}`, error);
      }
    }
  }

  return didMutate;
};

export const syncFileAttachments = async (
  appData: AppData,
  syncPath: string
): Promise<boolean> => {
  const syncDir = await resolveFileSyncDir(syncPath);
  if (!syncDir) return false;

  const attachmentsDir = await getAttachmentsDir();
  if (!attachmentsDir) return false;

  const attachmentsById = new Map<string, Attachment>();
  for (const task of appData.tasks) {
    for (const attachment of task.attachments || []) {
      attachmentsById.set(attachment.id, attachment);
    }
  }
  for (const project of appData.projects) {
    for (const attachment of project.attachments || []) {
      attachmentsById.set(attachment.id, attachment);
    }
  }

  let didMutate = false;
  for (const attachment of attachmentsById.values()) {
    if (attachment.kind !== 'file') continue;
    if (attachment.deletedAt) continue;

    const uri = attachment.uri || '';
    const isHttp = /^https?:\/\//i.test(uri);
    const hasLocal = Boolean(uri) && !isHttp;
    const existsLocally = hasLocal ? await fileExists(uri) : false;
    const nextStatus: Attachment['localStatus'] = (existsLocally || uri.startsWith('content://') || isHttp) ? 'available' : 'missing';
    if (attachment.localStatus !== nextStatus) {
      attachment.localStatus = nextStatus;
      didMutate = true;
    }

    if (hasLocal && existsLocally && !isHttp) {
      const cloudKey = attachment.cloudKey || buildCloudKey(attachment);
      const filename = cloudKey.split('/').pop() || `${attachment.id}${extractExtension(attachment.title)}`;
      let remoteExists = false;
      if (syncDir.type === 'file') {
        const targetUri = `${syncDir.attachmentsDirUri}${filename}`;
        remoteExists = await fileExists(targetUri);
      } else {
        remoteExists = Boolean(await findSafEntry(syncDir.attachmentsDirUri, filename));
      }
      if (!remoteExists) {
        try {
          const size = await getAttachmentByteSize(attachment, uri);
          if (size != null) {
            const validation = await validateAttachmentForUpload(attachment, size, FILE_BACKEND_VALIDATION_CONFIG);
            if (!validation.valid) {
              logAttachmentWarn(`Attachment validation failed (${validation.error}) for ${attachment.title}`);
              continue;
            }
          }
          if (syncDir.type === 'file') {
            const targetUri = `${syncDir.attachmentsDirUri}${filename}`;
            if (uri.startsWith('content://')) {
              const bytes = await readFileAsBytes(uri);
              await writeBytesSafely(targetUri, bytes);
            } else {
              await copyFileSafely(uri, targetUri);
            }
          } else {
            const base64 = await readFileAsBytes(uri).then(bytesToBase64);
            let targetUri = await findSafEntry(syncDir.attachmentsDirUri, filename);
            if (!targetUri && StorageAccessFramework?.createFileAsync) {
              targetUri = await StorageAccessFramework.createFileAsync(syncDir.attachmentsDirUri, filename, attachment.mimeType || DEFAULT_CONTENT_TYPE);
            }
            if (targetUri && StorageAccessFramework?.writeAsStringAsync) {
              await StorageAccessFramework.writeAsStringAsync(targetUri, base64, { encoding: FileSystem.EncodingType.Base64 });
            }
          }
        } catch (error) {
          logAttachmentWarn(`Failed to copy attachment ${attachment.title} to sync folder`, error);
          continue;
        }
      }
      if (!attachment.cloudKey) {
        attachment.cloudKey = cloudKey;
        attachment.localStatus = 'available';
        didMutate = true;
      }
    }
  }

  return didMutate;
};

const ensureFileAttachmentAvailable = async (
  attachment: Attachment,
  syncPath: string
): Promise<Attachment | null> => {
  const syncDir = await resolveFileSyncDir(syncPath);
  if (!syncDir) return null;
  if (!attachment.cloudKey) return null;
  const attachmentsDir = await getAttachmentsDir();
  if (!attachmentsDir) return null;
  const filename = attachment.cloudKey.split('/').pop() || `${attachment.id}${extractExtension(attachment.title)}`;
  const targetUri = `${attachmentsDir}${filename}`;
  const existing = await fileExists(targetUri);
  if (existing) {
    return { ...attachment, uri: targetUri, localStatus: 'available' };
  }

  try {
    if (syncDir.type === 'file') {
      const sourceUri = `${syncDir.attachmentsDirUri}${filename}`;
      const exists = await fileExists(sourceUri);
      if (!exists) return null;
      await copyFileSafely(sourceUri, targetUri);
      return { ...attachment, uri: targetUri, localStatus: 'available' };
    }
    const entry = await findSafEntry(syncDir.attachmentsDirUri, filename);
    if (!entry || !StorageAccessFramework?.readAsStringAsync) return null;
    const base64 = await StorageAccessFramework.readAsStringAsync(entry, { encoding: FileSystem.EncodingType.Base64 });
    await writeBytesSafely(targetUri, base64ToBytes(base64));
    return { ...attachment, uri: targetUri, localStatus: 'available' };
  } catch (error) {
    logAttachmentWarn(`Failed to copy attachment ${attachment.title} from sync folder`, error);
    return null;
  }
};

const ensureAttachmentAvailableInternal = async (attachment: Attachment): Promise<Attachment | null> => {
  if (attachment.kind !== 'file') return attachment;
  const uri = attachment.uri || '';
  const isHttp = /^https?:\/\//i.test(uri);
  const isContent = uri.startsWith('content://');
  if (uri && (isHttp || isContent)) {
    return { ...attachment, localStatus: 'available' };
  }

  if (uri) {
    const exists = await fileExists(uri);
    if (exists) {
      return { ...attachment, localStatus: 'available' };
    }
  }

  const backend = await AsyncStorage.getItem(SYNC_BACKEND_KEY);
  if (backend === 'file') {
    const syncPath = await AsyncStorage.getItem(SYNC_PATH_KEY);
    if (syncPath) {
      const resolved = await ensureFileAttachmentAvailable(attachment, syncPath);
      if (resolved) return resolved;
    }
    return null;
  }

  if (backend === 'cloud' && attachment.cloudKey) {
    const config = await loadCloudConfig();
    if (!config?.url) return null;
    const baseSyncUrl = getCloudBaseUrl(config.url);
    const attachmentsDir = await getAttachmentsDir();
    if (!attachmentsDir) return null;
    const filename = attachment.cloudKey.split('/').pop() || `${attachment.id}${extractExtension(attachment.title)}`;
    const targetUri = `${attachmentsDir}${filename}`;
    const existing = await fileExists(targetUri);
    if (existing) {
      return { ...attachment, uri: targetUri, localStatus: 'available' };
    }
    try {
      const data = await withRetry(() =>
        cloudGetFile(`${baseSyncUrl}/${attachment.cloudKey}`, {
          token: config.token,
          onProgress: (loaded, total) => reportProgress(attachment.id, 'download', loaded, total, 'active'),
        })
      );
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
      await validateAttachmentHash(attachment, bytes);
      await writeBytesSafely(targetUri, bytes);
      reportProgress(attachment.id, 'download', bytes.length, bytes.length, 'completed');
      return { ...attachment, uri: targetUri, localStatus: 'available' };
    } catch (error) {
      reportProgress(
        attachment.id,
        'download',
        0,
        attachment.size ?? 0,
        'failed',
        error instanceof Error ? error.message : String(error)
      );
      logAttachmentWarn(`Failed to download attachment ${attachment.title}`, error);
      return null;
    }
  }

  if (attachment.cloudKey) {
    const config = await loadWebDavConfig();
    if (!config?.url) return null;
    const baseSyncUrl = getBaseSyncUrl(config.url);
    const attachmentsDir = await getAttachmentsDir();
    if (!attachmentsDir) return null;
    const filename = attachment.cloudKey.split('/').pop() || `${attachment.id}${extractExtension(attachment.title)}`;
    const targetUri = `${attachmentsDir}${filename}`;
    const existing = await fileExists(targetUri);
    if (existing) {
      return { ...attachment, uri: targetUri, localStatus: 'available' };
    }
    try {
      const data = await withRetry(() =>
        webdavGetFile(`${baseSyncUrl}/${attachment.cloudKey}`, {
          username: config.username,
          password: config.password,
          onProgress: (loaded, total) => reportProgress(attachment.id, 'download', loaded, total, 'active'),
        })
      );
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
      await validateAttachmentHash(attachment, bytes);
      await writeBytesSafely(targetUri, bytes);
      reportProgress(attachment.id, 'download', bytes.length, bytes.length, 'completed');
      return { ...attachment, uri: targetUri, localStatus: 'available' };
    } catch (error) {
      reportProgress(
        attachment.id,
        'download',
        0,
        attachment.size ?? 0,
        'failed',
        error instanceof Error ? error.message : String(error)
      );
      logAttachmentWarn(`Failed to download attachment ${attachment.title}`, error);
      return null;
    }
  }

  return null;
};

export const ensureAttachmentAvailable = async (attachment: Attachment): Promise<Attachment | null> => {
  if (attachment.kind !== 'file') return attachment;
  const existing = downloadLocks.get(attachment.id);
  if (existing) return existing;
  const downloadPromise = ensureAttachmentAvailableInternal(attachment);
  downloadLocks.set(attachment.id, downloadPromise);
  try {
    return await downloadPromise;
  } finally {
    downloadLocks.delete(attachment.id);
  }
};
