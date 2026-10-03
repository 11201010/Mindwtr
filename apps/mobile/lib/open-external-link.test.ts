import { Alert } from 'react-native';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openExternalLink } from './open-external-link';

const state = vi.hoisted(() => ({ sandbox: false, logInfo: vi.fn(async () => null), logWarn: vi.fn(async () => null) }));
vi.mock('@mindwtr/core', async (original) => ({
  ...await original<typeof import('@mindwtr/core')>(), isSandboxMode: () => state.sandbox,
}));
vi.mock('expo-linking', () => ({ openURL: vi.fn(async () => undefined) }));
vi.mock('./app-log', () => ({ logInfo: state.logInfo, logWarn: state.logWarn }));

const uri = 'upnote://x-callback-url/openNote?noteId=Note%2FCase%2520&new_window=true';
const t = (key: string) => key;
beforeEach(() => { vi.clearAllMocks(); state.sandbox = false; vi.spyOn(Alert, 'alert').mockImplementation(() => {}); });

describe('explicit external link opening', () => {
  it.each(['markdown', 'attachment'] as const)('hands the original URI to the OS on %s', async (surface) => {
    await openExternalLink(uri, t, surface);
    expect(Linking.openURL).toHaveBeenCalledWith(uri);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(state.logInfo).toHaveBeenCalledWith('External app link handoff', {
      scope: 'links', force: true, extra: { releaseCheck: 'v1.3.4/upnote-links', outcome: 'opened', surface, scheme: 'upnote' },
    });
  });
  it('handles a missing app and copies the exact original URI without logging native details', async () => {
    vi.mocked(Linking.openURL).mockRejectedValueOnce(new Error(`No app for ${uri}`));
    await expect(openExternalLink(uri, t, 'markdown')).resolves.toBeUndefined();
    expect(Alert.alert).toHaveBeenCalledWith('common.error', expect.stringContaining('Make sure the app'), expect.any(Array));
    const buttons = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!;
    buttons.find((button) => button.text === 'Copy link')!.onPress!();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(uri);
    expect(state.logWarn).toHaveBeenCalledWith('External app link handoff', {
      scope: 'links', force: true, extra: { releaseCheck: 'v1.3.4/upnote-links', outcome: 'failed', surface: 'markdown', scheme: 'upnote' },
    });
    expect(JSON.stringify(state.logWarn.mock.calls)).not.toContain('noteId');
  });
  it('handles clipboard rejection after an opening failure', async () => {
    vi.mocked(Linking.openURL).mockRejectedValueOnce(new Error('missing app'));
    vi.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('clipboard unavailable'));
    await openExternalLink(uri, t, 'attachment');
    vi.mocked(Alert.alert).mock.calls.at(-1)![2]!.find((button) => button.text === 'Copy link')!.onPress!();
    await Promise.resolve();
    expect(Alert.alert).toHaveBeenLastCalledWith('common.error', 'Could not copy this link.');
  });
  it('blocks OS handoff and release logging in sandbox mode', async () => {
    state.sandbox = true;
    await openExternalLink(uri, t, 'markdown');
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(state.logInfo).not.toHaveBeenCalled();
    expect(state.logWarn).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('common.notice', 'sandbox.unavailable');
  });
  it('keeps ordinary links working without UpNote release logging', async () => {
    await openExternalLink('https://example.com', t, 'markdown');
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com');
    expect(state.logInfo).not.toHaveBeenCalled();
  });
});
