/**
 * URL Polyfill Shim for React Native (Hermes)
 * 
 * Provides standard URL and URLSearchParams implementation.
 * Adds safety stubs for createObjectURL/revokeObjectURL to prevent crashes in environments
 * that don't support them fully or where we want to handle them gracefully.
 */

// Use global URL if available, but wrap it to ensure safety methods exist
const NativeURL = globalThis.URL;
const NativeURLSearchParams = globalThis.URLSearchParams;

// Patch createObjectURL and revokeObjectURL if missing
const patchURL = (URLClass) => {
    if (!URLClass) return URLClass;

    const SafeURL = URLClass;

    if (!SafeURL.createObjectURL) {
        SafeURL.createObjectURL = (blob) => {
            console.warn('URL.createObjectURL is not supported in this environment (shimmed to prevent crash).');
            return '';
        };
    }

    if (!SafeURL.revokeObjectURL) {
        SafeURL.revokeObjectURL = (url) => {
            // No-op
        };
    }

    return SafeURL;
};

const ShimmedURL = patchURL(NativeURL) || NativeURL;

// Export as a shim object to match test expectations
const shim = {
    URL: ShimmedURL,
    URLSearchParams: NativeURLSearchParams,
};

// Also apply globally for runtime usage if needed
if (typeof globalThis !== 'undefined') {
    if (!globalThis.URL) {
        globalThis.URL = ShimmedURL;
    } else {
        // Ensure patch is applied to global
        patchURL(globalThis.URL);
    }

    if (!globalThis.URLSearchParams) {
        globalThis.URLSearchParams = NativeURLSearchParams;
    }
}

// Named exports for test compatibility (when using await import)
export const URL = shim.URL;
export const URLSearchParams = shim.URLSearchParams;

export default shim;
