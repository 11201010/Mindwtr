# Maintaining Focus GTD on AUR

## Prerequisites
1. Create an account on [aur.archlinux.org](https://aur.archlinux.org/).
2. Upload your SSH public key to your AUR account.
3. Install `git` and configuring it.

## Initial Submission (One-time)
1. Clone the repository: `git clone Action ssh://aur@aur.archlinux.org/focus-gtd-bin.git` (or create if not reserved).
2. Copy `PKGBUILD` and `.SRCINFO` to the repo.
3. Generate `.SRCINFO`: `makepkg --printsrcinfo > .SRCINFO`
4. Commit and push:
   ```bash
   git add PKGBUILD .SRCINFO
   git commit -m "Initial release 0.2.2"
   git push
   ```

## Updating Version
1. Update `pkgver` in `PKGBUILD`.
2. Update checksums: `updpkgsums` (requires having the source file downloaded or manually calculate `sha256sum`).
   - Or set to 'SKIP' (not recommended for production but easy for testing).
3. Regenerate `.SRCINFO`: `makepkg --printsrcinfo > .SRCINFO`
4. Commit and push.

## Note on Binary
This package uses the `.deb` release artifact which is extracted. Alternatively, you can use the `.AppImage` or build from source (`focus-gtd` without `-bin` suffix).
