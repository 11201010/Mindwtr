# Apple evaluation validation

Tracks the local implementation gates for #915, #1194, #1214, and #1195.
These are iOS prototypes and investigations. Passing JavaScript checks or an
unsigned archive does not establish Siri understanding or model quality.
No Private Cloud Compute integration is included.

## Build matrix

| Configuration | Purpose | Required evidence |
| --- | --- | --- |
| Existing Xcode 26 / iOS 26 SDK | Compile optional-module fallbacks and the on-device clarification APIs | Native Platform CI, existing App Intents/plugin checks |
| Xcode 27 / iOS 27 SDK | Compile search/image APIs and validate Release metadata extraction | Explicit iOS 27 native CI run and unsigned Release archive |
| Older supported iOS runtime | Preserve capture, queries, manual Inbox processing, and startup | Simulator/device smoke test at the existing deployment floor |
| Apple Intelligence-capable iPhone and iPad | Establish availability, quality, cancellation, and performance | Recorded hardware, OS/model version, corpus results, and diagnostics |

No row is satisfied merely by adding its workflow or test command. Record the
exact revision and run URL when it actually runs. This Linux development host
does not have Xcode or an Apple model-capable runtime.

## Native build

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

## Shipping decision

Search and image capture require a separate production scope after the
evaluation. Clarification requires successful native and community/device
testing. Unsupported Siri action contracts remain deferred until their
entity and durable mutation-completion requirements are satisfied. Keep
the issues open while these gates are outstanding.
