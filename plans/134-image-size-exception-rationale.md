# Plan 134: Correct the image-size exception rationale

## Status

- Priority P3; effort S; risk LOW; category docs.
- Planned at `285b922ab`, 2026-09-28; dependencies none.
- Scope: workflow comments and the current dependency-deferral note only.

## Evidence and decision

`.github/workflows/dependency-audit.yml:69` says no patched release exists, and
`:85` says Expo tooling is waiting for one. GitHub advisories
[GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and
[GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), updated
September 24, now identify image-size 2.0.3 as patched.

The compatible upgrade is not established: Expo 54.2.0 pins Metro 0.83.3, whose
asset reader calls image-size with a filename. The patched major accepts bytes
or its separate asynchronous fromFile interface. Metro 0.83.8 removes the
dependency but overriding Expo's Metro family requires a separate real asset
bundling validation round on Android and iOS.

The selected change corrects the rationale, not the vulnerable dependency.
The existing build-time-only exceptions remain; no new exemption or weaker gate
is authorized. The dependency migration is deferred for compatibility/bundling
validation, not because a patched upstream release is unavailable. Existing
dated audit entries remain historical records.

## Implementation and verification

1. Update the two workflow comments to describe the actual compatibility
   constraint and continued build-time topology/exception guards.
2. Update the current DEPS-R2 note in `plans/README.md`; root owns this plan's
   DONE status. Do not rewrite dated prior audit findings.
3. Run `rtk bun test scripts/ci/validate-dependency-audit.test.js` — 5 tests pass.
4. Run `rtk git diff --check` and verify all executable workflow/audit commands,
   manifests, lockfiles and exception IDs remain unchanged.

One scoped commit; no push. Stop if a compatible parser replacement is attempted:
that is a different implementation scope requiring actual Expo asset bundling.
