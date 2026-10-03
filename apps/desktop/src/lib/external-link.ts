import { isSandboxMode, tFallback } from '@mindwtr/core';
import { open } from '@tauri-apps/plugin-shell';
import { logInfo, logWarn } from './app-log';
import { isTauriRuntime } from './runtime';
import { useUiStore } from '../store/ui-store';

export const isUpNoteHref = (href: string): boolean => /^upnote:\/\//i.test(href);

/** An explicit click only; never normalize or decode an app's URI. */
export async function openExternalLink(href: string, surface: 'markdown' | 'attachment'): Promise<void> {
    if (isSandboxMode()) throw new Error('Unavailable in sandbox.');
    const upnote = isUpNoteHref(href);
    try {
        if (isTauriRuntime()) {
            try {
                await open(href);
                if (upnote) void logInfo('UpNote link handed to the OS', {
                    scope: 'links', force: true,
                    extra: { releaseCheck: 'v1.3.4/upnote-links', outcome: 'opened', surface, scheme: 'upnote' },
                });
                return;
            } catch (error) {
                // A browser fallback cannot establish whether the external app exists.
                if (upnote) throw error;
            }
        }
        // With noopener browsers can return null even after opening the target.
        // Browser custom-protocol handoffs also have no acceptance acknowledgement.
        window.open(href, '_blank', 'noopener,noreferrer');
    } catch (error) {
        if (upnote) void logWarn('UpNote link handoff failed', {
            scope: 'links', force: true,
            extra: { releaseCheck: 'v1.3.4/upnote-links', outcome: 'failed', surface, scheme: 'upnote' },
        });
        throw error;
    }
}

export function showExternalLinkFailure(href: string, t: (key: string) => string): string {
    const message = tFallback(t, 'markdown.openLinkFailed', 'Could not open this link. Make sure the app that handles it is installed. You can copy the link and open it there.');
    useUiStore.getState().showToast(message, 'error', 10_000, {
        label: tFallback(t, 'markdown.copyLink', 'Copy link'),
        onClick: () => {
            void (async () => {
                try {
                    await navigator.clipboard.writeText(href);
                } catch {
                    useUiStore.getState().showToast(tFallback(t, 'markdown.copyLinkFailed', 'Could not copy this link.'), 'error');
                }
            })();
        },
    });
    return message;
}
