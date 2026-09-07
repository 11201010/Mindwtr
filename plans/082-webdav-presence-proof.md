# Plan 082: Use one attachment presence proof for WebDAV

## Status
- Priority: P2; effort: M; risk: MED; category: architecture/correctness.
- Planned at: `5f48daafb`, 2026-09-07. Depends on: none.
- Strong candidate automatically selected in the review-improve-loop. Astra architecture review; Sol implementation; root commits once, no push.

## Problem and exact current state
Desktop `apps/desktop/src/lib/sync-attachment-backends.ts:662-693` and mobile `apps/mobile/lib/attachment-sync-backends/webdav.ts:199-238` implement their own remote presence loops. Non-rate-limit exceptions log but leave `abortedByRateLimit=false`; each then marks the daily proof complete. A HEAD500,401 or network error can suppress the next check for24hours even after recovery. No immediate byte loss is claimed.

The existing deep module `packages/core/src/attachment-presence-repair.ts:108-137`, `repairMissingRemoteAttachments`, already owns true/false/null proof traversal and clears only definitive false. Null returns complete=false and stops. Cloud/Dropbox consume it and advance stamps only on complete. `webdavFileExists` returns false on404, true on405, and throws for other non-OK statuses; rate-limit classification covers429 and503, so use500 for the primary red regression.

## Architecture and deletion test
Before: each WebDAV adapter owns traversal, missing-reference clearing and implied completion via !rateLimited. After: platform local prepass + WebDAV probe adapter → existing repairMissingRemoteAttachments → complete → platform-owned stamp.
Delete both duplicated remote traversal/clearing decisions. This adds leverage at an existing seam with two real platform adapters; locality improves because unknown cannot earn proof in one shared implementation. Do not create another module/interface or consolidate whole backends. The core proof interface/tests remain unchanged unless a concrete integration problem requires root approval.

## Scope
Only desktop `apps/desktop/src/lib/sync-attachment-backends.ts` and adjacent `.test.ts`; mobile `apps/mobile/lib/attachment-sync-backends/webdav.ts` and `apps/mobile/lib/attachment-sync.test.ts`; `packages/core/src/release-diagnostics-fields.test.ts`; `docs/release-notes/diagnostics-ledger.md`. Existing core proof is read-only. Report need for any other path.

## Fixed design and invariants
- Keep desktop local presence/unreadable pruning/download-backoff clearing outside the remote proof gate (currently625-660). Keep mobile's current local-prepass gate (171-197). Do not harmonize that platform difference.
- Candidate selection uses existing isAttachmentPresenceRepairCandidate plus confirmed readable local bytes. HTTP URI, unreadable/absent bytes, pending content upload, deleted and non-file attachments cannot lose remote references.
- Probe adapter retains request options, retry/waitForSlot, abort, logs and rate-limit handling. Ordinary unknown returns null. Mobile abort and fatal fence errors propagate; never turn them into an unknown result followed by uploads.
- On429/503, set existing abortedByRateLimit so downstream transfers still stop. Preserve cooldown/delay/caps. All-present complete proof advances stamp; unknown leaves it unchanged. Activation always probes and never stamps.
- Preserve404 repair in the same cycle, including a valid missing result before a later unknown. Preserve existing HEAD405 transport semantics. No changes to metadata/byte generations, publication order, sync payloads, settings, backends or global Sync run (ADR0011/0014).
- Log `WebDAV attachment presence proof finished` where shared result exists, both apps, with extra.releaseCheck=v1.2.9/webdav-presence-proof and checked/cleared/complete fields. Use real app diagnostic adapters and register safe field names/ledger. Never log URLs, credentials, attachment paths/titles or task text.

## Execution and machine-checkable acceptance
1. Drift: `rtk git diff --stat 5f48daafb..HEAD -- apps/desktop/src/lib/sync-attachment-backends.ts apps/mobile/lib/attachment-sync-backends/webdav.ts`; compare to excerpts. No production edits before real platform-interface red case.
2. Use existing syncWebdavAttachments harnesses. Mock transport/local I/O only; do not mock repairMissingRemoteAttachments. On500/401/network after retry: reference retained, no repair upload for unknown, stamp unchanged, second recovered cycle probes. Demonstrate red on current stamp behavior.
3. Route both adapters through core and delete old decisions.
4. Both adapters:404 readable bytes still repair/upload; all present stamp advances and next same-scope cycle skips HEAD; no candidates cause no remote request; unknown following missing retains earlier valid repair but no completed stamp.
5. Both adapters:429/503 preserve cooldown/stamp/transfer stop. Mobile abort before/during proof rejects and cannot upload afterward. Activation probes but never stamps. Existing fresh-stamp desktop local pruning/backoff behavior survives; unsafe candidates never clear.
6. `rtk bun run --cwd apps/desktop test src/lib/sync-attachment-backends.test.ts` passes. `rtk bun run --cwd apps/mobile test lib/attachment-sync.test.ts` passes. `rtk bun run --cwd packages/core test src/attachment-presence-repair.test.ts src/release-diagnostics-fields.test.ts` passes.
7. `rtk bun run typecheck:desktop`, `rtk bun run typecheck:mobile`, relevant focused ESLint and `rtk bun test scripts/ci/validate-diagnostics-ledger.test.js` all exit0. `rtk git diff --check` clean and only allowed files changed.
8. Return red/green evidence and exact changes in assigned result file, stop source edits, no commit. Root runs full verify/perf and fresh Astra Standards/Spec review over architecture range with this plan as Spec.

## Non-goals, workflow and stop conditions
No whole-backend rewrite, notification consolidation, new architecture settings or change to proof ceiling semantics. Use assigned worktree under /home/dd/worktrees/Mindwtr, with dependencies/build/temp under /home/dd (never /tmp or /dev/shm). You are not alone; preserve others' edits. CodeGraph first, rtk shell, design guardrails/TDD/implement replace-not-layer discipline; no crash logs. Root maintains plan status. STOP if the existing proof cannot preserve cancellation/fence behavior, if local URI/admission semantics need redesign, or scope expands beyond these adapters. Future remote proof changes belong in the existing core module; platform tests must cross that seam.
