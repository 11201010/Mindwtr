# Performance Guide

This page documents practical performance patterns for Mindwtr (desktop, mobile, and core).

## High-Impact Areas

- Large list filtering and sorting
- Project/task ordering updates
- Sync merge and attachment reconciliation
- Re-render churn from broad store subscriptions
- SQLite query patterns (search, date filters, project/status views)

## UI Rendering Guidance

1. Prefer narrow store selectors and avoid selecting whole store objects.
2. Group related selectors and memoize derived collections.
3. Keep item components pure; push expensive transforms up to list-level memoization.
4. Use virtualization for large lists and avoid dynamic height recalculation in hot paths.
5. Avoid creating new inline callbacks/objects in large mapped lists.

## Sync Performance Guidance

1. Validate payload shape before merge to fail fast.
2. Keep merge deterministic and O(n) over entity count (map by ID, avoid nested scans).
3. Reconcile attachment metadata first; defer file IO/network to separate sync phase.
4. Bound retries with backoff and classify retryable vs terminal errors.
5. Cache backend config reads during a sync cycle to reduce repeated storage access.

## Database Guidance

1. Use FTS indexes for free-text search where available.
2. Keep common status/project/date filters indexed.
3. Batch writes inside transactions for large imports/sync save paths.
4. Keep JSON columns normalized at read boundaries and avoid repeated parse/stringify loops.

## Profiling Checklist

1. Reproduce with a realistic dataset (thousands of tasks, large projects).
2. Measure before/after (render counts, query timings, sync duration).
3. Check memory growth during long sessions.
4. Verify no regressions in low-end devices/simulators.

## Performance Budget Suggestions

- List interactions should remain responsive (<16ms frame budget where feasible).
- Search requests should be sub-100ms on typical local datasets.
- Sync merge should scale linearly with entity count.
- Avoid blocking UI threads with file/network operations.

## Related docs

- [[Architecture]]
- [[Core API]]
- [[Data and Sync]]
- [[Diagnostics and Logs]]
