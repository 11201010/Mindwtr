# Widget, saved-list Shortcuts, and voice capture checks

## Behavior

- Tasks widgets own their padding; both configuration variants disable WidgetKit content margins. This avoids budgeting twice for margins and hiding all task rows at medium size.
- In iOS Shortcuts, choose **Open Mindwtr Saved List** and select a saved Focus filter (including a context filter). Open Mindwtr after saving a filter to refresh the picker. Existing **Open Mindwtr List** automations retain their enum parameter.
- Saved lists use stable IDs. The destination resolves current data rather than cached widget tasks; renamed filters keep working, and deleted filters do not open a replacement list.
- Desktop quick capture focuses Start recording when Audio opens. Enter uses normal button activation, including the existing speech configuration and recording guards.

## Automated validation

Run from the appropriate package directory:

```sh
# apps/desktop
bunx vitest run src/components/QuickAddModal.test.tsx
bunx tsc --noEmit

# apps/mobile
bunx vitest run plugins/ios-widgets-and-shortcuts.test.js lib/widget-list-destination.test.ts 'app/(drawer)/widget-list/widget-list-screen.test.tsx' lib/widget-data.test.ts lib/widget-service.test.ts lib/pending-captures.test.ts
bunx tsc --noEmit

# repository root
node scripts/ci/validate-ios-app-intents-availability.js
bunx vitest run packages/core/src/release-diagnostics-fields.test.ts
```

On macOS, compile and run the Foundation catalog/URL check:

```sh
mkdir -p "$HOME/worktrees/Mindwtr/saved-list-shortcut-check"
swiftc apps/mobile/ios-app-intents/MindwtrSavedListCatalog.swift \
  apps/mobile/tests/ios-saved-list/SavedListCatalogCheck.swift \
  -o "$HOME/worktrees/Mindwtr/saved-list-shortcut-check/catalog-check"
"$HOME/worktrees/Mindwtr/saved-list-shortcut-check/catalog-check"
```

All checks above passed on September 26. Xcode 27 also typechecked the maintained widget and App Intents sources against the iOS SDK with an iOS 16 deployment target. Its metadata processor successfully exported the App Intents metadata, including the saved-list action and entity. This was isolated source/metadata validation, not a signed full-app archive.

## Physical device validation

Revision `fd90e68f3` built successfully as a signed Release app with Xcode 27 and was installed on the wired iPhone 12 (iOS 17.5.1), preserving existing data. The SQLite directory was backed up privately before installation. Appium/XCUITest with a separately signed WebDriverAgent drove the following checks:

- Medium and large Tasks widgets both displayed the existing starred Focus task, title and project. Screenshots and accessibility trees confirmed visible rows. Both test widgets were removed afterward.
- **Open Mindwtr Saved List** was discoverable in Shortcuts and offered the temporary saved `@computer` filter. Warm and cold runs opened its exact list with the two matching existing tasks.
- After removing the temporary saved filter, rerunning its Shortcut showed **No options available** without opening another list. The temporary Shortcut was then deleted, and Mindwtr returned to Focus without the test filter. No existing task was edited or completed.
- Evidence remains private under `~/Library/Logs/MindwtrApple` on the Mac (`widget-medium.png`, `widget-large.png`, `saved-list-cold.png`, `saved-list-deleted.png`). The build log is in the isolated `widget-shortcuts-device/.apple-test` directory.

## Remaining acceptance limits

1. In-place large → medium → large resizing requires a newer iOS device; this phone validated separate sizes only. Larger accessibility text sizes remain untested.
2. Filter rename has automated coverage but was not exercised on hardware. The copied device log did not contain `v1.3.3/saved-list-shortcut`; persistent info logging is gated by diagnostic logging, so the log evidence remains unconfirmed despite successful UI navigation.
3. Mac follow-up: after the user connected a WH-1000XM4 microphone and restored the app, System Events exposed the web content. In a new Add Task dialog, switching to Audio focused **Start recording** (`focused: true`). Sending Return (`key code 36`) changed the control to **Stop recording** and displayed **Recording…**. Stopping created a new audio note; only that test note was deleted afterward, preserving the previously open editor and its existing attachment. This confirms native keyboard activation and the recording/capture path. No known spoken sample was supplied, so transcription accuracy remains unverified. Screen capture still failed and `/dev/console` still reported `root`; neither prevented this accessibility-driven test. Private evidence: `mac-audio-tree.txt`, `mac-recording-tree.txt`, `mac-after-recording-tree.txt`, and `mac-cleanup-tree.txt` in the Mac log directory.

No device reset, production signing change, account change, or simulator session was required. Test-only filters, Shortcuts and widgets were created and removed; the app installation and separate WDA runner remain available for continued testing.
