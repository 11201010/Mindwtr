# Android Dropbox callback routing — September 13, 2026

Issue: [#1207](https://github.com/dongdongbh/Mindwtr/issues/1207). Base: `0953885fe`.

## Cause and correction

The registered Dropbox redirect, `mindwtr://redirect`, was delivered to both AuthSession and Expo Router. Router had no matching page, so it could show Unmatched Route during authorization. The system-path hook now recognizes only the four exact host/path callback spellings (each with an optional trailing slash) and navigates to Sync settings without copying OAuth query or fragment data into navigation. Raw matching rejects lookalikes and dot-segment normalization. The shared callback constant remains the AuthSession native redirect.

AuthSession still owns the original callback, state check, PKCE exchange, and the existing staged-credential/sync flow. This routing fix neither consumes OAuth credentials nor resumes a request lost to process death. An orphan callback safely opens Sync settings. The forced `v1.3.0/dropbox-oauth-route` diagnostic proves only the routing decision; see the diagnostics ledger for its limits.

## Validation

- Mobile native-intent suite: 17 tests, including cold/warm hook inputs, cancellation, empty/path callbacks, query/fragment privacy, malformed lookalikes, logger failure, and existing capture routes.
- Existing Dropbox OAuth, staged-auth, and Sync settings transport tests passed. Mobile TypeScript and Expo lint passed (no errors; existing warnings retained).
- Core diagnostic sanitizer contract: 2 tests passed. Diff whitespace check passed.
- Independent Sol review caught normalization accepting non-exact targets. The raw allowlist and regression cases resolved the only finding; closure review approved.
- Physical OnePlus CPH2655, Android 16, separate `tech.dongdongbh.mindwtr.dev` build (installed version 1.3.0-rc.2), fresh Metro bundle from the dedicated worktree on port 8094. Warm synthetic code/state callback and cold synthetic cancellation callback both rendered Sync settings, with Sync remaining Off. The Dev client requires its launcher to load Metro after a cold external intent; launching MAIN preserved and delivered that pending intent to the new JS runtime. This is a Dev-client cold-JS check, not a standalone release APK test.
- Both paths emitted the marker in the actual app log without OAuth query/fragment contents. Screenshot/XML and filtered log evidence are under `/home/dd/.cache/mindwtr-checklist-focus/issue-1207-*`. Raw reporter authorization values were not reused.

The symlinked worktree dependency layout produced an unrelated optional alarm-notification dynamic-module warning in Metro; no notification behavior is certified here. The routing logger loaded successfully and its persisted entries were read back. No production package, backend setting, credential, or task was changed.

## Publication and remaining confirmation

The preceding main revision `0953885fe` passed [CI 34794648993](https://github.com/dongdongbh/Mindwtr/actions/runs/34794648993), including the repaired Traditional Chinese Settings test expectations after #1209. That run does not certify a later revision; check the exact pushed SHA.

Live Dropbox authorization, token exchange and full sync on the reporter device remain unverified. Keep #1207 open for next-build confirmation. Public docs: no change needed; this restores the documented sign-in flow. No release or tag is authorized.
