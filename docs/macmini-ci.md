# Mac mini native CI

`Native Platform CI` keeps Android, desktop, Xcode 26, and all pull requests on
GitHub-hosted runners. With repository variable `MACMINI_NATIVE_CI=true`, the
Xcode 27 lane for pushes/manual runs on `main` runs on the Mac mini.

The public Ubuntu job dispatches `native.yml` in the private
`dongdongbh/Mindwtr-native-ci` repository, waits for its result, and copies its
validation artifacts back. That private workflow calls the same native workflow
here. A hosted preflight requires the requested SHA to be an ancestor of public
`main` before scheduling the Mac. The public repository has **no self-hosted
runner**; workflow conditions alone cannot safely isolate a public PR runner.

## Operation

- `MACMINI_CI_DISPATCH_TOKEN`: fine-grained token scoped only to the private
  repository, with Actions read/write and Metadata read-only. Keep it in the
  public repository's Actions secrets; renew it before its chosen expiry.
- Manual hosted comparison: select `platform=ios`, `apple_runner=github`.
- Disable Mac routing: set `MACMINI_NATIVE_CI=false`. A dispatched job fails if
  the Mac is unavailable; it does not silently skip validation.
- The Mac runs one runner under the non-admin `mindwtr-ci` account, with its own
  home and primary group. No signing credentials are needed for this lane.
- Service: `actions.runner.dongdongbh-Mindwtr-native-ci.mindwtr-macmini` in
  `/Library/LaunchDaemons/`. It starts at boot and runs as `mindwtr-ci`.
- Service logs: `/Users/mindwtr-ci/Library/Logs/` under that service name.
  Runner diagnostics: `/Users/mindwtr-ci/actions-runner/_diag/`.

## Caches and validation

Swift and Xcode intermediates live under
`/Users/mindwtr-ci/Library/Caches/MindwtrNativeCI/<compiler-hash>/`.
The checkout retains `node_modules`; other generated/untracked sources are
removed before every build. Expo regenerates its native project on every run.
Xcode uses four compile workers; the single runner serializes heavy jobs.

Every Xcode 27 run retains the native Swift suites, SDK checks, bundled Release
simulator build, cold/warm link smoke tests, and unsigned device archive. A fresh
simulator is created and deleted for each Mac run. These are build checks;
signing, store distribution, and real-device validation remain separate.

To clear caches, stop or wait for the runner to become idle, then remove only the
compiler cache directory above. Old compiler directories can also be removed
after an Xcode upgrade. Keep the Mac awake and network-connected for CI.
