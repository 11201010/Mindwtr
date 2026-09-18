import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  asyncStorageGetItem,
  asyncStorageSetItem,
  resetHeartbeatOptOutMarker,
  sendDailyHeartbeat,
  sendHeartbeatOptOut,
} = vi.hoisted(() => ({
  asyncStorageGetItem: vi.fn(async () => null),
  asyncStorageSetItem: vi.fn(async () => undefined),
  resetHeartbeatOptOutMarker: vi.fn(async () => undefined),
  sendDailyHeartbeat: vi.fn(async () => true),
  sendHeartbeatOptOut: vi.fn(async () => true),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: asyncStorageGetItem,
    setItem: asyncStorageSetItem,
  },
}));

vi.mock('@mindwtr/core', () => ({
  generateUUID: () => 'generated-id',
  resetHeartbeatOptOutMarker,
  sendDailyHeartbeat,
  sendHeartbeatOptOut,
}));

vi.mock('expo-application', () => ({
  getInstallReferrerAsync: vi.fn(async () => ''),
}));

import {
  isMobileAnalyticsHeartbeatConfigured,
  resolveMobileAnalyticsVersion,
  sendMobileAnalyticsOptOut,
  sendMobileDailyHeartbeat,
} from './analytics-heartbeat';

describe('sendMobileDailyHeartbeat', () => {
  const config = {
    analyticsHeartbeatUrl: 'https://analytics.example.com/heartbeat',
    appVersion: '0.9.4',
    isExpoGo: false,
    isFossBuild: false,
  };

  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    asyncStorageGetItem.mockClear();
    asyncStorageSetItem.mockClear();
    resetHeartbeatOptOutMarker.mockClear();
    sendDailyHeartbeat.mockClear();
    sendHeartbeatOptOut.mockClear();
  });

  it('does not build or send a heartbeat when the setting is disabled', async () => {
    await expect(sendMobileDailyHeartbeat(config, {
      analytics: {
        heartbeatEnabled: false,
      },
    })).resolves.toBe(false);

    expect(asyncStorageGetItem).not.toHaveBeenCalled();
    expect(asyncStorageSetItem).not.toHaveBeenCalled();
    expect(sendDailyHeartbeat).not.toHaveBeenCalled();
    expect(sendHeartbeatOptOut).not.toHaveBeenCalled();
  });

  it('allows configured FOSS builds to send the anonymous heartbeat', async () => {
    const fossConfig = {
      ...config,
      analyticsHeartbeatChannel: 'fdroid',
      isFossBuild: true,
    };

    expect(isMobileAnalyticsHeartbeatConfigured(fossConfig)).toBe(true);

    await expect(sendMobileDailyHeartbeat(fossConfig, {})).resolves.toBe(true);

    expect(sendDailyHeartbeat).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'fdroid',
      endpointUrl: 'https://analytics.example.com/heartbeat',
      profileId: null,
    }));
  });

  it('forwards the synced analytics profile id from settings', async () => {
    await expect(sendMobileDailyHeartbeat(config, { analyticsProfileId: 'profile-1' })).resolves.toBe(true);

    expect(sendDailyHeartbeat).toHaveBeenCalledWith(expect.objectContaining({
      distinctId: 'generated-id',
      profileId: 'profile-1',
    }));
  });

  it('sends the final opt-out only from the explicit opt-out action', async () => {
    await expect(sendMobileAnalyticsOptOut(config)).resolves.toBe(true);

    expect(sendHeartbeatOptOut).toHaveBeenCalledTimes(1);
    expect(sendDailyHeartbeat).not.toHaveBeenCalled();
  });
});


describe('resolveMobileAnalyticsVersion', () => {
  it('uses the RC tag suffix when it matches the app base version', () => {
    expect(resolveMobileAnalyticsVersion('1.0.5', 'v1.0.5-rc.1')).toBe('1.0.5-rc.1');
  });

  it('keeps the app version when the configured release tag does not match', () => {
    expect(resolveMobileAnalyticsVersion('1.0.5', 'v1.0.6-rc.1')).toBe('1.0.5');
  });
});
