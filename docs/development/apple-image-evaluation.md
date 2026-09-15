# Apple image-to-Inbox evaluation

This development-only evaluation compares two local ways to turn one system-selected image into one editable Inbox proposal:

1. iOS 27 Foundation Models image input produces a JSON title and optional description.
2. Vision OCR recognizes text, then a deterministic baseline uses the first non-empty line as the title and the remaining lines as notes.

The evaluation is not a production capture feature. It has no camera, cloud, Private Cloud Compute, bulk extraction, automatic attachment, or synced setting. The ordinary capture flow remains the fallback.

## Integration

The leader-owned development route renders the named `AppleImageCaptureEvaluation` export from `apps/mobile/components/AppleImageCaptureEvaluation.tsx`.

Its optional props are:

- `onClose(): void`
- `onSaved(taskId: string): void`
- `controller: AppleImageEvaluationController`, for an isolated harness or test

The default controller lives at module scope as UI-session state. It therefore survives a route unmount when `MobileAppLockGate` hides the app. Moving inactive or unmounting cancels current inference and ignores a late result; it does not clear the selected preview or accepted draft. Process termination still clears the evaluation, which is acceptable for this prototype and must be reassessed before shipping.

The picker uses the system photo picker without first requesting broad photo-library permission. Mindwtr reads the selected local file but does not copy, delete, attach, upload, or sync it. `Cancel and forget image` clears only Mindwtr's in-memory reference.

The minimal UI is one scrollable screen: picker and source preview, Run/Cancel analysis, side-by-side model/OCR proposals with measured duration, editable title and notes, and one Save to Inbox action. Unsupported or unavailable model states keep the OCR proposal and manual capture available.

## Bounds and save contract

The JavaScript preflight rejects a known selection above 12 MiB, 24 megapixels, or 8,192 pixels on either axis. Native code repeats the byte check before ImageIO parses metadata, repeats the pixel checks before decode, and downscales the analysis image to at most 2,048 pixels on its longest side. This protects the model and OCR paths even when picker metadata is absent or wrong.

Model output is treated as untrusted data and parsed as one JSON object. Only `title` and `description` survive parsing. Dates, reminders, completion state, tags, people, projects, attachments, and any instruction-like fields are ignored. OCR output is also plain source data.

Save calls the normal core `addTask` action with `status: 'inbox'`, then waits for `flushPendingSave`. A stable capture UUID makes task creation idempotent. If creation succeeded but the durable flush exhausted its queue and failed, Retry calls the store's `retryPersistence` action; that action re-enqueues a fresh full snapshot before flushing. Editing is locked at that point so the visible draft cannot diverge from the already-created in-memory task. Success is shown only after the initial flush or explicit recovery resolves.

## Current Apple API contract

The implementation follows Apple's current beta declarations:

- `Attachment(image).label("selected-image")` inside a Foundation Models prompt builder.
- `LanguageModelSession(model:)` and `session.respond { ... }` for the on-device response.
- `SystemLanguageModel.default.availability` with explicit unavailable reasons.
- `VNRecognizeTextRequest` for the independent OCR baseline. Apple's new `OCRTool` is not used as the baseline because it is a model tool and is unavailable in Simulator.

The iOS 27-only attachment and image-prompt symbols sit behind both `#if compiler(>=6.4) && canImport(FoundationModels)` and `@available(iOS 27.0, macOS 27.0, *)`. Apple lists Xcode 27 with Swift 6.4 and Xcode 26.6 with Swift 6.3, so Xcode 26 keeps compiling the app's existing deployment range without parsing those new symbols. The pod keeps the app minimum at iOS 15.1 and weak-links Foundation Models.

Primary sources:

- [Analyzing images with multimodal prompting](https://developer.apple.com/documentation/FoundationModels/analyzing-images-with-multimodal-prompting)
- [Attachment](https://developer.apple.com/documentation/foundationmodels/attachment)
- [SystemLanguageModel availability](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.property)
- [OCRTool](https://developer.apple.com/documentation/Vision/OCRTool)
- [WWDC26: What's new in image understanding](https://developer.apple.com/videos/play/wwdc2026/237/)
- [WWDC26: What's new in Foundation Models](https://developer.apple.com/videos/play/wwdc2026/241/)
- [Xcode SDK and system requirements](https://developer.apple.com/xcode/system-requirements)

These APIs are beta. Exact compilation must pass on the final Xcode 27 SDK before any production recommendation.

## Corpus and scoring protocol

The representative manifest is `scripts/apple-evaluation/image-corpus.json`. Store test images outside the repository in a device-local directory. Use synthetic or evaluator-owned material with no credentials or real personal data. Do not add image binaries to git.

Run every readable case through both methods from a cold launch and a warm launch, offline. Record the raw proposal privately on the test device only long enough to score it; the checked-in results must contain scores and timings, never source or extracted text. Run lifecycle cases separately: cancel during OCR, cancel during model generation, background/lock, foreground, rotate/resize, repeated Save, and injected persistence failure.

Before collecting results, use these go/no-go thresholds:

- At least 30 readable images, with at least 4 each for UI screenshots, photographed print, handwriting, and multilingual text; include all negative and oversized manifest cases.
- Model useful-proposal rate at least 80% overall and at least 70% in every readable category.
- Model improves useful-proposal rate over OCR by at least 10 percentage points, or reduces median edits-to-accept by at least 25%, without worsening false proposals.
- Zero invented commitments, dates, reminders, completion state, people, or projects in the saved task. The parser and save shape must keep this true even if raw model output contains those fields.
- Invented factual details in title/description at or below 2% of readable proposals, with zero high-severity inventions.
- Zero proposals for blank or irrelevant images unless the evaluator can identify a concrete, supported action in the source.
- On the slowest supported test device: warm p50 at or below 2.5 seconds, warm p95 at or below 6 seconds, and incremental peak memory at or below 150 MiB.
- Cancel updates the UI within 250 ms, produces no task, and leaves no native operation running after 1 second in all 20 cancellation trials.
- Zero duplicates or false success messages in 100 repeated-save, lock/unlock, and persistence-failure trials.
- Offline results match the local-path expectations, with no network request attributable to the evaluation.

Defer shipping if any threshold is missed, if Xcode 26 compatibility or Xcode 27 archive validation fails, or if physical-device measurements are unavailable. The current implementation has no measured quality, latency, memory, energy, cancellation-stop, or offline-network evidence.

## Current recommendation and effort

**Defer production adoption.** The bounded controller and bridge are ready for CI and device evaluation, but no iOS 27 device evidence exists yet. A production recommendation would be speculation before the corpus and lifecycle thresholds are measured.

Estimated remaining evaluation effort is 1–2 engineer-days once a supported iOS 27 device and Xcode 27 runner are available. If the thresholds pass, production hardening is another 3–5 engineer-days for localized UI placement, accessibility/device passes, lifecycle instrumentation, final-SDK prompt retesting, user documentation, and release-channel validation. A threshold miss may require prompt or image-pipeline work and a new measurement run, so that work is intentionally not included in the estimate.

## Validation commands

From the repository root:

```bash
rtk bun test apps/mobile/lib/apple-image-evaluation.test.ts apps/mobile/lib/apple-image-native-source.test.ts
rtk bun run typecheck:mobile
```

On a Mac with Xcode 27:

```bash
cd apps/mobile/modules/apple-image-capture
swift test
```

The Swift package test covers bounds without requiring a model. The app archive and physical iOS 27 device run remain required because Linux and Simulator cannot validate the image model or `OCRTool` availability.

## Release diagnostic integration

The component records privacy-safe events with `releaseCheck = v1.3.1/apple-image-capture-evaluation` and only `stage`, `outcome`, and `kind`. It never logs the image URI, extracted text, proposal, task ID, model response, or credentials.

The leader-owned diagnostics ledger needs this entry under v1.3.1:

- `apple-image-capture-evaluation` — `apps/mobile/components/AppleImageCaptureEvaluation.tsx`; tester log must show `analysis/completed` and `save/persisted`, or a bounded failure/cancellation outcome, without source content.
