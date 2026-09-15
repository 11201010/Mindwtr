# Apple on-device task-search evaluation

Issue #1194 is implemented as a development-only iOS evaluation. It does not
enable a production search surface.

## Execution boundary

The optional Expo module lives at
`apps/mobile/modules/apple-task-search`. Its podspec preserves the app's iOS
15.1 deployment floor. Calls return unavailable outside a debug build, on an
older runtime, when the selected SDK/compiler cannot expose the APIs, or when
`SystemLanguageModel` is unavailable. The UI route is development-only and is
rendered inside the root `MobileAppLockGate`.

The tool uses one `CoreSpotlightSource`, requests item output with
`Guide.focused(.items)`, and caps the source and returned unique task IDs at 50.
It accepts an indexed item only when its content URL is an exact
`mindwtr://open?task=<non-empty-id>` link. Widget entries or unrelated indexed
content therefore cannot become task matches. The model-generated response is
discarded; only events from `SpotlightSearchTool.searchResults` are consumed.
Task text is treated as untrusted data and is never executed as an instruction.
Queries are trimmed and limited to 500 characters in both JavaScript and Swift.

## Result completion and cancellation

Apple marks each search reply as `partial` or `complete`; complete is the final
reply for that query token. The response call can finish while the listener is
still processing its last batches. After `LanguageModelSession.respond`
returns, Mindwtr performs a bounded drain:

1. poll the actor-isolated collector every 25 ms;
2. track Apple's opaque query tokens and require a complete reply for every
   observed token;
3. after all observed tokens are complete, wait until the collector revision is
   unchanged for two polls;
4. stop after ten polls (250 ms) even if the stream remains open;
5. atomically verify the same revision and complete-token set while closing the
   collector; retry if a new partial token interleaved after the poll;
6. return results only from a stable completed stream; throw an explicit
   incomplete-stream error on timeout, discarding partial IDs;
7. cancel the listener in deferred cleanup.

Each search and cancel call carries the same random request ID. Native code
retains a bounded set of cancel-before-registration tombstones, so an Expo
async cancel that reaches the coordinator first is consumed when that request
arrives. A delayed cancellation for an older ID cannot cancel a newer search.

This avoids the immediate-snapshot race, silent partial success, and an
indefinite wait on a long-lived stream. Replacement queries cancel their
predecessor. AbortSignal, explicit module cancellation, and Expo module
destruction also cancel the active native task. Cancellation after a native
result is delivered is still checked before JavaScript accepts it.

## Stable-ID hydration and filters

Native output contains the opaque indexed ID and stable task ID. React Native
uses those as candidates only. It reads the latest store entities and filters
after native search returns, retains only candidate IDs in component state,
and revalidates again on every later store/filter change and immediately before
opening a result. It then:

- deduplicates by task ID in result order;
- drops missing and deleted tasks;
- hydrates title and all other display fields from current store state;
- applies the shared global-search status, completion, reference, future,
  area, token, location, due-date, week-start, and scope rules;
- opens only the exact revalidated ID through the normal task editor.

Semantic matching cannot weaken an explicit filter. A stale ID never falls
back to a title match, including when two current tasks have the same title.
Diagnostics record only stage, aggregate match/accepted/dropped counts, and
elapsed time under `v1.3.1/apple-search-evaluation`; prompts, task text, and
identifiers are excluded.

## Privacy and production blockers

The development route respects the existing app-lock gate. The current
Spotlight publisher, introduced before this evaluation, does not have a user
opt-in tied to system-search publication. It also reindexes only on app launch,
so deletion or cap changes can remain in Spotlight until the next launch.
Those are production blockers. A shipping design needs a device-local setting
that defaults to no publication, immediate index removal when disabled or
locked according to the chosen privacy contract, reindexing after snapshot
changes, and device tests that prove removal. This prototype does not infer
consent from entering a query or from Apple Intelligence availability.

## Deterministic harness

`scripts/apple-evaluation/search-corpus.json` declares paraphrase,
multilingual, duplicate-title, explicit-filter, deleted-entry, capped-library,
cancellation, and unavailable-model cases. It uses stable fixture IDs and
predeclares these provisional go/no-go thresholds:

- mean precision at least 0.90;
- mean recall at least 0.90;
- completed-query p95 latency at most 2 seconds;
- peak per-case memory delta at most 64 MB;
- at most 50 unique IDs per query;
- exact cancellation and unavailable outcomes.

Run the schema/metric validator against its deterministic fixture:

```sh
bun scripts/apple-evaluation/search-harness.ts
```

For a device run, save the same JSON shape as
`search-results.fixture.json` and pass its path to the harness. Record device,
OS build, model/language state, app revision, cold/warm state, and measured
latency/memory. The checked-in fixture proves harness determinism only. It is
not search-quality or performance evidence.

## Toolchain evidence and native gates

The compile condition is `compiler(>=6.4)` plus framework and iOS 27 runtime
availability. Apple's current Xcode system-requirements table lists Xcode 27
with Swift 6.4 and Xcode 26.6 with Swift 6.3. The 6.4 boundary prevents the late
iOS 26 SDK from parsing iOS 27-only symbols. The iOS 27 CI selector must also
print the actual `xcodebuild -version`, iOS SDK, and `swiftc -version` used. An
iOS 27 archive must compile the guarded branch. An iOS 26 archive must compile
the fallback while preserving the existing deployment floor. A passing Linux
test does not establish either result.

The local module registration inputs are:

- `apps/mobile/modules/apple-task-search/expo-module.config.json`
- `apps/mobile/modules/apple-task-search/ios/MindwtrAppleTaskSearch.podspec`
- `apps/mobile/modules/apple-task-search/ios/MindwtrAppleTaskSearchModule.swift`

Inspect a clean generated project and then archive on macOS:

```sh
APP_VARIANT=development bunx expo prebuild --clean --platform ios --no-install
xcodebuild -workspace apps/mobile/ios/Mindwtr.xcworkspace -scheme Mindwtr \
  -configuration Release -sdk iphoneos CODE_SIGNING_ALLOWED=NO archive
```

Finally, run the corpus on an Apple Intelligence-capable iPhone, including
offline, unavailable, cancellation, lock/unlock, backgrounding, stale/deleted
index entries, duplicate titles, and a library larger than every cap. Until the
native compile and hardware evidence pass, the production decision is defer.

## Apple sources

- [SpotlightSearchTool](https://developer.apple.com/documentation/corespotlight/spotlightsearchtool)
- [Natural-language indexed-content search](https://developer.apple.com/documentation/corespotlight/searching-indexed-content-with-natural-language)
- [SearchReply status](https://developer.apple.com/documentation/corespotlight/spotlightsearchtool/searchreply/status-swift.enum)
- [SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel)
- [LanguageModelSession](https://developer.apple.com/documentation/foundationmodels/languagemodelsession)
- [Build a semantic search experience with Core Spotlight](https://developer.apple.com/videos/play/wwdc2026/246/)
- [Xcode SDK and system requirements](https://developer.apple.com/xcode/system-requirements)
