import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'ios' },
  remove: vi.fn(),
  nativeModule: {
    drainDiagnostics: vi.fn(),
    addListener: vi.fn(),
  },
  requireOptionalNativeModule: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: mocks.requireOptionalNativeModule,
}));

describe('ios-scene-lifecycle bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.platform.OS = 'ios';
    mocks.nativeModule.drainDiagnostics.mockReturnValue([]);
    mocks.nativeModule.addListener.mockReturnValue({ remove: mocks.remove });
    mocks.requireOptionalNativeModule.mockReturnValue(mocks.nativeModule);
  });

  it('projects bounded native records onto the fixed privacy-safe fields', async () => {
    mocks.nativeModule.drainDiagnostics.mockReturnValue([
      {
        stage: 'coldDelivery',
        deliveryKind: 'url',
        count: 1,
        url: 'mindwtr:///capture?task=private',
        title: 'private',
      },
      { stage: 'coldDelivery', deliveryKind: 'notification', count: 1 },
      { stage: 'unknown', deliveryKind: 'url', count: 2 },
      { stage: 'warmDelivery', deliveryKind: 'url', count: 0 },
    ]);
    const bridge = await import('./index');

    expect(bridge.drainIosSceneDiagnostics()).toEqual([
      { stage: 'coldDelivery', deliveryKind: 'url', count: 1 },
      { stage: 'coldDelivery', deliveryKind: 'notification', count: 1 },
    ]);
  });

  it('subscribes to the native wake-up edge', async () => {
    const bridge = await import('./index');
    const listener = vi.fn();

    const subscription = bridge.subscribeIosSceneDiagnostics(listener);
    expect(mocks.nativeModule.addListener).toHaveBeenCalledWith('onDiagnosticsChanged', listener);
    subscription.remove();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it('is nonfatal outside iOS and when an older client lacks the module', async () => {
    mocks.platform.OS = 'android';
    let bridge = await import('./index');
    expect(bridge.drainIosSceneDiagnostics()).toEqual([]);
    expect(() => bridge.subscribeIosSceneDiagnostics(vi.fn()).remove()).not.toThrow();
    expect(mocks.requireOptionalNativeModule).not.toHaveBeenCalled();

    vi.resetModules();
    mocks.platform.OS = 'ios';
    mocks.requireOptionalNativeModule.mockImplementation(() => {
      throw new Error('not linked');
    });
    bridge = await import('./index');
    expect(bridge.drainIosSceneDiagnostics()).toEqual([]);
    expect(() => bridge.subscribeIosSceneDiagnostics(vi.fn()).remove()).not.toThrow();
  });
});
