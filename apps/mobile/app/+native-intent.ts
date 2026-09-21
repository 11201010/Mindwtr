import { isEntityOpenUrl, isOpenFeatureUrl, isShortcutCaptureUrl, parseOpenFeatureUrl, resolveOpenFeaturePath } from '@/lib/capture-deeplink';
import { DROPBOX_CALLBACK_SETTINGS_PATH, isDropboxAuthCallbackUrl } from '@/lib/dropbox-auth-callback';

const logShareHandoffRouted = (initial: boolean): void => {
    try {
        void import('@/lib/app-log')
            .then(({ logInfo }) => logInfo('Share handoff routed', {
                scope: 'routing',
                extra: {
                    releaseCheck: 'v1.3.1/share-handoff-route',
                    stage: 'handoff-routed',
                    delivery: initial ? 'cold' : 'warm',
                },
                force: true,
            }))
            .catch(() => undefined);
    } catch {
        // Optional diagnostics must not block a share handoff.
    }
};

const logDropboxCallbackRouted = (): void => {
    try {
        void import('@/lib/app-log')
            .then(({ logInfo }) => logInfo('Dropbox OAuth callback routed', {
                scope: 'routing',
                extra: {
                    releaseCheck: 'v1.3.0/dropbox-oauth-route',
                    stage: 'callback-routed',
                },
                force: true,
            }))
            .catch(() => undefined);
    } catch {
        // Diagnostics must never become part of system URL routing.
    }
};

// The Control Center control cannot be tested off-device, and its tap runs native code a tester
// never sees. The app-side intent tags its link with `source=control`, so this line proves the
// tap reached the app and was routed to the capture sheet.
const logControlCaptureRouted = (path: string, initial: boolean): void => {
    try {
        if (new URL(path).searchParams.get('source') !== 'control') return;
        void import('@/lib/app-log')
            .then(({ logInfo }) => logInfo('Control Center quick capture routed', {
                scope: 'routing',
                extra: {
                    releaseCheck: 'v1.3.2/ios-control-capture',
                    stage: 'capture-routed',
                    delivery: initial ? 'cold' : 'warm',
                },
                force: true,
            }))
            .catch(() => undefined);
    } catch {
        // Diagnostics must never become part of system URL routing.
    }
};

const isQuickCaptureUrl = (path: string): boolean => {
    const url = new URL(path);
    if (url.protocol !== 'mindwtr:') return false;
    return url.hostname === 'capture-quick' || url.pathname === '/capture-quick';
};

// Expo Router routes incoming system URLs by path, so mindwtr://open-feature
// would land on the Unmatched Route screen before the root-layout hook can
// redirect. Rewrite it to the destination route up front (#755).
//
// Entity-open links (mindwtr://open?task=...) get the same treatment (#1017):
// land on /inbox immediately so there's no Unmatched Route flash, then
// useRootLayoutExternalCapture's incoming-URL effect (which still sees the
// original URL via Linking.useURL()) resolves the real entity once data is
// ready and re-navigates.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
    try {
        // expo-share-intent uses the scheme-derived App Group entry name, not
        // an application route. Keep its original Linking URL intact for the
        // provider; only intercept Expo Router's navigation interpretation.
        if (/^(mindwtr(?:-dev)?):\/\/dataUrl=\1ShareKey\/?(?:#(?:text|weburl|file|media))?$/.test(path)) {
            logShareHandoffRouted(initial);
            // A cold launch needs a valid base route. On a warm delivery Expo
            // Router ignores an empty result: don't race the provider's
            // populated capture modal with an independent Inbox navigation.
            return initial ? '/inbox' : '';
        }
        if (isDropboxAuthCallbackUrl(path)) {
            logDropboxCallbackRouted();
            return DROPBOX_CALLBACK_SETTINGS_PATH;
        }
        if (isOpenFeatureUrl(path)) {
            return resolveOpenFeaturePath(parseOpenFeatureUrl(path)?.feature ?? null);
        }
        if (isEntityOpenUrl(path)) {
            return '/inbox';
        }
        // The external-capture hook opens the prefilled confirmation from the
        // original Linking delivery. Letting Router also visit /capture opens
        // a blank quick-capture sheet behind it, which reappears after closing.
        // Invalid capture payloads also belong to that hook's error handling.
        if (isShortcutCaptureUrl(path)) {
            return '/inbox';
        }
        // The hidden tab route depends on a focus callback that is not reliable
        // during an Android widget/tile cold launch. The root capture modal is
        // purpose-built for system entry points and works on both cold and warm
        // launches. Current native widget/tile entry points request text mode.
        // origin=system lets the modal send the app back behind the previous
        // screen after the capture ends (#1169); in-app openers never set it.
        if (isQuickCaptureUrl(path)) {
            logControlCaptureRouted(path, initial);
            return '/capture-modal?origin=system';
        }
    } catch {
        // redirectSystemPath must never throw; fall through to the original path.
    }
    return path;
}
