import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type AndroidWidgetModule = {
  setPayload(json: string): void;
  updateWidgets(): number | undefined;
  getWidgetListSelections(): string[];
  getCaptureIntentConfig(): Promise<CaptureIntentConfig>;
  setCaptureIntentEnabled(enabled: boolean): Promise<CaptureIntentConfig>;
};

export type CaptureIntentConfig = {
  enabled: boolean;
  token: string | null;
};

// Null in Expo Go and on every other platform; callers check isSupported().
const nativeModule = Platform.OS === 'android'
  ? requireOptionalNativeModule<AndroidWidgetModule>('MindwtrAndroidWidget')
  : null;

export function isSupported(): boolean {
  return nativeModule !== null;
}

/** Store the widget payload JSON natively; the widget provider draws from it. */
export function setPayload(json: string): void {
  nativeModule?.setPayload(json);
}

/** Redraw every placed home-screen widget from the stored payload. */
export function updateWidgets(): number | undefined {
  return nativeModule?.updateWidgets();
}

/** Distinct list ids the placed Tasks widgets are configured to show. */
export function getWidgetListSelections(): string[] {
  return nativeModule?.getWidgetListSelections() ?? [];
}

/** Device-only authorization for the exported Android automation receiver. */
export async function getCaptureIntentConfig(): Promise<CaptureIntentConfig> {
  if (!nativeModule) throw new Error('Android capture intent is not supported');
  return nativeModule.getCaptureIntentConfig();
}

/** Enabling creates a token; disabling revokes it. Neither value is synced. */
export async function setCaptureIntentEnabled(enabled: boolean): Promise<CaptureIntentConfig> {
  if (!nativeModule) throw new Error('Android capture intent is not supported');
  return nativeModule.setCaptureIntentEnabled(enabled);
}
