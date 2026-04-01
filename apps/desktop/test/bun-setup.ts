import { JSDOM } from 'jsdom';
import { afterEach, expect, vi } from 'vitest';

process.env.NODE_ENV = 'test';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
});

const win = dom.window as unknown as Window & typeof globalThis;

const defineGlobal = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
    });
};

defineGlobal('window', win);
defineGlobal('document', win.document);
defineGlobal('self', win);
defineGlobal('navigator', win.navigator);
defineGlobal('location', win.location);
defineGlobal('localStorage', win.localStorage);
defineGlobal('sessionStorage', win.sessionStorage);
defineGlobal('HTMLElement', win.HTMLElement);
defineGlobal('HTMLInputElement', win.HTMLInputElement);
defineGlobal('HTMLTextAreaElement', win.HTMLTextAreaElement);
defineGlobal('HTMLButtonElement', win.HTMLButtonElement);
defineGlobal('HTMLCanvasElement', win.HTMLCanvasElement);
defineGlobal('Node', win.Node);
defineGlobal('Event', win.Event);
defineGlobal('CustomEvent', win.CustomEvent);
defineGlobal('KeyboardEvent', win.KeyboardEvent);
defineGlobal('MouseEvent', win.MouseEvent);
defineGlobal('MutationObserver', win.MutationObserver);
defineGlobal('getComputedStyle', win.getComputedStyle.bind(win));
defineGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
defineGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));

if (!('matchMedia' in win)) {
    win.matchMedia = (() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as typeof win.matchMedia;
}

if (!(win.HTMLElement.prototype as { attachEvent?: () => void }).attachEvent) {
    (win.HTMLElement.prototype as { attachEvent?: () => void }).attachEvent = () => {};
}
if (!(win.HTMLElement.prototype as { detachEvent?: () => void }).detachEvent) {
    (win.HTMLElement.prototype as { detachEvent?: () => void }).detachEvent = () => {};
}

if (win.HTMLCanvasElement) {
    Object.defineProperty(win.HTMLCanvasElement.prototype, 'getContext', {
        value: (() => null) as HTMLCanvasElement['getContext'],
        configurable: true,
    });
}

const perf = globalThis.performance as Performance & {
    trackUseMemo?: () => void;
};
if (typeof perf.trackUseMemo !== 'function') {
    perf.trackUseMemo = () => {};
}
const windowPerf = win.performance as Performance & {
    trackUseMemo?: () => void;
};
if (typeof windowPerf.trackUseMemo !== 'function') {
    windowPerf.trackUseMemo = () => {};
}

if (typeof (vi as { hoisted?: <T>(factory: () => T) => T }).hoisted !== 'function') {
    (vi as { hoisted?: <T>(factory: () => T) => T }).hoisted = <T>(factory: () => T) => factory();
}
if (typeof (vi as { importActual?: <T>(path: string) => Promise<T> }).importActual !== 'function') {
    (vi as { importActual?: <T>(path: string) => Promise<T> }).importActual = <T>(path: string) => {
        if (path === '@mindwtr/core') {
            const coreUrl = new URL('../../../packages/core/src/index.ts', import.meta.url).href;
            return import(coreUrl) as Promise<T>;
        }
        return import(path) as Promise<T>;
    };
}

const { cleanup } = await import('@testing-library/react');
const jestDomMatchers = await import('@testing-library/jest-dom/matchers');

(globalThis as { expect?: typeof expect }).expect = expect;
expect.extend(jestDomMatchers);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});
