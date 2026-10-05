# Apple CI output retention

The self-hosted Apple lanes retire generated build outputs after uploading their job evidence. Cleanup also runs after a failed build when artifact upload succeeds. If upload fails, outputs remain for diagnosis; the startup and pre-archive disk guards remain the fallback for interrupted jobs.

`scripts/ci/cleanup-apple-outputs.py` accepts only the `swiftui` or `ios` scope in GitHub Actions. It verifies the runner account roots and current Xcode cache fingerprint, refuses symlink roots or candidate directories, and validates all candidates before deleting any. It removes only named product/intermediate directories. Xcode 27 SwiftPM uses `<scratch>/out` (the `debug` symlink points to `out/Products/Debug`). Dependency checkouts, repositories, downloaded artifacts, CocoaPods, node_modules, build logs, unknown directories, and other compiler generations remain.

SwiftUI validation retains a combined log as a GitHub artifact for 14 days. The React Native lane uploads its existing build logs and unsigned archive before retiring local copies of the archive and build products. Watch products/intermediates have explicit dedicated paths. This helper does not remove simulators, worktrees, or branches and does not restart the runner.

Run its isolated filesystem regressions with:

```sh
python3 -m unittest discover -s scripts/ci -p test_cleanup_apple_outputs.py -v
```

A killed worker or full disk may prevent all final steps. `prepare-apple-cache.sh` still checks disk space before work and before the large unsigned archive. Successful fixture tests prove cleanup boundaries; the next self-hosted workflow run must separately confirm live cleanup.
