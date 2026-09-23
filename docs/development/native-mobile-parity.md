# Native mobile workflow parity and release evidence

Baseline: **v1.3.2**, commit **ee82a9e3e9a1d4e0c406f5ffff80e768a1f1f812**, frozen 2026-09-22. Execution order and release policy: [migration roadmap](native-mobile-migration.md).

This is the initial source-grounded inventory, not a declaration of native parity. Before closing each row, inspect the baseline behavior and split it if independently supported variants need separate evidence. Omitted baseline capabilities remain in scope. Platform availability follows released behavior, not an assumption that both platforms offer every integration.

## How to record progress

Per-platform progression: **N** not implemented/integrated → **I** implemented → **A** automatically checked → **D** device checked → **R** release ready. Stages accumulate evidence. For visual/accessibility checks, record the appropriate human check and why automation is not applicable rather than inventing a test.

**P** means related Android pilot code was reported in ADR 0029; it is not acceptance of the complete workflow. **—** means no native evidence recorded here. **N/A** requires baseline platform unavailability, not an unimplemented native feature. Applicable rows block release until verified or an intentional replacement is explicitly accepted.

Each evidence link identifies commit, artifact/core hashes, device/OS or test environment, fixture/provider/channel, date, exact check and outcome. Keep sensitive contents/credentials out of reports. Record automated and hands-on results separately; injected taps, simulator results, and existing RN tests are not physical-device native verification. Link failures to an issue, and accepted differences to a dated maintainer decision.

## Workflow inventory

Source pointers locate baseline behavior and reusable checks; they do not claim new clients pass existing tests. Paths are repository-relative and were checked at the frozen commit. Read that revision for the parity definition and the implementation revision for current behavior. Cross-cutting safety and release rows also include new migration acceptance requirements from the roadmap.

| ID | Workflow / acceptance behavior | Baseline source | Android | iOS | Automated evidence | Device evidence | Blocker / approved difference |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F01 | Open/load/restart; valid empty library; failed/partial reads write nothing | `apps/mobile/lib/storage-adapter.ts` | N | N | — | — | Pending |
| F02 | Settings, workspace, device-local preferences and secure credentials survive upgrade | `apps/mobile/lib/workspace-session-storage.ts`; `apps/mobile/lib/secure-config.ts` | N | N | — | — | Pending |
| F03 | Query windows/counts/revisions and durable acknowledgments match core semantics | `packages/core/src/storage.ts` | N | N | — | — | Pending |
| W01 | Inbox capture, natural-language preview and processing into next actions | `apps/mobile/app/capture-modal.tsx`; `apps/mobile/components/QuickAddPreview.tsx` | N (pilot P) | N | — | — | Pending |
| W02 | Editor fields, cancel/save, interrupted drafts and truthful failure handling | `apps/mobile/components/task-edit-modal.tsx`; `apps/mobile/components/task-edit/` | N (pilot P) | N | — | — | Pending |
| W03 | Focus membership/sections, counts, ordering, filters and large-list windows | `apps/mobile/app/check-focus.tsx`; `apps/mobile/components/task-list.tsx` | N (pilot P) | N | — | — | Pending |
| W04 | Date-only versus timed start/due dates; timezone/DST and overdue behavior | `apps/mobile/components/task-edit/use-task-edit-dates.ts` | N | N | — | — | Pending |
| W05 | Recurrence, custom rules, next occurrence after completion and undo | `apps/mobile/components/task-edit/TaskEditCustomRecurrenceModal.tsx` | N | N | — | — | Pending |
| W06 | Notes/Markdown, checklists, links and editor preview | `apps/mobile/components/task-edit/TaskEditContentField.tsx`; `apps/mobile/components/task-edit/TaskEditViewTab.tsx` | N | N | — | — | Pending |
| W07 | Complete/undo; move/archive/delete/restore without unintended child deletion | `packages/core/src/store-projects.ts`; `packages/core/src/undo-project-delete.ts` | N | N | — | — | Pending |
| W08 | Projects/sections: next actions, status, ordering, deferred and archived projects | `apps/mobile/app/(drawer)/projects-screen.tsx`; `apps/mobile/components/views/deferred-projects-section.tsx` | N | N | — | — | Pending |
| W09 | Areas: create/edit/filter; deletion preserves tasks/projects | `apps/mobile/components/mobile-area-switcher.tsx`; `packages/core/src/area-utils.ts` | N | N | — | — | Pending |
| W10 | Contexts/tags and Waiting/Someday organization | `apps/mobile/components/views/contexts-view.tsx`; `apps/mobile/components/views/waiting-view.tsx`; `apps/mobile/components/views/someday-view.tsx` | N | N | — | — | Pending |
| W11 | Global search across supported entities; filters and sorting | `apps/mobile/app/global-search.tsx`; `apps/mobile/lib/task-list-sort.ts` | N | N | — | — | Pending |
| W12 | Bulk selection and supported multi-task actions | `apps/mobile/components/task-list/TaskListBulkBar.tsx` | N | N | — | — | Pending |
| W13 | Daily review, mind sweep, weekly review and progress/restoration | `apps/mobile/app/daily-review.tsx`; `apps/mobile/app/mind-sweep-modal.tsx`; `apps/mobile/app/weekly-review.tsx` | N | N | — | — | Pending |
| W14 | Calendar views, scheduling and recurrence presentation | `apps/mobile/components/views/calendar-view.tsx` | N | N | — | — | Pending |
| W15 | Board view and status movement | `apps/mobile/components/views/board-view.tsx` | N | N | — | — | Pending |
| W16 | Pomodoro lifecycle, interruption and restoration | `apps/mobile/lib/pomodoro-controller.ts`; `apps/mobile/lib/pomodoro-session.ts` | N | N | — | — | Pending |
| S01 | WebDAV: authorization, push/pull, conflict/retry, offline/reconnect | `apps/mobile/lib/sync-service.ts`; `apps/mobile/lib/attachment-sync-backends/webdav.ts` | N | N | — | — | Pending |
| S02 | Dropbox: authorization refresh/reconnect and sync | `apps/mobile/lib/dropbox-auth.storage.test.ts`; `apps/mobile/lib/attachment-sync-backends/dropbox.ts` | N | N | — | — | Pending |
| S03 | Self-hosted/cloud sync: configuration, authorization, conflict/retry | `apps/mobile/lib/sync-service.ts`; `apps/mobile/lib/attachment-sync-backends/cloud.ts` | N | N | — | — | Pending |
| S04 | File sync: access grants/bookmarks, locking and interrupted writes | `apps/mobile/lib/storage-file.ts`; `apps/mobile/modules/sync-path-bookmarks/`; `apps/mobile/modules/sync-file-lock/` | N | N | — | — | Pending |
| S05 | CloudKit account/container compatibility, sync and attachment delivery | `apps/mobile/modules/cloudkit-sync/`; `apps/mobile/lib/attachment-sync-backends/cloudkit.ts` | N/A | N | — | — | Pending |
| S06 | Encryption enable/disable, credentials, locked/incorrect-secret behavior | `apps/mobile/lib/storage-file-encryption.ts` | N | N | — | — | Pending |
| S07 | Mixed RN/native/desktop edits, deletion/restore and repeated convergence | `apps/mobile/lib/sync-service.ts`; `packages/core/src/` | N | N | — | — | Pending |
| S08 | Edits during merge, stale results, failure/retry and durable reload; responsive UI | `apps/mobile/lib/sync-service.runtime.test.ts` | N | N | — | — | Pending |
| D01 | Attachments/files: add/open/download/delete, missing bytes, retry, restart and sync | `apps/mobile/lib/attachment-sync.ts`; `apps/mobile/modules/attachment-file-installer/` | N | N | — | — | Pending |
| D02 | Import/export, backup/restore and failed/cancelled transfers | `apps/mobile/components/settings/use-sync-settings-backup-actions.ts`; `packages/core/src/backup-transfer.ts` | N | N | — | — | Pending |
| I01 | Reminders, permission changes, notification actions, reschedule/cancel after edits | `apps/mobile/lib/notification-service.ts`; `apps/mobile/modules/notification-open-intents/` | N | N | — | — | Pending |
| I02 | External calendar read/push, permissions and disabled behavior | `apps/mobile/lib/external-calendar.ts`; `apps/mobile/lib/calendar-push-sync.ts` | N | N | — | — | Pending |
| I03 | Android widget/quick capture while closed; durable queue and exact delivery | `apps/mobile/modules/android-widget/`; `apps/mobile/lib/pending-capture-drain.ts` | N | N/A | — | — | Pending |
| I04 | Android capture intents, persistent capture notification and automation | `apps/mobile/components/settings/android-capture-intent-section.tsx`; `apps/mobile/modules/context-automation/`; `apps/mobile/lib/persistent-capture-notification.ts` | N | N/A | — | — | Pending |
| I05 | iOS widgets, Siri/Shortcuts and closed-app capture delivery | `apps/mobile/modules/ios-widget/`; `apps/mobile/modules/ios-siri-actions/` | N/A | N | — | — | Pending |
| I06 | Watch capture/actions/audio, queued delivery, reconnect and deduplication | `apps/mobile/modules/watch-connectivity/`; `apps/mobile/lib/watch-audio.ts` | N/A | N | — | — | Pending |
| I07 | System search, deep links and safe routing to existing/missing tasks | `apps/mobile/modules/app-search/`; `apps/mobile/modules/apple-task-search/`; `apps/mobile/lib/capture-deeplink.ts` | N | N | — | — | Pending platform inventory |
| I08 | Voice/audio capture, transcription and optional AI configuration/actions | `apps/mobile/components/use-quick-capture-audio.ts`; `apps/mobile/components/settings/ai-settings-screen.tsx` | N | N | — | — | Pending platform inventory |
| I09 | Apple on-device AI/image capture; supported-device checks and unavailable behavior | `apps/mobile/modules/apple-foundation-models/`; `apps/mobile/modules/apple-image-capture/` | N/A | N | — | — | Pending |
| U01 | General/GTD/appearance settings, optional features, defaults and customization | `apps/mobile/components/settings/general-settings-screen.tsx`; `apps/mobile/components/settings/gtd-settings-screen.tsx`; `apps/mobile/components/settings/manage-settings-screen.tsx` | N | N | — | — | Pending |
| U02 | Sandbox isolation/switching; no accidental live sync or fixture seeding | `apps/mobile/components/settings/sandbox-settings-screen.tsx` | N | N | — | — | Pending |
| U03 | Supported translations, locale loading, sorting and date/number formats | `packages/core/src/` | N | N | — | — | Pending |
| U04 | Screen readers, large text, focus order, keyboard/insets, contrast and touch targets | `apps/mobile/components/`; `apps/mobile/modules/android-window-layout/` | N | N | — | — | Pending |
| U05 | Phone/tablet/iPad layouts, rotation, process death, lifecycle and navigation | `apps/mobile/app/_layout.tsx`; `apps/mobile/modules/ios-scene-lifecycle/` | N | N | — | — | Pending |
| U06 | Diagnostics/support, feedback and relevant store/update prompts | `apps/mobile/components/settings/about-settings-screen.tsx`; `apps/mobile/modules/play-store-updates/` | N | N | — | — | Pending platform inventory |
| R01 | Play old install → native beta/release → tested forward recovery | `apps/mobile/app.config.ts`; `.github/workflows/release-android.yml` | N | N/A | — | — | Pending |
| R02 | F-Droid old install → native → recovery; correct update recommendation | `.github/workflows/release-android-foss.yml` | N | N/A | — | — | Pending |
| R03 | Direct APK old install → native → recovery with matching signing | `.github/workflows/release-android.yml` | N | N/A | — | — | Pending |
| R04 | App Store → TestFlight/native → recovery; extensions/credentials intact | `.github/workflows/release-ios-appstore.yml` | N/A | N | — | — | Pending |
| R05 | Physical-device budgets: launch, lists, editor/save, memory, sync-busy interaction | `docs/performance/budgets.md`; `docs/adr/0029-native-clients-host-the-typescript-core.md` | N | N | — | — | Pending |

## Release decisions

Record actual dates and evidence as milestones close; no native release is approved by this initial checklist.

| Platform/channel | Beta entry | Required parity / RC | Upgrade + recovery | Promotion decision | Full rollout | Stabilization / RN retirement |
| --- | --- | --- | --- | --- | --- | --- |
| Android / Play | Pending | Pending | Pending | Pending; manual controller gap | — | — |
| Android / F-Droid | Pending | Pending | Pending | Pending; build/update metadata | — | — |
| Android / direct APK | Pending | Pending | Pending | Pending; explicit artifact promotion | — | — |
| iOS / App Store + TestFlight | Pending | Pending | Pending | Pending; native archive and tester assignment | — | — |

No fixed tester quota applies. Coverage gaps remain visible even when observation periods elapse. Complete channel decisions independently, retain old-client sync compatibility, and apply the roadmap's per-platform stabilization threshold before retiring the RN release path.
