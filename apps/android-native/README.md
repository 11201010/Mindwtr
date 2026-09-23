# Android native development app

This isolated Compose app uses `tech.dongdongbh.mindwtr.nativeclient.dev` and its own private `mindwtr-native-dev.db`. It does not read or replace the React Native app. It shows the first 50 Inbox rows, loads more in windows of at most 50, and calls the shared core contract to capture, complete, and edit tasks. The app has no sync, external intents, fixture seeding, or production upgrade path.

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

Tapping an Inbox row opens a task editor for title, notes, status, priority, project, start date, and due date. It reads through core's `getTaskEditor` and saves through `updateTask`; Kotlin holds no task rules. Save sends only the changed fields, each with the value it was loaded with, and closes without a call when nothing changed. Dates are picked as `YYYY-MM-DD` or cleared; a stored date with a time is shown as stored (timed editing is not built yet). If another writer changed a field you edited, core refuses the save, the draft stays, and **Reload** takes the stored value of each changed field while keeping your other edits. An invalid combination shows core's message and writes nothing. A failed or timed-out save locks the draft to its exact retry, like a failed capture. Leaving with unsaved edits asks Discard / Save / Cancel, as the mobile editor does. The draft and the values it was loaded with survive rotation and process death, so a save after a restart still detects another writer's change.

Debug builds read three fault properties before each create, complete, or update command; release builds never read them:

- `debug.mindwtr.native.fail_commit=1` makes every SQLite `COMMIT` fail.
- `debug.mindwtr.native.delay_before_ms=<ms>` holds the command before it runs.
- `debug.mindwtr.native.delay_after_ms=<ms>` holds the acknowledgment after the commit.

`node apps/android-native/scripts/check-lifecycle-device.mjs <adb-serial>` uses these to check capture through rotation, process death, force-stop, and a failed commit that survives rotation, Back, and a new screen. It refuses any APK whose package is not the development package (checked with `aapt2`). It installs with `install -r`, keeps existing development data, and asserts on task titles unique to each run. Leave the device on its home screen first; the script stops (exit 3) rather than type into another app. It needs host `sqlite3`.

`node apps/android-native/scripts/check-editor-device.mjs <adb-serial>` checks the editor the same way: a save that changes title, priority, and due date; a draft kept through rotation and through process death; a failed commit that keeps its exact retry through rotation, Back, and a new screen; clearing a due date; and core's refusal of status `reference` with a priority. It has the same install, safety, and exit-code rules as the lifecycle check.

Rotation and process death are validated only for this development identity, not for a production identity.

The `upgradetest` build type (`./gradlew :app:assembleUpgradetest`) is for the upgrade harness only. It installs as the throwaway package `tech.dongdongbh.mindwtr.upgradetest` over a real RN v1.3.2 build and opens the RN database, `files/SQLite/mindwtr.db`. Before anything opens that file, a guard refuses to start when the database is missing while other RN state exists, when RN AsyncStorage (`databases/RKStorage`) holds the `mindwtr-data:json-ahead-of-sqlite` marker (RN saved work only to its JSON backup), or when either file cannot be read or the database fails `quick_check`. The guard reads byte copies in the cache folder, never the files themselves. On a refusal the app shows `Storage unavailable` and changes no file. `node scripts/build-upgrade-harness.mjs` builds and signs the three harness APKs; `node scripts/check-upgrade-device.mjs <adb-serial>` runs the upgrade, fail-closed, damaged-database, missing-database and RN recovery scenarios on a phone. See the Harness section of `docs/development/native-android-upgrade-inventory.md`.
