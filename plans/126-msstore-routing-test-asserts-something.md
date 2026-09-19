# Plan 126: Make the Microsoft Store rollout-policy test able to fail

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. Do NOT edit `plans/README.md`; the coordinator maintains the index.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- scripts/ci/msstore-rollout.test.js scripts/ci/publish-msstore-flight.test.js docs/CONTRIBUTING.md .github/workflows/release-windows.yml` — if any of these changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (test and docs only)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

The Windows release workflow refuses a bad Microsoft Store rollout policy (a wrong mode, or a percentage that is not between 0 and 100) before it publishes anything. One test guards that refusal. Today the test only checks that running PowerShell "throws". It also throws when PowerShell is not installed, and when the script has a syntax error, so the test stays green in both cases while testing nothing. It also starts PowerShell six times in a row with no timeout of its own, so it fails at bun's 5-second default when the machine is busy. After this plan the test checks the exact refusal message for each bad input, proves two good inputs are accepted, starts PowerShell once, has a 30-second timeout like its sibling, and is skipped with a clear notice on a machine without PowerShell (but fails in CI, where PowerShell must exist).

## Current state

Files:

- `scripts/ci/msstore-rollout.test.js` — bun tests for the Store rollout tooling. Two of its tests run PowerShell (`pwsh`): the payload test at `:428-502` (three `pwsh` starts) and the routing test at `:504-535` (six `pwsh` starts).
- `scripts/ci/publish-msstore-flight.test.js` — sibling file. Its last test (`:194-247`) also runs `pwsh`, has positive controls, and ends with `}, 30_000);` at `:247`.
- `.github/workflows/release-windows.yml` — the workflow whose script text the tests extract. Read-only for this plan.
- `docs/CONTRIBUTING.md:72-81` — the "Prerequisites" list for contributors.

The vacuous test — `scripts/ci/msstore-rollout.test.js:504-535`:

```js
test('Windows routing rejects invalid rollout policy before resolving a Store package', () => {
  const workflow = parse(readFileSync('.github/workflows/release-windows.yml', 'utf8'));
  const resolve = workflow.jobs.standalone.steps.find(step => step.id === 'version').run;
  const routingStart = resolve.indexOf("$tag = (($lines | Where-Object { $_ -like 'tag=*' })");
  expect(routingStart).toBeGreaterThan(-1);
  const routing = resolve.slice(routingStart);
  const run = (mode, percentage) => {
    const command = `$ErrorActionPreference = 'Stop'\n$lines = @('tag=v1.3.0', 'version=1.3.0')\n${routing}`;
    return execFileSync(
      'pwsh',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
      {
        env: {
          ...process.env,
          GITHUB_OUTPUT: '/dev/null',
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/main',
          RUN_MSSTORE: 'true',
          RUN_MSSTORE_FLIGHT: 'false',
          ROLLOUT_MODE: mode,
          ROLLOUT_PERCENTAGE: percentage,
          MSSTORE_FLIGHT_ID: '',
        },
        stdio: 'pipe',
      },
    );
  };
  expect(() => run('resume', '5')).toThrow();
  for (const percentage of ['NaN', 'Infinity', '-1', '0', '100']) {
    expect(() => run('staged', percentage)).toThrow();
  }
});
```

This is the last test in the file (the file has 535 lines). Its imports are at `:1-4`: `import { expect, test } from 'bun:test';`, `execFileSync` from `node:child_process`, `readFileSync` from `node:fs`, `parse` from `yaml`.

The two messages the workflow throws — `.github/workflows/release-windows.yml:181-188` (inside the step with `id: version`, which starts at `:146`):

```powershell
          if ($stable) {
            if (@('staged', 'immediate') -notcontains $rolloutMode) {
              throw "rollout_mode must be staged or immediate before Microsoft Store publication."
            }
            if (-not $rolloutPercentageValid -or [double]::IsNaN($rolloutPercentage) -or [double]::IsInfinity($rolloutPercentage) -or $rolloutPercentage -le 0 -or $rolloutPercentage -ge 100) {
              throw "rollout_percentage must be finite and greater than 0 and less than 100 before Microsoft Store publication."
            }
          }
```

Facts measured at this commit on the planning machine (PowerShell 7 at `/usr/bin/pwsh`):

- One `pwsh` start costs about 0.5 s when the machine is idle, so the current test needs about 3 s idle and passes the 5 s default only without load.
- When the script throws, `pwsh -NonInteractive` writes its error to stderr as CLIXML with colour codes, and the message is cut short with `…`. So do NOT assert on stderr text. Catch the error inside PowerShell and print JSON instead (Step 2 does this).
- The shape in Step 2 was run on the planning machine: all eight cases in ONE `pwsh` process took about 0.7 s and returned `ok: true` for `staged/5` and `immediate/5`, the `rollout_mode ...` message for `resume/5`, and the `rollout_percentage ...` message for `NaN`, `Infinity`, `-1`, `0`, `100`. A valid case also runs `node scripts/ci/msstore-version.mjs v1.3.0` from the repository root; that works because the tests already run from the root.

How CI provides PowerShell: `bun run test:governance` runs in the `governance` job of `.github/workflows/ci.yml` (`:111-144`, `runs-on: ubuntu-latest`). GitHub's hosted `ubuntu-latest` image ships PowerShell 7 as `pwsh`. GitHub Actions also sets the environment variable `CI=true`.

Existing idiom for finding a program: `scripts/mindwtr-cli.test.ts:8` — `const BUN_BIN = Bun.which('bun') || process.execPath;`. `Bun.which(name)` returns `null` when the program is not on `PATH`. Use it.

The prerequisites list today — `docs/CONTRIBUTING.md:72-81`:

```markdown
### Prerequisites

- Bun (workspace/package manager) — use the version in `.bun-version` (currently 1.3.5) or newer
- Node.js 20 or newer — `apps/mcp-server` declares `"node": ">=20"` and is published to npm, so it must build and run on plain Node
- Python 3 — `bun run verify` runs the governance tests, which include `scripts/ci/google-play-edit.test.py`
- Git
- Rust toolchain (required for Tauri desktop build/dev)
```

## Commands you will need

Run all commands from the repository root.

| Purpose | Command | Expected |
|---|---|---|
| Rollout tests | `rtk bun test scripts/ci/msstore-rollout.test.js` | see each step |
| Sibling tests | `rtk bun test scripts/ci/publish-msstore-flight.test.js` | all pass |
| PowerShell present? | `command -v pwsh` | prints a path |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only files you may modify or create):
- `scripts/ci/pwsh-test.mjs` (create)
- `scripts/ci/msstore-rollout.test.js`
- `scripts/ci/publish-msstore-flight.test.js` (only the guard on its one `pwsh` test; no assertion changes)
- `docs/CONTRIBUTING.md` (one new bullet)

**Out of scope** (do NOT touch):
- `.github/workflows/release-windows.yml` and every other workflow — the test must keep reading the real workflow text; never copy the PowerShell into the test.
- `scripts/ci/msstore-rollout.mjs` and the other tests in `msstore-rollout.test.js`.
- `package.json` scripts, `bunfig.toml`.
- `plans/README.md`.

## Git workflow

- One commit for this plan. Message: `test(release): assert the exact Store rollout refusals and skip without PowerShell`. Repo style is conventional commits (example from `git log`: `test(release): run the CSV migration test in the governance suite`). No tooling mentions. Do not push.

## Steps

### Step 1: prove the hole (nothing is committed from this step)

`command -v pwsh` must print a path. If it prints nothing, STOP: you cannot verify this plan on this machine.

In `scripts/ci/msstore-rollout.test.js:513`, temporarily change `'pwsh',` to `'pwsh-does-not-exist',` (only the one inside the routing test, not the one at `:448`).

**Verify**: `rtk bun test scripts/ci/msstore-rollout.test.js -t "Windows routing rejects"` → the test PASSES. That is the bug: the program does not exist and the test is green. Now undo the edit: `rtk git checkout -- scripts/ci/msstore-rollout.test.js`, then `rtk git status --short` → no output.

### Step 2: add the shared guard

Create `scripts/ci/pwsh-test.mjs`:

```js
import { test } from 'bun:test';

// Some release tests run script blocks from the Windows workflows through
// PowerShell. GitHub's hosted runners ship `pwsh`, so CI always runs them. A
// contributor machine without it skips them with a notice instead of failing
// `bun run verify`; in CI a missing `pwsh` is an error, never a silent skip.
const hasPwsh = Bun.which('pwsh') !== null;

if (!hasPwsh && process.env.CI) {
  throw new Error('PowerShell (pwsh) is required in CI for the Windows workflow tests.');
}
if (!hasPwsh) {
  console.warn(
    '[scripts/ci] PowerShell (pwsh) not found: skipping tests that run Windows workflow scripts. Install PowerShell 7 to run them.',
  );
}

export const pwshTest = test.skipIf(!hasPwsh);
```

**Verify**: `rtk bun -e "const m = await import('./scripts/ci/pwsh-test.mjs'); console.log(typeof m.pwshTest)"` → prints `function`.

### Step 3: rewrite the routing test

In `scripts/ci/msstore-rollout.test.js`:

1. Add after the `yaml` import at `:4`: `import { pwshTest } from './pwsh-test.mjs';`
2. Replace the whole routing test (`:504-535`) with the version below. Keep the test title unchanged.

```js
pwshTest('Windows routing rejects invalid rollout policy before resolving a Store package', () => {
  const workflow = parse(readFileSync('.github/workflows/release-windows.yml', 'utf8'));
  const resolve = workflow.jobs.standalone.steps.find(step => step.id === 'version').run;
  const routingStart = resolve.indexOf("$tag = (($lines | Where-Object { $_ -like 'tag=*' })");
  expect(routingStart).toBeGreaterThan(-1);
  const routing = resolve.slice(routingStart);

  const modeRefusal = 'rollout_mode must be staged or immediate before Microsoft Store publication.';
  const percentageRefusal = 'rollout_percentage must be finite and greater than 0 and less than 100 before Microsoft Store publication.';
  const cases = [
    { mode: 'staged', percentage: '5', ok: true, message: '' },
    { mode: 'immediate', percentage: '5', ok: true, message: '' },
    { mode: 'resume', percentage: '5', ok: false, message: modeRefusal },
    ...['NaN', 'Infinity', '-1', '0', '100'].map(percentage => (
      { mode: 'staged', percentage, ok: false, message: percentageRefusal }
    )),
  ];

  // One PowerShell start for every case: each start costs about half a second.
  // The workflow text runs unchanged inside a script block; a refusal is caught
  // and reported as JSON, because pwsh's own stderr is CLIXML with a cut-off message.
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "$lines = @('tag=v1.3.0', 'version=1.3.0')",
    `$routing = {\n${routing}\n}`,
    `$cases = '${JSON.stringify(cases.map(({ mode, percentage }) => ({ mode, percentage })))}' | ConvertFrom-Json`,
    '$results = foreach ($case in $cases) {',
    '  $env:ROLLOUT_MODE = $case.mode',
    '  $env:ROLLOUT_PERCENTAGE = $case.percentage',
    '  try { & $routing | Out-Null; [pscustomobject]@{ mode = $case.mode; percentage = $case.percentage; ok = $true; message = "" } }',
    '  catch { [pscustomobject]@{ mode = $case.mode; percentage = $case.percentage; ok = $false; message = $_.Exception.Message } }',
    '}',
    'ConvertTo-Json -InputObject @($results) -Compress',
  ].join('\n');
  const output = execFileSync(
    'pwsh',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
    {
      env: {
        ...process.env,
        GITHUB_OUTPUT: '/dev/null',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF: 'refs/heads/main',
        RUN_MSSTORE: 'true',
        RUN_MSSTORE_FLIGHT: 'false',
        MSSTORE_FLIGHT_ID: '',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  expect(JSON.parse(output.trim().split(/\r?\n/).at(-1))).toEqual(cases);
}, 30_000);
```

Notes: the JSON list of cases holds only letters, digits, `-`, quotes and brackets, so it is safe inside the single-quoted PowerShell string. `execFileSync` is NOT wrapped in try/catch on purpose: a missing program or a script that cannot be parsed must fail the test.

**Verify (green)**: `rtk bun test scripts/ci/msstore-rollout.test.js` → all tests pass, 0 fail.

**Verify (it can fail now — mutation 1)**: temporarily change `'pwsh',` to `'pwsh-does-not-exist',` inside the rewritten test, run `rtk bun test scripts/ci/msstore-rollout.test.js -t "Windows routing rejects"` → the test FAILS (ENOENT). Undo that one edit.

**Verify (it can fail now — mutation 2)**: in the list `['NaN', 'Infinity', '-1', '0', '100']` inside the rewritten test, temporarily change `'100'` to `'99'`, run the same command → the test FAILS (99 is a valid percentage, so PowerShell reports `ok: true` with an empty message while the test expects a refusal). Undo that edit. Then run `rtk bun test scripts/ci/msstore-rollout.test.js` → all pass again.

### Step 4: guard and time-box the other two PowerShell tests

1. `scripts/ci/msstore-rollout.test.js:428`: change `test('Windows rollout payload mutates copied delivery options without replacing unrelated fields', () => {` to start with `pwshTest(` instead of `test(`, and change its closing `});` (at `:502` before your Step 3 edit) to `}, 30_000);`. Change nothing else in that test.
2. `scripts/ci/publish-msstore-flight.test.js`: add `import { pwshTest } from './pwsh-test.mjs';` after the `yaml` import at `:7`, and change `test('Windows PowerShell validates Store versions only for selected Store routes', () => {` at `:194` to start with `pwshTest(`. It already ends with `}, 30_000);`. Change nothing else.

**Verify**: `rtk bun test scripts/ci/msstore-rollout.test.js scripts/ci/publish-msstore-flight.test.js` → all pass, 0 fail, 0 skipped (PowerShell is installed on this machine). Then `/usr/bin/grep -c "'pwsh'" scripts/ci/msstore-rollout.test.js` → `2`, and `/usr/bin/grep -c "30_000" scripts/ci/msstore-rollout.test.js` → `2`.

### Step 5: document the prerequisite

In `docs/CONTRIBUTING.md`, add one bullet directly after the `- Python 3 — ...` bullet (`:76`):

```markdown
- PowerShell 7 (`pwsh`), optional — the governance tests in `bun run verify` run script blocks from the Windows release workflows through it (`scripts/ci/msstore-rollout.test.js`, `scripts/ci/publish-msstore-flight.test.js`). Without it those tests are skipped with a notice; CI always runs them
```

**Verify**: `/usr/bin/grep -n "PowerShell 7" docs/CONTRIBUTING.md` → one line, directly below the Python 3 line. `rtk git diff --check` → no output.

## Test plan

- The rewritten routing test is the new test. "Failing first" for a test-only fix means the two mutation checks in Step 3 plus the Step 1 proof: before the change a missing `pwsh` is green; after the change a missing `pwsh` and a wrong expectation are both red.
- Structural pattern: the sibling's positive-control style in `scripts/ci/publish-msstore-flight.test.js:194-247`.
- Verification: `rtk bun test scripts/ci/msstore-rollout.test.js scripts/ci/publish-msstore-flight.test.js` → all pass.

## Done criteria

ALL must hold:

- [ ] `rtk bun test scripts/ci/msstore-rollout.test.js scripts/ci/publish-msstore-flight.test.js` → 0 fail, 0 skipped on a machine with `pwsh`.
- [ ] `/usr/bin/grep -c "toThrow()" scripts/ci/msstore-rollout.test.js` is lower by exactly 2 than at commit `561cfdfa0` (check with `rtk git show 561cfdfa0:scripts/ci/msstore-rollout.test.js | /usr/bin/grep -c "toThrow()"`).
- [ ] `/usr/bin/grep -c "pwshTest(" scripts/ci/msstore-rollout.test.js` → `2`; same command on `scripts/ci/publish-msstore-flight.test.js` → `1`.
- [ ] `/usr/bin/grep -c "pwsh-does-not-exist" scripts/ci/msstore-rollout.test.js` → `0` (both mutations undone).
- [ ] `rtk git status --short` lists only the four in-scope files.
- [ ] `rtk git diff --check` prints nothing.

## STOP conditions

Stop and report (do not improvise) if:

- `command -v pwsh` prints nothing on your machine.
- The excerpts in "Current state" do not match the live code, or either refusal message in `release-windows.yml` differs from the text above (report the live text; do not loosen the assertion to a substring).
- The Step 1 proof FAILS (the old test is red with a missing program): the hole is already closed; report instead of rewriting.
- The rewritten test cannot return `ok: true` for `staged/5` or `immediate/5`. That means the workflow block needs something the test does not provide (for example a new required environment variable). Report what it printed; do not edit the workflow.
- `test.skipIf` is not a function in the installed bun (`rtk bun --version` is below 1.3.5).
- A verification fails twice after a reasonable fix attempt, or the fix seems to need a file outside the scope list.

## Maintenance notes

- If a new refusal is added to the `version` step of `release-windows.yml`, add one case line to the `cases` list; the test needs no other change.
- If the refusal wording changes, this test fails with a clear diff. Update the two message constants in the same commit as the workflow.
- The skip is local-only by design. If CI ever moves to an image without `pwsh`, `pwsh-test.mjs` fails the whole file there (because `CI` is set) instead of skipping. Do not remove that check.
- `scripts/ci/validate-release-rc-workflow.test.js:805` only compares the string `"pwsh"`; it does not run PowerShell and needs no guard.
- Reviewer: check that the PowerShell text still comes from the parsed workflow, not from a copy in the test.
