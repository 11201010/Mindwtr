# Apple evaluation validation

Tracks the local implementation gates for #915, #1194, #1214, and #1195.
These are iOS prototypes and investigations. Passing JavaScript checks or an
unsigned archive does not establish Siri understanding or model quality. The
PCC work is a development-only synthetic comparison harness. It has no task
content or production workflow integration.

## Build matrix

| Configuration | Purpose | Required evidence |
| --- | --- | --- |
| Existing Xcode 26 / iOS 26 SDK | Compile optional-module fallbacks and the on-device clarification APIs | Native Platform CI, existing App Intents/plugin checks |
| Xcode 27 / iOS 27 SDK | Compile search/image APIs and validate Release metadata extraction | Explicit iOS 27 native CI run and unsigned Release archive |
| Xcode 27 PCC API preflight | Compile the real standalone PCC engine for ARM64 simulator/device and the unavailable Intel path | Explicit `platform=apple-api` or full iOS native CI run |
| Older supported iOS runtime | Preserve capture, queries, manual Inbox processing, and startup | Simulator/device smoke test at the existing deployment floor |
| Apple Intelligence-capable iPhone and iPad | Establish availability, quality, cancellation, and performance | Recorded hardware, OS/model version, corpus results, and diagnostics |
| Signed PCC-enabled development App ID | Establish provisioning and one minimal PCC request | Inspected signed entitlement/profile plus physical-device smoke record |

No row is satisfied merely by adding its workflow or test command. Record the
exact revision and run URL when it actually runs. This Linux development host
does not have Xcode or an Apple model-capable runtime.

## Native build

For a fast API-only check, dispatch Native Platform CI with
`platform=apple-api`. This typechecks the actual search and image engines
against simulator and device SDKs without installing React Native dependencies.
It does not compile the Expo bridge or replace the full `platform=ios` run.
The affected pods explicitly enable Swift cross-import overlays; the SDK's
Core Spotlight/Foundation Models integration is not visible to CocoaPods' Swift
compiler without that setting. The full Xcode 27 lane runs this preflight too.

The existing **Native Platform CI** runs Xcode 26 and Xcode 27 matrix lanes.
Dispatch it with `platform=ios` on the revision being evaluated.
Each lane checks its required toolchain,
checks its actual SDK version, records the toolchain, generates a clean Expo
project, compiles native modules, and builds an unsigned Release archive.
It fails if the requested SDK is unavailable; an older-SDK fallback is not
valid evidence for newer APIs. The iOS 27 job uses GitHub's
[`xcode-27` preview image](https://github.com/actions/runner-images/issues/14404),
not the regular macOS image. Runner image availability is an external gate.

On a Mac, the same selector can record the intended toolchain:

```sh
bash scripts/ci/select-apple-sdk.sh 27
```

The script exports `DEVELOPER_DIR` for its own checks and writes it to
`GITHUB_ENV` in CI. For local subsequent commands, select that printed
developer directory in your shell or Xcode before building.

The archive disables signing. Provisioning, signed-device installation,
AppIntentsTesting against the built app, and App Store acceptance require
separate checks. A release archive also disables JavaScript development-only
entry points; use a development client to exercise the evaluations.

The PCC engine lives in
`modules/apple-foundation-models/ios/ApplePccEvaluationEngine.swift`. The Apple
API preflight typechecks that file for ARM64 simulator/device and the guarded
Intel fallback. A full iOS job also compiles it through the module podspec.
Neither check proves that Apple granted the signed App ID access.

## Open the prototypes

Use an iOS development client built with `APP_VARIANT=development` and a
JavaScript development session. Open the `/apple-evaluation` route for Search
and Image capture. For Inbox clarification, choose the on-device backend in
Settings > AI, then use Clarify while processing an Inbox item. Apply changes
only the editable draft; the normal Inbox Save action persists it.

Add `MINDWTR_PCC_EVALUATION_ENABLED=1` to the development build to expose the
PCC comparison tab and request the managed entitlement. The tab uses synthetic
native-owned fixtures and explicit consent for each PCC request. Follow
`apple-pcc-evaluation.md` for signing and device evidence.

The unsigned Release CI archive intentionally has no development entry points.
Use separate evaluator data and record actual hardware results in the feature
reports; the checked-in search result fixture only tests the scoring harness.

## Device sequence

1. Use a development build with non-production test data. Keep the existing
   minimum OS and ordinary capture/search available.
2. Check model readiness and language support before inference. Test disabled
   Apple Intelligence, model download pending, offline use, and cancellation.
3. Run each feature's predeclared corpus and quality thresholds. Record real
   result IDs, extraction errors, latency and memory observations; leave
   unmeasured values blank.
4. Repeat after backgrounding, app lock, rotation/resizing, task deletion,
   edits from another surface, and a failed durable save. A stale response
   must not overwrite a newer draft or produce a duplicate task.
5. Verify system-search publication opt-out, index removal, snapshot caps,
   and missing identifiers. Never treat capped search results as a full-store
   answer. Do not let model output override explicit filters.
6. Exercise App Intents in order: native framework tests, Shortcuts,
   Spotlight, then representative conversational Siri requests. A queued
   operation must not claim a completed durable mutation.
7. Share only privacy-safe diagnostics and aggregate evaluation results.
   Do not include private task text, images, prompts, responses, or credentials.
8. For PCC, run the on-device synthetic baseline without consent or network,
   then complete the signed-device PCC smoke before the PCC planning fixture.
   Inspect the signed entitlement and profile separately from runtime readiness.

## Shipping decision

Search and image capture require a separate production scope after the
evaluation. Clarification requires successful native and community/device
testing. Unsupported Siri action contracts remain deferred until their
entity and durable mutation-completion requirements are satisfied. Keep
the issues open while these gates are outstanding. PCC also remains an
evaluation until signed provisioning, device smoke, and the predeclared
quality and performance thresholds pass.
