# ADR 0005: Tombstone Retention and Purge Policy

Date: 2026-03-14
Status: Accepted

## Context

Mindwtr uses soft-delete tombstones so deletions can sync safely across devices and providers. If tombstones disappear too early, an offline client can resurrect deleted records during a later merge. If they are kept forever, local data and sync payloads grow without bound.

The system therefore needs a retention policy that keeps deletes long enough for normal multi-device recovery while still allowing eventual cleanup.

## Decision

We retain tombstoned records in persisted data for a bounded window and only purge them after the retention period has elapsed.

Current policy:

- deletes are represented as tombstones, not immediate hard deletes
- tombstones stay in persisted snapshots and sync payloads during the retention window
- purge happens as an explicit cleanup step after the retention window, not as part of ordinary reads
- retention is measured conservatively so a recently deleted item is never dropped during normal sync churn

## Consequences

- Delete propagation stays deterministic for offline and intermittently connected clients.
- Storage growth is bounded instead of permanently accumulating deleted records.
- Save/export paths must preserve tombstones until cleanup runs; filtering them out early is a data-loss bug.
- Any future change to the retention window or purge timing must be treated as a sync-behavior decision, not just a storage optimization.
- A purged row is never restored: restore actions in core and in the desktop local API treat it as missing, so a compacted tombstone cannot come back as a live "(deleted)" item.
