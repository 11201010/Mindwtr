# ADR 0028: How native surfaces run core commands while the app is closed

Date: 2026-09-21
Status: Proposed

## Context

Mindwtr already has a command boundary for ordinary use. `@mindwtr/core` exposes about 63 store actions (add task, update task, add project, and so on), and screens call those actions. Only four infrastructure files write the store directly: the two sync services, mobile startup, and the desktop file watcher. None of them is a screen. So "screens should call commands" is already true and is not the question here.

The open question is narrower: **how does a native surface run one of those commands when the React Native app is not running?**

The surfaces are written in Kotlin and Swift today: Android widgets, the capture window, the Quick Settings tile and the capture intent receiver; iOS widgets, App Intents and Shortcuts; the Apple Watch companion. None of them may write task storage. ADR 0026 fixed that rule for the Watch, and the same rule holds for every other surface: native code publishes one JSON file per request under `pending-captures/` (kinds today: text capture, audio capture, `complete`, `defer`, `pomodoro`), and the JS side applies it through the normal store actions, so revisions, save tracking, recurrence and sync merge behave exactly as in the app.

Until 2026-09-21 that queue was only read when the app came to the foreground. [Issue #1257](https://github.com/dongdongbh/Mindwtr/issues/1257) showed the cost: a task added from the Android app shortcut never reached the desktop until the phone app was opened. Commit `4bb48c0db` changed that on Android. **Save** in the capture window starts `CaptureSyncHeadlessService`, which wakes the JS task `MindwtrCaptureSync`; that task imports the queue through the store and runs one sync. The scheduled background sync imports the queue first as well. On a physical phone (dev build) this worked with the app in the background and with the app force-stopped, and the imported tasks were found in the SQLite file afterwards.

That run also showed the main trap. A headless JS runtime starts on core's no-op storage adapter. A store write there "succeeds", and the import would then delete the queue file: the capture would be lost. The background import therefore connects mobile storage and loads the store before its first write.

A different answer exists: move the core to Rust so Kotlin and Swift can call it directly. That has been raised together with the idea of replacing the React Native screens with Jetpack Compose and SwiftUI.

## Options

**A. A headless JavaScript command runner.** Keep the TypeScript core as the only implementation. Native surfaces keep publishing durable queue files; a small runner that needs no screen imports them through the store actions and asks for one sync. #1257 is the first instance.

- For: no second implementation of sync merge, tombstones, recurrence, revisions or storage normalization. Small change. Proven on Android with the app closed. Every core fix reaches native surfaces at once. It does not commit the project to any UI rewrite.
- Against: it has to start a JS runtime. The start cost is not measured yet on a release build; in the debug build the import finished a few seconds after Save. Android vendors (ColorOS, MIUI) can refuse background starts. Android evidence says nothing about iOS. A native surface gets no synchronous result, so it can only show an optimistic state, as the widget ring and the Inbox count already do.

**B. A Rust core callable from Kotlin and Swift.** Native surfaces, and any future native screen, call the engine in-process with no JS start.

- For: lowest latency, works where JS cannot start, and it is what a full Compose or SwiftUI app would want.
- Against: the TypeScript core is used by desktop, mobile, the cloud server and the MCP server, so this is not a mobile-only change. TypeScript and Rust would coexist for a long time, which means two implementations of the highest-risk rules. This project has repeatedly had bugs from one rule living in several places. Coding agents lower the cost of translating code; they do not prove that two merge engines behave the same.

## Decision

Propose **option A** as the way native and background surfaces run core commands. The TypeScript core stays the single authority. #1257 is treated as the first instance of this path, not as a one-off workaround.

1. **The queue file is the command request.** Native code never calls into JS with arguments and never writes task storage. It publishes a JSON item (temp file, then rename) and then asks the runner to run. The durable request exists before any JS starts, so a refused or killed run loses nothing: the next foreground or scheduled background run imports it.
2. **One drain.** `apps/mobile/lib/pending-capture-drain.ts` is the only reader. The foreground hook and every background run go through its serialized chain, so an item cannot be imported twice at once.
3. **Closed command set.** The runner applies only the item kinds that `parsePendingCapture` accepts. A new native action adds a kind there with its validation and its test. There is no generic "run this action" entry point.
4. **Guards before the first write.** Connect mobile storage when the runtime is still on the no-op adapter, flush pending saves, load the store, and refuse to write when the load reported an error, the app is visible (the foreground hook owns the queue then), the sandbox workspace is open, or a workspace transition is active. An empty queue does no work at all.
5. **Idempotent and durable.** Items carry an id (`captureId` for Android captures, UUIDs for Watch commands). A queue file is deleted only after the store write is durable (`flushPendingTaskActionSave`). A crash in between re-imports at most that one item, which the id makes harmless.
6. **One sync policy.** A run started by a user action syncs once after a non-empty import and skips the scheduled-run failure cooldown. A scheduled run imports first and then syncs as before. All runs share the background sync's single in-flight run and its deadlines.
7. **Foreground-only work stays in the foreground.** Audio needs transcription and stays queued for the app.
8. **Observable.** Each background import logs `background-capture-drain` with `trigger` and `count` (diagnostics ledger).

Where this stands on Android: the app shortcut, the widget **+** button and the tile all open the capture window, so they already share the Save trigger. Widget check-offs and the capture intent receiver start from the background, where Android refuses a service start, so they wait for the scheduled run. Next steps under this proposal: measure the release-build start cost, decide whether those two need a faster path (for example expedited WorkManager work), then investigate Apple.

### Apple platforms are not covered yet

Nothing here is verified on iOS or watchOS. Known so far: a foreground App Intent runs in the app process only when the app target carries a type of the same name; the background Shortcuts intent and the Watch receiver publish queue files (ADR 0026); widget extensions cannot host the JS runtime. The scheduled background task is shared code, so the queue import also runs there on iOS, but this has not been observed on a device. Before calling option A cross-platform, check for each of widgets, App Intents, the share extension, background tasks and the Watch whether it can trigger a run, and how soon. A surface that can neither run JS nor hand off to something that can is evidence for the list below.

### When to reopen option B

Reopen the Rust option only on evidence, not on expectation:

1. A required surface cannot start the runner or hand off to it, on any supported OS version.
2. Measured runner start time is too slow for a user-facing interaction after reasonable tuning. A few seconds is fine for a capture that already showed "added"; it is not fine for a screen.
3. Background memory, time or battery limits make the runner unreliable on supported phones.
4. A native-screen experiment (Compose or SwiftUI) shows that crossing into JS for every interaction costs more than a native-callable engine would.
5. Benchmarks on the existing large-store budgets show a latency or throughput ceiling caused by running commands in JS.
6. A plan exists in which Rust **replaces** the TypeScript core instead of living beside it, with parity tests and an owner for every high-risk rule, across desktop, cloud and MCP as well.

## Non-goals

This ADR does not decide whether the Android or iOS screens move to Compose or SwiftUI, whether `@mindwtr/core` ever moves to Rust, or anything about desktop. Those need their own evidence: a classification of recent mobile issues, and a small Compose experiment judged on architecture, maintenance cost, measured performance and platform feel. Such an experiment must write through this same path and must not write SQLite from Kotlin.

## Consequences

Native integrations get one way to cause real Mindwtr writes, and React Native can stay the main UI without blocking them. The project avoids keeping two engines for its most dangerous rules. The price is a JS start per background run, no synchronous answer to native callers, and dependence on each OS allowing a background start; where it is refused, behavior falls back to what it was before, import at the next app opening. A debug build cold-starts the headless runtime against Metro on port 8081, which matters only for testing. If the runner proves insufficient, the project will hold measurements and named platform limits to justify the larger migration.
