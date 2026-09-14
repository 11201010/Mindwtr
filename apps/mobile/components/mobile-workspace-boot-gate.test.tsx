import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileWorkspaceBootGate } from './mobile-workspace-boot-gate';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  throwApplicationMetadata: false,
  initializeMobileWorkspace: vi.fn(),
  logWarn: vi.fn(async () => undefined),
  recoverRetainedFatalCrash: vi.fn(async () => false),
  setupGlobalErrorLogging: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

vi.mock('expo-application', () => ({
  get nativeApplicationVersion() {
    if (mocks.throwApplicationMetadata) throw new Error('application version unavailable');
    return '1.3.1';
  },
  get nativeBuildVersion() {
    if (mocks.throwApplicationMetadata) throw new Error('build version unavailable');
    return '144';
  },
}));

vi.mock('@/lib/sandbox-workspace', () => ({
  initializeMobileWorkspace: mocks.initializeMobileWorkspace,
}));

vi.mock('@/lib/app-log', () => ({
  logWarn: mocks.logWarn,
  recoverRetainedFatalCrash: mocks.recoverRetainedFatalCrash,
  setupGlobalErrorLogging: mocks.setupGlobalErrorLogging,
}));

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
};

function ChildStartupProbe() {
  React.useEffect(() => {
    mocks.order.push('child-effect');
  }, []);
  return <div>ready</div>;
}

describe('MobileWorkspaceBootGate crash capture startup order', () => {
  beforeEach(() => {
    mocks.order.length = 0;
    mocks.throwApplicationMetadata = false;
    vi.clearAllMocks();
    mocks.setupGlobalErrorLogging.mockImplementation(() => {
      mocks.order.push('setup');
    });
    mocks.recoverRetainedFatalCrash.mockImplementation(async () => {
      mocks.order.push('recover');
      return false;
    });
  });

  it('installs crash capture before workspace initialization and downstream child effects', async () => {
    const workspace = deferred<{ requestError?: string }>();
    mocks.initializeMobileWorkspace.mockImplementation(() => {
      mocks.order.push('initialize');
      return workspace.promise;
    });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <MobileWorkspaceBootGate>
          <ChildStartupProbe />
        </MobileWorkspaceBootGate>,
      );
      await Promise.resolve();
    });

    expect(mocks.order).toEqual(['setup', 'recover', 'initialize']);
    expect(renderer?.toJSON()).toBeNull();

    await act(async () => {
      workspace.resolve({});
      await workspace.promise;
    });

    expect(mocks.order).toEqual(['setup', 'recover', 'initialize', 'child-effect']);
  });

  it('continues workspace initialization when optional crash metadata and capture are unavailable', async () => {
    mocks.throwApplicationMetadata = true;
    mocks.setupGlobalErrorLogging.mockImplementation(() => {
      mocks.order.push('setup-failed');
      throw new Error('file system unavailable');
    });
    mocks.recoverRetainedFatalCrash.mockRejectedValue(new Error('recovery unavailable'));
    mocks.initializeMobileWorkspace.mockImplementation(async () => {
      mocks.order.push('initialize');
      return {};
    });

    await act(async () => {
      create(
        <MobileWorkspaceBootGate>
          <ChildStartupProbe />
        </MobileWorkspaceBootGate>,
      );
      await Promise.resolve();
    });

    expect(mocks.order[0]).toBe('setup-failed');
    expect(mocks.order).toContain('initialize');
    expect(mocks.setupGlobalErrorLogging).toHaveBeenCalledWith({
      crashMetadata: { platform: 'android' },
    });
  });
});
