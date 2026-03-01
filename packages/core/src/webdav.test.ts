import { describe, expect, it, vi } from 'vitest';
import { webdavGetJson } from './webdav';

describe('webdav http helpers', () => {
    it('allows HTTP for private IP targets', async () => {
        const fetcher = vi.fn(
            async () =>
                ({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                    text: async () => '',
                }) as Response,
        );

        await expect(webdavGetJson('http://100.64.10.2/dav/data.json', { fetcher })).resolves.toBeNull();
        expect(fetcher).toHaveBeenCalledOnce();
    });

    it('rejects HTTP for public targets', async () => {
        const fetcher = vi.fn();
        await expect(webdavGetJson('http://8.8.8.8/dav/data.json', { fetcher })).rejects.toThrow(
            'WebDAV requires HTTPS for public URLs',
        );
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('treats empty successful body as missing remote data', async () => {
        const fetcher = vi.fn(
            async () =>
                ({
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    text: async () => '   ',
                }) as Response,
        );

        await expect(webdavGetJson<{ foo: string }>('https://example.com/data.json', { fetcher })).resolves.toBeNull();
    });

    it('parses JSON body with a UTF-8 BOM prefix', async () => {
        const fetcher = vi.fn(
            async () =>
                ({
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    text: async () => '\uFEFF{"ok":true}',
                }) as Response,
        );

        await expect(webdavGetJson<{ ok: boolean }>('https://example.com/data.json', { fetcher })).resolves.toEqual({ ok: true });
    });
});
