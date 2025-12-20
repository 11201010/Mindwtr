// Install shared URL/URLSearchParams shim up front so all modules see a consistent API
const { URL: ShimURL, URLSearchParams: ShimURLSearchParams, setupURLPolyfill } = require('./shims/url-polyfill');
setupURLPolyfill();

if (typeof globalThis !== 'undefined' && typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
}

const maybeCopyGlobals = (target) => {
    if (!target) return;
    target.URL = ShimURL;
    target.URLSearchParams = ShimURLSearchParams;
};
maybeCopyGlobals(typeof window !== 'undefined' ? window : undefined);
maybeCopyGlobals(typeof globalThis !== 'undefined' ? globalThis : undefined);
maybeCopyGlobals(typeof self !== 'undefined' ? self : undefined);

try {
    // Apply React Native specific polyfills
    if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
        if (typeof SharedArrayBuffer === 'undefined') {
            global.SharedArrayBuffer = ArrayBuffer;
        }

        if (typeof Buffer === 'undefined') {
            global.Buffer = require('buffer').Buffer;
        }

        // Set on all potential global objects
        if (typeof window !== 'undefined') window.SharedArrayBuffer = global.SharedArrayBuffer;
        if (typeof self !== 'undefined') self.SharedArrayBuffer = global.SharedArrayBuffer;
    }
} catch (e) {
    console.error('[Polyfills] Error applying polyfills:', e);
}
