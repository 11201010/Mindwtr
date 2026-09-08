# Plan 062: Preserve the AUR beta package transition

> Drift check: git diff --check v1.2.5-rc.2..HEAD

## Status

- Superseded on September 6, 2026, when AUR accepted the maintainer's [deletion request for `mindwtr-bin-beta`](https://lists.archlinux.org/archives/list/aur-requests@lists.archlinux.org/thread/H76IUDZWQTMVL7J4NLMZASCNMG6VYWU5/).
- `mindwtr-beta-bin` is now the only published beta identity.

## Why

Renaming the beta package to `mindwtr-beta-bin` stopped updates and trust audits for existing `mindwtr-bin-beta` installations. AUR helper behavior cannot be assumed to migrate those users from package metadata alone.

## Design

1. Generate, validate, audit, and publish `mindwtr-beta-bin` from each RC and stable release.
2. Keep `provides`, `conflicts`, and `replaces` metadata for the deleted legacy identity.
3. Tell remaining `mindwtr-bin-beta` users to migrate manually.

## Verification and stop conditions

- AUR workflow/governance tests, live ownership audit, actionlint, and the authoritative drift check.
- Stop if the canonical package is untrusted, initialized over missing history, or published without validation. Make one commit only.
