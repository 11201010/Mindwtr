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

The adapter rejects detected concurrent database writes, so the process owns exactly one core host (`ProcessCoreHost`). Activities and the Inbox `ViewModel` never close it; process death is the only shutdown. Screen state lives in the `ViewModel`, so rotation keeps an in-flight or failed save. A failed command's exact retry also stays with the process host until that retry succeeds, so a screen that is closed and reopened in the same process shows the failure and its retry again. Only the capture draft and its UUID survive process death, so an unchanged restored draft retries without a duplicate. `am force-stop` discards that saved screen state by Android design.

Debug builds read three fault properties before each create or complete command; release builds never read them:

- `debug.mindwtr.native.fail_commit=1` makes every SQLite `COMMIT` fail.
- `debug.mindwtr.native.delay_before_ms=<ms>` holds the command before it runs.
- `debug.mindwtr.native.delay_after_ms=<ms>` holds the acknowledgment after the commit.

`node apps/android-native/scripts/check-lifecycle-device.mjs <adb-serial>` uses these to check capture through rotation, process death, force-stop, and a failed commit that survives rotation, Back, and a new screen. It refuses any APK whose package is not the development package (checked with `aapt2`). It installs with `install -r`, keeps existing development data, and asserts on task titles unique to each run. Leave the device on its home screen first; the script stops (exit 3) rather than type into another app. It needs host `sqlite3`.

Rotation and process death are validated only for this development identity, not for a production identity.
