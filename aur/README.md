# Mindwtr AUR packages

Mindwtr recognizes these AUR package identities:

| Package                                                                   | Channel | Source                        | Expected owner(s)                                       |
| ------------------------------------------------------------------------- | ------- | ----------------------------- | ------------------------------------------------------- |
| [`mindwtr-bin`](https://aur.archlinux.org/packages/mindwtr-bin)           | Stable  | GitHub release `.deb`         | Maintainer `dongdongbh`                                 |
| [`mindwtr-beta-bin`](https://aur.archlinux.org/packages/mindwtr-beta-bin) | RC/beta | GitHub prerelease `.deb`      | Maintainer `dongdongbh`                                 |

The source-built `mindwtr` package on the AUR is community maintained; the Mindwtr project does not publish, audit, or support it.

Treat a different upstream URL or an unexpected ownership change as a security event. The machine-readable policy is in [`trusted-packages.json`](trusted-packages.json).

## Install

Review every AUR file before building. For example:

```bash
git clone https://aur.archlinux.org/mindwtr-bin.git
cd mindwtr-bin
git log --oneline -10
less PKGBUILD .SRCINFO
makepkg --verifysource
makepkg -sri
```

The source URLs must resolve to `https://github.com/dongdongbh/Mindwtr`, executable and source artifacts must have full SHA-256 checksums, and `.SRCINFO` must match `PKGBUILD`. Mindwtr AUR packages must not contain install scripts, remote-shell commands, persistence hooks, or `SKIP` checksums for executable/source content.

### Beta package rename

`mindwtr-beta-bin` is the current beta package name. The maintainer [requested deletion of the legacy `mindwtr-bin-beta` package](https://lists.archlinux.org/archives/list/aur-requests@lists.archlinux.org/thread/H76IUDZWQTMVL7J4NLMZASCNMG6VYWU5/) on August 31, 2026, after publishing its replacement. AUR accepted that request on September 6, 2026, so the legacy identity no longer receives updates.

To move explicitly, review the new package and then replace the legacy identity:

```bash
sudo pacman -R mindwtr-bin-beta
paru -S mindwtr-beta-bin
```

Removing the package does not remove Mindwtr's user data. Existing `mindwtr-bin-beta` users must migrate manually because AUR helpers do not reliably migrate package identities from `replaces` metadata alone.

## Release trust anchor

Mindwtr publishes `SHA256SUMS` with release artifacts and signs new manifests as `SHA256SUMS.asc`. The primary signing-key fingerprint is:

```text
0358 999B BE70 4F58 8B90  9497 9E55 3245 CB17 047D
```

Verify the fingerprint independently before trusting the key. A typical verification is:

```bash
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum --check SHA256SUMS
```

## Publishing policy

All recognized packages publish directly from release jobs:

1. Generate the package's `PKGBUILD` and `.SRCINFO` from the release tag.
2. Reject unexpected files, owners, sources, commands, or skipped checksums (`scripts/ci/validate-aur-package.mjs`).
3. Build in a clean Arch container.
4. Re-verify the package's maintainer, co-maintainers, and upstream URL against the trusted policy immediately before pushing (`scripts/ci/audit-aur-state.mjs`); ownership drift aborts the push.
5. Push a single, non-force commit over a dedicated SSH credential.

A recognized AUR maintenance response (pushes disabled) marks the channel delayed rather than failing the job; an unexpected rejection fails it.

## Maintainer security

- Keep `dongdongbh` as maintainer or co-maintainer of all recognized packages.
- Use a dedicated, passphrase-protected Ed25519 AUR key that is not shared with GitHub, servers, or general build machines.
- Store the publishing key only as the `AUR_SSH_PRIVATE_KEY` secret in the protected `aur-publish` Environment.
- Never orphan a package for temporary maintenance convenience and never force-push AUR history.

The AUR is unofficial. Automation catches policy drift, but it does not replace reviewing the actual package diff and build behavior.
