# iOS native upgrade safety

Source inventory: 2026-09-26, base `2d62a09a9ff5cecef08a48554bd43bd614bbd9b6`. This is a release gate, not a claim that a replacement build is ready. The maintainer requires existing data to survive an ordinary update; users must not need to export/import or reinstall.

The current SwiftUI foundation uses an isolated database. Physical alpha testing uses a separate development app identity and sandbox. It must not select the RN database merely because both builds use the same bundle identifier. Upgrade activation requires a separate, tested storage preparation path.

## Implemented rehearsal boundary

`LegacyRNStorage` reads inline and MD5-named external AsyncStorage values without changing them. Its internal authority commit preserves unknown preferences and external files, checkpoints the original manifest, then atomically updates only the markers core requests after a validated SQLite readback. Changed sources, corrupt checkpoints and multiple populated legacy stores block the commit. The Swift package's debug initializer exercises synthetic and copied RN containers. The debug simulator app enables the same path only with `--native-rn-rehearsal`, selecting an explicitly staged copy under `Application Support/NativeRNRehearsal`; ordinary startup retains the isolated foundation database.

Before SQLite opens, core's native-upgrade gate rejects corrupt, duplicate or lossy backup data. A missing database with any SQLite-era authority marker also blocks startup: a valid backup alone cannot prove that later SQLite-only edits are present. A genuine JSON-only legacy installation without those markers can migrate. Existing RN startup policy is unchanged.

Native UTF-8 decoding preserves leading U+FEFF and embedded NUL text through SQLite and JSON reads; invalid UTF-8 still fails. JSON parsing retains Foundation's distinct raw manifest keys, including canonically equivalent Unicode spellings, instead of rebuilding them as Swift dictionary keys. The 250-test Swift/JSC run includes exact-byte SQL round trips, raw-key preservation and authority-marker commits that retain unknown values and external files. These checks cover the storage adapter, not the signed replacement-install gate.

Automated rehearsals cover an interrupted marker acknowledgment after the database import, exact retry, notes, date-only values, tombstones, device preferences, unchanged attachment-file bytes, and repeated startup. These are filesystem/JSC/SQLite tests, not a signed App Store replacement or attachment-workflow test. The simulator's original RN Documents and AsyncStorage files also remained byte-identical after installing and using the isolated native app (seven original files checked, none changed or missing).

A copied RN 1.3.1 simulator container also passed two host startups with its two tasks and existing preferences preserved. Canonical rows across all eight library tables were compared, allowing only core's expected `lastTombstoneCleanupAt` maintenance timestamp. This exposed a checkpoint reopen failure: SQLite backup had inherited WAL mode, so a read-only reopen could require missing sidecars. Newly created checkpoints now switch only their destination to DELETE journal mode before validation and durable promotion. A regression verifies the committed source WAL is included, original main/WAL bytes stay unchanged during checkpoint creation, and the standalone checkpoint reopens read-only before any writable inspection. The debug app has also opened the copied library. This small fixture does not cover all upgrade surfaces or establish RN 1.3.2 visual parity.

## Existing storage contract

| Surface | Existing RN convention | Native requirement |
| --- | --- | --- |
| App identity | `tech.dongdongbh.mindwtr`, `apps/mobile/app.json` | Preserve the existing store identity and signing access; no uninstall/reinstall migration |
| Database | `Documents/SQLite/mindwtr.db`, `apps/mobile/lib/storage-adapter.ts` | Open the same database only after preparation succeeds; include committed WAL state in a validated prewrite checkpoint |
| Fallback library | AsyncStorage `mindwtr-data`, with older names `focus-gtd-data`, `gtd-todo-data`, `gtd-data` | Preserve all records, including unsynced work and tombstones; use core's legacy import policy, not Swift merge rules |
| Backup authority | `mindwtr-data:json-ahead-of-sqlite`, `:startup-backup-version`, `:sqlite-json-reconcile-v1` | A JSON-ahead backup may contain writes absent from SQLite. Confirm import and readback before clearing its marker; inability to read authority state blocks migration |
| iOS AsyncStorage | `Library/Application Support/<bundleID>/RCTAsyncLocalStorage_V1/manifest.json`; string values inline, null values in lowercase MD5-named UTF-8 files | Preserve every preference and provider setting, including unknown keys; recognize older Documents stores and reject ambiguous conflicting stores |
| Device preferences | `workspace-session-storage.ts`, including `mindwtr-language` and `@mindwtr_theme` | Read existing values; do not substitute defaults during upgrade |
| Sync credentials | Expo SecureStore, `secure-config.ts` and `dropbox-auth.ts` | Preserve Keychain items and their access identity. No clearing or rewriting credentials as an initialization step |
| Provider configuration | AsyncStorage keys in `sync-constants.ts`, plus bookmarks and encryption state | Preserve configuration and grants; do not enable a copied library's live sync destination in a test |
| App Group | `group.tech.dongdongbh.mindwtr`; Siri and widget action stores | Preserve the container, snapshots, queues and receipts; reuse existing delivery contracts before enabling extensions |
| CloudKit | `iCloud.tech.dongdongbh.mindwtr`, `plugins/ios-cloudkit-sync.js` | Preserve container identity and existing record format; signed-device verification remains required |
| Files and queued work | Documents attachment/capture files, `pending-captures`, Watch receiver journals/audio | Preserve bytes and references; a task-row count does not prove attachments or queued captures survived |

The installed RN AsyncStorage implementation is the format authority: `node_modules/@react-native-async-storage/async-storage/ios/RNCAsyncStorage.mm`. Read all referenced out-of-line files; a missing file cannot be converted to an absent value or empty library. Older paths include Documents storage variants recognized by that implementation. Unsupported, oversized, corrupt or unreadable state must remain untouched and produce a retryable blocked startup.

Expo SecureStore's current query uses generic-password items, a UTF-8 account/generic field, and services `app:no-auth`, `app:auth`, then legacy `app`. The ordinary sync-secret adapter removes the leading `@` from its key. Dropbox uses `mindwtr_dropbox_tokens`. Background-readable sync secrets use `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`; Dropbox tokens use `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. These are source observations, not permission to inspect credentials or a claim that a new signing configuration can read them. Real signed-upgrade tests must prove access without printing secret values or bypassing authentication.

## Required upgrade evidence

Use an actual RN installation with disposable data, preserving its application/container identity during replacement. Record both app artifacts and the native core bundle hash. Exercise at least:

1. A valid fresh empty install and a library with unsynced tasks, projects, sections, areas, people, tombstones, settings and attachment bytes.
2. SQLite plus a newer JSON-ahead backup, JSON-only fallback, legacy backup names, and repeat/restart after import. Verify values and identities, not just counts.
3. Corrupt/partially readable SQLite, corrupt/missing AsyncStorage entries, missing database with evidence of existing data, and failed checkpoint creation. No task/schema/authority-state write may proceed from an untrusted load.
4. Process interruption before checkpoint promotion, during import, after database commit and before marker acknowledgment. Repeating startup must converge without duplicate tasks or discarding newer writes.
5. Native create/edit/complete, restart, and a newer RN recovery build reading those changes without reviving stale JSON data.
6. Preferences, credentials, attachment references, app-group queues, file bookmarks and provider state across the actual signed channel. An unsigned simulator cannot prove Keychain/App Group/CloudKit access after an App Store update.

No release or beta replacement is authorized by a successful isolated-host test. Keep the RN release path and recovery capability until these checks and the migration roadmap's remaining gates pass.
