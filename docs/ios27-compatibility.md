# iOS 27 compatibility audit (#1193)

This is an engineering validation record, not a declaration of released iOS 27 support. Physical iPhone and older supported iOS checks remain required even when CI passes.

## Toolchain decision

The scoped migration keeps Expo 54.0.30, React Native 0.81.5, Expo Router 6.0.21, react-native-screens 4.16.0, and the generated host deployment target of iOS 16.4. These are the installed versions inspected on 2026-09-14. A framework upgrade is not a substitute for examining the generated application lifecycle.

The Expo template and widget target use iOS 15.1, but installed `react-native-quick-crypto` 1.1.7 intentionally raises the host and CocoaPods floor to 16.4 for its Nitro dependency. A clean pre-migration project confirms that existing floor. The scene migration preserves it; validating only project-level settings would miss this distinction.

Apple lists Xcode 27 RC with the iOS 27 SDK, requiring macOS 26.6 or later. GitHub exposes a separate `xcode-27` preview image; a normal macOS 26 image does not imply that Xcode 27 is installed. CI must report its actual Xcode build and SDK instead of describing an arbitrary preview image as the RC. The existing release workflow continues to prefer Xcode 26 while the new configuration is evaluated.

- [Apple SDK/toolchain matrix](https://developer.apple.com/xcode/system-requirements)
- [Apple scene migration requirement](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle)
- [GitHub Xcode 27 preview runner](https://github.com/actions/runner-images/issues/14404)
- [Expo scene-template issue](https://github.com/expo/expo/issues/46664)

### Apple RC and design references

The [iOS 27 RC release notes](https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes) require both scene lifecycle adoption and a launch-screen declaration for apps built with the new SDK. Generated-project validation checks both. The [what's new overview](https://developer.apple.com/ios/whats-new/) and [Apple design resources](https://developer.apple.com/design/resources/) guide platform integration; they do not require a wholesale redesign of Mindwtr's shared interface.

For the follow-up evaluations, the RC notes report a default `SpotlightSearchTool` description that exceeds the on-device context window: use a focused guide and explicitly select the on-device model. They also report the `reminders.updateReminder` schema failure as resolved in RC. A preview runner build must not be assumed to contain that fix. Model quality and Siri behavior still need appropriate physical hardware.

## Lifecycle and delivery contract

The maintained Expo plugin must reproduce the migration after clean prebuild. Generated `apps/mobile/ios/` is not the maintained source.

| Owner | Responsibility |
| --- | --- |
| AppDelegate | Bind the React Native factory; run Expo launch subscribers once; retain background task, Watch and notification registration; register existing Siri actions and index the app-owned snapshot. |
| Single UIWindowScene | Associate the app window with its scene, start the UI root once, and forward scene lifecycle callbacks to Expo subscribers. |
| Cold connection | Provide URL/activity/quick-action launch information before React Native initializes; do not replay the same connection as a warm URL event. |
| Warm connection | Forward each OS delivery once into existing Expo/React Native linking. A second deliberate invocation of the same URL remains a separate delivery. |
| React Native capture/queue ingestion | Validate input, enforce app lock, and save through existing core factories and durable persistence. Native lifecycle code does not write task data. |
| Widget/Watch/intent extensions | Read app-published snapshots or enqueue operations through existing stores; never open the app database. |

Expo 54's development launcher expects an AppDelegate window during launch and prepares its root before starting its launcher. The migration must preserve that ordering. UIKit continues to emit UIApplication lifecycle notifications with scenes, so duplicating those notifications would give React Native AppState duplicate events. Scene forwarding is for delegate subscribers, not synthetic notifications.

## Required validation evidence

| Check | What it establishes | Remaining limit |
| --- | --- | --- |
| Plugin tests and clean/repeated prebuild validation | Manifest, registered scene source, host startup and generated project consistency. | Cannot prove Swift compilation or runtime delivery. |
| Existing Xcode 26 native job | Compilation and native tests with the previously selected toolchain. | Does not prove iOS 27 compatibility. |
| Xcode 27 native job | Actual SDK selection, native tests and generated app compilation. | SDK preview/RC identity must be read from artifacts. |
| Bundled Release simulator launch and cold/warm links | App process survives scene startup without Metro; connection and delivery markers can be inspected with screenshots. | Does not prove that every capture was persisted once or that Siri understood speech. |
| Unsigned Release device archive | Device-target compilation, extension linkage and archive generation. | Not a signed installable distribution archive or App Store upload. |
| Physical iPhone and older supported iOS smoke | User-visible launch, capture, background/foreground, notification/widget/Watch opening, app lock, accessibility and draft restoration. | Still required before closing #1193 or advertising support. |

For a tester session, exercise normal capture; cold and warm Shortcuts capture; repeated identical shortcut requests; share capture; notification and widget opening; app lock on return; foreground/background transitions; Watch delivery; and a supported older iOS device/runtime. Confirm one task per accepted save and no task on cancellation. Scene diagnostics prove native routing only; a save requires separate persistence evidence.

## Follow-up work

#1194 and #1195 are evaluations, with on-device quality and performance gates before production adoption. #915 reuses the existing app-maintained snapshot and needs an explicit mutation-completion contract. CI build success does not supply model-capable device results or conversational Siri evidence for those tickets.

Public docs: no change needed until verified supported behavior changes. Do not raise the documented minimum iOS version or advertise iOS 27 support from compilation alone.
