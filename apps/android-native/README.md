# Android native development app

This isolated Compose app uses `tech.dongdongbh.mindwtr.nativeclient.dev` and its own private `mindwtr-native-dev.db`. It does not read or replace the React Native app. It shows the first 50 Inbox rows, loads more in windows of at most 50, and calls the shared core contract to capture and complete tasks. The app has no editor, sync, external intents, fixture seeding, or production upgrade path.

From the repository root:

```sh
bun install --frozen-lockfile
node apps/android-native/scripts/build-bundle.mjs
cd apps/android-native/android
./gradlew :app:assembleDebug --offline
```

The build also regenerates `core-host.js` from current core source. Install only the resulting development APK (`android/app/build/outputs/apk/debug/app-debug.apk`) into the isolated development package. A clean install creates an app-private SQLite checkpoint before core schema setup. On later launches, the first checkpoint is retained. The checkpoint file and its directory entry are synced before task writes. Every core data load is checked against storage row counts, including the load during contract activation. A failed check shows `Storage unavailable` and leaves commands disabled. Capture drafts stay visible after save failure and reuse their UUID for an unchanged retry; editing the draft starts a new capture.

The checkpoint is a SQLite `VACUUM INTO` snapshot, so it includes committed WAL content. This development app has no other recoverable user data yet. It is not a tester build: its log is only in logcat, and it has no Settings › Diagnostics. A tester build needs that diagnostics screen, upgrade and recovery validation, and the remaining workflows before distribution.

The adapter rejects detected concurrent database writes. Activity rotation and simultaneous host startup have not been validated for a production identity.
