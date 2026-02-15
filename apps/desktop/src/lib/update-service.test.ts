import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdates } from './update-service';

const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const originalFetch = globalThis.fetch;

describe('update-service channel selection', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        globalThis.fetch = originalFetch;
    });

    it('keeps mac app store installs on app store version even if github is newer', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('itunes.apple.com/lookup')) {
                return jsonResponse({
                    results: [{ version: '1.1.0', trackViewUrl: 'https://apps.apple.com/app/mindwtr/id6758597144' }],
                });
            }
            if (url.includes('api.github.com/repos/dongdongbh/Mindwtr/releases/latest')) {
                return jsonResponse({
                    tag_name: 'v1.9.0',
                    html_url: 'https://github.com/dongdongbh/Mindwtr/releases/tag/v1.9.0',
                    body: 'latest notes',
                    assets: [],
                });
            }
            return jsonResponse({}, 404);
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await checkForUpdates('1.0.0', { installSource: 'mac-app-store' });

        expect(result.hasUpdate).toBe(true);
        expect(result.source).toBe('app-store');
        expect(result.latestVersion).toBe('1.1.0');
        expect(result.sourceFallback).toBe(false);
    });

    it('falls back to github when managed source lookup fails', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('itunes.apple.com/lookup')) {
                return jsonResponse({}, 500);
            }
            if (url.includes('api.github.com/repos/dongdongbh/Mindwtr/releases/latest')) {
                return jsonResponse({
                    tag_name: 'v1.2.0',
                    html_url: 'https://github.com/dongdongbh/Mindwtr/releases/tag/v1.2.0',
                    body: 'latest notes',
                    assets: [],
                });
            }
            return jsonResponse({}, 404);
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await checkForUpdates('1.0.0', { installSource: 'mac-app-store' });

        expect(result.hasUpdate).toBe(true);
        expect(result.source).toBe('github-release');
        expect(result.latestVersion).toBe('1.2.0');
    });

    it('keeps homebrew installs on homebrew version even if github is newer', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('formulae.brew.sh/api/cask/mindwtr.json')) {
                return jsonResponse({ version: '1.1.0' });
            }
            if (url.includes('api.github.com/repos/dongdongbh/Mindwtr/releases/latest')) {
                return jsonResponse({
                    tag_name: 'v1.9.0',
                    html_url: 'https://github.com/dongdongbh/Mindwtr/releases/tag/v1.9.0',
                    body: 'latest notes',
                    assets: [],
                });
            }
            return jsonResponse({}, 404);
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await checkForUpdates('1.0.0', { installSource: 'homebrew' });

        expect(result.hasUpdate).toBe(true);
        expect(result.source).toBe('homebrew');
        expect(result.latestVersion).toBe('1.1.0');
        expect(result.sourceFallback).toBe(false);
    });
});
