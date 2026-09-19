import { expect, test } from 'bun:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const workflow = (name) => parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));

test('stable policy is validated before publishing and forwarded to every production store', () => {
  const stable = workflow('release');
  const inputs = stable.on.workflow_dispatch.inputs;
  expect(inputs.rollout_mode.default).toBe('staged');
  expect(inputs.rollout_percentage.default).toBe(5);
  const gate = stable.jobs.validate.steps.find((step) => step.id === 'rollout');
  expect(gate.env.ROLLOUT_MODE).toContain("vars.RELEASE_ROLLOUT_MODE || 'staged'");
  for (const job of ['android', 'windows']) {
    expect(stable.jobs[job].with.rollout_mode).toBe('${{ needs.validate.outputs.rollout_mode }}');
    expect(stable.jobs[job].with.rollout_percentage).toBe('${{ fromJSON(needs.validate.outputs.rollout_percentage) }}');
  }
  expect(stable.jobs.windows.with.run_msstore).toBe(true);
  for (const job of ['ios-appstore', 'macos-appstore']) {
    expect(stable.jobs[job].with.phased_release).toBe("${{ needs.validate.outputs.rollout_mode == 'staged' }}");
  }
});

test('an open production rollout fails the stable release before any build job', () => {
  const stable = workflow('release');
  const preflight = stable.jobs['rollout-preflight'];
  expect(preflight.needs).toBe('validate');
  expect(preflight.if).toContain("needs.validate.outputs.rollout_mode == 'staged'");
  // Forks hold no Store credentials, so the check is skipped there, not failed.
  expect(preflight.if).toContain("github.repository == 'dongdongbh/Mindwtr'");
  expect(preflight.concurrency.group).toBe('google-play-production');

  // A recovery dispatch that reaches no store must not be refused by its own
  // tag's open rollout, so only a publishing run is checked, store by store.
  const selected = new Function('github', 'inputs', 'needs', `return Boolean(${
    preflight.if.replace(/^\$\{\{\s*|\s*\}\}$/g, '').replace(/always\(\)/g, 'true')
      .replace(/\bneeds\.([\w-]+)/g, 'needs["$1"]')
  })`);
  const needs = { validate: { result: 'success', outputs: { rollout_mode: 'staged' } } };
  const repository = 'dongdongbh/Mindwtr';
  expect(selected({ event_name: 'push', repository }, {}, needs)).toBe(true);
  expect(selected({ event_name: 'push', repository: 'someone/Mindwtr' }, {}, needs)).toBe(false);
  expect(selected({ event_name: 'push', repository }, {}, {
    validate: { result: 'success', outputs: { rollout_mode: 'immediate' } },
  })).toBe(false);
  for (const [dispatched, expected] of [
    [{ run_linux: true, run_macos: true }, false],
    [{ run_update_packages: true }, false],
    [{ run_android: true }, true],
    [{ run_windows: true }, true],
  ]) {
    expect(selected({ event_name: 'workflow_dispatch', repository }, dispatched, needs)).toBe(expected);
  }

  const check = preflight.steps.at(-1);
  expect(check.env.CHECK_PLAY).toContain('inputs.run_android');
  expect(check.env.CHECK_MSSTORE).toContain('inputs.run_windows');
  expect(check.run).toContain('if [ "${CHECK_PLAY:-}" != "true" ]');
  expect(check.run).toContain('if [ "${CHECK_MSSTORE:-}" != "true" ]');
  expect(check.run).toContain('--action status');
  expect(check.run).toContain('google-play-edit.py rollout');
  expect(check.run).toContain('msstore-rollout.mjs --action status');
  expect(check.run).toContain('docs/development/store-rollouts.md');
  expect(check.run).toContain('exit 1');
  for (const step of preflight.steps) {
    expect(step.run ?? '').not.toMatch(/(?:upload|publish|--action (?:auto|increase|halt|finalize)|tauri build)/);
  }

  for (const job of [
    'android-version-code', 'linux', 'macos', 'windows',
    'android', 'android-foss', 'ios-appstore', 'macos-appstore',
  ]) {
    expect(stable.jobs[job].needs).toContain('rollout-preflight');
    // A skipped preflight (immediate mode or a fork) must not skip the builds.
    expect(stable.jobs[job].if).toContain(
      "(needs['rollout-preflight'].result == 'success' || needs['rollout-preflight'].result == 'skipped')",
    );
  }
});

test('the Windows stable Store path fails instead of exiting zero on an open rollout', () => {
  const windows = workflow('release-windows');
  const publish = windows.jobs.standalone.steps.find(
    (step) => step.id === 'msstore_publish',
  );
  expect(publish.if).toContain("steps.version.outputs.store_stable == 'true'");
  const refusals = [...publish.run.matchAll(/if \(& \$is(RolloutOpen|StoreBusy) \$errText\) \{\n(.*)\n/g)]
    .map((match) => [match[1], match[2].trim()]);
  // Every tolerated store-busy skip is preceded by the rollout-open failure.
  expect(refusals.map(([matcher]) => matcher)).toEqual([
    'RolloutOpen', 'StoreBusy', 'RolloutOpen', 'StoreBusy',
  ]);
  for (const [matcher, body] of refusals) {
    if (matcher === 'RolloutOpen') expect(body).toBe('throw $rolloutOpenMessage');
    else expect(body).toStartWith('Write-Warning');
  }
  expect(publish.run).toContain('package rollout is still open');
  expect(publish.run).toContain('Get-StoreErrorText -ErrorRecord $_');
});

test('release policy shell accepts valid modes and rejects unsafe percentages and unknown modes', () => {
  const gate = workflow('release').jobs.validate.steps.find((step) => step.id === 'rollout');
  const directory = mkdtempSync(join(tmpdir(), 'mindwtr-rollout-policy-'));
  try {
    for (const [mode, percentage, valid] of [
      ['staged', '5', true], ['staged', '20.5', true], ['immediate', '5', true],
      ['oops', '5', false], ['staged', '0', false], ['staged', '-1', false],
      ['staged', '100', false], ['staged', 'nan', false], ['staged', 'inf', false],
      ['staged', '', false],
    ]) {
      const outputPath = join(directory, `${mode}-${percentage}.txt`);
      const result = spawnSync('bash', ['-e', '-c', gate.run], {
        encoding: 'utf8',
        env: { ...process.env, ROLLOUT_MODE: mode, ROLLOUT_PERCENTAGE: percentage,
          GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: join(directory, 'summary.md') },
      });
      expect(result.status === 0).toBe(valid);
      if (valid) expect(readFileSync(outputPath, 'utf8')).toContain(`mode=${mode}\n`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Apple stable metadata enables phasing while TestFlight-only metadata remains untouched', () => {
  for (const [name, job, upload] of [
    ['release-ios-appstore', 'ios-appstore', 'Upload IPA to App Store Connect'],
    ['release-macos-appstore', 'macos-appstore', 'Upload to App Store Connect'],
  ]) {
    const apple = workflow(name);
    for (const trigger of ['workflow_call', 'workflow_dispatch']) {
      expect(apple.on[trigger].inputs.phased_release.default).toBe(true);
    }
    const step = apple.jobs[job].steps.find((item) => item.name === upload)
      ?? apple.jobs[job].steps.find((item) => item.run?.includes('deliver_options = {'));
    expect(step.env.PHASED_RELEASE).toBe("${{ inputs.phased_release && 'true' || 'false' }}");
    expect(step.run).toContain('automatic_release: true');
    expect(step.run).toContain('unless ENV.fetch("SKIP_METADATA", "false") == "true"\n');
    expect(step.run).toContain('deliver_options[:phased_release] = ENV.fetch("PHASED_RELEASE", "true") == "true"');
  }
  const rc = workflow('release-rc');
  expect(rc.jobs['ios-appstore'].with.testflight_only).toBe(true);
  expect(rc.jobs['ios-appstore'].with.submit_for_review).toBe(false);
  expect(rc.jobs['macos-appstore'].with.submit_for_review).toBe(false);
});

test('rollout workflow schedules one automatic stage per day and retains explicit controls', () => {
  const rollout = workflow('rollout');
  expect(Object.keys(rollout.on)).toEqual(['schedule', 'workflow_dispatch']);
  expect(rollout.on.schedule).toEqual([{ cron: '17 15 * * *' }]);
  expect(rollout.on.workflow_dispatch.inputs.action.default).toBe('status');
  expect(rollout.permissions).toEqual({ contents: 'read' });
  expect(rollout.jobs.play.concurrency.group).toBe('google-play-production');
  expect(rollout.jobs.msstore.concurrency.group).toBe('msstore-production');
  expect(rollout.jobs.play.if).toContain("github.event_name == 'schedule'");
  expect(rollout.jobs.msstore.if).toContain("github.event_name == 'schedule'");
  // A fork holds no Store credentials, so the daily schedule must not run there.
  for (const job of Object.values(rollout.jobs)) {
    expect(job.if).toContain("github.repository == 'dongdongbh/Mindwtr'");
  }
  const play = rollout.jobs.play.steps.find((step) => step.env?.VERSION_CODE);
  expect(play.run).toContain('--version-code "$VERSION_CODE"');
  expect(play.run).toContain('auto-rollout --package tech.dongdongbh.mindwtr');
  expect(play.env.ROLLOUT_ACTION).toContain("github.event_name == 'schedule'");
  expect(play.run).toContain('google-play-edit.py "${args[@]}"');
  const msstore = rollout.jobs.msstore.steps.find((step) => step.env?.SUBMISSION_ID);
  expect(msstore.run).toContain('--submission-id "$SUBMISSION_ID"');
  expect(msstore.run).toContain('args=(--action auto)');
  expect(msstore.env.ROLLOUT_ACTION).toContain("github.event_name == 'schedule'");
  expect(msstore.env.MS_STORE_APP_ID).toBe("${{ secrets.MS_STORE_APP_ID || '9N0V5B0B6FRX' }}");
  for (const job of Object.values(rollout.jobs)) {
    expect(job.concurrency['cancel-in-progress']).toBe(false);
    for (const step of job.steps) {
      expect(step.run ?? '').not.toMatch(/(?:upload|create-plan|build-aab|tauri build)/);
    }
  }
});

test('generated Fastlane code passes the requested phase policy and omits it for skipped metadata', () => {
  for (const [name, job] of [
    ['release-ios-appstore', 'ios-appstore'],
    ['release-macos-appstore', 'macos-appstore'],
  ]) {
    const step = workflow(name).jobs[job].steps.find((item) => item.run?.includes('deliver_options = {'));
    const fastfile = step.run.match(/cat <<'EOF' > fastlane\/Fastfile\n([\s\S]*?)\nEOF/)[1];
    const stubs = `require 'json'
def opt_out_usage; end
def default_platform(*); end
def platform(*); yield; end
def lane(*); yield; end
def app_store_connect_api_key(**); nil; end
def deliver(options); puts JSON.generate(options); end
`;
    for (const [phased, skipMetadata] of [['true', 'false'], ['false', 'false'], ['true', 'true']]) {
      const result = spawnSync('ruby', ['-'], {
        input: stubs + fastfile,
        encoding: 'utf8',
        env: { ...process.env, PHASED_RELEASE: phased, SKIP_METADATA: skipMetadata,
          EXPECTED_BUNDLE_ID: 'tech.dongdongbh.mindwtr', APP_VERSION: '1.0.5',
          IPA_PATH: 'fixture.ipa', PKG_PATH: 'fixture.pkg', FASTLANE_METADATA_PATH: 'fixture',
          FASTLANE_ASC_KEY_ID: 'fixture', FASTLANE_ASC_ISSUER_ID: 'fixture', ASC_KEY_PATH: 'fixture',
        },
      });
      expect(result.status).toBe(0);
      const options = JSON.parse(result.stdout);
      expect(options.automatic_release).toBe(true);
      expect(options.phased_release).toBe(skipMetadata === 'true' ? undefined : phased === 'true');
    }
  }
});

test('all Play edit sessions share the rollout lock, including RC and version lookups', () => {
  const expected = workflow('rollout').jobs.play.concurrency;
  for (const [name, jobs] of [
    ['release', ['android-version-code']],
    ['release-rc', ['android-version-code']],
    ['release-android', ['preflight', 'publish']],
  ]) {
    const release = workflow(name);
    for (const job of jobs) expect(release.jobs[job].concurrency).toEqual(expected);
    // The enclosing workflow never reacquires a child's lock.
    expect(release.concurrency.group).not.toBe(expected.group);
  }
});
