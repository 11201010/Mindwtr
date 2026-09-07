# Plan 079: Document MCP authentication throttling accurately

## Status
- Priority: P3; effort: S; risk: LOW; category: docs.
- Planned at: Mindwtr `77137ce0d`, 2026-09-07. Depends on: none.
- Root executes this ordinary prose correction after the plan set is committed, one commit per repository, no push.

## Why and current state
`apps/mcp-server/README.md:118-120` and public `docs/power-users/mcp.md:283-285` say invalid credentials always receive401 and there is no rate limiting. `apps/mcp-server/src/http-server.ts:21-25,168-195,238-247` throttles failed authentication attempts: after30 per IP or presented token within60 seconds, it returns429 with Retry-After. Successfully authenticated requests are not rate-limited. Built-in TLS remains absent. The misleading text is copied in all five public translations.

## Scope and steps
1. Update only apps/mcp-server/README.md in Mindwtr and docs/{power-users,de/power-users,es/power-users,fr/power-users,zh-Hans/power-users,zh-Hant/power-users}/mcp.md in /home/dd/code/mindwtr-web. Preserve existing structure, commands, technical values and links.
2. Explain401 for invalid tokens and429 after repeated failures with Retry-After. Clarify that successful requests are not rate-limited and a reverse proxy provides TLS. No new security promises, no source or runtime changes. No new tests needed for prose.
3. Read mindwtr-web/AGENTS.md. Preserve unrelated untracked .worktrees/ there. Prefix shell rtk; large outputs/temp under /home/dd.
4. Run `rtk bun run check` in mindwtr-web (required full docs gate) and `rtk git diff --check` in both repos. Expected exit0. Review all six translations for matching meaning.
5. Root commits exactly one scoped docs commit in each repository and updates the plan index with the app-side commit. No push/deploy.

## Done criteria and stop conditions
Only the seven intended docs files change across the two repositories; docs gate/diffchecks pass; no runtime code touched; all six language variants mention401/429 and Retry-After. Stop if technical source changes before editing or the docs gate exposes unrelated work needing changes. Existing source is the authority; no need to search external protocol docs for this implementation fact.
