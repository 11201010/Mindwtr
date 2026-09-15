import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type AppleFoundationModelsUnavailableReason =
  | 'unsupported_platform'
  | 'native_module_missing'
  | 'unsupported_os'
  | 'apple_intelligence_disabled'
  | 'device_not_eligible'
  | 'model_not_ready'
  | 'locale_not_supported'
  | 'unknown';

export type AppleFoundationModelsCapability = Readonly<{
  available: boolean;
  reason?: AppleFoundationModelsUnavailableReason;
  supportedOperations: readonly ('inbox_clarification')[];
  contextSize?: number;
}>;

export type AppleFoundationModelsNativeRequest = Readonly<{
  requestId: string;
  locale: string;
  title: string;
  description: string;
  candidates: readonly Readonly<{
    kind: 'project' | 'area' | 'context' | 'tag';
    id: string;
    label: string;
  }>[];
}>;

export type AppleFoundationModelsNativeSuggestion = Readonly<{
  cleanedTitle: string;
  status?: string | null;
  projectIds?: readonly string[];
  areaIds?: readonly string[];
  contextIds?: readonly string[];
  tagIds?: readonly string[];
  startDate?: string | null;
  startDateEvidence?: string | null;
  dueDate?: string | null;
  dueDateEvidence?: string | null;
}>;

interface AppleFoundationModelsNativeModule extends NativeModule {
  getCapability?: (locale: string) => Promise<AppleFoundationModelsCapability>;
  clarifyInbox?: (request: AppleFoundationModelsNativeRequest) => Promise<AppleFoundationModelsNativeSuggestion>;
  cancel?: (requestId: string) => Promise<void>;
}

const nativeModule = Platform.OS === 'ios'
  ? requireOptionalNativeModule<AppleFoundationModelsNativeModule>('MindwtrAppleFoundationModels')
  : null;

const unsupportedCapability = (
  reason: AppleFoundationModelsUnavailableReason,
): AppleFoundationModelsCapability => ({
  available: false,
  reason,
  supportedOperations: [],
});

export async function getNativeAppleFoundationModelsCapability(
  locale: string,
): Promise<AppleFoundationModelsCapability> {
  if (Platform.OS !== 'ios') return unsupportedCapability('unsupported_platform');
  const getCapability = nativeModule?.getCapability;
  if (typeof getCapability !== 'function') return unsupportedCapability('native_module_missing');
  try {
    return await getCapability.call(nativeModule, locale);
  } catch {
    return unsupportedCapability('unknown');
  }
}

export async function requestNativeAppleInboxClarification(
  request: AppleFoundationModelsNativeRequest,
): Promise<AppleFoundationModelsNativeSuggestion> {
  if (Platform.OS !== 'ios') throw new Error('Apple on-device clarification requires iOS');
  const clarify = nativeModule?.clarifyInbox;
  if (typeof clarify !== 'function') throw new Error('Apple Foundation Models native module is unavailable');
  return clarify.call(nativeModule, request);
}

export async function cancelNativeAppleInboxClarification(requestId: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const cancel = nativeModule?.cancel;
  if (typeof cancel !== 'function') return;
  await cancel.call(nativeModule, requestId);
}
