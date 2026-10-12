// Desktop's glue for sync encryption (#1056).
//
// Rust owns key derivation and the OS-keyring cache (apps/desktop/src-tauri/src/
// sync_encryption.rs), the File Sync transitions, and the per-cycle WebDAV crypto seam. WebDAV
// and Dropbox transitions run in core's sync encryption service
// (`packages/core/src/sync-encryption-service.ts`), the same code the mobile apps run; this
// module binds it to Rust's keyring and sidecar, the Rust Argon2 primitive and xmldom. It also
// holds the attachment byte seams and the failure classification.
//
// Desktop TS never keeps a key cache of its own; every getKey/setKey/clearKey here is a Tauri
// call into Rust's keyring, so there is exactly one source of truth on the device.
//
// Deliberately imports nothing from ./sync-service — that module imports this one.

import {
    SYNC_ENCRYPTION_LOG_EVENTS,
    buildSyncEncryptionRemoteReadExtra,
    createSyncEncryptionService,
    syncEncryptionLogMessage,
    type SyncEncryptionRemoteReadLogInput,
    decryptRemoteArtifactOrThrow,
    defaultSyncCryptoPrimitives,
    encryptSyncArtifact,
    inspectSyncArtifact,
    SYNC_ENCRYPTION_KEYED_STATES,
    SyncCryptoUnsupportedError,
    SyncEncryptionRemotePlaintextError,
    SyncEncryptionTerminalError,
    type SyncCryptoKdfParams,
    type SyncCryptoPrimitives,
    type SyncEncryptionKeyCachePort,
    type SyncEncryptionLocalState,
    type SyncEncryptionLocalStatePort,
    type SyncEncryptionLocationPort,
    type SyncEncryptionService,
    type SyncEncryptionServiceDeps,
    type SyncEncryptionServiceStatePort,
    type SyncEncryptionStatus,
    type SyncEncryptionTransitionKind,
    type SyncKeyMaterial,
} from '@mindwtr/core';
import { DOMParser } from '@xmldom/xmldom';
import { logInfo, logWarn } from './app-log';
import { invokeNative, invokeNativeOr } from './tauri-invoke';

export {
    isSyncEncryptionCleanupDeferredError,
    SyncEncryptionCleanupDeferredError,
} from '@mindwtr/core';

/** The `[sync-encryption]` emitter core's service writes its transition trail through.
 *  `logInfo`/`logWarn` sanitize the extras a second time on the way out; never rejects. */
export const logSyncEncryptionEvent: SyncEncryptionServiceStatePort['logSyncEncryptionEvent'] = (
    event,
    extra,
    options,
) => {
    const message = syncEncryptionLogMessage(event);
    const context = { scope: 'sync', extra, force: options?.force };
    const written = options?.level === 'warn' ? logWarn(message, context) : logInfo(message, context);
    return Promise.resolve(written).then(() => undefined, () => undefined);
};

/** fresh-join-attachment-posture packet -10: the attachment byte seams (`sealAttachmentBytes`,
 *  `openAttachmentBytes`) get their own `remote-read` line, same builder and event as the
 *  document-read seams in sync-service.ts — this module cannot import that one (see the file
 *  banner), so this is a second, deliberately identical emitter. Rides the Debug logging
 *  switch like `state`/`remote-read` everywhere else — not forced, unlike `transition`/`error`. */
const logSyncEncryptionRemoteRead = (input: SyncEncryptionRemoteReadLogInput): void => {
    void logInfo(
        syncEncryptionLogMessage(SYNC_ENCRYPTION_LOG_EVENTS.remoteRead),
        { scope: 'sync', extra: buildSyncEncryptionRemoteReadExtra(input) },
    );
};

const OFF_STATUS: SyncEncryptionStatus = { state: 'off' };

type NativeKdfParams = { mKib: number; t: number; p: number };
type NativeKeyMaterial = { key: string; salt: string; kdfParams: NativeKdfParams };
type NativeStatus = {
    state: SyncEncryptionStatus['state'];
    kdfParams?: NativeKdfParams;
    hasKey: boolean;
    incompleteTransition?: SyncEncryptionTransitionKind;
    /** First 8 hex characters only — truncated in Rust so a diagnostics read never carries a
     *  whole salt across the IPC boundary (#1056 diagnostics). */
    saltPrefix?: string;
    /** Location scope of a discovery state (#1138), ALREADY reduced to `<backend>#<digest>`
     *  by Rust. No raw scope (WebDAV username, sync folder path) ever reaches the JS side. */
    discoveredScopeLabel?: string;
};

/** The device's encryption posture as the Diagnostics "Encryption" block needs it: the core
 *  status plus the two sidecar fields the core status shape does not carry. */
export type DesktopSyncEncryptionPosture = {
    state: SyncEncryptionStatus['state'];
    kdfParams?: SyncCryptoKdfParams;
    hasKey: boolean;
    incompleteTransition?: SyncEncryptionTransitionKind;
    saltPrefix?: string;
    /** Already `<backend>#<digest>`; pass it as `discoveredScopeLabel` to core's builders. */
    discoveredScopeLabel?: string;
};

export async function getSyncEncryptionPosture(): Promise<DesktopSyncEncryptionPosture> {
    const status = await invokeNativeOr<NativeStatus | null>(null, 'get_sync_encryption_status');
    if (!status) return { state: 'off', hasKey: false };
    return {
        state: status.state,
        kdfParams: status.kdfParams,
        hasKey: status.hasKey,
        incompleteTransition: status.incompleteTransition,
        saltPrefix: status.saltPrefix,
        discoveredScopeLabel: status.discoveredScopeLabel,
    };
}

const base64ToBytes = (value: string): Uint8Array => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return btoa(binary);
};

const bytesToHex = (bytes: Uint8Array): string =>
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const hexToBytes = (hex: string): Uint8Array => {
    const out = new Uint8Array(Math.floor(hex.length / 2));
    for (let index = 0; index < out.length; index += 1) {
        out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return out;
};

const toMaterial = (payload: NativeKeyMaterial): SyncKeyMaterial => ({
    key: base64ToBytes(payload.key),
    salt: hexToBytes(payload.salt),
    params: payload.kdfParams,
});

// A keyring read can be an IPC round-trip (and on some Linux backends a prompt), and the
// attachment seams ask for the material once per file. Memoized until a transition changes it —
// so populating `enabledButLocked` alongside it (one extra one-time invoke per cache
// population, not per attachment or per cycle) costs an existing off-state install nothing
// ongoing (backward-compat invariant #1).
let materialCache: { material: SyncKeyMaterial | null; enabledButLocked: boolean } | null = null;

export const clearSyncEncryptionMaterialCache = (): void => {
    materialCache = null;
};

/** `null` whenever this device is not in the 'enabled' state, or is enabled but has no key —
 *  in which case every seam that needs one fails closed rather than silently writing
 *  plaintext into an encrypted folder. Callers that would otherwise treat `null` as "encryption
 *  is off" (e.g. an upload seam falling back to a plaintext write) must check
 *  `isSyncEncryptionEnabledButLocked()` first — see S3. */
export async function getSyncEncryptionMaterial(): Promise<SyncKeyMaterial | null> {
    if (materialCache) return materialCache.material;
    const [payload, status] = await Promise.all([
        invokeNativeOr<NativeKeyMaterial | null>(null, 'get_sync_encryption_key_material'),
        invokeNativeOr<NativeStatus | null>(null, 'get_sync_encryption_status'),
    ]);
    const material = payload ? toMaterial(payload) : null;
    const keyed = Boolean(status && SYNC_ENCRYPTION_KEYED_STATES.includes(status.state));
    materialCache = { material, enabledButLocked: keyed && !material };
    return material;
}

/** True when local state says `enabled` but no key resolved (S3) — an Android-Keystore-class
 *  keyring invalidation, or a corrupt fallback-key blob. Distinct from "encryption is off":
 *  a seam that resolves `null` material here must fail closed (surface
 *  `SyncEncryptionTerminalError`), never silently write a plaintext artifact into a folder
 *  every other device believes is encrypted. */
export async function isSyncEncryptionEnabledButLocked(): Promise<boolean> {
    await getSyncEncryptionMaterial();
    return materialCache?.enabledButLocked ?? false;
}

export async function getSyncEncryptionStatus(): Promise<SyncEncryptionStatus> {
    const status = await invokeNativeOr<NativeStatus | null>(null, 'get_sync_encryption_status');
    if (!status) return OFF_STATUS;
    return {
        state: status.state,
        kdfParams: status.kdfParams,
        incompleteTransition: status.incompleteTransition,
    };
}

/** Persists `remote-encrypted-no-key` the moment a TS seam finds ciphertext it cannot open.
 *  Mirrors core's `markRemoteEncryptionDiscovered`; Rust refuses to downgrade a keyed device
 *  whose salt matches the discovery (and deliberately DOES downgrade one holding a
 *  foreign-salt key — that key is provably for another generation, and only the no-key state
 *  surfaces the unlock prompt), so this is safe to call unconditionally from a read path. */
export async function markRemoteSyncEncryptionDiscovered(discovered: {
    salt: Uint8Array;
    params: SyncCryptoKdfParams;
}, locationScope?: string | null): Promise<void> {
    // `Or`, not the throwing form: in the web build there is no keyring and no sidecar to
    // persist into, and a discovery must not turn into a second, confusing failure on top of
    // the terminal one the caller is already raising.
    await invokeNativeOr(null, 'mark_sync_encryption_remote_discovered', {
        salt: bytesToHex(discovered.salt),
        kdfParams: discovered.params,
        // #1138: binds the discovery to the location it was made on. Optional on the Rust
        // side, and an absent scope re-checks rather than blocking.
        locationScope: locationScope ?? null,
    });
    clearSyncEncryptionMaterialCache();
}

/** Recover a stale marker only after this cycle authenticated the encrypted document. */
export async function restoreVerifiedRemoteSyncEncryption(
    material: SyncKeyMaterial,
    locationScope: string,
): Promise<boolean> {
    const restored = await invokeNativeOr(false, 'restore_sync_encryption_verified_remote', {
        salt: bytesToHex(material.salt),
        kdfParams: material.params,
        locationScope,
    });
    if (restored) clearSyncEncryptionMaterialCache();
    return restored;
}

/** Persist the plaintext discovery without discarding the device's encryption material. */
export async function markRemoteSyncEncryptionPlaintext(locationScope?: string | null): Promise<void> {
    await invokeNativeOr(null, 'mark_sync_encryption_remote_plaintext', {
        locationScope: locationScope ?? null,
    });
    clearSyncEncryptionMaterialCache();
}

/** No Argon2 in desktop JS: a pure-JS KDF on the webview thread is exactly the freeze the
 *  Tauri-command rules exist to prevent, and Rust already has the identical implementation.
 *  AES-GCM stays in WebCrypto (both desktop webviews have it), which is what core's defaults
 *  already use. */
export const desktopSyncCryptoPrimitives: SyncCryptoPrimitives = {
    ...defaultSyncCryptoPrimitives,
    async argon2id(pass, salt, params, dkLen) {
        if (dkLen !== 32) throw new Error(`unsupported derived key length ${dkLen}`);
        const payload = await invokeNative<NativeKeyMaterial>('derive_sync_encryption_key', {
            // Rust NFC-normalizes too; normalization is idempotent, so re-encoding here is safe.
            passphrase: new TextDecoder().decode(pass),
            salt: bytesToHex(salt),
            kdfParams: params,
        });
        return base64ToBytes(payload.key);
    },
};

const persistNativeEnabledMaterial = async (
    key: Uint8Array,
    state: SyncEncryptionLocalState,
): Promise<void> => {
    if (!state.discoveredSalt || !state.discoveredParams) {
        throw new Error('sync encryption enabled material is incomplete');
    }
    await invokeNative('set_sync_encryption_key_material', {
        key: bytesToBase64(key),
        salt: state.discoveredSalt,
        kdfParams: state.discoveredParams,
    });
};

const restoreNativeTransitionSnapshot = async (
    previousState: SyncEncryptionLocalState | null,
    previousMaterial: SyncKeyMaterial | null,
    attemptedState: SyncEncryptionLocalState,
): Promise<void> => {
    if (previousMaterial) {
        await persistNativeEnabledMaterial(previousMaterial.key, {
            state: 'enabled',
            discoveredSalt: bytesToHex(previousMaterial.salt),
            discoveredParams: previousMaterial.params,
        });
        if (previousState?.state === 'remote-plaintext') {
            await invokeNative('mark_sync_encryption_remote_plaintext');
        }
    } else {
        await invokeNative('clear_sync_encryption_key_material');
        if (previousState?.state === 'remote-encrypted-no-key') {
            const salt = previousState.discoveredSalt ?? attemptedState.discoveredSalt;
            const params = previousState.discoveredParams ?? attemptedState.discoveredParams;
            if (!salt || !params) throw new Error('sync encryption rollback material is incomplete');
            await invokeNative('mark_sync_encryption_remote_discovered', {
                salt,
                kdfParams: params,
            });
        }
    }
    if (previousState?.incompleteTransition) {
        await invokeNative('mark_sync_encryption_transition_incomplete', {
            transitionKind: previousState.incompleteTransition,
        });
    }
};

/** Rust's keyring and sidecar as core's state port.
 *
 *  Core always calls `keyCache.setKey(key)` and then `localState.write({state, salt, params})`
 *  — the key alone cannot rebuild a header, so the persist is deferred to the write, where
 *  both halves are in hand for the one Rust command. That also keeps the "persist the enabled
 *  flag only after the transition has fully succeeded" rule: core never reaches the write if
 *  any artifact failed.
 *
 *  `localState.write` returns the native persistence promise. When Rust reports a partial
 *  enabled-material commit, the adapter restores the preceding key/state/journal snapshot
 *  before rejecting, so core's compensating key-cache write is not merely an in-memory update.
 *
 *  The pending key and the snapshot belong to one transition: core loads the state at the start
 *  of each one, on its serialized queue, and every desktop call reaches the service through
 *  `runSyncRestoreExclusive`, so two transitions never share them. */
const createDesktopSyncEncryptionState = (): SyncEncryptionServiceStatePort => {
    let current: SyncEncryptionLocalState | null = null;
    let pendingKey: Uint8Array | null = null;
    let persistedMaterial: SyncKeyMaterial | null | undefined;
    let queued: Promise<unknown>[] = [];

    const keyCache: SyncEncryptionKeyCachePort = {
        async getKey() {
            const material = await getSyncEncryptionMaterial();
            if (persistedMaterial === undefined) persistedMaterial = material;
            return material?.key ?? null;
        },
        async setKey(key) {
            pendingKey = key;
        },
        async clearKey() {
            pendingKey = null;
        },
    };

    const localState: SyncEncryptionLocalStatePort = {
        read: () => current,
        write: (next) => {
            const previous = current;
            current = next;
            const key = pendingKey;
            const operation = (async () => {
                try {
                    if (next?.incompleteTransition) {
                        await invokeNative('mark_sync_encryption_transition_incomplete', {
                            transitionKind: next.incompleteTransition,
                        });
                    } else if (!next || next.state === 'off') {
                        await invokeNative('clear_sync_encryption_key_material');
                    } else if (key && next.discoveredSalt && next.discoveredParams) {
                        await persistNativeEnabledMaterial(key, next);
                    }
                    clearSyncEncryptionMaterialCache();
                } catch (error) {
                    if (current === next) current = previous;
                    if (next && next.state === 'enabled' && key) {
                        try {
                            await restoreNativeTransitionSnapshot(
                                previous,
                                persistedMaterial ?? null,
                                next,
                            );
                        } catch (rollbackError) {
                            clearSyncEncryptionMaterialCache();
                            const commitMessage = error instanceof Error ? error.message : String(error);
                            const rollbackMessage = rollbackError instanceof Error
                                ? rollbackError.message
                                : String(rollbackError);
                            const combined = new Error(
                                `Failed to persist sync encryption material (${commitMessage}); rollback failed (${rollbackMessage})`,
                            );
                            (combined as Error & { cause?: unknown }).cause = error;
                            throw combined;
                        }
                    }
                    clearSyncEncryptionMaterialCache();
                    throw error;
                }
            })();
            queued.push(operation);
            return operation;
        },
    };

    const flush = async () => {
        await Promise.all(queued);
    };

    return {
        loadSyncEncryptionLocalState: async () => {
            current = statusToLocalState(await getSyncEncryptionStatus());
            pendingKey = null;
            persistedMaterial = undefined;
            queued = [];
            void logInfo('Sync encryption state loaded for the core service', {
                scope: 'sync',
                extra: { releaseCheck: 'v1.3.5/desktop-encryption-core-service' },
                force: true,
            });
            return current;
        },
        // Rust commits the key and the state in one call: one snapshot restore puts both back.
        restoreAfterFenceLoss: async (before, attempted) => {
            pendingKey = before.key;
            current = before.state;
            await restoreNativeTransitionSnapshot(
                before.state,
                persistedMaterial ?? null,
                attempted.state ?? before.state ?? { state: 'off' },
            );
            clearSyncEncryptionMaterialCache();
            await flush();
        },
        flushSyncEncryptionLocalState: flush,
        syncEncryptionLocalState: localState,
        syncEncryptionKeyCache: keyCache,
        getSyncEncryptionMaterial,
        getSyncEncryptionStatus,
        logSyncEncryptionEvent,
    };
};

const statusToLocalState = (status: SyncEncryptionStatus): SyncEncryptionLocalState | null =>
    status.state === 'off' && !status.incompleteTransition
        ? null
        : {
            state: status.state,
            discoveredParams: status.kdfParams,
            incompleteTransition: status.incompleteTransition,
        };

/** What the core service needs from SyncService: where this device syncs and the backend
 *  credentials. Desktop has no File Sync port here — SyncService routes File Sync to Rust. */
export type DesktopSyncEncryptionHost = Pick<
    SyncEncryptionServiceDeps<never>,
    'fetch' | 'loadWebDavConfig' | 'webDavRequestOptions' | 'getDropboxClientId' | 'runDropboxAuthorized'
> & { location: SyncEncryptionLocationPort };

export const createDesktopSyncEncryptionService = (host: DesktopSyncEncryptionHost): SyncEncryptionService =>
    createSyncEncryptionService<never>({
        ...host,
        fenceOwnerId: 'mindwtr-desktop',
        state: createDesktopSyncEncryptionState(),
        crypto: desktopSyncCryptoPrimitives,
        parseWebdavXml: (source) => {
            const errors: string[] = [];
            const document = new DOMParser({
                errorHandler: (level, message) => errors.push(`${level}: ${String(message)}`),
            }).parseFromString(source, 'application/xml') as unknown as Document;
            return { document, errors };
        },
    });

// ---------------------------------------------------------------------------
// Attachment bytes (WebDAV, Dropbox, and the file backend — all three go through the
// webview's byte primitives, so all three are encrypted here rather than in Rust)
// ---------------------------------------------------------------------------

/** Attachments keep their exact remote name with encrypted bytes: `cloudKey` is identity-keyed
 *  and immutable once uploaded, so renaming would churn every record (pinned decision #1).
 *
 *  `artifact` is the caller's `cloudKey` (or, for the file backend's generation verification,
 *  the target path) — the byte-seam `remote-read` line used to say `absent` for every
 *  attachment in the trail, so a log full of seals named nothing. Passed straight to
 *  `buildSyncEncryptionRemoteReadExtra`, which reduces any string to its leaf name via
 *  `syncEncryptionArtifactLabel`. Optional: a caller with no identity yet still gets a valid
 *  line, just with the absent marker. Mirrors mobile's `sealAttachmentBytesForUpload`. */
export async function sealAttachmentBytes(bytes: Uint8Array, artifact?: string | null): Promise<Uint8Array> {
    const label = artifact ?? '';
    const material = await getSyncEncryptionMaterial();
    if (material) {
        logSyncEncryptionRemoteRead({ artifact: label, exists: null, kind: 'encrypted', decision: 'seal' });
        return encryptSyncArtifact(bytes, material);
    }
    if (await isSyncEncryptionEnabledButLocked()) {
        // S3: `enabled` but no key resolved must fail closed — the old `return bytes`
        // fallback here would silently upload a PLAINTEXT attachment into a folder every
        // other device believes is encrypted.
        logSyncEncryptionRemoteRead({ artifact: label, exists: null, kind: 'encrypted', decision: 'no-key' });
        throw new SyncEncryptionTerminalError(
            new SyncCryptoUnsupportedError('sync encryption is enabled but no key is available on this device'),
        );
    }
    logSyncEncryptionRemoteRead({ artifact: label, exists: null, kind: 'plaintext', decision: 'seal' });
    return bytes;
}

/** Plaintext bytes pass straight through: during (and after an interrupted) transition a
 *  remote legitimately holds both generations, and a peer on an older app version can still
 *  upload plaintext. Ciphertext with no key is terminal — never "corrupt, re-upload".
 *
 *  `artifact`: see `sealAttachmentBytes` above. */
export async function openAttachmentBytes(bytes: Uint8Array, artifact?: string | null): Promise<Uint8Array> {
    const label = artifact ?? '';
    const inspected = inspectSyncArtifact(bytes);
    if (inspected.kind === 'unsupported') {
        logSyncEncryptionRemoteRead({ artifact: label, exists: true, kind: 'unsupported', decision: 'decrypt' });
        throw new SyncEncryptionTerminalError(new SyncCryptoUnsupportedError(inspected.reason));
    }
    if (inspected.kind === 'plaintext') {
        logSyncEncryptionRemoteRead({ artifact: label, exists: true, kind: 'plaintext', decision: 'plaintext' });
        return bytes;
    }
    const material = await getSyncEncryptionMaterial();
    if (!material) {
        logSyncEncryptionRemoteRead({
            artifact: label,
            exists: true,
            kind: 'encrypted',
            headerSalt: inspected.salt,
            headerKdf: inspected.params,
            decision: 'no-key',
        });
        await markRemoteSyncEncryptionDiscovered({ salt: inspected.salt, params: inspected.params });
        throw new SyncEncryptionTerminalError(
            new SyncCryptoUnsupportedError('encrypted attachment: no key on this device'),
        );
    }
    logSyncEncryptionRemoteRead({
        artifact: label,
        exists: true,
        kind: 'encrypted',
        headerSalt: inspected.salt,
        headerKdf: inspected.params,
        decision: 'decrypt',
    });
    return decryptRemoteArtifactOrThrow(bytes, material.key, desktopSyncCryptoPrimitives);
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/** Rust's sentinels, mirrored from apps/desktop/src-tauri/src/sync_encryption.rs. */
export const SYNC_ENCRYPTION_TERMINAL = 'SYNC_ENCRYPTION_TERMINAL';
export const SYNC_ENCRYPTION_STATE_UNAVAILABLE = 'SYNC_ENCRYPTION_STATE_UNAVAILABLE';
export const SYNC_ENCRYPTION_REMOTE_ENCRYPTED = 'SYNC_ENCRYPTION_REMOTE_ENCRYPTED';
export const SYNC_ENCRYPTION_REMOTE_PLAINTEXT = 'SYNC_ENCRYPTION_REMOTE_PLAINTEXT';
export const SYNC_ENCRYPTION_TRANSITION_INCOMPLETE = 'SYNC_ENCRYPTION_TRANSITION_INCOMPLETE';

export type SyncEncryptionFailure =
    | 'local-state-unavailable'
    | 'needs-passphrase'
    | 'remote-encrypted-no-key'
    | 'remote-plaintext'
    | 'transition-incomplete';

/** A decrypt failure is never a permission problem and never "corrupt data we repaired" — it
 *  is always "this device needs the passphrase again". Returning a discriminant (rather than a
 *  message) keeps the prose out of this module: desktop's toast-i18n test scans showToast's
 *  first argument for literals, so the caller resolves the string. */
export function classifySyncEncryptionFailure(error: unknown): SyncEncryptionFailure | null {
    if (error instanceof SyncEncryptionRemotePlaintextError) return 'remote-plaintext';
    if (error instanceof SyncEncryptionTerminalError) return 'needs-passphrase';
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    // `includes`, not `startsWith`: a Tauri rejection travels through the sync run's own error
    // wrapping before it gets here, the same reason `SYNC_FILE_WRITE_CONFLICT` is matched that
    // way. The two sentinels do not share a prefix, so order only decides which wins on the
    // (impossible) both-present case.
    if (message.includes(SYNC_ENCRYPTION_STATE_UNAVAILABLE)) return 'local-state-unavailable';
    if (message.includes(SYNC_ENCRYPTION_TRANSITION_INCOMPLETE)) return 'transition-incomplete';
    if (message.includes(SYNC_ENCRYPTION_REMOTE_ENCRYPTED)) return 'remote-encrypted-no-key';
    if (message.includes(SYNC_ENCRYPTION_REMOTE_PLAINTEXT)) return 'remote-plaintext';
    if (message.includes(SYNC_ENCRYPTION_TERMINAL)) return 'needs-passphrase';
    return null;
}

export const isSyncEncryptionFailure = (error: unknown): boolean =>
    classifySyncEncryptionFailure(error) !== null;
