# Desktop navigation geometry — September 13, 2026

## Result

Sidebar navigation now changes the content width together with the rendered
page. The sidebar still selects the requested destination immediately. This
removes the outgoing page stretching sideways while a destination is loading.
The shared fix covers Projects, Contexts, Board, Settings, and the other routes
that switch between narrow, list, chart, and full-width layouts.

This is a visual-stability correction, not a measured route-latency improvement.
No data, sorting, route semantics, animation, loading delay, or persistence change
is included. Public docs: no change needed.

## Recording and diagnosis

The supplied private recording was inspected as decoded frames using ffprobe's
`best_effort_timestamp_time`; its frame rate is variable. The 47.194-second,
3822 × 2150 recording showed these intervals:

| Transition | First frame with outgoing geometry changed | First destination frame | Observed interval |
| --- | --- | --- | --- |
| Inbox → Projects | 3.259978 s | 3.372189 s | 112 ms |
| Archived → Settings | 28.624156 s | 28.848300 s | 224 ms |
| Review → Contexts | 40.451644 s | 40.608467 s | 157 ms |

These are intervals in the recording, not measured input-to-presentation latency.
The recording and its frames contain personal task text and remain local.

`App` already kept sidebar selection (`currentView`) separate from the route
rendered in a React transition (`activeView`). `Layout` sized the outgoing page
using `currentView`, so an urgent click changed the container before the lazy
route committed. App now passes its normalized rendered route as `contentView`;
only Layout's width decisions use it. The disabled-Timeline fallback and focus
mode keep their existing behavior.

## Reproduction and regression checks

The production Chromium control reproduced the fault with Board and Settings
chunks held: at a 1920 × 900 viewport, the outgoing Focus container changed from
x=512, width=1152 to x=256, width=1664. The heading moved left by 256 pixels before
the destination appeared. Across the two held-chunk cases and 15 successive
sidebar destinations, 11 of 17 checks failed on the control.

The final candidate passed all 21 checks: held Board/Settings chunks at widths
800, 1280, and 1920, plus 15 successive sidebar destinations at width 1920.
The harness checks both DOM mutations and animation frames, retains immediate
sidebar selection, and checks the destination's final width. It uses ten
synthetic tasks, isolated browser contexts, dark theme, Timeline enabled, and
blocked external requests. Screenshots of the control and candidate were inspected.
The observer reads layout; these runs must not be treated as timing benchmarks.

The App regression failed before the production edit while Calendar remained
visible under a prematurely full-width wrapper. It now covers suspended
Settings, a later Review request, stale Settings resolution, and the eventual
page/geometry commit. Layout's tests cover every width class, saved searches,
independent sidebar selection, and focus-mode precedence.

Validation completed:

- 62 focused App/Layout cases passed; the navigation case also passed alone
  without React act warnings.
- Desktop TypeScript, scoped ESLint, script syntax, and diff checks passed.
- Production web build and Linux Benchmark native build passed.
- Both desktop 5,000-task ListView/Timeline render budgets passed.
- Existing Settings browser checks passed at 800/1280 pixels in light/dark mode,
  including suspended routes, latest navigation, search, and lazy subpages.
- Independent Sol review found no blocking issue.

## Native Linux confirmation and limits

The actual Tauri/WebKitGTK candidate passed all 15 successive navigation checks
at 1600 × 900 CSS pixels and devicePixelRatio 2. Each run verified the Benchmark
app name, exact isolated portable data path, synthetic fixture, canonical
interactive readiness, and ownership of the executable and niri window. Only
that window was resized. Projects, Contexts, Board, and Settings screenshots were
retained; the Contexts screenshot was inspected.

An archived pre-fix native executable reproduced eight geometry failures in the
same 15-destination sequence. Its source/bundle predates the current browser
control, so this is corroborating reproduction, not a matched native performance
comparison. There is no macOS, Windows, or compositor-frame latency claim.

Initial direct native launches failed GTK initialization before opening a window.
Those failed reports remain. A diagnostic launcher confirmed the inherited
DISPLAY/Wayland/runtime paths and then completed both candidate and control runs;
the initial startup failure's cause was not established. Missing host libraries
also prevented Playwright WebKit use. System packages and global display settings
were not changed. Owned test sessions/windows were closed; normal Mindwtr data
and the Android lab state were untouched.

## Provenance and rerun

Source base: `cde9cd61adcbf5d6b0fd8b893892e757d96561e4`, plus this commit's
App/Layout changes. Worktree:
`/home/dd/worktrees/Mindwtr/desktop-transition-flash-20260913`.
Local artifacts: `/home/dd/.cache/mindwtr-transition-flash/20260913`.

- `video-observations.json`, `frame-times.json`, and selected decoded frames:
  private recording evidence; do not publish task text or raw frames.
- `control-provenance.json`: browser control source
  `51a851d2d0f82aad7978db7b0a8e8632ebdf051a`; app/package/lockfile sources match
  the base above. Recorded dist hash:
  `4ecbda9bb7660e1ec6e156102ac3464d494ce5208a872f3ac190cb279dce973f`.
- `candidate-final-dist/` and `candidate-final-dist-manifest.json`: archived
  unprofiled final production build; manifest SHA-256
  `b666844e2c8924cddc3fab0b7fbc374d9b6b8b00ae8117151236e1fff0e30600`.
  Native compilation rebuilt the web bundle with profiling, so final browser
  validation was repeated after restoring a plain production build.
- `candidate-provenance.json`: exact changed-file and lockfile hashes, Linux
  7.1.11/Arch x86_64, Bun 1.3.3, Node 22.23.2.
- `control-all/report.json`, `candidate-final/report.json`, and
  `settings-final.log`: production-browser results and synthetic screenshots.
- `native-candidate/mindwtr`: SHA-256
  `ae2b19514376cf8d204013d80508e4a3f0d8262ce65cfb80de8d1c66f963fe5a`;
  `VITE_STARTUP_PROFILING=1`, Benchmark identifier/product override, no bundle.
- `native-control/mindwtr`: preserved pre-fix executable, SHA-256
  `e663e22d45b7ffbeaaeadde0fad14ad0a07a85584399840a6d4021dfb35cc87a`.
- `native-navigation-display-debug.mjs` and each native directory's
  `run-display-debug/report.json`: launcher, ownership/readiness assertions,
  geometry observations, and owned-window screenshots.

The native build reused only the ignored Cargo target directory under the older
`desktop-stability-20260912` worktree. Its source checkout was not changed; the
new binary in that target directory must not be attributed to the older source.
Both actual executables are archived separately above.

Run the committed browser regression after a production build:

```bash
rtk bun run desktop:web:build
rtk proxy env WIDTHS=800,1280,1920 bun scripts/performance/navigation-layout.mjs
```

`DESKTOP_ROOT` selects a different checkout's built desktop directory, `OUT_DIR`
selects retained evidence, and `PORT` selects the local preview port. Default
output is `build/navigation-layout` under the checkout. The App regression runs
in normal desktop CI. No existing performance budget was changed.

The next bounded desktop check is a native Windows/macOS navigation confirmation
when those runtimes are available. The separate capture/save and Android
investigations remain open as recorded in the stability handoff.
