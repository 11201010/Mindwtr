# Stable store rollouts

Scheduled stable releases remain biweekly, usually advancing the patch component
by five (for example `1.0.0` to `1.0.5`). Intervening hotfixes use the available
patch numbers; RCs target the upcoming stable (`1.0.5-rc.1`, `1.0.5-rc.2`).
Always keep versions increasing if more hotfixes exhaust that gap.
Rollout promotion does not change the version or rebuild a package.

## Defaults

| Channel | Stable release behavior |
| --- | --- |
| iOS and macOS App Store | Apple phased release, automatic after approval |
| Google Play production | 5%, `inProgress` |
| Microsoft Store production | 5%, gradual package rollout |
| Play beta/internal | Completed, same standard AAB and versionCode |
| RC TestFlight, Play testing, Microsoft Beta flight | Existing beta distribution |
| GitHub downloads and other package channels | Existing distribution, no staging |

Apple progresses automatically through 1%, 2%, 5%, 10%, 20%, 50%, and 100%
over seven days. Anyone can still update manually. Manage pause, resume, or
release-to-all in App Store Connect, independently for iOS and macOS.
See [Apple phased releases](https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases)
and [Fastlane's phased_release option](https://docs.fastlane.tools/actions/deliver/#phased_release).

Play and Microsoft require explicit promotion. After each store actually starts
distribution, aim for 5% → 20% → 50% → 100% over roughly three to seven days.
Review crash/ANR reports, launch failures, storage/migration and sync errors,
feedback, and reviews before each increase. Time elapsed alone is insufficient.
Pause expansion for a credible data-loss report. Small cohorts or delayed
telemetry can mean there is insufficient evidence to promote yet.

## Operate an existing rollout

Use GitHub Actions **Manage Store Rollout** (`rollout.yml`) from `main` once this
workflow is published. It uses the existing Store credentials and uploads no
packages. The default action is `status`.

- `store=play`: supply the exact production `version_code` from the release
  summary. Actions: `status`, `increase`, `halt`, `resume`, `finalize`.
- `store=msstore`: supply the exact production `submission_id` from the Windows
  release summary or Partner Center. Actions: `status`, `increase`, `halt`,
  `finalize`. Microsoft does not support resuming a halted rollout.
- `percentage` is used only by `increase`, must exceed the current percentage,
  and must be below 100. Use `finalize` to complete the rollout.

For example, after reviewing health evidence:

```sh
rtk gh workflow run rollout.yml --ref main -f store=play -f action=status -f version_code=150
rtk gh workflow run rollout.yml --ref main -f store=play -f action=increase -f version_code=150 -f percentage=20
rtk gh workflow run rollout.yml --ref main -f store=msstore -f action=increase -f submission_id=SUBMISSION_ID -f percentage=20
rtk gh workflow run rollout.yml --ref main -f store=play -f action=finalize -f version_code=150
rtk gh workflow run rollout.yml --ref main -f store=msstore -f action=finalize -f submission_id=SUBMISSION_ID
```

Replace example identifiers with live verified values. The controllers reject
stale or ambiguous targets and invalid transitions. Mutations are serialized
with publishing. Play's shared lock also covers beta/internal and version-code
lookups because every new edit can invalidate a prior edit for the same account;
see [Google's edit lifecycle](https://developers.google.com/android-publisher/edits).
If a request loses its response, inspect current
status before any retry; a failed workflow can still have changed the store.
Never rerun the build/release workflow merely to increase a rollout.

On Microsoft, even 100% selection is not the same as finalizing: finalization
stops distribution of older packages. A halted rollout cannot be resumed or
finalized through these API controls; submit a new version to continue delivery.
See [Microsoft gradual rollouts](https://learn.microsoft.com/en-us/windows/apps/publish/gradual-package-rollout)
and the [finalization API state requirement](https://learn.microsoft.com/en-us/windows/uwp/monetize/finalize-the-package-rollout-for-an-app-submission).
On Play, halting does not remove an already installed update; see
[Play staged rollouts](https://support.google.com/googleplay/android-developer/answer/6346149).

## Corrective hotfixes

Ordinary hotfixes are staged too. For a critical correction, choose
`rollout_mode=immediate` when dispatching `release.yml`, or disable
`phased_release` when dispatching an Apple reusable workflow directly.
Play/Windows standalone workflows accept `rollout_mode` and `rollout_percentage`.
Immediate mode disables staging and releases after the normal store review.

Tag pushes cannot carry dispatch inputs. If an emergency release must be
immediate on the initial tag-triggered run, set repository Actions variable
`RELEASE_ROLLOUT_MODE=immediate` **before** pushing that tag; restore it to
`staged` (or remove it) after the run has resolved its policy. Check the
**Validate store rollout policy** summary. An unset variable means staged.
Do not start a second publishing run while the tag-triggered run is active.
Changing inputs on a later recovery run does not alter an already-published
release; use the rollout controls for that release instead.

## Release evidence

Record each store's approval/distribution state, identifier, rollout percentage,
last health check, and next decision. A green upload job does not establish
store approval or full distribution. Close release follow-through only when
Play and Microsoft are finalized and Apple's phased release is complete,
or explicitly hand off a paused rollout with its reason.

No live store mutations are needed for the local tests. Run:

```sh
rtk python3 scripts/ci/android-play-release-plan.test.py
rtk python3 scripts/ci/google-play-edit.test.py
rtk bun test scripts/ci/msstore-rollout.test.js scripts/ci/validate-store-rollout-workflow.test.js scripts/ci/validate-release-rc-workflow.test.js
```
