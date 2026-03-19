# Release Process

This page documents the normal Mindwtr release flow at a practical level. It is intended for maintainers working from the repository.

---

## Source Files

Release automation and version metadata are centered in:

- `scripts/bump-version.sh`
- `scripts/update-versions.js`
- `docs/release-notes/`
- `metadata/`
- `metadata/metadata.json`
- `.github/workflows/`

---

## Standard Release Flow

1. Make sure `main` is in the intended release state.
2. Prepare or update the release notes under `docs/release-notes/`.
3. Bump the version with:

```bash
./scripts/bump-version.sh 0.x.y
```

This updates workspace package versions and bumps the Android `versionCode`.

4. Regenerate the lockfile when prompted by the script (`bun install` is part of the version bump flow).
5. Review the resulting version changes carefully.
6. Commit the release prep:

```bash
git add -A
git commit -m "chore(release): v0.x.y"
```

7. Tag the release:

```bash
git tag v0.x.y
```

8. Push `main` and the tag:

```bash
git push origin main --tags
```

9. Let GitHub Actions publish the platform artifacts and any downstream packaging jobs.

---

## Before Tagging

At minimum, verify:

- release notes exist and match the actual changes
- package versions are aligned across the monorepo
- Android `versionCode` was incremented
- critical tests for changed packages have passed
- any store/release metadata changes are intentional

For larger releases, also verify:

- desktop updater metadata
- mobile store metadata / Fastlane inputs
- wiki/docs changes for user-visible features

---

## Release Notes

Versioned release notes live in `docs/release-notes/`.

Guidelines:

- keep the top summary user-facing
- include the important fixes/features first
- list notable commits when helpful
- keep Google Play snippets in `docs/release-notes/google-play/` aligned when needed
- update `metadata/*/release_notes.txt` for App Store release notes
- add the new Android changelog file under `metadata/*/changelogs/<versionCode>.txt`
- keep Microsoft Store release notes in `metadata/metadata.json` aligned with the same release

---

## Post-Release Checks

After the tag is pushed:

- verify GitHub release creation
- verify expected desktop/mobile artifacts are attached
- verify store-specific workflows succeeded when applicable
- spot-check the updater/download surfaces against the new version

---

## Rollback Mindset

If a bad release is detected:

- stop follow-up tagging until the failure mode is understood
- prefer a fast forward fix release over rewriting published history
- keep release notes explicit about the corrective patch

---

## Related

- [[Developer Guide]]
- [[Deployment Guide]]
- [Repository release notes](https://github.com/dongdongbh/Mindwtr/tree/main/docs/release-notes)
