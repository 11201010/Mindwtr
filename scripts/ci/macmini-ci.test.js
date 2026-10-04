import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const prepareCacheScript = fileURLToPath(new URL('./prepare-apple-cache.sh', import.meta.url));
const dispatchScript = fileURLToPath(new URL('./dispatch-macmini.sh', import.meta.url));

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
    writeFileSync(join(bin, 'watchman'), '#!/bin/sh\ntest "$1" = --no-site-spawner\n', { mode: 0o755 });
    writeFileSync(join(bin, 'df'), '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 20000000 1 12582912 1%% /\\n"\n', { mode: 0o755 });
    const envFile = join(root, 'env');
    const run = (version) => {
      writeFileSync(envFile, '');
      execFileSync('bash', [prepareCacheScript], { cwd: repo, env: {
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

const minimumKiB = 12 * 1024 * 1024;
const cacheFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'mindwtr-headroom-'));
  const repo = join(root, 'repo'); const bin = join(root, 'bin');
  mkdirSync(repo); mkdirSync(bin); execFileSync('git', ['init', '-q', repo]);
  const cacheRoot = join(root, 'Library/Caches/MindwtrNativeCI');
  mkdirSync(join(root, 'Library/Caches'), { recursive: true });
  for (const path of ['node_modules/dependency', 'apps/mobile/node_modules/dependency']) {
    mkdirSync(join(repo, path, '..'), { recursive: true }); writeFileSync(join(repo, path), 'dependency');
  }
  writeFileSync(join(bin, 'xcodebuild'), '#!/bin/sh\necho "Xcode 27A"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'watchman'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'df'), `#!/bin/bash
set -eu
test "$1" = -Pk
test "$2" = "$HOME"
calls=0
[ ! -f "$FIXTURE_DF_STATE" ] || calls="$(cat "$FIXTURE_DF_STATE")"
calls=$((calls + 1))
echo "$calls" > "$FIXTURE_DF_STATE"
[ "$FIXTURE_DF_MODE" != failure ] || exit 1
if [ "$FIXTURE_DF_MODE" = malformed ]; then echo 'not df output'; exit 0; fi
available="$FIXTURE_BEFORE_KIB"
[ "$calls" -eq 1 ] || available="$FIXTURE_AFTER_KIB"
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\nfixture 40000000 1 %s 1%% /\n' "$available"
`, { mode: 0o755 });
  const seed = (version, child) => {
    const directory = join(cacheRoot, version, child); mkdirSync(directory, { recursive: true });
    const file = join(directory, 'preserved'); writeFileSync(file, 'fixture'); return file;
  };
  const run = (before = minimumKiB, after = minimumKiB, extra = {}) => spawnSync('bash', [prepareCacheScript], { cwd: repo, encoding: 'utf8', env: {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: root, GITHUB_ACTIONS: 'true',
    RUNNER_ENVIRONMENT: 'self-hosted', RUNNER_TEMP: root, GITHUB_ENV: join(root, 'env'), GITHUB_PATH: join(root, 'path'),
    FIXTURE_DF_STATE: join(root, 'df-state'), FIXTURE_DF_MODE: 'valid', FIXTURE_BEFORE_KIB: String(before), FIXTURE_AFTER_KIB: String(after), ...extra,
  } });
  return { root, repo, cacheRoot, seed, run, close: () => rmSync(root, { recursive: true, force: true }) };
};

test('low Apple disk space trims only known generated children across compiler versions', () => {
  const fixture = cacheFixture();
  try {
    const removed = [];
    for (const version of ['a'.repeat(16), '0123456789abcdef']) for (const child of ['swift', 'simulator', 'archive']) removed.push(fixture.seed(version, child));
    const preserved = [fixture.seed('a'.repeat(16), 'unknown'), fixture.seed('future-compiler', 'swift'),
      fixture.seed('A'.repeat(16), 'archive'), fixture.seed('b'.repeat(15), 'simulator')];
    const result = fixture.run(minimumKiB - 1, minimumKiB);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`before_kib=${minimumKiB - 1} after_kib=${minimumKiB} trimmed_entries=6`);
    for (const file of removed) expect(existsSync(file)).toBe(false);
    for (const file of preserved) expect(readFileSync(file, 'utf8')).toBe('fixture');
    for (const path of ['node_modules/dependency', 'apps/mobile/node_modules/dependency']) expect(readFileSync(join(fixture.repo, path), 'utf8')).toBe('dependency');
    const cache = readFileSync(join(fixture.root, 'env'), 'utf8').split('\n').find((line) => line.startsWith('MINDWTR_NATIVE_CACHE=')).slice('MINDWTR_NATIVE_CACHE='.length);
    for (const child of ['swift', 'simulator', 'archive']) expect(existsSync(join(cache, child))).toBe(true);
    expect(readFileSync(join(fixture.root, 'df-state'), 'utf8').trim()).toBe('2');
  } finally { fixture.close(); }
});

test('healthy Apple space preserves every compiler cache and reads disk space once', () => {
  const fixture = cacheFixture();
  try {
    const files = ['swift', 'simulator', 'archive', 'unknown'].map((child) => fixture.seed('a'.repeat(16), child));
    const result = fixture.run(minimumKiB, 0);
    expect(result.status).toBe(0); expect(result.stdout).toContain(`before_kib=${minimumKiB} after_kib=${minimumKiB} trimmed_entries=0`);
    for (const file of files) expect(readFileSync(file, 'utf8')).toBe('fixture');
    expect(readFileSync(join(fixture.root, 'df-state'), 'utf8').trim()).toBe('1');
  } finally { fixture.close(); }
});

test('insufficient Apple space after bounded cleanup fails before cache creation and build setup', () => {
  const fixture = cacheFixture();
  try {
    const generated = fixture.seed('a'.repeat(16), 'swift'); const unknown = fixture.seed('a'.repeat(16), 'unknown');
    const result = fixture.run(100, 200);
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('At least 12 GiB'); expect(result.stderr).toContain('free runner disk space before retrying');
    expect(result.stdout).toContain('before_kib=100 after_kib=200 trimmed_entries=1');
    expect(existsSync(generated)).toBe(false); expect(existsSync(unknown)).toBe(true); expect(existsSync(join(fixture.root, 'env'))).toBe(false);
  } finally { fixture.close(); }
});

test.each(['malformed', 'failure', 'invalid-count', 'overflow-count'])('unreadable or malformed df (%s) cannot erase cache data', (mode) => {
  const fixture = cacheFixture();
  try {
    const file = fixture.seed('a'.repeat(16), 'swift');
    const before = mode === 'invalid-count' ? 'not-a-number' : mode === 'overflow-count' ? '9'.repeat(30) : 100;
    const result = fixture.run(before, minimumKiB, { FIXTURE_DF_MODE: mode === 'invalid-count' || mode === 'overflow-count' ? 'valid' : mode });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('Cannot measure'); expect(readFileSync(file, 'utf8')).toBe('fixture');
  } finally { fixture.close(); }
});

test.each(['root', 'version', 'child', 'dangling-child', 'library-parent', 'caches-parent', 'home-parent'])('symlinked owned cache %s is rejected without following or deleting its target', (kind) => {
  const fixture = cacheFixture();
  try {
    const target = join(fixture.root, 'outside'); mkdirSync(join(target, 'swift'), { recursive: true }); const sentinel = join(target, 'swift/preserved'); writeFileSync(sentinel, 'untouched');
    const extra = {};
    if (kind === 'home-parent') { const alias = join(fixture.root, 'home-alias'); symlinkSync(target, alias, 'dir'); extra.HOME = alias; }
    else if (kind === 'library-parent' || kind === 'caches-parent') {
      const parent = join(fixture.root, kind === 'library-parent' ? 'Library' : 'Library/Caches');
      rmSync(parent, { recursive: true }); symlinkSync(target, parent, 'dir');
    }
    else if (kind === 'root') symlinkSync(target, fixture.cacheRoot, 'dir');
    else {
      mkdirSync(fixture.cacheRoot);
      const version = join(fixture.cacheRoot, 'a'.repeat(16));
      if (kind === 'version') symlinkSync(target, version, 'dir');
      else { mkdirSync(version); symlinkSync(kind === 'dangling-child' ? join(target, 'missing') : target, join(version, 'swift'), 'dir'); }
    }
    const result = fixture.run(100, minimumKiB, extra);
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('Refusing symlinked'); expect(readFileSync(sentinel, 'utf8')).toBe('untouched');
    expect(existsSync(join(fixture.root, 'df-state'))).toBe(false);
  } finally { fixture.close(); }
});

test('unknown cache symlinks and GitHub-hosted cache behavior remain untouched', () => {
  const fixture = cacheFixture();
  try {
    const target = join(fixture.root, 'outside'); mkdirSync(target); writeFileSync(join(target, 'preserved'), 'untouched');
    mkdirSync(fixture.cacheRoot); symlinkSync(target, join(fixture.cacheRoot, 'unknown-version'), 'dir');
    mkdirSync(join(fixture.cacheRoot, 'a'.repeat(16))); symlinkSync(target, join(fixture.cacheRoot, 'a'.repeat(16), 'unknown-child'), 'dir');
    const low = fixture.run(100, minimumKiB); expect(low.status).toBe(0); expect(low.stdout).toContain('trimmed_entries=0'); expect(readFileSync(join(target, 'preserved'), 'utf8')).toBe('untouched');
    rmSync(join(fixture.root, 'df-state'));
    const hosted = fixture.run(0, 0, { RUNNER_ENVIRONMENT: 'github-hosted', FIXTURE_DF_MODE: 'failure' });
    expect(hosted.status).toBe(0); expect(existsSync(join(fixture.root, 'df-state'))).toBe(false);
    expect(readFileSync(join(fixture.root, 'env'), 'utf8')).toContain(`MINDWTR_NATIVE_CACHE=${fixture.root}/mindwtr-native/`);
  } finally { fixture.close(); }
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
    const run = (result, sha = 'a'.repeat(40)) => spawnSync('bash', [dispatchScript], { encoding: 'utf8', env: {
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
