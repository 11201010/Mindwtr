# Automatic retirement of merged worktrees

`scripts/maintenance/cleanup-merged-worktrees.py` is a Python 3 standard-library CLI for retiring completed worktrees. It defaults to a read-only preview. It never resets or cleans source, force-removes a worktree, deletes a branch, expires an archive, or cleans caches in dirty worktrees.

## Preview and apply

Configure the primary Git checkout, the directory containing direct registered worktree children, and a private archive directory outside source checkouts. Example for the Mac `dd` account:

```sh
python3 scripts/maintenance/cleanup-merged-worktrees.py \
  --repo /Users/dd/code/Mindwtr \
  --worktree-root /Users/dd/worktrees/Mindwtr \
  --archive-root /Users/dd/.local/state/mindwtr-worktree-retirement \
  --protect /Users/dd/worktrees/Mindwtr/ios-data-export-198 \
  --report /Users/dd/.local/state/mindwtr-worktree-retirement/latest-preview.json
```

The archive directory's parent must already exist. A preview with `--report` requires an existing private archive directory. A preview without `--report` creates nothing and does not fetch. Cached `origin/main` reachability is explicitly marked unverified; preview eligibility is provisional. Report paths are restricted to `latest-preview.json` for previews or `latest-apply.json` for apply, directly inside the archive root. Existing files must be private prior reports from this CLI; renamed archives, receipts, or other files are refused before cleanup.

Review the JSON first. Add `--apply` and change the report filename to `latest-apply.json` to perform retirement. Apply creates the archive directory if missing, with mode `0700`; an existing directory must already be owned by the invoking account and exactly `0700`. It acquires a nonblocking `fcntl` job lock, fetches only `origin/main`, and refuses to proceed if fetch fails. Reports and retained receipts use `0600`. Subprocess errors are fixed reason codes; command output, remote URLs, process arguments, and file contents are not emitted.

The default inactivity threshold is ten days; `--older-than-days` accepts a positive number. Repeat `--protect` for paths that must remain. The primary checkout and the direct-child names `native-ios-foundation`, `ios-editor-draft-recovery`, and `apple-ui-wda` are always protected. Branches remain after retirement, including branches attached to removed worktrees.

## Admission gates

Every candidate must satisfy all of these checks:

- Its exact Git registration is an unlocked, non-prunable, direct child of the configured worktree root.
- The primary checkout, candidate, configured paths, and ancestors are real paths without symlink components. Source/evidence symlinks are skipped. Links inside proven ignored generated groups count only their own mtime and are never followed; ordinary Git removal unlinks them while retaining external targets.
- Its current HEAD is an ancestor of freshly fetched `origin/main` during apply. Local main, commit age, and other remote refs are insufficient. Replace refs are disabled for Git proofs.
- Tracked and ordinary untracked status is clean, including submodule state. Assume-unchanged and skip-worktree index hints cause refusal because they can hide modified source. Any `assume-unchanged` or `skip-worktree` index flag prevents retirement because Git status/removal can hide modified source behind these flags. The tool never clears them.
- Every ignored file belongs to a narrow generated directory or `.orchestrator` evidence. Unknown ignored files, including `.env`, local agent configuration, arbitrary root `build` directories, and generated native project source, prevent retirement.
- A metadata scan finds no file or directory activity within the threshold. Source, evidence, and generated-file mtimes all count; changing an existing generated file is visible even when its parent directory remains old.
- A bounded `lsof +D` probe reports no process cwd/open file in the candidate. Missing `lsof`, warnings, other probe failures, and timeouts skip the candidate.

The generated allowlist is root `node_modules`, `apps/<name>/node_modules`, `packages/<name>/node_modules`, `apps/ios-native/.build`, root `.build-task<number>`, `apps/desktop/src-tauri/target`, root `.gradle`, and explicit Android `.gradle`/`build`/`app/build` paths for `apps/mobile/android` and `apps/android-native`. An allowlisted ignored group containing tracked source is skipped. This deliberately excludes other dependencies and caches until their ownership is explicitly added and tested.

Registration, HEAD, status, protection, ignored content, age, and process use are checked again after archiving, immediately before ordinary `git worktree remove -- <path>`. Git's own refusal protects last-moment tracked/ordinary-untracked changes. There is no `--force` fallback. Filesystem or Git uncertainty preserves source.

## Evidence retention

Nonempty `.orchestrator` evidence is preserved in a unique `tar.gz`. Evidence symlinks and special files are rejected. The tool hashes every regular file, records sizes and metadata in a private receipt, archives without following links, and independently verifies the exact archive inventory and hashes. It then compares source evidence again, fsyncs the archive and parent, and publishes without overwriting an existing archive.

Before copying, the archive filesystem must have the estimated uncompressed tar size plus compression overhead and a reserve of at least 512 MiB or ten percent, whichever is larger. A failed copy, verification, changed source manifest, or low-space probe leaves the worktree intact. Only this invocation's incomplete archive can be removed. A successfully published archive remains even if a later eligibility check or Git removal fails. Empty or absent evidence needs no archive. Reproducible generated directories are not archived.

Each attempted removal has a fsynced private receipt containing path, HEAD, branch, archive path/hash, evidence manifest, and time. The receipt is prepared before the final full eligibility/evidence rechecks, followed immediately by ordinary Git removal, and marked removed afterward. Evidence created during receipt persistence therefore prevents removal. If the final receipt update fails, the prepared receipt survives and the report identifies `removed_receipt_completion_failed`; inspect registration before retrying. There is no archive expiry or branch deletion policy.

## Daily operation and limits

The Mac mini `dd` account runs the reviewed script through `tech.dongdongbh.mindwtr.worktree-cleanup`, a user LaunchAgent scheduled for 04:17 local time. It uses the paths in the example above, ten days of inactivity, and `latest-apply.json`. The active `ios-data-export-198` worktree is explicitly protected in addition to the built-in protections. The first live preview retained all 34 registered worktrees. The CLI itself does not install or change launchd jobs. Keep live worktrees explicitly protected and run maintenance away from active development. Overlapping apply runs fail with `cleanup_already_running`.

Age and process checks are conservative point-in-time probes, not a filesystem-wide transaction with editors or new processes. They cannot prevent an ignored file changing in the tiny interval after the final check. Live source is never made clean to satisfy eligibility. Generated scans can take time on large dependency trees; probe timeouts skip instead of guessing. Git remote freshness requires network availability during apply. APFS shared extents mean removed allocation does not guarantee the same amount of newly free disk space.

The JSON report contains a decision and fixed reason for each registration, plus bounded metadata. A top-level error returns exit 1; ordinary skipped worktrees return exit 0. `--report` atomically replaces a private JSON report outside source; stdout also contains the report. No personal files outside configured candidates are scanned.

## Tests

Fixtures are real temporary Git repositories and worktrees. Process, time, and disk probes are injected only in tests. Keep fixtures and any interpreter cache under the disk-backed home:

```sh
MINDWTR_MAINTENANCE_TEST_TMPDIR=/home/dd/worktrees/Mindwtr/mac-worktree-auto-clean/.orchestrator/test-tmp \
PYTHONDONTWRITEBYTECODE=1 \
python3 -m unittest discover -s scripts/maintenance -p 'test_cleanup_merged_worktrees.py' -v
```

The tests cover clean merged retirement with retained branches, cached/fresh ref behavior, dirty/untracked/unmerged/locked/protected/active/recent worktrees, path and symlink refusal, narrow ignored-content admission, evidence preservation and failures, concurrency and final rechecks, ordinary removal without force, Unicode/spaces, and private reports/receipts.
