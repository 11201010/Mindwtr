import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { logInfo, logWarn } from '@/lib/app-log';
import {
  cancelNativeApplePccEvaluation,
  getNativeApplePccEvaluationCapability,
  getNativeApplePccEvaluationFixtures,
  requestNativeApplePccEvaluation,
  type ApplePccEvaluationBackend,
  type ApplePccEvaluationCapability,
  type ApplePccEvaluationFixture,
  type ApplePccEvaluationFixtureId,
  type ApplePccEvaluationNativeOutcome,
} from '@/modules/apple-foundation-models';

export type {
  ApplePccEvaluationBackend,
  ApplePccEvaluationCapability,
  ApplePccEvaluationFixture,
  ApplePccEvaluationFixtureId,
};

export const APPLE_PCC_RELEASE_CHECK = 'v1.3.1/apple-pcc-evaluation';
export const APPLE_PCC_REQUEST_TIMEOUT_MS = 60_000;
export const APPLE_PCC_CAPABILITY_TIMEOUT_MS = 10_000;
const FIXTURE_IDS = ['smoke', 'project_planning'] as const;
const OUTCOMES = new Set<ApplePccEvaluationNativeOutcome>([
  'completed',
  'evaluation_disabled',
  'invalid_request',
  'consent_required',
  'duplicate_request',
  'cancelled',
  'timeout',
  'unsupported_sdk',
  'unsupported_os',
  'unsupported_device',
  'system_not_ready',
  'locale_unsupported',
  'quota_exhausted',
  'network_failure',
  'service_unavailable',
  'refused',
  'malformed_output',
  'unknown',
]);
const CAPABILITY_REASONS = new Set<NonNullable<ApplePccEvaluationCapability['reason']>>([
  'evaluation_disabled',
  'unsupported_platform',
  'native_module_missing',
  'unsupported_sdk',
  'unsupported_os',
  'unsupported_device',
  'system_not_ready',
  'locale_unsupported',
  'quota_exhausted',
  'network_failure',
  'service_unavailable',
  'timeout',
  'unknown',
]);
let requestSequence = 0;

type MobileExtraConfig = { applePccEvaluationEnabled?: unknown };

export class ApplePccEvaluationError extends Error {
  constructor(public readonly code: ApplePccEvaluationNativeOutcome | 'timeout' | 'malformed_native_output') {
    super(code);
    this.name = 'ApplePccEvaluationError';
  }
}

export type ApplePccEvaluationResult = Readonly<{
  backend: ApplePccEvaluationBackend;
  fixtureId: ApplePccEvaluationFixtureId;
  outcome: ApplePccEvaluationNativeOutcome;
  durationMs: number;
  summary?: string;
  nextActions: readonly string[];
  contextSize?: number;
}>;

export function isApplePccEvaluationEnabled(): boolean {
  const extra = Constants.expoConfig?.extra as MobileExtraConfig | undefined;
  return __DEV__ && Platform.OS === 'ios' && extra?.applePccEvaluationEnabled === true;
}

const malformed = (): ApplePccEvaluationError => new ApplePccEvaluationError('malformed_native_output');

export async function loadApplePccEvaluationFixtures(): Promise<readonly ApplePccEvaluationFixture[]> {
  if (!isApplePccEvaluationEnabled()) throw new ApplePccEvaluationError('evaluation_disabled');
  const raw = await getNativeApplePccEvaluationFixtures();
  if (!Array.isArray(raw) || raw.length !== FIXTURE_IDS.length) throw malformed();
  const byId = new Map<string, ApplePccEvaluationFixture>();
  for (const item of raw) {
    if (!item || !FIXTURE_IDS.includes(item.fixtureId) || typeof item.text !== 'string') throw malformed();
    const text = item.text.trim();
    if (!text || text.length > 2_000 || byId.has(item.fixtureId)) throw malformed();
    byId.set(item.fixtureId, { fixtureId: item.fixtureId, text });
  }
  if (FIXTURE_IDS.some((id) => !byId.has(id))) throw malformed();
  return FIXTURE_IDS.map((id) => byId.get(id)!);
}

export async function getApplePccEvaluationCapability(
  backend: ApplePccEvaluationBackend,
  timeoutMs = APPLE_PCC_CAPABILITY_TIMEOUT_MS,
): Promise<ApplePccEvaluationCapability> {
  const startedAt = Date.now();
  let capabilityTimeout: ReturnType<typeof setTimeout> | undefined;
  const raw = isApplePccEvaluationEnabled()
    ? await Promise.race([
        getNativeApplePccEvaluationCapability(backend),
        new Promise<ApplePccEvaluationCapability>((resolve) => {
          capabilityTimeout = setTimeout(() => {
            resolve({ available: false, backend, reason: 'timeout' });
          }, Math.max(1, Math.min(timeoutMs, APPLE_PCC_CAPABILITY_TIMEOUT_MS)));
        }),
      ]).finally(() => {
        if (capabilityTimeout) clearTimeout(capabilityTimeout);
      })
    : { available: false, backend, reason: 'evaluation_disabled' as const };
  const capability = (() => {
    if (!raw || typeof raw !== 'object' || typeof raw.available !== 'boolean' || raw.backend !== backend) {
      return { available: false, backend, reason: 'unknown' as const };
    }
    const contextSize = typeof raw.contextSize === 'number'
      && Number.isFinite(raw.contextSize)
      && Number.isInteger(raw.contextSize)
      && raw.contextSize > 0
      ? raw.contextSize
      : undefined;
    if (raw.available) {
      if (raw.reason !== undefined || (raw.contextSize !== undefined && contextSize === undefined)) {
        return { available: false, backend, reason: 'unknown' as const };
      }
      return { available: true, backend, ...(contextSize ? { contextSize } : {}) };
    }
    if (typeof raw.reason !== 'string' || !CAPABILITY_REASONS.has(raw.reason)) {
      return { available: false, backend, reason: 'unknown' as const };
    }
    return { available: false, backend, reason: raw.reason };
  })();
  void logInfo('Apple PCC capability checked', {
    scope: 'apple-pcc',
    force: true,
    extra: {
      releaseCheck: APPLE_PCC_RELEASE_CHECK,
      backend,
      operation: 'capability',
      outcome: capability.available ? 'available' : capability.reason ?? 'unknown',
      durationMs: Date.now() - startedAt,
    },
  });
  return capability;
}

const validateResult = (
  raw: unknown,
  backend: ApplePccEvaluationBackend,
  fixtureId: ApplePccEvaluationFixtureId,
  durationMs: number,
): ApplePccEvaluationResult => {
  if (!raw || typeof raw !== 'object') throw malformed();
  const record = raw as Record<string, unknown>;
  if (typeof record.outcome !== 'string' || !OUTCOMES.has(record.outcome as ApplePccEvaluationNativeOutcome)) {
    throw malformed();
  }
  const outcome = record.outcome as ApplePccEvaluationNativeOutcome;
  if (outcome !== 'completed') {
    return { backend, fixtureId, outcome, durationMs, nextActions: [] };
  }
  if (typeof record.summary !== 'string') throw malformed();
  const summary = record.summary.trim();
  if (!summary || summary.length > 600 || !Array.isArray(record.nextActions) || record.nextActions.length > 3) {
    throw malformed();
  }
  const nextActions = record.nextActions.map((action) => {
    if (typeof action !== 'string') throw malformed();
    const trimmed = action.trim();
    if (!trimmed || trimmed.length > 200) throw malformed();
    return trimmed;
  });
  const contextSize = typeof record.contextSize === 'number'
    && Number.isInteger(record.contextSize)
    && record.contextSize > 0
    ? record.contextSize
    : undefined;
  return { backend, fixtureId, outcome, durationMs, summary, nextActions, ...(contextSize ? { contextSize } : {}) };
};

export async function runApplePccEvaluation(options: {
  backend: ApplePccEvaluationBackend;
  fixtureId: ApplePccEvaluationFixtureId;
  consent: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ApplePccEvaluationResult> {
  if (!isApplePccEvaluationEnabled()) throw new ApplePccEvaluationError('evaluation_disabled');
  if (!FIXTURE_IDS.includes(options.fixtureId)) throw new ApplePccEvaluationError('invalid_request');
  if (options.backend === 'private_cloud_compute' && options.consent !== true) {
    throw new ApplePccEvaluationError('consent_required');
  }
  const requestId = `pcc-${Date.now()}-${++requestSequence}`;
  const startedAt = Date.now();
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? APPLE_PCC_REQUEST_TIMEOUT_MS, APPLE_PCC_REQUEST_TIMEOUT_MS));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    if (options.signal?.aborted) throw new ApplePccEvaluationError('cancelled');
    const cancelled = new Promise<never>((_resolve, reject) => {
      abortListener = () => {
        void cancelNativeApplePccEvaluation(requestId);
        reject(new ApplePccEvaluationError('cancelled'));
      };
      options.signal?.addEventListener('abort', abortListener, { once: true });
    });
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        void cancelNativeApplePccEvaluation(requestId);
        reject(new ApplePccEvaluationError('timeout'));
      }, timeoutMs);
    });
    const raw = await Promise.race([
      requestNativeApplePccEvaluation({
        requestId,
        backend: options.backend,
        fixtureId: options.fixtureId,
        consent: options.consent,
      }),
      cancelled,
      timedOut,
    ]);
    if (options.signal?.aborted) throw new ApplePccEvaluationError('cancelled');
    const result = validateResult(raw, options.backend, options.fixtureId, Date.now() - startedAt);
    const logger = result.outcome === 'completed' ? logInfo : logWarn;
    void logger(
      result.outcome === 'completed' ? 'Apple PCC evaluation completed' : 'Apple PCC evaluation stopped',
      {
        scope: 'apple-pcc',
        force: true,
        extra: {
          releaseCheck: APPLE_PCC_RELEASE_CHECK,
          backend: options.backend,
          operation: 'generation',
          outcome: result.outcome,
          durationMs: result.durationMs,
          fixtureId: options.fixtureId,
        },
      },
    );
    return result;
  } catch (error) {
    const code = error instanceof ApplePccEvaluationError ? error.code : 'unknown';
    void logWarn('Apple PCC evaluation stopped', {
      scope: 'apple-pcc',
      force: true,
      extra: {
        releaseCheck: APPLE_PCC_RELEASE_CHECK,
        backend: options.backend,
        operation: 'generation',
        outcome: code,
        durationMs: Date.now() - startedAt,
        fixtureId: options.fixtureId,
      },
    });
    throw error instanceof ApplePccEvaluationError ? error : new ApplePccEvaluationError('unknown');
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortListener) options.signal?.removeEventListener('abort', abortListener);
  }
}

export function describeApplePccOutcome(outcome: string): string {
  switch (outcome) {
    case 'evaluation_disabled': return 'Private Cloud Compute evaluation is not enabled in this build.';
    case 'consent_required': return 'Confirm this request before sending the synthetic fixture to Apple Private Cloud Compute.';
    case 'unsupported_sdk': return 'Build with the Xcode 27 SDK to evaluate Private Cloud Compute.';
    case 'unsupported_os': return 'Private Cloud Compute evaluation requires iOS or iPadOS 27.';
    case 'unsupported_device': return 'This device is not eligible for Apple Intelligence.';
    case 'system_not_ready': return 'Apple Intelligence or Private Cloud Compute is not ready on this device.';
    case 'locale_unsupported': return 'The current device language or region is not supported.';
    case 'quota_exhausted': return 'The daily Private Cloud Compute quota is exhausted. Try again after it resets.';
    case 'network_failure': return 'Private Cloud Compute could not be reached. The fixture and existing results were kept.';
    case 'service_unavailable': return 'Private Cloud Compute is temporarily unavailable. The fixture and existing results were kept.';
    case 'refused': return 'The model declined this synthetic evaluation request.';
    case 'cancelled': return 'The evaluation was cancelled.';
    case 'timeout': return 'The Apple model request timed out. Generation requests are cancelled after 60 seconds.';
    case 'malformed_output':
    case 'malformed_native_output': return 'The model returned an invalid bounded suggestion.';
    default: return 'The evaluation could not be completed. No task data was changed.';
  }
}
