# 0030 — Optional archive retention

- Status: Accepted
- Date: 2026-10-01
- Issue: #1320

## Decision

Archive retention controls how long archived contents remain in the current library. It is separate from tombstone retention, which protects deletion propagation between devices. Retention defaults to Never; a user can explicitly enable a positive whole number of days in Settings → Data. The policy is synced. Enabling or shortening it requires confirmation, with a current eligibility preview. Automatic runs do not ask again.

Tasks and projects carry an optional `archivedAt` timestamp. Archive transitions stamp the actual operation time, restoration clears it, and rearchiving starts a new period. Completion and last-edit timestamps are not substituted for archive entry. When retention is enabled, an archived record without a reliable archive timestamp starts a full period at its first explicit retention initialization. Loading or normalizing a record does not invent an archive date. Older clients that lose the field cause conservative deferral.

Individually archived tasks in ongoing projects are preserved. An archived project and its contents are evaluated together, including tasks connected through its sections. Newer, active, reactivated, or undated contents prevent the group from expiring. Recent edits are an additional safety veto. Existing unrelated Trash contents are not implicitly purged by an archive policy.

Cleanup re-evaluates eligibility against current state at the mutation boundary, pauses during editing/loading or persistence failure, and applies one batch through the existing durable store write path. It reuses tombstone compaction and attachment deletion bookkeeping, preserving shared attachments. It does not call ordinary project deletion and assume a cascade: ordinary project deletion detaches surviving tasks.

Deletion timestamps and revisions are fresh at cleanup time, never backdated to archive entry. The normal tombstone retention period remains unchanged (90 days by default; referenced parents can remain longer). Cleanup removes task/project contents but retains minimal sync deletion metadata and any attachment metadata still needed for cleanup.

## Consequences

Cancellation remains a distinct outcome and is covered when the cancelled record is archived. Restoring or editing work may defer expiration. No incremental-sync protocol or second synced document is introduced. Automatic cleanup runs while a supported app is active; it does not require an OS background job.

This feature does not promise secure erasure. Existing backups, recovery snapshots, exports, and provider version history have separate lifetimes and are not rewritten. Turning retention off cannot restore contents already removed.

## Release prerequisite

`archivedAt` requires additive String fields containing ISO timestamps on the CloudKit `MindwtrTask` and `MindwtrProject` record types. The tracked production-schema manifest must retain them as pending until deployed. Deployment is required before releasing a binary that writes them; the existing static CloudKit mappers do not runtime-gate pending fields. This implementation does not change production CloudKit configuration.
