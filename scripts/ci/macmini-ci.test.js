import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('Mac caches survive cleanup while stale generated sources are removed', () => {
  const root = mkdtempSync(join(tmpdir(), 'mindwtr-cache-'));
  try {
    const repo = join(root, 'repo');
    const bin = join(root, 'bin');
    mkdirSync(repo); mkdirSync(bin);
    execFileSync('git', ['init', '-q', repo]);
    for (const path of ['node_modules/dependency', 'apps/mobile/node_modules/dependency', 'apps/mobile/ios/stale.swift']) {
      mkdirSync(join(repo, path, '..'), { recursive: true });
      writeFileSync(join(repo, path), 'fixture');
    }
    writeFileSync(join(bin, 'xcodebuild'), '#!/bin/sh\necho "Xcode $FIXTURE_XCODE"\n', { mode: 0o755 });
    const envFile = join(root, 'env');
    const run = (version) => {
      writeFileSync(envFile, '');
      execFileSync('bash', [resolve('scripts/ci/prepare-apple-cache.sh')], { cwd: repo, env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: root,
        GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted', RUNNER_TEMP: root,
        GITHUB_ENV: envFile, GITHUB_PATH: join(root, 'path'), FIXTURE_XCODE: version,
      }});
      return readFileSync(envFile, 'utf8').split('\n').find((line) => line.startsWith('MINDWTR_NATIVE_CACHE=')).split('=')[1];
    };
    const first = run('27A');
    writeFileSync(join(first, 'swift', 'compiled'), 'cached');
    expect(run('27A')).toBe(first);
    expect(existsSync(join(first, 'swift', 'compiled'))).toBe(true);
    expect(existsSync(join(repo, 'node_modules/dependency'))).toBe(true);
    expect(existsSync(join(repo, 'apps/mobile/node_modules/dependency'))).toBe(true);
    expect(existsSync(join(repo, 'apps/mobile/ios/stale.swift'))).toBe(false);
    expect(run('27B')).not.toBe(first);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the dispatch broker propagates failures, cancels interrupted runs, and rejects invalid commits', () => {
  const root = mkdtempSync(join(tmpdir(), 'mindwtr-dispatch-'));
  try {
    const bin = join(root, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'uuidgen'), '#!/bin/sh\necho fixture-request\n', { mode: 0o755 });
    writeFileSync(join(bin, 'gh'), `#!/bin/bash
set -eu
case "$1 $2" in
  'workflow run') ;;
  'run list') printf '[{"databaseId":123,"displayTitle":"Mindwtr %s / fixture-request"}]' "$SOURCE_SHA" ;;
  'api repos/dongdongbh/Mindwtr-native-ci/actions/runs/123')
    [ "$FIXTURE_RESULT" != interrupted ] || exit 1
    printf '{"status":"completed","conclusion":"%s"}' "$FIXTURE_RESULT" ;;
  'run download') touch "$RUNNER_TEMP/downloaded" ;;
  'run cancel') touch "$RUNNER_TEMP/cancelled" ;;
  *) echo "Unexpected gh arguments: $*" >&2; exit 1 ;;
esac
`, { mode: 0o755 });
    const run = (result, sha = 'a'.repeat(40)) => spawnSync('bash', [resolve('scripts/ci/dispatch-macmini.sh')], { encoding: 'utf8', env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_TOKEN: 'fixture', RUNNER_TEMP: root,
      SOURCE_SHA: sha, FIXTURE_RESULT: result, GITHUB_STEP_SUMMARY: join(root, 'summary'),
    }});
    expect(run('success').status).toBe(0);
    expect(existsSync(join(root, 'downloaded'))).toBe(true);
    expect(run('failure').status).not.toBe(0);
    expect(existsSync(join(root, 'cancelled'))).toBe(false);
    expect(run('interrupted').status).not.toBe(0);
    expect(existsSync(join(root, 'cancelled'))).toBe(true);
    expect(run('success', 'main').status).not.toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
