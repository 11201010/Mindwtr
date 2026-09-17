import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getDesktopTimerHost', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('binds browser timer functions to window', async () => {
        const runtimeModule = await import(pathToFileURL(resolve(process.cwd(), 'src/lib/runtime.ts')).href);
        const { getDesktopTimerHost } = runtimeModule;
        const callback = vi.fn();
        const originalSetTimeout = window.setTimeout;
        const originalClearTimeout = window.clearTimeout;
        const setTimeoutSpy = vi.fn(function (
            this: Window,
            handler: TimerHandler
        ): ReturnType<typeof setTimeout> {
            expect(this).toBe(window);
            if (typeof handler === 'function') {
                handler();
            }
            return 1 as unknown as ReturnType<typeof setTimeout>;
        });
        const clearTimeoutSpy = vi.fn(function (
            this: Window,
            _id?: string | number | ReturnType<typeof setTimeout>
        ): void {
            expect(this).toBe(window);
        });

        Object.defineProperty(window, 'setTimeout', {
            configurable: true,
            writable: true,
            value: setTimeoutSpy,
        });
        Object.defineProperty(window, 'clearTimeout', {
            configurable: true,
            writable: true,
            value: clearTimeoutSpy,
        });

        try {
            const timers = getDesktopTimerHost();
            const handle = timers.setTimeout(callback, 10);
            timers.clearTimeout(handle);

            expect(callback).toHaveBeenCalledOnce();
            expect(setTimeoutSpy).toHaveBeenCalledOnce();
            expect(clearTimeoutSpy).toHaveBeenCalledOnce();
        } finally {
            Object.defineProperty(window, 'setTimeout', {
                configurable: true,
                writable: true,
                value: originalSetTimeout,
            });
            Object.defineProperty(window, 'clearTimeout', {
                configurable: true,
                writable: true,
                value: originalClearTimeout,
            });
        }
    });
});

describe('desktop platform detection', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('recognizes the Linux WebKit user agent used by native packages', async () => {
        vi.stubGlobal('navigator', {
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15',
        });
        const runtimeModule = await import(pathToFileURL(resolve(process.cwd(), 'src/lib/runtime.ts')).href);

        expect(runtimeModule.isLinuxRuntime()).toBe(true);
        expect(runtimeModule.isWindowsRuntime()).toBe(false);
    });

    it('does not classify Windows WebView2 as Linux', async () => {
        vi.stubGlobal('navigator', {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        });
        const runtimeModule = await import(pathToFileURL(resolve(process.cwd(), 'src/lib/runtime.ts')).href);

        expect(runtimeModule.isLinuxRuntime()).toBe(false);
        expect(runtimeModule.isWindowsRuntime()).toBe(true);
    });
});
