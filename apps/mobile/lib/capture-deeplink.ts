// Moved to core (packages/core/src/capture-deeplink.ts) so the native Android app parses the same links.
export {
    isEntityOpenUrl,
    isOpenFeatureUrl,
    isShortcutCaptureUrl,
    normalizeShortcutTags,
    parseEntityOpenUrl,
    parseOpenFeatureUrl,
    parseShortcutCaptureUrl,
    resolveOpenFeaturePath,
    type EntityOpenKind,
    type EntityOpenPayload,
    type OpenFeaturePayload,
    type ShortcutCapturePayload,
} from '@mindwtr/core';
