import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type IosSceneDiagnosticStage =
  | 'sceneConnected'
  | 'rootStarted'
  | 'coldDelivery'
  | 'warmDelivery'
  | 'didBecomeActive'
  | 'willResignActive'
  | 'didEnterBackground'
  | 'willEnterForeground';

export type IosSceneDeliveryKind = 'none' | 'url' | 'userActivity' | 'shortcut';

export interface IosSceneDiagnosticRecord {
  stage: IosSceneDiagnosticStage;
  deliveryKind: IosSceneDeliveryKind;
  count: number;
}

type IosSceneDiagnosticsSubscription = { remove(): void };

interface MindwtrIosSceneLifecycleNativeModule extends NativeModule {
  drainDiagnostics?: () => unknown;
  addListener(
    eventName: 'onDiagnosticsChanged',
    listener: () => void,
  ): IosSceneDiagnosticsSubscription;
}

const allowedStages = new Set<IosSceneDiagnosticStage>([
  'sceneConnected',
  'rootStarted',
  'coldDelivery',
  'warmDelivery',
  'didBecomeActive',
  'willResignActive',
  'didEnterBackground',
  'willEnterForeground',
]);
const allowedDeliveryKinds = new Set<IosSceneDeliveryKind>([
  'none',
  'url',
  'userActivity',
  'shortcut',
]);

let cachedNativeModule: MindwtrIosSceneLifecycleNativeModule | null | undefined;

function getNativeModule(): MindwtrIosSceneLifecycleNativeModule | null {
  if (Platform.OS !== 'ios') return null;
  if (cachedNativeModule !== undefined) return cachedNativeModule;
  try {
    cachedNativeModule = requireOptionalNativeModule<MindwtrIosSceneLifecycleNativeModule>(
      'MindwtrIosSceneLifecycle',
    ) ?? null;
  } catch {
    cachedNativeModule = null;
  }
  return cachedNativeModule;
}

const validRecord = (value: unknown): value is IosSceneDiagnosticRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<IosSceneDiagnosticRecord>;
  return allowedStages.has(record.stage as IosSceneDiagnosticStage)
    && allowedDeliveryKinds.has(record.deliveryKind as IosSceneDeliveryKind)
    && Number.isInteger(record.count)
    && Number(record.count) > 0
    && Number(record.count) <= 1_000_000;
};

/** Drains only fixed, privacy-safe fields from the bounded native queue. */
export function drainIosSceneDiagnostics(): IosSceneDiagnosticRecord[] {
  try {
    const raw = getNativeModule()?.drainDiagnostics?.();
    if (!Array.isArray(raw)) return [];
    return raw.filter(validRecord).slice(-32).map((record) => ({
      stage: record.stage,
      deliveryKind: record.deliveryKind,
      count: record.count,
    }));
  } catch {
    return [];
  }
}

/** A wake-up edge; records remain in the native queue until drained. */
export function subscribeIosSceneDiagnostics(
  listener: () => void,
): IosSceneDiagnosticsSubscription {
  try {
    const nativeModule = getNativeModule();
    if (!nativeModule || typeof nativeModule.addListener !== 'function') {
      return { remove: () => undefined };
    }
    return nativeModule.addListener('onDiagnosticsChanged', listener);
  } catch {
    return { remove: () => undefined };
  }
}
