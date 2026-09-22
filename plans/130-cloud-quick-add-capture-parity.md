# Plan 130: Preserve complete quick-add capture semantics in Cloud REST

> Executor: read this plan and project instructions, use red-first TDD, and stop after focused verification for root review/commit. Do not commit or push. Root maintains the index and diagnostics ledger. Other agents are active; preserve their edits. Use an isolated worktree and dependencies under `/home/dd/worktrees/Mindwtr`, never RAM-backed temporary storage for installs/builds.
>
> Drift check: `rtk git diff --stat 59d0e575e..HEAD -- apps/cloud/src/server.ts apps/cloud/src/server.test.ts apps/cloud/src/server-config.ts`. Compare affected excerpts before proceeding.

## Status

- Priority: P2; effort: S; risk: MED; confidence: HIGH.
- Category: correctness/architecture; finding CORRECTNESS-01; dependencies: none.
- Planned at: `59d0e575e`, 2026-09-22.

## Why this matters

Cloud REST task creation drops parser metadata that the app/core capture module consumes. An unknown or archived-only `+Project` disappears without a new assignable project; natural-language dates disappear; invalid explicit dates are silently accepted. Cloud-mode MCP forwards to this endpoint, and public docs promise app-compatible quick-add input.

## Current state and invariant

`apps/cloud/src/server.ts:661-679` currently does:

```ts
const parsed = input ? parseQuickAdd(input, data.projects, new Date(nowIso), data.areas,
    buildQuickAddParseOptions(data.settings, { tasks: data.tasks, people: data.people }))
    : { title: rawTitle, props: {} };
const title = (parsed.title || rawTitle || input).trim();
const props: Partial<Task> = { ...parsed.props, ...initialProps };
```

It never consumes `projectTitle`, `detectedDate` or `invalidDateCommands`. `packages/core/src/capture.ts` already owns these decisions in `buildCaptureTaskProps` (229–260), with invalid-command rejection in `prepareCaptureTask` (303–309). Reuse that pure assembly; do not reimplement title/date/project policy.

`handleEntityRoute` (server.ts515–535) already reloads a cloned document under its namespace lock, calls `createEntity`, appends the task, finalizes/validates and writes the document once. Preserve this transaction: optional project and task must commit together, or neither commits. `loadAppData` clones its cached document; rejected requests must not change disk or later reads.

`buildNewProject` is already imported by the Cloud server and owns project defaults, revision, ordering and area-title stamping. Its parameters are title/color/initialProps/existingProjects/existingAreas/settings/deviceId/now. Use `CLOUD_API_REV_BY` and current `nowIso`. Keep Container exclusivity: a project home clears direct task area. Preserve existing status promotion, Focus cap, explicit ordering, lifecycle validation and input limits. ADR0011 snapshot persistence is unchanged.

Real authenticated endpoint red evidence at59d0e575e: unknown/archived-only project requests return201 with stripped title and no project; natural `tomorrow` has no dueDate; invalid `/due:2026-99-99` returns201. Active project and explicit `/due:tomorrow` already work. Fixture artifact is under `/home/dd/worktrees/Mindwtr/cloud-audit-4mbvIV`, not production data.

## Scope

- `apps/cloud/src/server.ts`
- `apps/cloud/src/server.test.ts`
- `apps/cloud/src/server-config.ts` only if the existing fixed-message log allowlist requires the diagnostic string.
- Root alone adds `docs/release-notes/diagnostics-ledger.md` entry.

Out of scope: core capture semantic changes, cloud transport/authentication, capture webhook schemas, CLI changes, app UI, public docs, new dependencies, generalized command/controller modules. Core is an existing deep module; this fix deletes local duplicate assembly and connects the Cloud adapter to its small interface.

## Steps and verification

1. Add real HTTP tests beside task creation cases in `server.test.ts`, using the existing temporary-data/startCloudServer fixture. Prove unknown project assignment/creation and natural-date behavior fail before source edits. Include archived-only and existing-active project cases, explicit project/due props precedence, invalid explicit date with no new task/project, and a later validation failure that does not leave an orphan project. Compare normalized core capture results for date/title semantics rather than inventing another natural-language rule.
   - `rtk bun test apps/cloud/src/server.test.ts -t 'quick-add'` must show the targeted red cases before implementation. Use a distinguishing test name so existing length-limit cases may also run.
2. Replace local title/props assembly with `buildCaptureTaskProps`, passing parsed data/projects/raw input/fallback and explicit props as the highest-precedence surface props. Reject parser invalid-date commands before adding any record. Check the final assembled title against existing length constraints. If assembly requests a project, use `buildNewProject`, append only to the request-local document, and apply project assignment through the existing core helper (`applyCapturedProject`) or equivalent existing seam. Keep one durable finalize/write.
   - Re-run targeted endpoint cases: all pass, active reuse and explicit props unchanged, no partial mutation after error.
3. Add one privacy-safe proof line after a successful durable Cloud quick-add write: marker `v1.3.2/cloud-quick-add-capture`. Reuse existing Cloud `logInfo` and fixed-message conventions, no content/IDs/paths/date values. Prefer a small task-create check at the existing after-write location; do not introduce a generic callback framework only for logging. Add fixed message to existing allowlist if required. A rejected write must not emit success. Report a ledger snippet to root.
4. Run `rtk bun run --filter mindwtr-cloud test`, `rtk bun run --filter mindwtr-cloud typecheck`, `rtk bun run --filter mindwtr-cloud lint`, `rtk git diff --check`: all exit0. Run relevant core capture tests if a type/export use requires validation, but do not change core semantics to satisfy the adapter.

## Done criteria

- Red/green endpoint evidence recorded.
- Unknown/archived-only projects produce an eligible project linked to the task; active matching projects reuse.
- Detected date/title assembly matches core and explicit props win.
- Invalid date commands and rejected finalization leave both task/project collections unchanged.
- Project/task share the existing single durable document write; Focus/order/container and security checks remain.
- Diagnostic occurs only after durable success and logs no content or identifiers.
- Cloud suite/typecheck/lint and diff checks pass; only Scope files changed.

## STOP conditions / maintenance

Stop if Cloud intentionally documents different capture semantics, assembly requires a core contract change, or the fix appears to require multiple durable writes. Do not copy Zustand store orchestration into the server. Future quick-add grammar belongs in core capture; adapter regressions should assert the shared result through HTTP.
