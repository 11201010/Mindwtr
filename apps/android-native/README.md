# Android native development shell

This is an isolated development app (`tech.dongdongbh.mindwtr.nativeclient.dev`). It does not replace or read the React Native app installation.

From the repository root:

```sh
bun install --frozen-lockfile
cd apps/android-native/android
./gradlew :app:assembleDebug
```

Gradle builds `core-host.js` from current `packages/core` source before packaging. A fresh install opens its private SQLite database through the core adapter and shows `Core ready · 0 tasks`. A load error is shown in the shell. The host exposes no task commands, fixture seeding, sync, or external action intents.

This shell is not a tester build. Before a tester build, add a content-free startup success/failure line tagged `extra.releaseCheck` and a matching entry in `docs/release-notes/diagnostics-ledger.md`, then make that line available through Settings › Diagnostics. The shared versioned host contract and safe write/recovery path are the next integration step.
