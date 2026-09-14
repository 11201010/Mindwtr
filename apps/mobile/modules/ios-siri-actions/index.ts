import {
  requireOptionalNativeModule,
  type NativeModule,
} from 'expo-modules-core';
import { Platform } from 'react-native';

export type MindwtrSiriActionOperation = 'create' | 'update' | 'delete';
export type MindwtrSiriActionClearField =
  'description' | 'dueDate' | 'projectId';
export type MindwtrSiriActionOutcome = 'persisted' | 'rejected';
export type MindwtrSiriActionRejectionReason =
  'stale' | 'missing' | 'unsupported' | 'invalid' | 'expired' | 'cancelled';

export interface MindwtrSiriActionFields {
  title?: string;
  description?: string;
  dueDate?: string;
  tags?: string[];
  projectId?: string;
  isFocusedToday?: boolean;
  isCompleted?: boolean;
}

export interface MindwtrSiriActionRequest {
  version: 1;
  id: string;
  operation: MindwtrSiriActionOperation;
  targetId?: string;
  expectedToken?: string;
  createdAt: number;
  expiresAt: number;
  fields: MindwtrSiriActionFields;
  clearFields: MindwtrSiriActionClearField[];
}

export interface MindwtrSiriActionResult {
  outcome: MindwtrSiriActionOutcome;
  reason?: MindwtrSiriActionRejectionReason;
  /** A bounded JSON object string returned only after the normal store save is durable. */
  task?: string;
}

export interface MindwtrSiriActionsSubscription {
  remove(): void;
}

interface MindwtrIosSiriActionsNativeModule extends NativeModule {
  claimPending?: () => Promise<MindwtrSiriActionRequest[]>;
  acknowledge?: (id: string, resultJSON: string) => Promise<void>;
  publishSnapshot?: (snapshotJSON: string) => Promise<void>;
  setAccessAllowed?: (allowed: boolean) => Promise<void>;
  addListener?: (
    eventName: 'onPendingActionsChanged',
    listener: () => void,
  ) => MindwtrSiriActionsSubscription;
}

let cachedNativeModule: MindwtrIosSiriActionsNativeModule | null | undefined;

function getNativeModule(): MindwtrIosSiriActionsNativeModule | null {
  if (Platform.OS !== 'ios') return null;
  if (cachedNativeModule !== undefined) return cachedNativeModule;
  try {
    cachedNativeModule =
      requireOptionalNativeModule<MindwtrIosSiriActionsNativeModule>(
        'MindwtrIosSiriActions',
      ) ?? null;
  } catch {
    cachedNativeModule = null;
  }
  return cachedNativeModule;
}

/**
 * Claims new requests and replays every previously claimed request until JS has
 * durably saved and acknowledged it. An unavailable optional module is empty.
 */
export async function claimPending(): Promise<MindwtrSiriActionRequest[]> {
  const nativeModule = getNativeModule();
  const claim = nativeModule?.claimPending;
  if (typeof claim !== 'function') return [];
  return claim.call(nativeModule);
}

/**
 * Persists a receipt after the normal JS/core write completes. Missing native
 * acknowledgement support rejects so callers can never mistake it for success.
 */
export async function acknowledge(
  id: string,
  resultJSON: string,
): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const nativeModule = getNativeModule();
  const acknowledgeRequest = nativeModule?.acknowledge;
  if (typeof acknowledgeRequest !== 'function') {
    throw new Error(
      'MindwtrIosSiriActions native acknowledge method is unavailable',
    );
  }
  await acknowledgeRequest.call(nativeModule, id, resultJSON);
}

/** Publishes an opaque derived JSON snapshot; it never writes task storage. */
export async function publishSnapshot(snapshotJSON: string): Promise<void> {
  const nativeModule = getNativeModule();
  const publish = nativeModule?.publishSnapshot;
  if (typeof publish !== 'function') return;
  await publish.call(nativeModule, snapshotJSON);
}

/** Enables reads only for the current hydrated and unlocked app process. */
export async function setAccessAllowed(allowed: boolean): Promise<void> {
  const nativeModule = getNativeModule();
  const setAllowed = nativeModule?.setAccessAllowed;
  if (typeof setAllowed !== 'function') return;
  await setAllowed.call(nativeModule, allowed);
}

/** A wake-up edge. Durable requests remain in the App Group store until acked. */
export function subscribePendingActionsChanged(
  listener: () => void,
): MindwtrSiriActionsSubscription {
  try {
    const nativeModule = getNativeModule();
    if (!nativeModule || typeof nativeModule.addListener !== 'function') {
      return { remove: () => undefined };
    }
    return nativeModule.addListener('onPendingActionsChanged', listener);
  } catch {
    return { remove: () => undefined };
  }
}
