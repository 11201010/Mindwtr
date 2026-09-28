// Mobile's reader for core's `buildSyncLocationScope` — one stable string naming the sync
// backend + location this device is pointed at, read from the device's own config.
//
// Two consumers, and they must agree byte-for-byte:
//   - attachment presence reconciliation (#1119) — "has the backend configuration changed
//     under the stamp?"
//   - sync-encryption discovery states (#1138) — "was this lock set for the location we are
//     about to sync against?"
//
// The derivation and the key read live in core (`readSyncLocationScope`) so desktop TS and
// the native app use the same ones and Rust has a single shape to mirror. No secret is
// included: the string is written into plain AsyncStorage and into the device-local
// encryption sidecar.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildSyncLocationScope, readSyncLocationScope } from '@mindwtr/core';

export { buildSyncLocationScope };

/** The scope of the configuration currently persisted on this device. `null` means the
 *  configuration could not be read at all, which every caller treats as doubt: attachment
 *  reconciliation runs, and an encryption lock stays in force. */
export const readActiveSyncLocationScope = async (): Promise<string | null> => readSyncLocationScope(AsyncStorage);
