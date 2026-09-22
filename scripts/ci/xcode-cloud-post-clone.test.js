import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('cloud bootstrap survives Expo replacing ios and stops on dependency failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'mindwtr-cloud-test-'));
  const entry = 'apps/mobile/ios/ci_scripts/ci_post_clone.sh';
  const helper = 'scripts/ci/xcode-cloud-post-clone.sh';
  const bin = join(root, 'bin');
  const bunBin = join(root, '.cache/mindwtr-xcode-cloud/bun/bin');
  try {
    for (const path of [bin, bunBin, join(root, 'scripts/ci'), join(root, 'apps/mobile/ios/ci_scripts')]) {
      mkdirSync(path, { recursive: true });
    }
    for (const path of [entry, helper, '.bun-version']) cpSync(path, join(root, path));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    git('add', entry, helper, '.bun-version');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    writeFileSync(join(bunBin, 'bun'), `#!/bin/sh
set -eu
if [ "$1" = --version ]; then cat "$CI_PRIMARY_REPOSITORY_PATH/.bun-version"; exit; fi
test "$*" = 'install --frozen-lockfile'
exit "$FIXTURE_INSTALL_EXIT"
`, { mode: 0o755 });
    writeFileSync(join(bin, 'node'), `#!/bin/sh
set -eu
if [ "$1" = -p ]; then echo 22; exit; fi
if [ "$1" = scripts/ci/validate-ios-app-intents-availability.js ]; then exit; fi
test "$*" = 'node_modules/expo/bin/cli prebuild --platform ios --non-interactive --no-install'
test "$CI" = 1
test "$APP_VARIANT" = production
rm -rf ios
mkdir -p ios/Mindwtr.xcworkspace ios/Mindwtr.xcodeproj/xcshareddata/xcschemes
touch ios/Mindwtr.xcworkspace/contents.xcworkspacedata ios/Mindwtr.xcodeproj/xcshareddata/xcschemes/Mindwtr.xcscheme
`, { mode: 0o755 });
    writeFileSync(join(bin, 'pod'), '#!/bin/sh\nset -eu\ntest "$1" = install\n. ./.xcode.env.local\ntest -x "$NODE_BINARY"\necho pod >> "$CI_PRIMARY_REPOSITORY_PATH/pod-runs"\n', { mode: 0o755 });
    const run = (installExit = '0') => spawnSync('sh', [join(root, entry)], {
      cwd: join(root, 'apps/mobile/ios/ci_scripts'),
      encoding: 'utf8',
      env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}`, CI_PRIMARY_REPOSITORY_PATH: root, FIXTURE_INSTALL_EXIT: installExit },
    });
    const result = run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('bootstrap complete');
    expect(readFileSync(join(root, entry), 'utf8')).toBe(readFileSync(entry, 'utf8'));
    expect(readFileSync(join(root, 'apps/mobile/ios/.xcode.env.local'), 'utf8')).toContain(`NODE_BINARY="${bin}/node"`);
    expect(run('7').status).toBe(7);
    expect(readFileSync(join(root, 'pod-runs'), 'utf8')).toBe('pod\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
