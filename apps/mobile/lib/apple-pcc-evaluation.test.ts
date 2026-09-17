import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'ios' },
  constants: { expoConfig: { extra: { applePccEvaluationEnabled: true } } },
  fixtures: vi.fn(),
  capability: vi.fn(),
  run: vi.fn(),
  cancel: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('expo-constants', () => ({ default: mocks.constants }));
vi.mock('@/modules/apple-foundation-models', () => ({
  getNativeApplePccEvaluationFixtures: mocks.fixtures,
  getNativeApplePccEvaluationCapability: mocks.capability,
  requestNativeApplePccEvaluation: mocks.run,
  cancelNativeApplePccEvaluation: mocks.cancel,
}));
vi.mock('@/lib/app-log', () => ({ logInfo: mocks.logInfo, logWarn: mocks.logWarn }));

import {
  ApplePccEvaluationError,
  getApplePccEvaluationCapability,
  isApplePccEvaluationEnabled,
  loadApplePccEvaluationFixtures,
  runApplePccEvaluation,
} from './apple-pcc-evaluation';

describe('Apple PCC synthetic evaluation service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('__DEV__', true);
    mocks.platform.OS = 'ios';
    mocks.constants.expoConfig.extra.applePccEvaluationEnabled = true;
    mocks.fixtures.mockResolvedValue([
      { fixtureId: 'smoke', text: 'Synthetic smoke fixture.' },
      { fixtureId: 'project_planning', text: 'Synthetic project planning fixture.' },
    ]);
    mocks.capability.mockResolvedValue({
      available: true,
      backend: 'private_cloud_compute',
      contextSize: 32_000,
    });
    mocks.run.mockResolvedValue({
      outcome: 'completed',
      summary: 'Prepare the workshop.',
      nextActions: ['Confirm the room.', 'Ask about accessibility.'],
      contextSize: 32_000,
    });
    mocks.cancel.mockResolvedValue(undefined);
  });

  it('fails closed outside an opted-in iOS development build without touching native code', async () => {
    mocks.constants.expoConfig.extra.applePccEvaluationEnabled = false;
    expect(isApplePccEvaluationEnabled()).toBe(false);
    await expect(getApplePccEvaluationCapability('private_cloud_compute')).resolves.toMatchObject({
      available: false,
      reason: 'evaluation_disabled',
    });
    expect(mocks.capability).not.toHaveBeenCalled();
  });

  it('accepts only the two bounded native-owned synthetic fixtures', async () => {
    await expect(loadApplePccEvaluationFixtures()).resolves.toEqual([
      { fixtureId: 'smoke', text: 'Synthetic smoke fixture.' },
      { fixtureId: 'project_planning', text: 'Synthetic project planning fixture.' },
    ]);
    mocks.fixtures.mockResolvedValue([{ fixtureId: 'smoke', text: 'Only one.' }]);
    await expect(loadApplePccEvaluationFixtures()).rejects.toMatchObject({ code: 'malformed_native_output' });
  });

  it('requires explicit consent for every PCC request before invoking native inference', async () => {
    await expect(runApplePccEvaluation({
      backend: 'private_cloud_compute', fixtureId: 'smoke', consent: false,
    })).rejects.toMatchObject({ code: 'consent_required' });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('sends no arbitrary text, validates bounded output, and emits content-free diagnostics', async () => {
    const result = await runApplePccEvaluation({
      backend: 'private_cloud_compute', fixtureId: 'smoke', consent: true,
    });
    expect(result).toMatchObject({
      backend: 'private_cloud_compute',
      fixtureId: 'smoke',
      outcome: 'completed',
      summary: 'Prepare the workshop.',
    });
    const request = mocks.run.mock.calls[0][0];
    expect(request).toEqual({
      requestId: expect.stringMatching(/^pcc-/),
      backend: 'private_cloud_compute',
      fixtureId: 'smoke',
      consent: true,
    });
    expect(request).not.toHaveProperty('text');
    expect(mocks.logInfo).toHaveBeenCalledWith('Apple PCC evaluation completed', expect.objectContaining({
      extra: {
        releaseCheck: 'v1.3.1/apple-pcc-evaluation',
        backend: 'private_cloud_compute',
        operation: 'generation',
        outcome: 'completed',
        durationMs: expect.any(Number),
        fixtureId: 'smoke',
      },
    }));
  });

  it('rejects malformed or overlong native output without logging generated content', async () => {
    mocks.run.mockResolvedValue({
      outcome: 'completed',
      summary: 'x'.repeat(601),
      nextActions: [],
    });
    await expect(runApplePccEvaluation({
      backend: 'on_device', fixtureId: 'smoke', consent: false,
    })).rejects.toMatchObject({ code: 'malformed_native_output' });
    expect(mocks.logWarn).toHaveBeenCalledWith('Apple PCC evaluation stopped', expect.objectContaining({
      extra: expect.not.objectContaining({ summary: expect.anything() }),
    }));
  });

  it('cancels native work on abort and ignores a late result', async () => {
    let resolve!: (value: object) => void;
    mocks.run.mockReturnValue(new Promise((done) => { resolve = done; }));
    const controller = new AbortController();
    const pending = runApplePccEvaluation({
      backend: 'private_cloud_compute', fixtureId: 'smoke', consent: true, signal: controller.signal,
    });
    controller.abort();
    resolve({ outcome: 'completed', summary: 'Late result', nextActions: [] });
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(mocks.cancel).toHaveBeenCalledWith(expect.stringMatching(/^pcc-/));
  });

  it('uses a bounded timeout and asks native code to cancel', async () => {
    vi.useFakeTimers();
    mocks.run.mockReturnValue(new Promise(() => undefined));
    const pending = runApplePccEvaluation({
      backend: 'private_cloud_compute', fixtureId: 'smoke', consent: true, timeoutMs: 50,
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(51);
    await rejected;
    expect(mocks.cancel).toHaveBeenCalledWith(expect.stringMatching(/^pcc-/));
    vi.useRealTimers();
  });

  it('uses stable capability metadata and never treats readiness as entitlement proof', async () => {
    await expect(getApplePccEvaluationCapability('private_cloud_compute')).resolves.toEqual({
      available: true,
      backend: 'private_cloud_compute',
      contextSize: 32_000,
    });
    expect(mocks.logInfo).toHaveBeenCalledWith('Apple PCC capability checked', expect.objectContaining({
      extra: expect.objectContaining({ operation: 'capability', outcome: 'available' }),
    }));
  });

  it('normalizes unexpected native capability fields before display or diagnostics', async () => {
    mocks.capability.mockResolvedValue({
      available: false,
      backend: 'private_cloud_compute',
      reason: 'private account detail: example@example.com',
      contextSize: Number.POSITIVE_INFINITY,
    });
    await expect(getApplePccEvaluationCapability('private_cloud_compute')).resolves.toEqual({
      available: false,
      backend: 'private_cloud_compute',
      reason: 'unknown',
    });
    const logged = mocks.logInfo.mock.calls.at(-1)?.[1]?.extra;
    expect(logged).toMatchObject({ outcome: 'unknown' });
    expect(JSON.stringify(logged)).not.toContain('example@example.com');
  });

  it('bounds a stalled native capability query with sanitized unknown metadata', async () => {
    vi.useFakeTimers();
    mocks.capability.mockReturnValue(new Promise(() => undefined));
    const pending = getApplePccEvaluationCapability('private_cloud_compute', 50);
    await vi.advanceTimersByTimeAsync(51);
    await expect(pending).resolves.toEqual({
      available: false,
      backend: 'private_cloud_compute',
      reason: 'timeout',
    });
    vi.useRealTimers();
  });

  it.each(['network_failure', 'service_unavailable'] as const)(
    'preserves the stable %s capability reason without exposing native text',
    async (reason) => {
      mocks.capability.mockResolvedValue({
        available: false,
        backend: 'private_cloud_compute',
        reason,
      });
      await expect(getApplePccEvaluationCapability('private_cloud_compute')).resolves.toEqual({
        available: false,
        backend: 'private_cloud_compute',
        reason,
      });
      expect(mocks.logInfo).toHaveBeenLastCalledWith('Apple PCC capability checked', expect.objectContaining({
        extra: expect.objectContaining({ outcome: reason }),
      }));
    },
  );

  it('exposes typed stable failures without raw native error messages', () => {
    const error = new ApplePccEvaluationError('network_failure');
    expect(error.code).toBe('network_failure');
    expect(error.message).toBe('network_failure');
  });
});
