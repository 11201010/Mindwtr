import { normalizeWebdavUrl } from './sync-helpers';
import type { WebdavSyncCompatibility } from './webdav';

export type WebdavCapabilityProofConfig = {
    url: string;
    username?: string;
    allowInsecureHttp?: boolean;
};

/**
 * The device-local identity a cached WebDAV capability proof is keyed on: normalized
 * endpoint, trimmed username, and the insecure-transport policy — the exact dimensions that
 * make an earlier proof (or legacy-plaintext answer) still apply to this configuration.
 *
 * Deliberately excludes the password: a caller that spreads a fuller config object (one that
 * happens to carry a `password` field) onto this shape must never have it enter the string
 * that gets written to device storage.
 */
export const serializeWebdavCapabilityProof = (config: WebdavCapabilityProofConfig): string => JSON.stringify({
    version: 1,
    endpoint: normalizeWebdavUrl(config.url.trim()),
    username: config.username?.trim() ?? '',
    allowInsecureHttp: config.allowInsecureHttp === true,
});

export const WEBDAV_CAPABILITY_PROOF_STORAGE_KEY = '@mindwtr_webdav_capability_proof_v1';
export const WEBDAV_LEGACY_PROOF_STORAGE_KEY = '@mindwtr_webdav_legacy_proof_v1';
// A legacy (no strong ETag) answer is re-checked daily, not per cycle: the probe is the
// cold first request of every sync and on a slow link it failed cycles whose own reads
// then succeeded (Jianguoyun, roaming, 2026-08-31). A day bounds how long a server that
// starts serving strong ETags goes unnoticed without asking the user to re-save.
export const WEBDAV_LEGACY_PROOF_TTL_MS = 24 * 60 * 60_000;

/** The host's device-local key-value store (AsyncStorage on RN). */
export type WebdavCapabilityProofStoragePort = {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
};

export type EnsureWebdavCapabilityProofOptions = {
    /** Only a caller that accepts plaintext without a strong ETag may reuse a cached
     *  legacy answer; with encryption on, the probe must run and reject it. */
    allowLegacyPlaintext?: boolean;
    now?: () => number;
};

export type WebdavCapabilityProofStore = {
    hasWebdavCapabilityProof(config: WebdavCapabilityProofConfig): Promise<boolean>;
    rememberWebdavCapabilityProof(config: WebdavCapabilityProofConfig): Promise<void>;
    ensureWebdavCapabilityProof(
        config: WebdavCapabilityProofConfig,
        probe: () => Promise<WebdavSyncCompatibility | void>,
        options?: EnsureWebdavCapabilityProofOptions,
    ): Promise<WebdavSyncCompatibility>;
};

/**
 * The device-local cache of WebDAV capability probes. A strong-ETag proof is kept until the
 * configuration changes; a legacy-plaintext answer is kept for one day and only reused by a
 * caller that accepts plaintext. A storage failure never counts as a proof: the next run
 * probes again.
 */
export const createWebdavCapabilityProofStore = (
    storage: WebdavCapabilityProofStoragePort,
): WebdavCapabilityProofStore => {
    const hasWebdavCapabilityProof = async (config: WebdavCapabilityProofConfig): Promise<boolean> => {
        try {
            return await storage.getItem(WEBDAV_CAPABILITY_PROOF_STORAGE_KEY)
                === serializeWebdavCapabilityProof(config);
        } catch {
            return false;
        }
    };

    const rememberWebdavCapabilityProof = async (config: WebdavCapabilityProofConfig): Promise<void> => {
        try {
            await storage.setItem(
                WEBDAV_CAPABILITY_PROOF_STORAGE_KEY,
                serializeWebdavCapabilityProof(config),
            );
        } catch {
            // The current run was proven. If device storage is unavailable, the next
            // run safely probes again instead of trusting an unrecorded result.
        }
    };

    const hasRecentLegacyProof = async (config: WebdavCapabilityProofConfig, now: number): Promise<boolean> => {
        try {
            const raw = await storage.getItem(WEBDAV_LEGACY_PROOF_STORAGE_KEY);
            if (!raw) return false;
            const parsed = JSON.parse(raw) as { proof?: unknown; at?: unknown };
            return parsed.proof === serializeWebdavCapabilityProof(config)
                && typeof parsed.at === 'number'
                && now - parsed.at >= 0
                && now - parsed.at < WEBDAV_LEGACY_PROOF_TTL_MS;
        } catch {
            return false;
        }
    };

    const rememberLegacyProof = async (config: WebdavCapabilityProofConfig, now: number): Promise<void> => {
        try {
            await storage.setItem(
                WEBDAV_LEGACY_PROOF_STORAGE_KEY,
                JSON.stringify({ proof: serializeWebdavCapabilityProof(config), at: now }),
            );
        } catch {
            // Next run probes again.
        }
    };

    const ensureWebdavCapabilityProof = async (
        config: WebdavCapabilityProofConfig,
        probe: () => Promise<WebdavSyncCompatibility | void>,
        options: EnsureWebdavCapabilityProofOptions = {},
    ): Promise<WebdavSyncCompatibility> => {
        const now = options.now?.() ?? Date.now();
        if (await hasWebdavCapabilityProof(config)) return 'strong-etag';
        if (options.allowLegacyPlaintext && await hasRecentLegacyProof(config, now)) return 'legacy-plaintext';
        const compatibility = await probe() ?? 'strong-etag';
        if (compatibility === 'strong-etag') {
            await rememberWebdavCapabilityProof(config);
            await storage.removeItem(WEBDAV_LEGACY_PROOF_STORAGE_KEY).catch(() => undefined);
        } else if (options.allowLegacyPlaintext) {
            await rememberLegacyProof(config, now);
        }
        return compatibility;
    };

    return { hasWebdavCapabilityProof, rememberWebdavCapabilityProof, ensureWebdavCapabilityProof };
};
