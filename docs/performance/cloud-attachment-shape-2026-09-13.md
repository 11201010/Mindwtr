# Cloud attachment shape recovery — September 13, 2026

Issue [#1205](https://github.com/dongdongbh/Mindwtr/issues/1205) reports a Linux
sync failure after an automation created a task through the Cloud API. The
reported payload puts a URL string in `props.attachments`; the diagnostic stack
matches the shared outbound attachment sanitizer calling `.map` on that string.
The reported empty due date is independent of the attachment-shape failure.

## Scope and accepted behavior

- New task/project API writes and whole-document uploads validate attachment
  arrays before persistence. Invalid input returns 400 without changing saved
  data. Null clearing, empty arrays, valid file/link records and tombstones remain
  supported. Task status belongs inside `props` on create.
- Shared sync document parsing recognizes previously saved absolute HTTP(S) URL
  strings and preserves them as link attachments. IDs derive from owner type,
  owner ID and URI; timestamps derive from existing owner timestamps or a fixed
  sentinel. No random IDs, current-clock timestamps, URL downloads, or task text
  changes are introduced. Purged owners do not regain attachment payloads.
- Other malformed attachment structures fail with a field-path error, without
  deleting or replacing the document. Existing valid arrays retain identity.
- A repaired remote read requests one write through the existing sync conflict,
  freshness and mutation-fence path. Comparing two normalized documents must not
  skip that repair. A subsequent unchanged cycle skips the write normally.
- Cloud record reads normalize old stored links before use. The raw-file trust
  cache remains separate from the parsed-data cache: repaired memory cannot mark
  unrepaired disk bytes trusted. A sync download publishes an accepted repair
  through the existing atomic writer under the namespace lock, then serves the
  saved bytes. A failed publication leaves the old bytes untrusted and intact.

The core and Cloud diagnostic markers are documented in the
[diagnostics ledger](../release-notes/diagnostics-ledger.md). Client normalization
and server persistence are separate proofs. Neither marker alone proves a
successful end-to-end sync on the reporter's devices.

## Validation and remaining confirmation

The initial recovery integration tests reproduced failures with input validation
alone: old-data GET returned 500 and direct PATCH returned 400. After recovery,
seven real local HTTP-server tests pass, covering saved/downloaded byte equality,
HEAD content length, no rewrite on the second GET, direct PATCH before any sync
download, PUT merging before any sync download, failed-write retry, stale
trusted-file identity, purged-only cleanup,
and unchanged unsupported malformed documents. The full Cloud suite passes
299 tests; Cloud typecheck and lint pass. Core document/sync-run/diagnostics tests
pass 147 cases, including null compatibility, deterministic convergence, retained
metadata, privacy-safe logging and the one-write/unchanged-second-cycle behavior.
The full core suite passes 3,964 tests with 8 skipped; core typecheck and scoped
lint pass. The seven core performance-budget tests also pass.

Independent review closed the required-field validation gap for attachment
records. The full core run exposed one fixture that supplied `name` instead of
the required `title`; correcting that fixture preserved its canonical-read
contract. Cloud review also required storage-root checks around the post-repair
file read and a second-GET assertion on inode and modification/change times,
so identical response bytes cannot hide repeated rewrites.

Public Cloud API docs include a valid automation payload in all six languages;
their production build and full docs checks pass. Docs revision `8972fd1` is
published, and [docs CI 34792525815](https://github.com/dongdongbh/mindwtr-web/actions/runs/34792525815)
passed. This work uses disposable
synthetic data on a loopback HTTP server. No reporter server, personal database,
Android app, or iOS device was accessed. Reporter confirmation after upgrade
remains open; check the exact published revision's CI separately.

Local logs and red/candidate/final results are retained under
`/home/dd/.cache/mindwtr-checklist-focus/issue-1205-*`. The engineering packets live
in the isolated worktree's ignored `.orchestrator/tasks/issue-1205-*` directories.

## Related Inbox clarification

Issue [#1204](https://github.com/dongdongbh/Mindwtr/issues/1204) changes the mobile
and desktop guided processing label to the existing translated **Contexts**,
which also covers tools and people. Existing desktop/mobile component suites
pass 19 and 90 tests respectively; this visible copy change needs no diagnostic
marker or separate public documentation.

The screenshot in [#1206](https://github.com/dongdongbh/Mindwtr/issues/1206) is in
Quick mode. Its list icon switches to Guided mode. Both modes intentionally
share the final filing screen, so a switch there affects the saved mode without
changing that screen's controls. No behavior change was made for that question.
