import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'android' },
  native: {
    applyNavigationBarStyleAsync: vi.fn(),
    setNavigationBarColorAsync: vi.fn(),
  } as { applyNavigationBarStyleAsync?: ReturnType<typeof vi.fn>; setNavigationBarColorAsync: ReturnType<typeof vi.fn> },
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  available: true,
}));
vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => mocks.available ? mocks.native : null }));
vi.mock('./app-log', () => ({ logInfo: mocks.logInfo, logWarn: mocks.logWarn }));

describe('Android native system bar application', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.platform.OS = 'android';
    mocks.available = true;
    mocks.native.applyNavigationBarStyleAsync = vi.fn().mockResolvedValue('edge-to-edge');
  });

  it.each(['edge-to-edge', 'legacy-color'])('records acknowledged %s applications after startup too', async (backend) => {
    mocks.native.applyNavigationBarStyleAsync!.mockResolvedValue(backend);
    const { applyAndroidSystemBars } = await import('./android-system-bars');
    await applyAndroidSystemBars({ bg: '#FFFFFF' }, false);
    await applyAndroidSystemBars({ bg: '#151718' }, true);
    expect(mocks.native.applyNavigationBarStyleAsync).toHaveBeenLastCalledWith('#151718', false);
    expect(mocks.logInfo).toHaveBeenCalledTimes(2);
    expect(mocks.logInfo).toHaveBeenLastCalledWith('Android navigation bar style applied', {
      scope: 'theme', extra: { releaseCheck: 'v1.3.1/android-system-bars', backend, outcome: 'applied' },
    });
  });

  it.each(['unavailable', 'unexpected'])('does not claim success for %s', async (outcome) => {
    mocks.native.applyNavigationBarStyleAsync!.mockResolvedValueOnce(outcome);
    const { applyAndroidSystemBars } = await import('./android-system-bars');
    await applyAndroidSystemBars({ bg: '#FFFFFF' }, false);
    expect(mocks.logInfo).not.toHaveBeenCalled();
    await applyAndroidSystemBars({ bg: '#FFFFFF' }, false);
    expect(mocks.logInfo).toHaveBeenCalledTimes(1);
  });

  it('supports older native builds without claiming the new path ran', async () => {
    delete mocks.native.applyNavigationBarStyleAsync;
    const { applyAndroidSystemBars } = await import('./android-system-bars');
    await applyAndroidSystemBars({ bg: '#FFFFFF' }, false);
    expect(mocks.native.setNavigationBarColorAsync).toHaveBeenCalledWith('#FFFFFF', true);
    expect(mocks.logInfo).not.toHaveBeenCalled();
  });

  it('contains failures without logging arbitrary native error text', async () => {
    mocks.native.applyNavigationBarStyleAsync!.mockRejectedValue(new Error('private native details'));
    const { applyAndroidSystemBars } = await import('./android-system-bars');
    await expect(applyAndroidSystemBars({ bg: '#FFFFFF' }, false)).resolves.toBeUndefined();
    expect(mocks.logWarn).toHaveBeenCalledExactlyOnceWith('Failed to apply Android system bar colors', {
      scope: 'theme', extra: { releaseCheck: 'v1.3.1/android-system-bars', outcome: 'failed' },
    });
  });

  it.each(['ios', 'missing'])('is optional on %s', async (mode) => {
    if (mode === 'ios') mocks.platform.OS = 'ios';
    else mocks.available = false;
    const { applyAndroidSystemBars } = await import('./android-system-bars');
    await applyAndroidSystemBars({ bg: '#FFFFFF' }, false);
    expect(mocks.native.applyNavigationBarStyleAsync).not.toHaveBeenCalled();
  });
});
