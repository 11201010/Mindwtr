# Native mobile migration: implementation and release roadmap

Planning date: 2026-09-22. Architecture: [ADR 0029](../adr/0029-native-clients-host-the-typescript-core.md), Accepted.

**Direction is decided; implementation and release readiness are not claimed.** This roadmap records the execution strategy. The observation periods, rollout percentages, and retirement thresholds below are proposed maintainer policies, not store requirements or completed gates.

## 1. Strategy and scope

Build native Android (Kotlin/Compose) and iOS/iPadOS (Swift/SwiftUI) incrementally around the shared TypeScript core. Keep the current React Native clients in production during development. Each user's eventual update replaces the whole mobile implementation through the existing app identity and listing. Develop in small reviewed changes; release to increasing populations after readiness checks. A production mixture of alternating RN/native screens is not the migration strategy.

Android and iOS have independent readiness decisions. Android may lead, but neither must wait for the other's release. Avoid overlapping their first production rollouts. Desktop/Tauri, cloud, and MCP continue working. A Rust rewrite, macOS desktop rewrite, fundamental database/sync redesign, and duplicate store listings are outside this migration.

Freeze capability scope at **v1.3.2**, commit **ee82a9e3e9a1d4e0c406f5ffff80e768a1f1f812**. The [parity checklist](native-mobile-parity.md) records workflows and evidence. This freezes product scope, not dependency or bug-fix revisions: integrate subsequent correctness/security fixes and record the tested source revision. Missing an existing supported capability from the initial inventory does not silently remove it from scope. Approve and document intentional replacements; pixel-identical UI is unnecessary.

### Current evidence and limits

- ADR 0029 records an Android pilot with Inbox, editor, and Focus on local branch `experiment/gate2-native-android`, reviewed at `6c74a67e9`. It is not a complete client or a production release. Its injected taps, simplified collation, and partial workflow coverage do not establish hands-on or language readiness.
- The pilot is not integrated into the main checkout. Bring reviewed pieces into `apps/android-native/` through small changes, not one final rewrite merge.
- The proposed full Apple client belongs in `apps/ios-native/`. Existing `apps/mobile/ios-native/` contains support code for the RN app; it is not the new SwiftUI application.
- The Mac mini enables Apple builds and simulator work. Physical iPhone validation remains required. Android measurements do not prove Apple readiness.
- Existing Native Platform CI checks the current mobile implementation. Building the new clients, upgrade tests, and their distribution artifacts must be added explicitly.

## 2. First work and ownership

Use three bounded lanes, with one owner of the host contract and fixture expectations. These are responsibilities, not a requirement to run three agents or hire three people. Android can inform the API slightly ahead of Apple; neither platform defines its own task policy.

| Order / owner | First deliverable | Acceptance before expanding |
| --- | --- | --- |
| 1. Shared contract/core | Versioned commands, queries, row summaries, section counts, revisions, windowing, errors, and durable-save acknowledgment; shared fixtures and task metadata | Both hosts can consume the same meanings; membership, ordering, dates, recurrence, parsing, and status/priority definitions remain in core |
| 2a. Android | Integrate reviewed pilot; remove obsolete regex rewrite after core fix `da57df2ef`; remove Kotlin date/status/priority policy; consume windowed API | Inbox/create/complete/edit persists across restart; no benchmark seeding in replacement builds; actual locale services replace the stand-in |
| 2b. Apple | Persistent SwiftUI project and serial JavaScriptCore host off the UI thread; Inbox/create/complete on disposable simulator | Same contract/fixtures, storage failure behavior, locale loading, and restart checks; reproducible development build |
| Alongside 1–2. Upgrade safety | Inventory old-client storage/identities and seed disposable installations using the actual released client | First replacement-install test preserves data/settings and writes nothing on failed or partial load |
| Separate shared change | Resolve merge-induced interaction blocking, keeping one authoritative store/persistence owner | Measured tap-to-result behavior plus overlapping-edit, stale-result, failed-write, and restart checks; no relaxation of correctness |

Windowed results need stable IDs, result revisions, counts, bounded prefetching, and invalidation when membership/order changes. Fetch the full task for editing. Do not serialize the whole library on each scroll or duplicate the store in Swift/Kotlin. Load translations before asking the translator to render. Validate numeric, accented, and normalization-sensitive ordering against production locale behavior.

Keep the existing shared Focus improvements. Review scheduling/concurrency separately from fingerprint/derivation optimizations so stale snapshots cannot erase edits. Being off the UI thread alone does not make a busy single engine responsive.

## 3. Milestones

| Milestone | Work | Exit evidence |
| --- | --- | --- |
| M1: foundation and upgrade safety | Contract and host ports; Android cleanup; Apple host; CI builds; signing/version inventory; initial replacement harness | Both hosts query, mutate, persist, and restart on fixtures; valid empty installs work; failed/partial reads cannot write; initial old-install upgrade preserves data/settings |
| M2: everyday workflows | Inbox/capture → editor → Focus → projects/areas → search/filter/sort → daily/weekly review; dates, recurrence, checklists, notes, completion/undo, move/archive/delete/restore | Maintainer can finish representative daily and weekly routines; automated checks and hands-on evidence recorded per workflow |
| M3: remaining parity and integrations | Complete all baseline workflows, supported sync providers, attachments, import/export/backup, settings, optional features, notifications/calendar, widgets/intents/Watch | Every required checklist row implemented, differences explicitly accepted; translations, accessibility, layouts, drafts, and restoration included |
| M4: replacement beta and RC | Actual signed-channel upgrades, mixed-client sync, failure/recovery checks, physical-device use, public opt-in beta | Per-platform production gates below all satisfied; forward recovery rehearsed |
| M5: production rollout | Independently promote each platform/channel through existing listings, with reviewed promotion controls | Supported channels have their recorded promotion decision; no unresolved blocker |
| M6: stabilize and retire | Fix regressions; retain recovery capability; remove obsolete RN pieces only when safe | Stabilization threshold met per platform; shared RN stack removed only when neither platform/channel needs it |

Start accessibility, localization, restoration, and unsaved drafts in M2, while building each workflow. Reuse native widgets, capture queues, Siri/Shortcuts, and Watch code; validate their delivery and persistence through the new host. A working foreground engine does not prove extensions or background execution work.

Local alpha testing starts during M1/M2. Replacement beta may start before all optional parity work is finished, but only after the entry gate below; all required parity must pass before production.

## 4. Development and beta distribution

**Reuse the existing Play and App Store Connect records. No second store product. No fixed tester quota.**

| Stage | Android | Apple |
| --- | --- | --- |
| Local alpha | Retain the isolated pilot/development ID; install APK directly, no Play listing | Disposable simulators with existing bundle ID; no second App Store Connect record. Separate development identity only if side-by-side physical installs are needed |
| Replacement beta | Existing app identity, correct channel signing, coordinated version code; public Play open testing when suitable | Existing app identity/entitlements; explicit external Native Beta TestFlight group, then public invitation link after review |
| Production | Existing listing and channel-specific signed artifacts | Existing App Store listing and production signing/entitlements |

Local alpha uses disposable/generated data and separate storage, credentials, containers, and sync destinations. Sync to live destinations is disabled by default. A copied database does not authorize writing to its original cloud destination. Remove fixture seeding/reset hooks from production-identity beta/release paths.

Public replacement-beta entry gate: actual old-install upgrade and recovery checks pass; daily workflows are usable; no known data-loss, corruption, false-save, or startup blocker; missing capabilities are disclosed and acceptable to explicit volunteers. Provide backup and recovery instructions before installation. TestFlight replaces the installed App Store app; testers are not receiving a sandbox. [TestFlight installation behavior](https://testflight.apple.com/).

A large closed cohort is not required. Maintainer checks come first, then public opt-in beta. A few early volunteers are useful when available. Release decisions use verified coverage, not enrollment counts or silence. Seek targeted feedback for missing device/provider/workflow coverage; do not silently waive critical checks because recruitment is small.

Play permits **one open-testing track**. If it already serves RN beta users, announce and coordinate its transition; it cannot also be an independently selectable second open native track. Do not upload an incomplete replacement and assume the track name provides fresh consent. Until the transition is suitable, keep native testing local or in an explicit closed cohort. Coordinate version codes across RN production, native beta, and emergency releases: the highest eligible compatible version matters. [Play testing and version eligibility](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en).

Use external TestFlight testers and a dedicated group/public link; community testers need no App Store Connect administrative access. Check existing automatic build assignment and public links so the normal RN beta audience is not unexpectedly moved. [Apple external testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/).

Proposed observation policy: two weekly-review cycles in opt-in beta, then at least seven days on an RC with no unresolved release blocker. These intervals do not replace coverage. Material fixes repeat affected checks and the affected RC observation period; sparse observations remain explicitly uncertain.

## 5. Upgrade compatibility and recovery

Inventory actual production conventions before replacing their adapters:

- Application/bundle and extension IDs, per-channel signing/lineage, version/build numbering, entitlements, App Groups, keychain access groups, CloudKit containers, and provider authorizations.
- Database location/schema and transaction/durability behavior; attachment bytes and references; pending captures, queued work, unsynced edits, and tombstones.
- Preferences and workspace/session selection; synced versus device-local settings; Expo/RN secure-storage item names, attributes, encoding, and access behavior.
- Notification IDs, permissions, pending reminders, deep links, widget queues, Watch delivery, file bookmarks/grants, and calendar integration.

Preserve the first native releases' data/sync contract. Any necessary credential/settings adapter is explicit, versioned, repeatable, and tested on interruption/retry. The native UI invokes core commands; native storage ports implement core-requested IO without adding a second domain writer.

Use actual old-client disposable installs to test: clean install; local-only unsynced work; encrypted/provider-authorized libraries; native update; restart; mixed RN/native/desktop sync; attachments; denied permissions; offline/reconnect; interrupted writes and initialization. Include partially unreadable data, not just thrown reads and valid empty databases. A failed load must never become an empty snapshot saved over existing data.

Before first native writes, create and validate a consistent local recovery checkpoint covering the necessary database and non-database state. Use transaction/backup-aware SQLite handling, not an arbitrary copy of a live database that omits WAL state. Keep sensitive checkpoints local/protected; validate adapters without logging secret values. Prove behavior if checkpoint creation fails before proceeding with migration writes.

Same identity alone is insufficient. Verify each Android channel's certificate or valid signing lineage and version eligibility; a debug APK cannot replace a differently signed Play installation. Verify Apple container and credential access through actual entitlements and signing. [Android update requirements](https://developer.android.com/google/play/app-updates).

Retain a buildable RN recovery release temporarily. Rehearse RN → native → a **newer versioned** recovery build where backward data compatibility permits, including edits created after the native upgrade. Otherwise the rehearsed path must be a fixed native build. Do not rely on uninstall/reinstall, downgrades, or the legacy JavaScript update channel for recovery.

On a serious regression: pause/halt further distribution, preserve evidence, assess local and propagated sync effects, and publish the tested forward fix. A stale backup is last-resort recovery because restoring it can discard later work. A rollout halt leaves already-updated users on that build; a 1% sync defect can affect other devices. Apple requires a new version rather than reverting the released version. [Play rollout controls](https://support.google.com/googleplay/android-developer/answer/6346149?hl=en), [Apple new-version guidance](https://developer.apple.com/help/app-store-connect/update-your-app/create-a-new-version/).

## 6. Production promotion and CI gaps

Record platform and channel readiness separately. Do not use a successful build or one store's approval as approval for all channels.

| Channel | Proposed promotion policy | Required work before first native promotion |
| --- | --- | --- |
| Google Play | Manual 1% → 5% → 10% → 25% → 50% → 100%; initially 24–48 hours per early step, longer for sparse evidence | Native artifact selection, exact version targeting, coordinated version codes, and a tested manual promotion hold/controller |
| App Store | Phased automatic updates: 1%, 2%, 5%, 10%, 20%, 50%, 100% over seven days; pause on blockers | Native archive/signing/upload path, correct group assignment, reviewed submission and phased-release controls |
| F-Droid | Explicit beta/recommended-version promotion, independent of Play | Native build recipe, signing/channel upgrade check, update detection and recommended-version metadata reviewed before tagging |
| Direct APK | Explicit opt-in prerelease, then deliberate stable artifact promotion | Correct channel signing, upgrade/recovery evidence, artifact naming and updater eligibility verified |

Apple's percentages apply to automatic updates; anyone can manually download the public version. It must already satisfy release gates at the first phase. [Apple phased releases](https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases/). A public APK is immediately available to eligible users; it has no percentage exposure control. A GitHub prerelease label alone does not prove F-Droid/update automation will ignore it. [F-Droid metadata](https://f-droid.org/docs/Build_Metadata_Reference/).

**Current automation does not implement the proposed Play policy.** [Store rollouts](store-rollouts.md) currently starts Play at 5% and advances 20% → 50% → 100% on a daily schedule. Its controller rejects off-schedule percentages, including 1%, 10%, and 25%. `RELEASE_ROLLOUT_MODE=staged` is not a manual hold. Before native launch, implement and verify a target-version-specific hold/manual path and matching publication inputs. Keep unrelated Microsoft and ordinary release behavior intact. This roadmap does not change live automation.

Explicitly select native versus RN build sources and beta audiences in release workflows. The existing iOS `testflight_group` default is `external_testing`; do not treat it as Native Beta. Confirm multi-platform RC/release orchestration cannot accidentally publish unfinished native artifacts or replace an existing beta audience. Tagging/promotion is a deliberate release operation, not a side effect of merging native source.

For CI, reuse shared domain tests and add contract/host tests and affected native build/UI checks as each client lands. Run actual upgrade/recovery suites for RCs. Keep trusted Apple work on the configured Mac runner and hosted checks where currently required; select supported Xcode versions explicitly. Xcode Cloud can later archive the persistent SwiftUI project if useful, but neither CI vendor nor a faster runner is a release-readiness criterion. See [Mac CI](../macmini-ci.md).

Record commit, core bundle and app artifact hashes, contract/schema versions, engine/compiler settings, device/OS/fixture identity, symbols, and reproduction commands with evidence. Existing [performance budgets](../performance/budgets.md) contain core/render checks; they are not complete native interaction budgets. Define reviewed physical-device thresholds before measuring launch-to-usable-screen, tap-to-result, durable-save acknowledgment, scroll behavior, memory, and interaction during sync. Keep simulator, synthetic core, and physical-device results separate. Do not weaken budgets to declare success.

Use opt-in diagnostics, available store crash reports, and explicit feedback. Future complicated implementation changes follow the existing diagnostics ledger policy; log path execution and failures without task text, credentials, or attachment contents. Sparse metrics do not establish safety.

## 7. Definition of done

### Ready for one platform's first production rollout

- Every required parity workflow is verified on that platform, including its supported languages, device/OS categories, accessibility, and integrations. Intentional replacements have explicit maintainer acceptance.
- Actual channel upgrades preserve local-only/unsynced data, settings, credentials, pending work, and attachments. Mixed-version sync and forward recovery pass.
- No known unresolved data loss, corruption, false-save acknowledgment, startup failure, or core-workflow blocker. Smaller issues have severity and documented disposition.
- Physical-device interaction budgets pass, including the known merge-induced stall; persistence and overlapping-edit correctness remain intact.
- Opt-in beta and RC evidence/observation requirements are met. There is no tester-count requirement and no assumption that silence is success.
- Signed artifacts, symbols, channel-specific promotion controls, backup/recovery instructions, diagnostics, and support ownership are ready. The maintainer records the platform release decision and remaining nonblocking issues.

### Migration complete

Both native clients are supported production implementations across their supported channels, with stabilization complete. Proposed retirement threshold per platform: **at least 30 days after full rollout and two successful stable native maintenance releases**, whichever takes longer, with no unresolved release blocker and a tested recovery path.

Retire Android RN independently when safe, but retain shared RN infrastructure while iOS needs it (and vice versa). Remove obsolete UI/runtime/release infrastructure only after neither platform/channel depends on it. Preserve reusable Kotlin/Swift integrations. Keep versioned compatibility fixtures for older installed clients beyond source retirement: 100% rollout does not mean every device updated.

After native beta starts on a platform, limit major legacy presentation changes; continue data-safety, security, crash, and essential OS/store fixes. Shared-core improvements still benefit both. New features require an explicit scope decision rather than silently extending the migration forever.

## 8. Discussion #1261 update — published 2026-09-22

Published with maintainer approval: [plan update in #1261](https://github.com/dongdongbh/Mindwtr/discussions/1261#discussioncomment-18559964). Updated the title and opening status and labeled the original exploration as historical. Verified that the remaining original body, including the physical-iPhone request, and both previous comments were preserved verbatim. The published discussion text is recorded below.

**Published title:** Native Android and iOS migration: implementation and release plan

**Published opening status:**

> **Status — September 22, 2026:** The direction is decided: native Android and iOS clients, retaining the shared TypeScript core. We will build incrementally, test real upgrades through opt-in beta, and release each platform when ready through the existing app listing. The current apps remain production versions. The original exploration below is historical; the implementation plan is in the latest progress update. There is no fixed native release date.

**Published progress comment:**

### Native mobile migration: implementation and release plan

Mindwtr will move to Kotlin/Compose on Android and Swift/SwiftUI on iOS, keeping one shared TypeScript core. The Mac mini is now available for Apple development; physical-iPhone testing is still needed. This is an implementation plan, not a native release announcement.

We will build the clients incrementally while the current apps remain in production. For users, the eventual change is an update to the existing app through the existing store listing. No second store product, new account, or routine manual data transfer is planned. We will test that replacement-install path explicitly.

The order is:

1. **Foundation and upgrade safety:** one core/host interface, Android pilot cleanup, the Apple host, and preservation of data, settings, credentials, and sync. Address sync-related interaction blocking as a separately reviewed correctness and performance change.
2. **Everyday workflows:** Inbox/capture, editing, Focus, projects/areas, search, and daily/weekly review. Accessibility, localization, and restoration are part of building these workflows.
3. **Complete existing capabilities:** supported sync backends, attachments, import/export, reminders/calendar, settings, and optional features. Reuse native widgets, capture integrations, and Watch functionality where practical.
4. **Opt-in replacement beta and RC:** after maintainer and upgrade-safety checks, use the existing Play app's open-testing track and an external TestFlight public-link group. There is no fixed volunteer quota. Any transition of the existing RN beta audience will be announced first; beta installation replaces the current app, so limitations and backup instructions will be clear.
5. **Independent production rollout and stabilization:** Android and iOS ship when each is ready, with separate promotion decisions for Play, App Store, F-Droid, and direct APKs, and a tested recovery path.

A native client will not replace production just because the main screens compile. Required workflows, actual upgrades, mixed-client sync, physical-device interaction, accessibility, and language behavior must be verified. No known critical data-safety or core-workflow blocker may remain. Few reports or a quiet beta do not count as a pass.

The migration is complete when both native clients are stable production versions across their supported channels and the obsolete RN mobile stack can be retired safely. Desktop is not being rewritten, and the first native releases will preserve the data/sync contract.

Help with Compose, SwiftUI, accessibility, translations, or testing a particular workflow is welcome. Please coordinate substantial legacy mobile UI changes so work is not duplicated during migration. We will track progress against implementation and release-readiness milestones rather than promise a production date.
