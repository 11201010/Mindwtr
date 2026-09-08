# android-widget

Native Android home-screen widgets, the floating quick-capture dialog, and the
opt-in automation capture receiver.
Every widget string comes from the payload `apps/mobile/lib/widget-service.ts`
publishes (`AndroidTasksWidgetPayload`) into SharedPreferences
`mindwtr_widget` / `payload`; Kotlin only lays it out.

## Kinds

| Kind | Provider | Layout | Plugin table row (`plugins/android-widget.js` `buildWidgetKinds`) |
|---|---|---|---|
| `TASKS` | `TasksWidgetProvider` | `mindwtr_widget` | `Tasks`: 3x2, resizable, preview PNG |
| `COMPACT` | `CompactWidgetProvider` | `mindwtr_compact_widget` | `Compact`: 2x2, resizable, simple-style preview PNG |
| `QUICK_CAPTURE` | `QuickCaptureWidgetProvider` | `mindwtr_quick_capture_widget` | `QuickCapture`: 1x1, no resize |

Adding a kind: one row in `WidgetKind`, one `MindwtrWidgetProvider` subclass
(one line), one layout, one row in the plugin's `buildWidgetKinds` table, and a
`when` branch in `WidgetRenderer.buildViews`. Rows for a list-backed kind come
from `TasksWidgetFactory`, keyed by the `EXTRA_KIND` extra on the adapter
intent.

## Tasks widget lists (#1173)

The Tasks widget reads optional payload sections and supports a list chooser.
Its default Focus projection combines Today's Focus and Today. A user's
explicit choice of Inbox, Today, Next, Waiting, Someday, or a project remains
selected across payload updates. Check-offs append queue commands for the app
to apply through the normal store; widget code never writes SQLite.

## Compact widget

The optional Compact style uses native RemoteViews with the simple v1.2.8
layout: a 13sp title, 10sp Inbox count, flat 12sp task rows, and a capture
button pinned below the scrollable list. It always shows the shared Focus
projection, without list selection, section headings, metadata, or inline
checkboxes. Task taps open the existing native detail sheet. Capture opens
`QuickCaptureActivity` over the launcher and durably queues the new task
without opening the main app. Both styles share the payload, theme, refresh,
and pending-capture paths; no React Native widget rendering dependency is used.

## Picker previews

The config plugin builds each `previewLayout` from its real native layout,
with sample task rows replacing the live collection. Each kind also has its
own `assets/images/widget-*-preview.png` fallback for launchers that use only
`previewImage`. These PNGs are rendered from the native sample layouts; update
them when changing widget layouts. Do not reuse the retired React Native
widget screenshot for the native kinds.
Picker names/descriptions for Compact use Android locale resources. Preview
sample content is intentionally static English demonstration data, including
the bitmap fallback; it is not a live localized task list. Placed widgets and
their capture dialogs use the app's localized payload as usual.

## Quick capture dialog

`QuickCaptureActivity` writes `<filesDir>/pending-captures/<uuid>.json` in the
schema `apps/mobile/lib/pending-captures.ts` (`parsePendingCapture`) reads,
through `PendingCaptureWriter` (temp file + rename), then bumps the stored
payload's `inboxCount` and redraws every widget. The tile, app shortcut,
capture notification and all three widgets launch it by explicit class name.

When speech-to-text is enabled in the app, the dialog also shows a microphone
button. Recording uses the existing microphone permission only while the native
dialog is visible, with a five-minute limit. It writes a 16 kHz mono PCM16 WAV
under `<filesDir>/quick-capture-audio/`, then atomically queues an `audio` JSON
item with the same UUID. No main activity, background microphone service, or
database write is involved. Save confirms the recording is queued, not that a
task has already been transcribed. The app's startup/foreground drain uses the
configured transcription provider (local Whisper on F-Droid), retains failed
captures for retry, and removes the queue item and WAV only after durable task
creation. Replaying a capture after an exhausted storage retry must persist the
existing task before acknowledging it, without creating a duplicate or changing
its revision. Explicit Cancel discards the unsaved draft; leaving during
recording stops the microphone and queues the usable recording.

Recordings already in the pending queue do not expire. Unqueued temporary or
orphan WAV files left by an interrupted process are removed on a later native
capture open only after seven days; active drafts and queued files are excluded.
The native writer preserves the `Context.filesDir` URI spelling used by Expo
while separately validating canonical file ownership. The JavaScript resolver
also supports React Native's URL implementation, which omits credential fields
for file URLs.

## Automation capture intent (#1149)

`CaptureIntentReceiver` accepts the explicit action
`tech.dongdongbh.mindwtr.action.CAPTURE` with string extras `text` and `token`.
It is off by default. Enabling it creates a random 256-bit token in an
`AtomicFile` under `noBackupFilesDir`, outside app backup and Mindwtr sync;
disabling deletes the token, and enabling again creates a new one.

The exported receiver validates the exact action, types, nonblank text,
2,000-character limit, and token before publishing one atomic queue file with
source `android-capture-intent`. It never launches the app, uses the network,
or writes SQLite. The normal pending-capture drain creates the Inbox task when
Mindwtr next starts or foregrounds, then deletes the queue file only after the
store save is durable.
