// Apple ships real ICU-backed Intl. Refuse a runtime that would activate the
// Android fallback: fallback collation is not an iOS parity implementation.
if (typeof Intl !== 'object' || typeof Intl.Collator !== 'function'
    || typeof Intl.DateTimeFormat !== 'function') {
    throw new Error('JavaScriptCore Intl is required');
}
