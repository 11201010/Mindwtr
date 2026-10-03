import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ open: vi.fn(), info: vi.fn(), warn: vi.fn(), sandbox: false }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: mocks.open }));
vi.mock('./app-log', () => ({ logInfo: mocks.info, logWarn: mocks.warn }));
vi.mock('@mindwtr/core', async (importOriginal) => ({
    ...await importOriginal<typeof import('@mindwtr/core')>(),
    isSandboxMode: () => mocks.sandbox,
}));
import { openExternalLink, showExternalLinkFailure } from './external-link';
import { useUiStore } from '../store/ui-store';

const uri = 'upnote://x-callback-url/openNote?noteId=Note%2FCase%2520&new_window=true';
describe('external links', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        mocks.sandbox = false;
        (window as any).__TAURI_INTERNALS__ = {};
        useUiStore.setState({ toasts: [] });
    });
    it.each(['markdown', 'attachment'] as const)('passes original UpNote URI on %s and logs only the handoff', async (surface) => {
        mocks.open.mockResolvedValue(undefined);
        await openExternalLink(uri, surface);
        expect(mocks.open).toHaveBeenCalledWith(uri);
        expect(mocks.info).toHaveBeenCalledWith('UpNote link handed to the OS', {
            scope: 'links', force: true, extra: { releaseCheck: 'v1.3.4/upnote-links', outcome: 'opened', surface, scheme: 'upnote' },
        });
        expect(JSON.stringify(mocks.info.mock.calls)).not.toContain('Note%');
    });
    it('reports native failure without browser fallback or leaking the URI/error', async () => {
        const browser = vi.spyOn(window, 'open');
        mocks.open.mockRejectedValue(new Error(`Unable to open ${uri}`));
        await expect(openExternalLink(uri, 'attachment')).rejects.toThrow();
        expect(browser).not.toHaveBeenCalled();
        expect(mocks.warn).toHaveBeenCalledWith('UpNote link handoff failed', {
            scope: 'links', force: true, extra: { releaseCheck: 'v1.3.4/upnote-links', outcome: 'failed', surface: 'attachment', scheme: 'upnote' },
        });
        expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('Note%');
    });
    it('does not hand off or log UpNote from sandbox', async () => {
        mocks.sandbox = true;
        await expect(openExternalLink(uri, 'attachment')).rejects.toThrow('sandbox');
        expect(mocks.open).not.toHaveBeenCalled();
        expect(mocks.info).not.toHaveBeenCalled();
        expect(mocks.warn).not.toHaveBeenCalled();
    });
    it.each(['https://example.com', uri])('does not treat a browser noopener null result as failure for %s', async (href) => {
        delete (window as any).__TAURI_INTERNALS__;
        const browser = vi.spyOn(window, 'open').mockReturnValue(null);
        await expect(openExternalLink(href, 'markdown')).resolves.toBeUndefined();
        expect(browser).toHaveBeenCalledWith(href, '_blank', 'noopener,noreferrer');
        expect(mocks.info).not.toHaveBeenCalled();
        expect(mocks.warn).not.toHaveBeenCalled();
    });
    it('shows useful copy failure feedback', async () => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
        showExternalLinkFailure(uri, (key) => key);
        useUiStore.getState().toasts[0].action?.onClick();
        await vi.waitFor(() => expect(useUiStore.getState().toasts[1].message).toBe('Could not copy this link.'));
    });
});
