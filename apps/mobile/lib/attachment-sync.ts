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
  webdavMakeDirectory,
  webdavPutFile,
  withRetry,
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

const ATTACHMENTS_DIR_NAME = 'attachments';
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const StorageAccessFramework = (FileSystem as any).StorageAccessFramework;

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

export const sanitizeAppDataForRemote = (data: AppData): AppData => {
  const sanitizeAttachments = (attachments?: Attachment[]): Attachment[] | undefined => {
    if (!attachments) return attachments;
    return attachments.map((attachment) => {
      if (attachment.kind !== 'file') return attachment;
      return {
        ...attachment,
        uri: '',
        localStatus: undefined,
      };
    });
  };

  return {
    ...data,
    tasks: data.tasks.map((task) => ({
      ...task,
      attachments: sanitizeAttachments(task.attachments),
    })),
    projects: data.projects.map((project) => ({
      ...project,
      attachments: sanitizeAttachments(project.attachments),
    })),
  };
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
      console.warn('Failed to ensure attachments directory', error);
    }
  }
  return dir;
};

const isSyncFilePath = (path: string) =>
  /(?:^|[\\/])(data\.json|mindwtr-sync\.json)$/i.test(path);

const resolveFileSyncDir = async (
  syncPath: string
): Promise<{ type: 'file'; dirUri: string; attachmentsDirUri: string } | { type: 'saf'; dirUri: string; attachmentsDirUri: string } | null> => {
  if (!syncPath) return null;
  if (syncPath.startsWith('content://')) {
    if (!StorageAccessFramework?.readDirectoryAsync) return null;
    const match = syncPath.match(/^(content:\/\/[^/]+)\/document\/(.+)$/);
    if (!match) return null;
    const prefix = match[1];
    const docId = decodeURIComponent(match[2]);
    const parts = docId.split('/');
    if (parts.length < 2) return null;
    const parentId = parts.slice(0, -1).join('/');
    const parentTreeUri = `${prefix}/tree/${encodeURIComponent(parentId)}`;
    let attachmentsDirUri: string | null = null;
    try {
      attachmentsDirUri = await StorageAccessFramework.makeDirectoryAsync(parentTreeUri, ATTACHMENTS_DIR_NAME);
    } catch (error) {
      try {
        const entries = await StorageAccessFramework.readDirectoryAsync(parentTreeUri);
        const decoded = entries.map((entry: string) => ({ entry, decoded: decodeURIComponent(entry) }));
        const matchEntry = decoded.find((item) =>
          item.decoded.endsWith(`/${ATTACHMENTS_DIR_NAME}`) || item.decoded.endsWith(`:${ATTACHMENTS_DIR_NAME}`)
        );
        attachmentsDirUri = matchEntry?.entry ?? null;
      } catch (innerError) {
        console.warn('Failed to resolve SAF attachments directory', innerError);
      }
    }
    if (!attachmentsDirUri) return null;
    return { type: 'saf', dirUri: parentTreeUri, attachmentsDirUri };
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
      console.warn('Failed to ensure sync attachments directory', error);
    }
  }
  return { type: 'file', dirUri, attachmentsDirUri };
};

const findSafEntry = async (dirUri: string, fileName: string): Promise<string | null> => {
  if (!StorageAccessFramework?.readDirectoryAsync) return null;
  try {
    const entries = await StorageAccessFramework.readDirectoryAsync(dirUri);
    const decoded = entries.map((entry: string) => ({ entry, decoded: decodeURIComponent(entry) }));
    const matchEntry = decoded.find((item) =>
      item.decoded.endsWith(`/${fileName}`) || item.decoded.endsWith(`:${fileName}`)
    );
    return matchEntry?.entry ?? null;
  } catch (error) {
    console.warn('Failed to read SAF directory', error);
    return null;
  }
};

const readFileAsBytes = async (uri: string): Promise<Uint8Array> => {
  if (uri.startsWith('content://')) {
    if (!StorageAccessFramework?.readAsStringAsync) {
      throw new Error('Storage Access Framework not available.');
    }
    const base64 = await StorageAccessFramework.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64ToBytes(base64);
  }
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return base64ToBytes(base64);
};

const getAttachmentByteSize = async (attachment: Attachment, uri: string): Promise<number | null> => {
  if (typeof attachment.size === 'number') return attachment.size;
  if (uri.startsWith('content://')) return attachment.size ?? null;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return typeof info.size === 'number' ? info.size : null;
  } catch (error) {
    console.warn('Failed to read attachment size', error);
    return attachment.size ?? null;
  }
};

const fileExists = async (uri: string): Promise<boolean> => {
  if (uri.startsWith('content://')) return true;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch (error) {
    console.warn('Failed to check attachment file', error);
    return false;
  }
};

export const syncWebdavAttachments = async (
  appData: AppData,
  webDavConfig: WebDavConfig,
  baseSyncUrl: string
): Promise<boolean> => {
  const attachmentsDirUrl = `${baseSyncUrl}/${ATTACHMENTS_DIR_NAME}`;
  try {
    await webdavMakeDirectory(attachmentsDirUrl, {
      username: webDavConfig.username,
      password: webDavConfig.password,
    });
  } catch (error) {
    console.warn('Failed to ensure WebDAV attachments directory', error);
  }

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
        const fileData = await readFileAsBytes(uri);
        const validation = await validateAttachmentForUpload(attachment, fileData.byteLength);
        if (!validation.valid) {
          console.warn(`Attachment validation failed (${validation.error}) for ${attachment.title}`);
          continue;
        }
        reportProgress(attachment.id, 'upload', 0, fileData.byteLength, 'active');
        const buffer = fileData.byteOffset === 0 && fileData.byteLength === fileData.buffer.byteLength
          ? fileData.buffer
          : fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
        const cloudKey = buildCloudKey(attachment);
        await webdavPutFile(
          `${baseSyncUrl}/${cloudKey}`,
          buffer,
          attachment.mimeType || DEFAULT_CONTENT_TYPE,
          {
            username: webDavConfig.username,
            password: webDavConfig.password,
            onProgress: (loaded, total) => reportProgress(attachment.id, 'upload', loaded, total, 'active'),
          }
        );
        attachment.cloudKey = cloudKey;
        attachment.localStatus = 'available';
        didMutate = true;
        reportProgress(attachment.id, 'upload', fileData.byteLength, fileData.byteLength, 'completed');
      } catch (error) {
        reportProgress(
          attachment.id,
          'upload',
          0,
          attachment.size ?? 0,
          'failed',
          error instanceof Error ? error.message : String(error)
        );
        console.warn(`Failed to upload attachment ${attachment.title}`, error);
      }
    }
  }

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
        const fileData = await readFileAsBytes(uri);
        const validation = await validateAttachmentForUpload(attachment, fileData.byteLength);
        if (!validation.valid) {
          console.warn(`Attachment validation failed (${validation.error}) for ${attachment.title}`);
          continue;
        }
        reportProgress(attachment.id, 'upload', 0, fileData.byteLength, 'active');
        const buffer = fileData.byteOffset === 0 && fileData.byteLength === fileData.buffer.byteLength
          ? fileData.buffer
          : fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
        const cloudKey = buildCloudKey(attachment);
        await cloudPutFile(
          `${baseSyncUrl}/${cloudKey}`,
          buffer,
          attachment.mimeType || DEFAULT_CONTENT_TYPE,
          {
            token: cloudConfig.token,
            onProgress: (loaded, total) => reportProgress(attachment.id, 'upload', loaded, total, 'active'),
          }
        );
        attachment.cloudKey = cloudKey;
        attachment.localStatus = 'available';
        didMutate = true;
        reportProgress(attachment.id, 'upload', fileData.byteLength, fileData.byteLength, 'completed');
      } catch (error) {
        reportProgress(
          attachment.id,
          'upload',
          0,
          attachment.size ?? 0,
          'failed',
          error instanceof Error ? error.message : String(error)
        );
        console.warn(`Failed to upload attachment ${attachment.title}`, error);
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

    if (!attachment.cloudKey && hasLocal && existsLocally && !isHttp) {
      const cloudKey = buildCloudKey(attachment);
      const filename = cloudKey.split('/').pop() || `${attachment.id}${extractExtension(attachment.title)}`;
      try {
        const size = await getAttachmentByteSize(attachment, uri);
        if (size != null) {
          const validation = await validateAttachmentForUpload(attachment, size, FILE_BACKEND_VALIDATION_CONFIG);
          if (!validation.valid) {
            console.warn(`Attachment validation failed (${validation.error}) for ${attachment.title}`);
            continue;
          }
        }
        if (syncDir.type === 'file') {
          const targetUri = `${syncDir.attachmentsDirUri}${filename}`;
          await FileSystem.copyAsync({ from: uri, to: targetUri });
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
        attachment.cloudKey = cloudKey;
        attachment.localStatus = 'available';
        didMutate = true;
      } catch (error) {
        console.warn(`Failed to copy attachment ${attachment.title} to sync folder`, error);
      }
    }
  }

  return didMutate;
};

const ensureFileAttachmentAvailable = async (attachment: Attachment, syncPath: string): Promise<Attachment | null> => {
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
      await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
      return { ...attachment, uri: targetUri, localStatus: 'available' };
    }
    const entry = await findSafEntry(syncDir.attachmentsDirUri, filename);
    if (!entry || !StorageAccessFramework?.readAsStringAsync) return null;
    const base64 = await StorageAccessFramework.readAsStringAsync(entry, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.writeAsStringAsync(targetUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return { ...attachment, uri: targetUri, localStatus: 'available' };
  } catch (error) {
    console.warn(`Failed to copy attachment ${attachment.title} from sync folder`, error);
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
      const base64 = bytesToBase64(bytes);
      await FileSystem.writeAsStringAsync(targetUri, base64, { encoding: FileSystem.EncodingType.Base64 });
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
      console.warn(`Failed to download attachment ${attachment.title}`, error);
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
      const base64 = bytesToBase64(bytes);
      await FileSystem.writeAsStringAsync(targetUri, base64, { encoding: FileSystem.EncodingType.Base64 });
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
      console.warn(`Failed to download attachment ${attachment.title}`, error);
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
