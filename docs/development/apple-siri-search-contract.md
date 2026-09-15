# Apple Siri and task-entity contract

This document records the implemented read-only contract and the remaining
requirements for issue #915. It does not declare Mindwtr conformant with the
Reminders App Schema.

## Current read-only entity

`MindwtrTaskEntity` is backed by the app-maintained shortcuts snapshot. Native
code never reads SQLite. Snapshot version 2 provides:

- a stable task ID and exact `mindwtr://open?task=<encoded-id>` link;
- display title, list/project label, due date, and start date;
- a generation timestamp;
- eligible, published, and omitted counts for each list, each published project,
  project groups, and unique tasks.

The React Native publisher includes version and coverage in its fingerprint,
so crossing a cap still publishes changed omission metadata when the visible
IDs stay unchanged. A successful App Group write records
`v1.3.1/apple-task-snapshot` with aggregate counts only. It does not claim the
later Core Spotlight launch reindex succeeded.

Native queries preserve the caller's identifier order. Duplicate titles never
act as identity. The entity validates a snapshot link against the same task ID
and falls back to a newly constructed exact-ID link if the stored URL is absent
or malformed. Missing and duplicate project names produce distinct dialogs.
Get Tasks reports a snapshot older than 24 hours. Its boundedness dialog uses
the requested list's omission count or the matched project's own omission
count; another list/project projection cannot mask that query's omissions. An
older snapshot without query-specific coverage reports possible omissions when
it returns the 50-item cap. Snapshot results are not a full-store answer.

Spotlight currently performs clear-and-replace indexing when the app launches.
React Native can refresh the snapshot later without triggering a new index, so
Spotlight can remain stale until the next launch. The consuming app revalidates
every returned ID against current hydrated state before opening a task.

## Why App Schema mutation is deferred

Apple's Reminders domain defines schema-backed intents and entities. Its
`createReminder` contract includes a title plus optional list, note, flag,
images, tags, URLs, due date, recurrence, location trigger, and section, and it
returns the created reminder entity. A conforming Mindwtr intent must therefore
know that the mutation reached the normal store and must return the resulting
stable entity.

The existing background capture intent only appends a pending-capture command.
The app drains that command later. Queue acceptance is not durable task
creation, and the extension cannot observe the task ID or a save failure.
Advertising this path as `createReminder` would report success too early.

Upstream commit `09276a308` adds a separate, reusable Siri evaluation
transport under `apps/mobile/modules/ios-siri-actions`. Its bounded App Group
store supports versioned create/update/delete request envelopes, expiry,
claim-and-replay behavior, cancellation before claim, persisted/rejected
receipts, bounded receipt retention, derived snapshot publication, and a
process-scoped access gate. The Expo bridge exposes claim, acknowledge,
snapshot publication, and access control to React Native. Swift package tests
exercise the store contract.

That transport is infrastructure, not a completed App Schema implementation.
No schema intent uses it, no React Native consumer in that commit applies its
requests through Mindwtr's core and durable-save path, and no schema intent
waits for a receipt and returns the resulting entity. It also does not change
the older pending-capture intent's queue-only success boundary. The transport
should be integrated and extended rather than duplicated.

No schema-backed create, update, complete, reopen, or delete intent is included
in this change. Existing custom capture and read-only query behavior stays in
place behind its current compiler and runtime availability guards.

## Required mutation completion protocol

A future schema-backed write can use the existing Siri action transport, while
preserving React Native as the single writer. Completion still requires:

1. Native code atomically enqueues the transport's bounded command with a
   random ID, operation, target stable ID when applicable, expected revision
   token, normalized payload, creation time, and expiry. It never writes the
   database.
2. React Native claims and replays commands idempotently and passes them through the same
   core factories, normalization, recurrence, sync, and validation paths used
   by the app.
3. React Native completes the ordinary durable-save boundary before calling
   the transport acknowledgement API. A persisted receipt includes the
   resulting bounded task projection; a rejected receipt carries a structured
   reason.
4. A schema intent waits for the matching stored receipt only for a bounded interval. It
   returns a schema entity only for a successful durable receipt. Timeout,
   cancellation, lock state, ambiguity, and failed saves surface as failure;
   none may be presented as a completed mutation.
5. Retried intents reuse their command ID and consume the transport's retained
   receipt rather than creating duplicate tasks.
6. The app wires the transport's process-scoped access gate to current hydrated
   and unlocked state. Destructive and bulk changes retain normal confirmation
   rules.

This protocol needs crash, duplicate-delivery, cancellation, save-failure,
locked-app, and sync-convergence tests before any schema conformance is added.

## Semantic mapping boundary

The safe initial mapping is narrow: a Mindwtr task can represent a reminder,
and stable task identity can back the schema entity. A project may map to a
reminder list only after list membership and lifecycle semantics are verified.
Mindwtr areas, GTD statuses, focus state, start dates, waiting context, and
project hierarchy must not be relabeled as reminder priority, recurrence,
sections, collaboration, or location triggers. Unsupported schema fields stay
unset until the product has matching behavior.

## Native validation still required

Linux checks source contracts and JavaScript behavior, but cannot compile App
Intents metadata. On the selected Apple toolchain, run:

```sh
node scripts/ci/validate-ios-app-intents-availability.js
bun test apps/mobile/plugins/ios-widgets-and-shortcuts.test.js
APP_VARIANT=development bunx expo prebuild --clean --platform ios --no-install
xcodebuild -workspace apps/mobile/ios/Mindwtr.xcworkspace -scheme Mindwtr \
  -configuration Release -sdk iphoneos CODE_SIGNING_ALLOWED=NO archive
```

Then use Apple's App Intents testing tools, Shortcuts, Spotlight, and Siri on a
supported device. Verify exact IDs, missing/deleted tasks, duplicate project
names, stale snapshots, capped snapshots, locked state, and removal after a
task becomes ineligible.

## Apple sources

- [Reminders App Schema domain](https://developer.apple.com/documentation/appintents/app-schema-domain-reminders)
- [Reminders createReminder](https://developer.apple.com/documentation/appintents/appschema/remindersintent/createreminder)
- [Develop for Shortcuts and Spotlight with App Intents](https://developer.apple.com/videos/play/wwdc2026/240/)
