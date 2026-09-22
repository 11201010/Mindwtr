# Plan 129: Make authenticated developer examples runnable

> Executor: follow this plan only. Root maintains the index and commits. Do not commit, push, publish or change runtime authentication. Read the public-doc repository's AGENTS.md first.
>
> Drift check: in `/home/dd/code/mindwtr-web`, run `rtk git diff --stat 89ac579b..HEAD -- docs/developers/developer-guide.md docs/de/developers/developer-guide.md docs/es/developers/developer-guide.md docs/fr/developers/developer-guide.md docs/zh-Hans/developers/developer-guide.md docs/zh-Hant/developers/developer-guide.md`. Compare changed excerpts before proceeding.

## Status

- Priority: P3; effort: S; risk: LOW; confidence: HIGH.
- Category: docs/DX; finding DOCS-01; dependencies: none.
- Planned at: Mindwtr `6342d1266`, public docs `89ac579b`, 2026-09-22.

## Why this matters

The developer guide requires local API authentication but its two curl requests omit the bearer header. Both return401. The Cloud startup example omits mandatory authentication configuration and fails before serving. All six locales repeat these omissions.

## Current state

Public docs live in `/home/dd/code/mindwtr-web/docs`, not Mindwtr's legacy wiki. The six paths listed in Scope contain identical technical commands (French translates comments). English `docs/developers/developer-guide.md:333` starts the API with:

```sh
MINDWTR_API_TOKEN=replace-with-a-strong-token bun mindwtr:api -- --port 4317
```

Its examples at363/368 omit authentication:

```sh
curl -X POST http://localhost:4317/tasks \
  -H "Content-Type: application/json" \
  -d '{"input": "Review PR @work /due:tomorrow"}'
curl -X POST http://localhost:4317/tasks/<id>/complete
```

Cloud startup at379 currently reads `bun run --filter mindwtr-cloud dev -- --port 8787`. Mindwtr `scripts/mindwtr-api.ts:157` requires a matching bearer token; lines232–233 enforce it before routing. `apps/cloud/src/server-auth.ts:188` throws for absent auth configuration, reached by `apps/cloud/src/server.ts:1135`.

Follow existing Markdown/fenced-shell style. `scripts/check-docs-sources.mjs` compares protected technical command blocks between locales; keep all six synchronized. No new domain term or ADR is needed. Security settings remain unchanged.

## Scope

Only modify these paths in `/home/dd/code/mindwtr-web`:

- `docs/developers/developer-guide.md`
- `docs/de/developers/developer-guide.md`
- `docs/es/developers/developer-guide.md`
- `docs/fr/developers/developer-guide.md`
- `docs/zh-Hans/developers/developer-guide.md`
- `docs/zh-Hant/developers/developer-guide.md`

Out of scope: runtime code, dependencies, generated assets, landing pages, other docs, auth-policy changes, real credentials. Preserve existing unsafe-mode warning; do not recommend disabling auth to make examples work.

## Steps and checks

1. Correct both local curl examples with `-H "Authorization: Bearer <placeholder>"`, using exactly the same clearly fake local token placeholder as the startup command. Quote the completion URL so its `<id>` placeholder is not shell redirection. Add one localized sentence saying to replace the placeholder with the same strong token used when starting the server and replace `<id>` with the returned task ID. Keep code identical across locales.
   - Check: inspect the six-page diff; exactly two authenticated local requests per page, no actual token values.
2. Prefix Cloud startup with `MINDWTR_CLOUD_AUTH_TOKENS=replace-with-a-strong-cloud-token`. Local token placeholder must be distinct (use `replace-with-a-strong-local-token` consistently). Add one localized sentence to replace the Cloud placeholder with a strong token and use that token in client configuration.
   - Check: `rtk bun run check:docs-sources` in web repo exits0, including protected command parity.
3. Run `rtk bun run check` in web repo. It performs secret scan, platform routing, source parity, production builds and built-link verification. Run `rtk git diff --check`. Both exit0. Report exact modified files and checks; root creates one scoped docs commit.

## Verification / done criteria

- All six guides have two quoted bearer headers matching their local startup token placeholder.
- Cloud examples all configure a distinct fake allowlist token; no recommendation to weaken authentication.
- `<id>` completion URL is quoted and substitution explained.
- `rtk bun run check:docs-sources`, `rtk bun run check`, `rtk git diff --check` exit0.
- `rtk git status --short` shows only the six in-scope Markdown files (plus any pre-existing unrelated changes, preserved).
- Root records completion and commit in `plans/README.md` and the task result.

No new test framework is needed for a documentation correction; source-parity/secret/build/link checks are the existing verification seam. The runtime auth trace above is the red evidence. Root may execute requests against a disposable loopback-only profile with generated fixture credentials; never open the user's profile for example validation.

## STOP conditions and maintenance

Stop if auth requirements changed, a target excerpt drifted materially, another locale has different runtime commands, or validation requires edits outside Scope. Do not weaken checks. Keep these examples paired with future authentication changes; never insert an actual credential into docs or reports.
