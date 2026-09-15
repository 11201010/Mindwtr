import { afterEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { parse } from 'yaml';

const fixtures = [];
afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function fixture({ installed = ['26.4', '27.0'], sdk = '27.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mindwtr-sdk-test-'));
  fixtures.push(root);
  const applications = join(root, 'Applications');
  const bin = join(root, 'bin');
  mkdirSync(applications);
  mkdirSync(bin);
  for (const version of installed) mkdirSync(join(applications, `Xcode_${version}.app`, 'Contents', 'Developer'), { recursive: true });
  writeFileSync(join(bin, 'xcodebuild'), '#!/bin/sh\nprintf "Xcode fixture\\n"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'xcrun'), '#!/bin/sh\nif [ "$1" = "swiftc" ]; then echo "Swift fixture"; else echo "$FIXTURE_SDK"; fi\n', { mode: 0o755 });
  return {
    root,
    run: (major) => spawnSync('bash', [resolve('scripts/ci/select-apple-sdk.sh'), major], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        MINDWTR_XCODE_APPLICATIONS_DIR: applications,
        FIXTURE_SDK: sdk,
        GITHUB_ENV: join(root, 'env'),
        GITHUB_STEP_SUMMARY: join(root, 'summary'),
      },
    }),
  };
}

test('the requested SDK is recorded for subsequent native build steps', () => {
  const testCase = fixture();
  const result = testCase.run('27');
  expect(result.status).toBe(0);
  expect(readFileSync(join(testCase.root, 'env'), 'utf8')).toContain('Xcode_27.0.app/Contents/Developer');
  expect(readFileSync(join(testCase.root, 'env'), 'utf8')).toContain('MINDWTR_VALIDATED_IOS_SDK=27.0');
});

test('an unavailable requested Xcode fails instead of falling back to another SDK', () => {
  const result = fixture({ installed: ['26.4'], sdk: '26.4' }).run('27');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Required Xcode 27 is not installed');
});

test('a matching application name is insufficient if the SDK is wrong', () => {
  const result = fixture({ sdk: '26.4' }).run('27');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('selected Xcode provides 26.4');
});

test('ordinary CI continues to select iOS 26 and rejects arbitrary input', () => {
  expect(fixture({ sdk: '26.4' }).run('26').status).toBe(0);
  expect(fixture().run('latest').status).not.toBe(0);
  execFileSync('bash', ['-n', 'scripts/ci/select-apple-sdk.sh']);
});

test('iOS 27 matrix validation includes an unsigned archive and states its limits', () => {
  const workflow = parse(readFileSync('.github/workflows/native-platform-ci.yml', 'utf8'));
  expect(workflow.jobs['ios-native'].strategy.matrix.include.map((lane) => lane.lane)).toEqual(['xcode26', 'xcode27']);
  const steps = workflow.jobs['ios-native'].steps;
  expect(steps.find((step) => step.name === 'Select the requested Apple SDK').run).toContain('select-apple-sdk.sh');
  const archive = steps.find((step) => step.name === 'Create unsigned Release device archive with Xcode 27');
  expect(archive.if).toContain("matrix.lane == 'xcode27'");
  expect(archive.run).toContain('-configuration Release');
  expect(archive.run).toContain('CODE_SIGNING_ALLOWED=NO');
  expect(steps.find((step) => step.name === 'Record archive validation limits').run).toContain('remain separate validation gates');
});
