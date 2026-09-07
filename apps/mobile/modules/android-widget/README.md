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
| `QUICK_CAPTURE` | `QuickCaptureWidgetProvider` | `mindwtr_quick_capture_widget` | `QuickCapture`: 1x1, no resize |

Adding a kind: one row in `WidgetKind`, one `MindwtrWidgetProvider` subclass
(one line), one layout, one row in the plugin's `WIDGET_KINDS` table, and a
`when` branch in `WidgetRenderer.buildViews`. Rows for a list-backed kind come
from `TasksWidgetFactory`, keyed by the `EXTRA_KIND` extra on the adapter
intent.

## Tasks widget lists (#1173)

The Tasks widget reads optional payload sections and supports a list chooser.
Its default Focus projection combines Today's Focus and Today. A user's
explicit choice of Inbox, Today, Next, Waiting, Someday, or a project remains
selected across payload updates. Check-offs append queue commands for the app
to apply through the normal store; widget code never writes SQLite.

## Quick capture dialog

`QuickCaptureActivity` writes `<filesDir>/pending-captures/<uuid>.json` in the
schema `apps/mobile/lib/pending-captures.ts` (`parsePendingCapture`) reads,
through `PendingCaptureWriter` (temp file + rename), then bumps the stored
payload's `inboxCount` and redraws every widget. The tile, app shortcut,
capture notification and both widgets launch it by explicit class name.

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
