# Archive reactivation candidate validation — September 15, 2026

## Result and scope

The production task mutation path now validates the requested section directly, using the exact reactivating parent and the existing strict archive-ownership predicate. It no longer projects the entire section collection once per task. The later lifecycle transition remains the sole writer; ordinary live-container validation remains unchanged. This removes one source of repeated work, not every array lookup in a batch.

| Evidence | Result |
| --- | --- |
| Shared-core production batch, 1,000 tasks / 160 sections | Original-array visits fell from 160,480 to 480 |
| Shared-core production batch, 50,000 tasks / 2,000 sections | Original-array visits fell from 100,006,000 to 6,000 |
| Updated active and archived fixtures at 1k / 10k / 50k | Both use 3 original-section maps; 480 / 3,000 / 6,000 visits |
| Native desktop latency | Not measured |
| Native mobile latency | Not measured |

The deterministic regression first failed with 208 visits for 12 tasks / 16 sections against a 64-visit ceiling. After the change it passes while retaining status, project, section placement and saved-snapshot assertions. The focused suite passed 251 tests, including actual SQLite persistence and reopening. Core typecheck and lint passed with three pre-existing task-status warnings. Final aggregate performance budgets are a separate integration gate; no budget was relaxed.

## Reproduce and source identity

From the checkout containing this report:

```sh
rtk proxy env WORKCOUNT_ONLY=1 bun scripts/performance/archive-reactivation-workcount-probe.ts
```

This mode disables timing and runs synthetic active/archived fixtures at all three scales. The probe imports core source relatively, so it cannot accidentally measure another checkout through a workspace package symlink. It asserts successful production `batchMoveTasks`, task status, project activation, section placement/restoration, and a saved snapshot. The instrument observes the original section collection only; it does not count every allocation or traversal elsewhere.

The baseline was commit `51ac48c2f` (relevant core source identical to `ef084cb45`). Baseline store-tasks SHA-256: `15f56ded10935f271bb6433f58985ed8440df703c58b2a1a6ed4d9b68cb22412`; task-container-rules: `b7ded7fc3b0e3e02ad9d21203a52391cb1cfd3fd13599defdcd90acc2d228de9`. The original probe SHA-256 was `cc45f78902b0a75524cfc22b7e82848dea05b176edef9f21ed392893b9354c71`. Updated source and the reusable probe are in this report's finding commit. Runtime: Bun 1.3.3, Linux 7.1.11-arch1-1 x86_64, glibc 2.44.

Baseline uninstrumented 50k archived synchronous samples were 2,094 / 1,923 / 1,893 ms, with matched active samples 859 / 851 / 864 ms. These historical host observations motivated the work; they are not a controlled before/after latency claim. Updated acceptance uses deterministic work counts and the existing performance budgets.

## Safety and maintenance

The narrow permission is created only after the existing task/project reactivation predicate succeeds. Independently deleted or edited sections, another parent's sections, purged/deleted tasks or parents, and default creation/import calls gain no authority. Duplicate section matching keeps the first eligible match. Order reservation, sibling statuses, persistence ownership, failed-save retry and archive markers retain their existing contracts.

The content-free `v1.3.1/archive-reactivation-validation` diagnostic follows successful persistence; see the release diagnostics ledger. It confirms the path ran, not speed. Future lifecycle changes must keep preview eligibility aligned with actual strict restoration. No schema, global cache, platform UI or native persistence change is included.
