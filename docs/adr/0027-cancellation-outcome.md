# ADR 0027: Cancellation as an archived outcome

Date: 2026-09-07
Status: Accepted

## Context

A commitment can end without achieving its intended result. Completing it gives
the wrong historical meaning; deleting it discards useful preparation and notes.
Cancellation should preserve this distinction without adding another GTD list.

## Decision

Task and Project gain an optional ISO timestamp, `cancelledAt`. There is no new
status, reason field, or sidebar entry. A cancelled entity has `status: archived`;
a cancelled task has no `completedAt`, Focus star, or Focus order. Completion
statistics and completed-task calendar overlays exclude cancellation. Historical
archives are not reclassified.

The task and project menus offer Cancel. Cancel recurring series archives the
current occurrence without generating another one. Recurrence metadata stays
available for deliberate reactivation; Skip occurrence keeps its existing meaning.

Cancelling a project preserves completed, archived, reference, and deleted tasks.
Its unfinished actionable tasks are cancelled together, retaining their previous
status through the existing project archive metadata. Reactivation restores only
children still owned by that operation: project membership, archive marker,
outcome timestamp, and last edit must still match. Independently edited, moved,
or completed children are not overwritten. Notes and attachments are preserved.

Shared write helpers enforce the lifecycle for app, cloud, and MCP writes. A
timestamp-only patch cancels; an explicit active status reactivates and clears
the marker. Completion clears the marker. Load and merge normalization uses
stable entity timestamps, never the current clock, and must become a no-op after
the first normalization.

Cancelled tasks remain in Archive and search. The Projects terminal section is
Closed, with Completed and Cancelled outcomes distinguished. Existing Notes can
hold a cancellation reason; no additional form is required.

## Compatibility and release requirements

All active writers must be upgraded before using cancellation with sync. Tests
against v1.2.8 show that older task normalization strips the unknown field and
stamps completion time; older task and project SQLite writers also lose it.
An older writer can therefore erase cancellation even though it understands the
archived status. This is not lossless mixed-version support.

New-client merge preserves a cancellation marker when an archived peer copy has
identical revision, writer, and edit time but has stripped the field. A real
newer edit or reactivation still wins. This narrow repair cannot recover a marker
after every remaining copy has lost it.

SQLite, CSV, JSON sync, signatures, and CloudKit mappings preserve the field.
CloudKit needs `cancelledAt` as a **String** on both MindwtrTask and
MindwtrProject. Keep these keys in `pendingProduction` until the production
schema is actually verified; stable release checks must continue to fail until
that deployment is confirmed.

Deployment was confirmed in CloudKit Console on 2026-09-07: the reviewed diff
added exactly these two String fields, and both were read back in Production.
