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
