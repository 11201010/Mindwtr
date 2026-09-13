import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logInfo, logWarn } from './app-log';
import {
  classifyIosShareHandoffUrl,
  IOS_SHARE_CAPTURE_RELEASE_CHECK,
  logIosShareDiagnostic,
} from './share-intent-diagnostics';

vi.mock('./app-log', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

const setPlatform = (os: typeof Platform.OS) => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
};

describe('share intent diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('ios');
  });

  afterEach(() => setPlatform('web'));

  it.each([
    ['mindwtr://dataUrl=/private/sensitive#text', 'text'],
    ['mindwtr-dev://dataUrl=/private/sensitive#weburl', 'weburl'],
    ['mindwtr://dataUrl=/private/sensitive#file', 'file'],
    ['mindwtr://dataUrl=/private/sensitive#media', 'media'],
    ['mindwtr://dataUrl=/private/sensitive#unexpected', 'unknown'],
    ['mindwtr://dataUrl=', 'unknown'],
  ] as const)('classifies an app share handoff without retaining its URL (%s)', (url, expected) => {
    expect(classifyIosShareHandoffUrl(url)).toBe(expected);
  });

  it.each([
    'https://example.com/dataUrl=/private/file#text',
    'otherapp://dataUrl=/private/file#text',
    'mindwtr:///capture?title=private',
    'mindwtr://other/path#text',
  ])('rejects non-share URLs (%s)', (url) => {
    expect(classifyIosShareHandoffUrl(url)).toBeNull();
  });

  it('forces a content-free event into the app log', () => {
    logIosShareDiagnostic({
      stage: 'payload-seen',
      type: 'weburl',
      providerReady: true,
      dataReady: false,
      disabled: false,
      fileCount: 0,
    });

    expect(logInfo).toHaveBeenCalledWith('iOS incoming share diagnostic', {
      scope: 'share-intent',
      extra: {
        releaseCheck: IOS_SHARE_CAPTURE_RELEASE_CHECK,
        stage: 'payload-seen',
        type: 'weburl',
        providerReady: true,
        dataReady: false,
        disabled: false,
        fileCount: 0,
      },
      force: true,
    });
    expect(JSON.stringify(vi.mocked(logInfo).mock.calls)).not.toContain('https://private.example');
  });

  it('uses a warning for fixed failure stages', () => {
    logIosShareDiagnostic({
      stage: 'native-error',
      outcome: 'present',
      providerReady: true,
      dataReady: true,
      disabled: false,
    });
    expect(logWarn).toHaveBeenCalledOnce();
    expect(logInfo).not.toHaveBeenCalled();
  });

  it('contains synchronous logger throws and rejected logger promises', async () => {
    vi.mocked(logInfo)
      .mockImplementationOnce(() => { throw new Error('logger sync failure'); })
      .mockRejectedValueOnce(new Error('logger async failure'));

    expect(() => logIosShareDiagnostic({ stage: 'form-mounted' })).not.toThrow();
    expect(() => logIosShareDiagnostic({ stage: 'form-mounted' })).not.toThrow();
    await Promise.resolve();
  });

  it('does nothing outside iOS', () => {
    setPlatform('android');
    logIosShareDiagnostic({ stage: 'form-mounted' });
    expect(logInfo).not.toHaveBeenCalled();
    expect(logWarn).not.toHaveBeenCalled();
  });
});
