import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { generateUUID } from '@mindwtr/core';

export type AppleTaskSearchAvailability = {
  supported: boolean;
  reason: string;
};

export type AppleTaskSearchNativeMatch = {
  indexedId: string;
  taskId: string;
};

interface MindwtrAppleTaskSearchNativeModule extends NativeModule {
  availability?: () => Promise<AppleTaskSearchAvailability>;
  search?: (requestId: string, query: string) => Promise<AppleTaskSearchNativeMatch[]>;
  cancel?: (requestId: string) => Promise<void>;
}

const nativeModule = Platform.OS === 'ios'
  ? requireOptionalNativeModule<MindwtrAppleTaskSearchNativeModule>('MindwtrAppleTaskSearch')
  : null;

const isDevelopmentBuild = (): boolean => typeof __DEV__ !== 'undefined' && __DEV__ === true;
let currentRequestId: string | null = null;

export async function getAppleTaskSearchAvailability(): Promise<AppleTaskSearchAvailability> {
  if (!isDevelopmentBuild()) return { supported: false, reason: 'development_only' };
  if (Platform.OS !== 'ios') return { supported: false, reason: 'unsupported_platform' };
  if (!nativeModule?.availability) return { supported: false, reason: 'native_module_unavailable' };
  try {
    const result = await nativeModule.availability();
    return {
      supported: result?.supported === true,
      reason: typeof result?.reason === 'string' && result.reason ? result.reason : 'unknown',
    };
  } catch {
    return { supported: false, reason: 'availability_check_failed' };
  }
}

function abortError(): Error {
  const error = new Error('Apple task search cancelled');
  error.name = 'AbortError';
  return error;
}

export async function cancelAppleTaskSearch(): Promise<void> {
  const requestId = currentRequestId;
  if (!requestId || !nativeModule?.cancel) return;
  await nativeModule.cancel(requestId);
}

export async function searchAppleTasksNative(
  rawQuery: string,
  options?: { signal?: AbortSignal },
): Promise<AppleTaskSearchNativeMatch[]> {
  const availability = await getAppleTaskSearchAvailability();
  if (!availability.supported || !nativeModule?.search) {
    throw new Error(`Apple task search unavailable: ${availability.reason}`);
  }

  const query = rawQuery.trim();
  if (!query) throw new Error('Enter a task search query.');
  if (query.length > 500) throw new Error('Task search queries must be 500 characters or fewer.');
  if (options?.signal?.aborted) throw abortError();

  const requestId = generateUUID();
  currentRequestId = requestId;
  const cancelOnAbort = () => {
    void nativeModule.cancel?.(requestId).catch(() => undefined);
  };
  options?.signal?.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    const matches = await nativeModule.search(requestId, query);
    if (options?.signal?.aborted) throw abortError();
    const seenTaskIds = new Set<string>();
    const sanitizedMatches: AppleTaskSearchNativeMatch[] = [];
    for (const match of Array.isArray(matches) ? matches : []) {
      if (!match || typeof match.indexedId !== 'string' || typeof match.taskId !== 'string') continue;
      const indexedId = match.indexedId.trim();
      const taskId = match.taskId.trim();
      if (!indexedId || !taskId || seenTaskIds.has(taskId)) continue;
      seenTaskIds.add(taskId);
      sanitizedMatches.push({ indexedId, taskId });
      if (sanitizedMatches.length >= 50) break;
    }
    return sanitizedMatches;
  } catch (error) {
    if (options?.signal?.aborted) throw abortError();
    throw error;
  } finally {
    options?.signal?.removeEventListener('abort', cancelOnAbort);
    if (currentRequestId === requestId) currentRequestId = null;
  }
}
