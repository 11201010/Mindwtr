import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'ios' },
  nativeModule: null as null | {
    getCapability: ReturnType<typeof vi.fn>;
    clarifyInbox: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    getPccEvaluationFixtures: ReturnType<typeof vi.fn>;
    getPccEvaluationCapability: ReturnType<typeof vi.fn>;
    runPccEvaluation: ReturnType<typeof vi.fn>;
    cancelPccEvaluation: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => mocks.nativeModule,
}));

const load = async () => {
  vi.resetModules();
  return import('./index');
};

describe('Apple Foundation Models optional module wrapper', () => {
  beforeEach(() => {
    mocks.platform.OS = 'ios';
    mocks.nativeModule = {
      getCapability: vi.fn(async () => ({
        available: true,
        supportedOperations: ['inbox_clarification'],
        contextSize: 4096,
      })),
      clarifyInbox: vi.fn(async () => ({ cleanedTitle: 'Call the dentist' })),
      cancel: vi.fn(async () => undefined),
      getPccEvaluationFixtures: vi.fn(async () => ([
        { fixtureId: 'smoke', text: 'Synthetic smoke fixture.' },
        { fixtureId: 'project_planning', text: 'Synthetic planning fixture.' },
      ])),
      getPccEvaluationCapability: vi.fn(async () => ({
        available: true,
        backend: 'private_cloud_compute',
        contextSize: 32_000,
      })),
      runPccEvaluation: vi.fn(async () => ({
        outcome: 'completed',
        summary: 'A bounded summary.',
        nextActions: ['Confirm the room.'],
      })),
      cancelPccEvaluation: vi.fn(async () => undefined),
    };
  });

  it('reports an absent optional module without crashing', async () => {
    mocks.nativeModule = null;
    const { getNativeAppleFoundationModelsCapability } = await load();

    await expect(getNativeAppleFoundationModelsCapability('en-US')).resolves.toEqual({
      available: false,
      reason: 'native_module_missing',
      supportedOperations: [],
    });
  });

  it('turns a native capability failure into an unavailable reason', async () => {
    mocks.nativeModule?.getCapability.mockRejectedValue(new Error('native failure'));
    const { getNativeAppleFoundationModelsCapability } = await load();

    await expect(getNativeAppleFoundationModelsCapability('en-US')).resolves.toEqual({
      available: false,
      reason: 'unknown',
      supportedOperations: [],
    });
  });

  it('is inert on unsupported platforms', async () => {
    mocks.platform.OS = 'android';
    const { getNativeAppleFoundationModelsCapability, cancelNativeAppleInboxClarification } = await load();

    await expect(getNativeAppleFoundationModelsCapability('en-US')).resolves.toMatchObject({
      available: false,
      reason: 'unsupported_platform',
    });
    await expect(cancelNativeAppleInboxClarification('request-1')).resolves.toBeUndefined();
    expect(mocks.nativeModule?.cancel).not.toHaveBeenCalled();
  });

  it('passes only the bounded request contract and forwards cancellation', async () => {
    const { requestNativeAppleInboxClarification, cancelNativeAppleInboxClarification } = await load();
    const request = {
      requestId: 'request-1',
      locale: 'en-US',
      title: 'dentist',
      description: '',
      candidates: [],
    } as const;

    await expect(requestNativeAppleInboxClarification(request)).resolves.toEqual({
      cleanedTitle: 'Call the dentist',
    });
    await cancelNativeAppleInboxClarification(request.requestId);

    expect(mocks.nativeModule?.clarifyInbox).toHaveBeenCalledWith(request);
    expect(mocks.nativeModule?.cancel).toHaveBeenCalledWith('request-1');
  });

  it('keeps the native bridge inference-only', () => {
    const source = readFileSync(resolve(
      process.cwd(),
      'modules/apple-foundation-models/ios/MindwtrAppleFoundationModelsModule.swift',
    ), 'utf8');

    expect(source).not.toMatch(/SQLite|CoreData|CloudKit|URLSession|fetch\(/);
    expect(source).toContain('LanguageModelSession');
  });

  it('returns stable unavailable metadata when PCC optional APIs are absent', async () => {
    mocks.nativeModule = null;
    const { getNativeApplePccEvaluationCapability, getNativeApplePccEvaluationFixtures } = await load();

    await expect(getNativeApplePccEvaluationCapability('private_cloud_compute')).resolves.toEqual({
      available: false,
      backend: 'private_cloud_compute',
      reason: 'native_module_missing',
    });
    await expect(getNativeApplePccEvaluationFixtures()).resolves.toEqual([]);
  });

  it('passes only fixed PCC request fields and forwards namespaced cancellation', async () => {
    const {
      cancelNativeApplePccEvaluation,
      requestNativeApplePccEvaluation,
    } = await load();
    const request = {
      requestId: 'pcc-1',
      backend: 'private_cloud_compute',
      fixtureId: 'smoke',
      consent: true,
    } as const;

    await expect(requestNativeApplePccEvaluation(request)).resolves.toMatchObject({ outcome: 'completed' });
    await cancelNativeApplePccEvaluation(request.requestId);

    expect(mocks.nativeModule?.runPccEvaluation).toHaveBeenCalledWith(request);
    expect(mocks.nativeModule?.cancelPccEvaluation).toHaveBeenCalledWith('pcc-1');
    expect(mocks.nativeModule?.runPccEvaluation.mock.calls[0][0]).not.toHaveProperty('text');
    expect(mocks.nativeModule?.cancel).not.toHaveBeenCalled();
  });
});
