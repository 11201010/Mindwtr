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
- Watchman starts with `--no-site-spawner` because the CI account has no desktop
  session. Xcode is selected from `/Applications/Xcode.app`; Ruby 3.3 and
  Watchman are installed through Homebrew.

## Caches and validation

Swift and Xcode intermediates live under
`/Users/mindwtr-ci/Library/Caches/MindwtrNativeCI/<compiler-hash>/`.
The checkout retains `node_modules`; other generated/untracked sources are
removed before every build. Expo regenerates its native project on every run.
Xcode uses `-jobs 4`; the single runner serializes heavy jobs.

Every Xcode 27 run retains the native Swift suites, SDK checks, bundled Release
simulator build, cold/warm link smoke tests, and unsigned device archive. A fresh
simulator is created and deleted for each Mac run. These are build checks;
signing, store distribution, and real-device validation remain separate.

To clear caches, stop or wait for the runner to become idle, then remove only the
compiler cache directory above. Old compiler directories can also be removed
after an Xcode upgrade. Keep the Mac awake and network-connected for CI.

## Initial measurements (2026-09-22)

Both completed runs below used the same application source and the full Xcode 27
validation lane. The Mac had populated Swift/simulator caches from setup; its
device archive cache was initially empty. These are observed runs, not a promise
for every commit.

| Step | GitHub hosted | Mac mini |
| --- | ---: | ---: |
| Release simulator build | 31m20s | 5m53s |
| Cold/warm link smoke | 9m31s | 3m03s |
| Unsigned device archive | 14m51s | 3m38s |
| Complete job, including setup/uploads | **61m40s** | **14m58s** |

Evidence: [hosted run](https://github.com/dongdongbh/Mindwtr/actions/runs/35757773554),
[Mac run](https://github.com/dongdongbh/Mindwtr-native-ci/actions/runs/35780193263)
(private). The first Mac setup attempt was cancelled after Watchman tried to use
a missing desktop session; the startup fix above is included in the successful
run. An additional hosted comparison was stopped after the Mac completed.

The [public dispatch verification](https://github.com/dongdongbh/Mindwtr/actions/runs/35781965801)
successfully dispatched a [second Mac run](https://github.com/dongdongbh/Mindwtr-native-ci/actions/runs/35782090078)
which completed in **13m57s**, then downloaded and republished its validation
artifact in the public run. This verified the scoped token and result/artifact
handoff, as well as a repeat run with existing caches.
