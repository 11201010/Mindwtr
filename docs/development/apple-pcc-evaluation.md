# Apple Private Cloud Compute evaluation

Issue #1214 includes a development-only comparison harness for Apple Foundation Models. It sends two fixed synthetic fixtures to either the on-device model or Private Cloud Compute (PCC). The harness has no task-store import and no save or Apply action.

PCC needs iOS or iPadOS 27, network access, a daily per-person quota, and Apple's managed `com.apple.developer.private-cloud-compute` entitlement. Team access alone does not prove that the App ID, provisioning profile, signed app, or device request can use PCC.

Apple's published PCC access terms, checked on 2026-09-16, list three conditions for no-cloud-API-cost access: App Store Small Business Program enrollment, fewer than two million first-time App Store downloads, and an assigned PCC entitlement. Apple documents App Store distribution plus TestFlight and ad hoc evaluation for eligible teams. These published conditions do not establish Mindwtr's account eligibility, App ID capability, or signed provisioning state.

## Build gate

The default, benchmark, preview, and production configurations omit the PCC entitlement. Enable the evaluator for a development build with both variables:

```sh
cd apps/mobile
APP_VARIANT=development \
MINDWTR_PCC_EVALUATION_ENABLED=1 \
bunx expo prebuild --clean --platform ios

APP_VARIANT=development \
MINDWTR_PCC_EVALUATION_ENABLED=1 \
bunx expo run:ios --device
```

The config sets three linked values:

- `extra.applePccEvaluationEnabled = true` controls the JavaScript route and component.
- `MindwtrPccEvaluationEnabled = true` in Info.plist controls the native module.
- `com.apple.developer.private-cloud-compute = true` requests the managed entitlement during signing.

`APP_VARIANT=development` without the PCC flag keeps all three off. Supplying the PCC flag to a stable or benchmark build also keeps them off. The config removes an inherited PCC entitlement when the gate is off.

## Provision a signed device build

Perform these checks on a Mac with access to the Apple Developer account:

1. Confirm that Apple assigned PCC access to the team.
2. Enable the managed PCC capability on the exact development App ID, `tech.dongdongbh.mindwtr.dev`.
3. Regenerate the development, ad hoc, or TestFlight provisioning profile after enabling the capability. A profile created before the change cannot prove access.
4. Build and sign the development app. Inspect the signed app without private `SecTask` APIs:

   ```sh
   codesign -d --entitlements :- /path/to/Mindwtr\ Dev.app
   security cms -D -i /path/to/profile.mobileprovision
   ```

5. Confirm that both artifacts contain `com.apple.developer.private-cloud-compute` with the expected value and App ID scope.
6. Install the signed build on an Apple Intelligence-capable iPhone or iPad running iOS or iPadOS 27. A simulator, unsigned archive, capability status, or model-ready response does not prove signed entitlement access.

Do not change Apple Developer portal capabilities from an automated evaluation run. Record the App ID and profile creation date without copying certificates, profile contents, account identifiers, or credentials into the repository.

## Data boundary and request sequence

The native engine owns both fixture IDs and their text. JavaScript can send only:

```text
requestId
backend = on_device | private_cloud_compute
fixtureId = smoke | project_planning
consent = true | false
```

The bridge rejects extra request fields. It cannot accept task text or an arbitrary prompt. Guided output contains a summary and no more than three next-action suggestions. TypeScript checks the shape and length again. The evaluator never creates, updates, completes, or schedules a task.

Use this sequence on a signed device:

1. Open the development-only Apple evaluation route. Confirm that both synthetic fixture texts appear before any request.
2. Run the on-device smoke and project-planning fixtures as the local baseline. These requests need no PCC consent or network.
3. Select the smoke fixture. Read the PCC disclosure, grant consent for that request, and run it. Starting the request consumes the consent state.
4. Run the PCC project-planning fixture only after the PCC smoke succeeds. Grant consent again.
5. Compare the same fixture across both backends. A failed PCC request keeps the fixture and prior results. Select the local backend yourself if you want another on-device run; the app never falls back on its own.
6. Cancel one request, background the app during another, and leave the route during a third. A late response must not replace a newer result or appear after cancellation.

Capability checks do not start inference. They report stable build, OS, device, readiness, locale, and quota states. Capability availability does not inspect or prove the signed entitlement.

## Failure matrix

| Outcome | Expected evaluator behavior |
| --- | --- |
| `evaluation_disabled` | Hide the route or explain that evaluation is not enabled. Do not instantiate the PCC model. |
| `unsupported_sdk` / `unsupported_os` | Keep both fixtures and existing results. State the required SDK or OS. |
| `unsupported_device` / `system_not_ready` | Keep manual evaluation controls inert until the device or model becomes ready. |
| `locale_unsupported` | Do not send a request. Record the tested locale. |
| `quota_exhausted` | Keep prior results and explain the daily quota. Do not offer an upgrade or retry loop. |
| `network_failure` / `service_unavailable` | Keep prior results. Offer a later explicit PCC retry or an explicit on-device run. |
| `consent_required` | Do not invoke native inference. Ask for consent for the next PCC request. |
| `cancelled` / `timeout` | Cancel native work and ignore late output. The JavaScript timeout is 60 seconds. |
| `refused` / `malformed_output` | Show a stable explanation and retain the fixture. Do not display or log raw model output. |
| `unknown` | Show a generic failure. Do not display a native error description. |

The evaluator does not retry inference. It does not switch backends after a failure.

## Thresholds set before device evaluation

Run ten attempts per fixture, backend, hardware model, OS build, model version, and locale after capability reports available.

Hard safety requirements:

- Every native request uses one fixed fixture ID and contains no task/store content.
- Every PCC request follows an unchecked-to-checked consent action, and the UI clears consent when the request starts.
- Every completed response contains a summary of at most 600 characters and no more than three actions of at most 200 characters each.
- No response invents a date, assignment, completed action, saved record, task ID, or firm commitment.
- Cancellation, timeout, background lock, and route unmount produce no late UI update or data write.
- Network inspection shows no inference or fixture/task-content upload during mount, fixture loading, capability checks, or an on-device run. PCC locale/readiness metadata checks may use the network because `supportsLocale(_:)` is asynchronous and can fail.

Quality thresholds for the project-planning fixture:

- At least 9 of 10 summaries preserve the tentative room and unknown accessibility state without turning either into a fact.
- At least 9 of 10 runs suggest actions grounded in the listed open questions.
- All runs remain useful without asking for task-store access or claiming authority over GTD state.

Performance thresholds:

- On-device median latency stays at or below 3 seconds and p95 stays at or below 8 seconds.
- PCC median latency stays at or below 6 seconds and p95 stays at or below 15 seconds on the tested network.
- Cancel changes the UI state within 250 ms.
- A 20-request sequence shows no serious or critical thermal state, no sustained memory growth above 20 MiB after sessions release, and no battery drop above 3 percentage points on a charged unplugged device under otherwise idle conditions.

Any hard-safety failure stops the evaluation. Record a quality or performance miss and revise the prompt or schema before another full run.

## Device record

Leave unknown fields blank. Do not infer a model version, entitlement state, memory value, or battery cost from CI.

| Field | Value |
| --- | --- |
| Hardware model | |
| OS build | |
| App commit and build profile | |
| Signed App ID | |
| Provisioning profile creation date | |
| Signed entitlement inspected | |
| Foundation Models model version, when exposed | |
| Locale and region | |
| Fixture revision | |
| Backend | |
| Attempts / completed / failed | |
| Failure outcomes | |
| Median / p95 latency | |
| Peak and post-run memory | |
| Thermal observations | |
| Battery before / after | |
| Network condition | |
| Safety threshold result | |
| Quality threshold result | |

## Diagnostics

The evaluator uses release check `v1.3.1/apple-pcc-evaluation`. It records only `backend`, `operation`, `outcome`, `durationMs`, and a fixed allowlisted `fixtureId`. Logs contain no fixture text, prompt, response, generated suggestion, task data, raw error, account detail, or credential.

## Apple references

- [Adding server-side intelligence with Private Cloud Compute](https://developer.apple.com/documentation/foundationmodels/adding-server-side-intelligence-with-private-cloud-compute)
- [PrivateCloudComputeLanguageModel](https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel)
- [PCC managed entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.private-cloud-compute)
- [Accessing Private Cloud Compute](https://developer.apple.com/private-cloud-compute/)
- [Provisioning with managed capabilities](https://developer.apple.com/help/account/reference/provisioning-with-managed-capabilities)
