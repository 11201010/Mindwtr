import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateWatchConnectivity,
  addPendingWatchCaptureListener,
  isWatchConnectivityAvailable,
  updateWatchApplicationContext,
} from './index';

const mocks = vi.hoisted(() => {
  const remove = vi.fn();
  return {
    platform: { OS: 'ios' },
    nativeModule: {
      isWatchConnectivityAvailable: vi.fn(() => true),
      activateWatchConnectivity: vi.fn(async () => undefined),
      updateWatchApplicationContext: vi.fn(async () => undefined),
      addListener: vi.fn((_eventName: string, _listener: () => void) => ({ remove })),
    },
    remove,
    requireOptionalNativeModule: vi.fn(),
  };
});

vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('expo-modules-core', () => {
  mocks.requireOptionalNativeModule.mockReturnValue(mocks.nativeModule);
  return { requireOptionalNativeModule: mocks.requireOptionalNativeModule };
});

describe('watch-connectivity wrapper', () => {
  beforeEach(() => {
    mocks.platform.OS = 'ios';
    mocks.nativeModule.isWatchConnectivityAvailable.mockReturnValue(true);
    vi.clearAllMocks();
  });

  it('guards non-iOS and disabled native builds', async () => {
    mocks.platform.OS = 'android';
    expect(isWatchConnectivityAvailable()).toBe(false);
    await activateWatchConnectivity();
    expect(mocks.nativeModule.activateWatchConnectivity).not.toHaveBeenCalled();

    mocks.platform.OS = 'ios';
    mocks.nativeModule.isWatchConnectivityAvailable.mockReturnValue(false);
    await updateWatchApplicationContext({ protocolVersion: 1 });
    expect(mocks.nativeModule.updateWatchApplicationContext).not.toHaveBeenCalled();
  });

  it('strips null recursively before native property-list serialization', async () => {
    await updateWatchApplicationContext({
      protocolVersion: 1,
      focus: [{ id: 'task-1', title: 'One', ignored: null }],
      pomodoro: {
        phase: 'focus',
        taskId: null,
        values: [1, null, 2],
      },
    });

    expect(mocks.nativeModule.updateWatchApplicationContext).toHaveBeenCalledWith({
      protocolVersion: 1,
      focus: [{ id: 'task-1', title: 'One' }],
      pomodoro: {
        phase: 'focus',
        values: [1, 2],
      },
    });
  });

  it('returns the native content-free event subscription', () => {
    const listener = vi.fn();
    const subscription = addPendingWatchCaptureListener(listener);
    expect(mocks.nativeModule.addListener).toHaveBeenCalledWith(
      'onPendingCapture',
      expect.any(Function),
    );

    const nativeListener = mocks.nativeModule.addListener.mock.calls[0][1];
    nativeListener();
    expect(listener).toHaveBeenCalledTimes(1);

    subscription.remove();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});
