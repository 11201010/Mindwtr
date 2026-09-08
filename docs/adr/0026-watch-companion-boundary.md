# ADR 0026: Apple Watch companion and durable capture boundary

Date: 2026-09-06
Status: Accepted

## Context

[Issue #1175](https://github.com/dongdongbh/Mindwtr/issues/1175) adds capture, Focus, and Pomodoro to Apple Watch. The iPhone owns transcription, quick-add parsing, the task store, and sync. A Watch capture must survive disconnection and repeated transport delivery without introducing another database writer.

## Decision

- Ship a native SwiftUI companion target inside the iOS build. `MINDWTR_WATCH_ENABLED` controls prebuild inclusion: release workflows enable it for both RC and stable iOS archives, while ordinary development and preview builds may leave it disabled. Incremental prebuild must remove previously generated Watch targets when disabled.
- Release workflows choose Watch inclusion with `include_watch` independently from distribution routing with `testflight_only`. RCs use a Watch-enabled, TestFlight-only archive that cannot submit for App Store review. Stable releases use one Watch-enabled archive for both App Store review and TestFlight distribution, so the reviewed binary and tester binary contain the same Watch app.
- Send text captures with `transferUserInfo`, audio with `transferFile`, and task/timer commands with reachable `sendMessage` plus `transferUserInfo` fallback using the same UUID. Publish the bounded latest Focus/timer snapshot with `updateApplicationContext`.
- Keep a durable Watch outbox until the iPhone acknowledges its queue write. A successful WatchConnectivity transfer alone does not acknowledge application persistence. The iPhone returns a content-free receipt containing protocol version, UUID, `kind: receipt`, and `accepted: true`.
- The iPhone native receiver validates transport input and publishes one JSON file per capture/command under `Documents/pending-captures`. It never writes task storage. Legacy Shortcuts text and Android widget completion items remain valid.
- Retain transferred AAC before returning from the native file callback. Convert it to 16 kHz mono PCM16 RIFF WAV before queue publication, following ADR 0019. The phone keeps failed transcription input for retry and removes its WAV only after durable task creation and queue removal.
- Journal native delivery by UUID. Stage queue bytes before the prepared receipt, then atomically rename the stage into the visible queue. A prepared receipt whose stage is absent records a completed publication even if JS has already consumed the queue file. Recovery must not recreate that consumed item. Compact published receipts omit task content and audio paths.
- Preserve the existing JS drain's at-least-once behavior: a crash after a task save but before queue removal can re-ingest that capture. Native delivery deduplication does not claim exactly-once task creation.
- Apply commands through existing store actions. Share one persisted, device-local phone timer between the panel and Watch bridge, using the existing linked-task and completion-alert preferences. Reject timer commands older than the last explicit timer change.

## Consequences

The Watch can capture while the phone is unreachable, but task creation and command application wait for the phone's JS ingestion path. Native receipt records consume a small amount of local storage per delivery. Focus and timer snapshots can be stale while disconnected.

Linux checks cover protocol logic, prebuild generation, channel exclusion, and TypeScript behavior. The macOS native CI job supplies compile checks; paired physical devices are required to validate background WatchConnectivity delivery, audio conversion, notifications, and haptics.

## Watch signing setup

Every Watch-enabled release archive requires two additional App Store distribution profiles:

| App ID | GitHub Actions secret |
| --- | --- |
| `tech.dongdongbh.mindwtr.watchkitapp` | `IOS_WATCH_PROVISIONING_PROFILE` |
| `tech.dongdongbh.mindwtr.watchkitapp.widgets` | `IOS_WATCH_WIDGET_PROVISIONING_PROFILE` |

Both App IDs enable App Groups and belong to `group.tech.dongdongbh.mindwtr.watch`. Generate their profiles with the existing iPhone release's Apple Distribution certificate and store each downloaded profile as base64 in its secret. The host does not need the Watch app group. Before prebuild, the CI installer verifies that each profile includes the configured signing certificate from the imported keychain, along with the team, exact App ID, group, expiration, and distribution profile type. Matching the team alone is insufficient. Unsigned native compile checks need neither profile.
