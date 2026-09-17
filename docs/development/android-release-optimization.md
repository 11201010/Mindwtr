# Android release optimization

Release builds enable minification and resource shrinking through the ABI config
plugin. They currently retain the Expo template's `proguard-android.txt`, which
explicitly disables code optimization even when minification is enabled.

An Android 16 device evaluation with Expo 54 / React Native 0.81 found that
switching to `proguard-android-optimize.txt` broke Expo SecureStore option
conversion with a native null-pointer exception. A release built from the same
source with the legacy default did not produce that error. The optimization
change is therefore deferred; a successful build or apparently normal UI launch
is insufficient evidence that reflective native modules remain safe.

Revisit code optimization with a compatible Expo upgrade or a narrowly scoped,
validated upstream fix. Make persistent changes in the Expo plugins, not only
in the generated `apps/mobile/android` directory. Keep the custom rules,
including the reflected `RNHeadlessAppLoader` entrypoint.

The current Expo 54 / React Native 0.81 toolchain resolves AGP 8.11. Do not set
`android.r8.optimizedResourceShrinking=true` on that version. Android documents
this option for AGP 8.12/8.13 and enables it by default in AGP 9. Revisit it with
a compatible framework/toolchain upgrade, not an isolated major AGP override.

## Validation before enabling code optimization

- Run the plugin tests and a clean Expo prebuild. Check that the generated
  release block uses the optimized default and still includes the custom rules.
- Build a release APK, not just a debug client. Inspect the merged
  `android/app/build/outputs/mapping/release/configuration.txt` for an active
  `-dontoptimize` directive from any dependency; there must be none.
- Verify cold launch, SQLite load/save, native module loading, navigation,
  share capture, reminders, and background work on the optimized build. A
  successful compiler or debug build alone does not validate R8 behavior.
- Exercise SecureStore reads and writes, including existing credentials, and
  inspect the persistent diagnostics log for native conversion errors. Compare
  with a release control using the legacy default; do not use a debug build as
  the control. Never include credential contents in diagnostics or artifacts.
- Run `:system-bars:testDebugUnitTest` for older Android and API 30/35 coverage;
  inspect navigation icon contrast in light/dark themes on a real device.
  API 35+ uses the app-drawn safe-area background, not the deprecated window
  color setter. See the release diagnostics ledger for native path evidence.
- Preserve the exact release's R8 mapping and merged configuration with its
  artifacts. Obfuscated Play Console stack locations must be matched to that
  same build before attributing a bitmap/download warning to app code.

Play Console advisories are not proof of a runtime defect. React Native's Image
already uses Fresco (including local-image resizing), and Expo Image uses Glide.
RNFS also downloads non-image attachments and models. A bitmap advisory alone
does not justify replacing these libraries. Framework code retains deprecated
system-bar APIs for older Android support, so improving Mindwtr's call sites
does not guarantee that Play's static warning disappears.

References: [Android app optimization](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization)
and [edge-to-edge views](https://developer.android.com/develop/ui/views/layout/edge-to-edge).
