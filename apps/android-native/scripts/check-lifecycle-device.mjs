// Lifecycle check for the isolated native Android development app.
//
//   node apps/android-native/scripts/check-lifecycle-device.mjs <adb-serial> [apk]
//
// Installs the debug APK with `install -r` (existing development data stays),
// then drives capture through rotation, process death, force-stop, and an
// injected commit failure. It asserts through the app's own database copy
// (.db, -wal and -shm pulled together), the UI hierarchy, and logcat. It
// touches only the development package (it refuses any other APK), never
// launches over another app, and restores rotation and clears its debug
// properties on exit. Leave the device on its home screen before running.
// Exit 0 = pass, 1 = fail, 2 = refused before touching the device, 3 = stopped.
import { execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [serial, apkArg] = process.argv.slice(2);
if (!serial) {
    console.error('usage: node check-lifecycle-device.mjs <adb-serial> [apk]');
    process.exit(2);
}
const app = resolve(import.meta.dirname, '..');
const apk = apkArg ?? resolve(app, 'android/app/build/outputs/apk/debug/app-debug.apk');
const adbBin = process.env.ADB ?? '/home/dd/Android/Sdk/platform-tools/adb';
const aapt2 = process.env.AAPT2 ?? '/home/dd/Android/Sdk/build-tools/36.1.0/aapt2';
const PKG = 'tech.dongdongbh.mindwtr.nativeclient.dev';
// Never install anything but the development package (install -r would upgrade it).
const apkPackage = execFileSync(aapt2, ['dump', 'packagename', apk], { encoding: 'utf8' }).trim();
if (apkPackage !== PKG) {
    console.error(`REFUSED: ${apk} is package "${apkPackage}", not ${PKG}`);
    process.exit(2);
}
const ACTIVITY = `${PKG}/tech.dongdongbh.mindwtr.pilot.MainActivity`;
const TAG = 'MindwtrNativeDev';
const UI_FILE = '/data/local/tmp/mindwtr-native-dev-ui.xml';
const PROPS = ['fail_commit', 'delay_before_ms', 'delay_after_ms'];
const work = resolve(app, 'android/build/lifecycle-check');
// Digits only: some phone keyboards hold typed letters in a composition strip.
// Time plus a random part keeps every run's titles unique; the run also asserts none exist yet.
const run = `${String(Date.now()).slice(-6)}${String(randomInt(1_000_000)).padStart(6, '0')}`;
const titles = { a: `81${run}`, b: `82${run}`, c1: `83${run}`, c2: `84${run}`, c3: `85${run}`, d: `86${run}` };

class Stopped extends Error {}
const adbRaw = (...args) => execFileSync(adbBin, ['-s', serial, ...args], { maxBuffer: 64 << 20 });
const sh = (command) => adbRaw('shell', command).toString('utf8').replace(/\r/g, '').trim();
const fail = (message) => { throw new Error(message); };
const check = (condition, message) => { if (!condition) fail(message); console.log(`ok - ${message}`); };
const setProp = (name, value) => sh(`setprop debug.mindwtr.native.${name} '${value}'`);

// ---- device state ----
const home = sh('cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME')
    .split('\n').pop().split('/')[0];
const front = () => sh('dumpsys activity activities').split('\n')
    .find((line) => /topResumedActivity|mResumedActivity/.test(line)) ?? '';
const requireAppFront = () => {
    if (!front().includes(`${PKG}/`)) throw new Stopped(`the dev app is not in front: ${front().trim()}`);
};
const launch = () => {
    const current = front();
    if (!current.includes(`${PKG}/`) && !current.includes(`${home}/`)) {
        throw new Stopped(`another app is in front; not launching over it: ${current.trim()}`);
    }
    sh(`am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${ACTIVITY}`);
};
const pid = () => { try { return sh(`pidof ${PKG}`); } catch { return ''; } };
const logs = (processId) => adbRaw('logcat', '-d', `--pid=${processId}`, '-s', `${TAG}:*`).toString('utf8');
const count = (text, needle) => text.split('\n').filter((line) => line.includes(needle)).length;
const boots = (processId) => count(logs(processId), 'Core host boot started');
const recreations = (processId) => logs(processId).split('\n')
    .filter((line) => line.includes('releaseCheck=v1.3.3/native-android-dev-host-reuse') && line.includes('reason=activity-recreate'));
const newScreens = (processId) => count(logs(processId), 'reason=new-screen');
const rotate = (rotation) => {
    requireAppFront();
    sh('settings put system accelerometer_rotation 0');
    sh(`settings put system user_rotation ${rotation}`);
};

// ---- UI ----
const decode = (value) => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const screen = async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            sh(`uiautomator dump ${UI_FILE}`);
            const xml = adbRaw('exec-out', 'cat', UI_FILE).toString('utf8');
            if (xml.includes('<hierarchy')) {
                return [...xml.matchAll(/<node [^>]*>/g)].map(([tag]) => Object.fromEntries(
                    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decode(value)]),
                ));
            }
        } catch { /* the hierarchy is briefly unavailable during recreation */ }
        await sleep(500);
    }
    return fail('uiautomator dump failed');
};
const field = (nodes) => nodes.find((node) => node.class === 'android.widget.EditText');
const box = (node) => node.bounds.match(/\d+/g).map(Number);
// A Compose button's label is a child node; the enabled state is on the clickable node around it.
const button = (nodes, label) => {
    const labelNode = nodes.find((node) => node.text === label || node['content-desc'] === label);
    if (!labelNode) return undefined;
    const [x1, y1, x2, y2] = box(labelNode);
    return nodes.filter((node) => node.clickable === 'true').filter((node) => {
        const [left, top, right, bottom] = box(node);
        return left <= x1 && top <= y1 && right >= x2 && bottom >= y2;
    }).sort((a, b) => {
        const area = (node) => { const [l, t, r, bt] = box(node); return (r - l) * (bt - t); };
        return area(a) - area(b);
    })[0];
};
const header = (nodes) => Number(nodes.map((node) => /^Inbox · (\d+)$/.exec(node.text ?? '')?.[1]).find(Boolean) ?? NaN);
const hasText = (nodes, text) => nodes.some((node) => node.text === text && node.class !== 'android.widget.EditText');
const hasError = (nodes) => nodes.some((node) => node.text?.includes('Injected commit failure'));
const waitFor = async (description, predicate, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const nodes = await screen();
        if (predicate(nodes)) return nodes;
        await sleep(500);
    }
    return fail(`timed out waiting for ${description}`);
};
const loaded = () => waitFor('the Inbox to load', (nodes) => field(nodes) && Number.isFinite(header(nodes)), 60_000);
const tap = async (node) => {
    requireAppFront();
    const [x1, y1, x2, y2] = box(node);
    sh(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
    await sleep(400);
};
const type = async (title) => {
    await tap(field(await screen()));
    requireAppFront();
    sh(`input text ${title}`);
    await waitFor(`the draft ${title} in the field`, (nodes) => field(nodes)?.text === title, 10_000);
};
const tapAdd = async () => tap(button(await screen(), 'Add'));
const busyField = (nodes) => field(nodes)?.enabled === 'false';

// ---- database ----
const pullDatabase = () => {
    const dir = resolve(work, 'db');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const present = sh(`run-as ${PKG} ls files`).split(/\s+/);
    for (const suffix of ['', '-wal', '-shm']) {
        const name = `mindwtr-native-dev.db${suffix}`;
        if (present.includes(name)) writeFileSync(resolve(dir, name), adbRaw('exec-out', 'run-as', PKG, 'cat', `files/${name}`));
    }
    return resolve(dir, 'mindwtr-native-dev.db');
};
const rowsTitled = (...names) => Number(execFileSync('sqlite3', [pullDatabase(),
    `SELECT COUNT(*) FROM tasks WHERE title IN (${names.map((name) => `'${name}'`).join(', ')}) AND deletedAt IS NULL`],
{ encoding: 'utf8' }).trim());

const originalAccelerometer = sh('settings get system accelerometer_rotation');
const originalRotation = sh('settings get system user_rotation');
const restore = () => {
    for (const name of PROPS) { try { setProp(name, ''); } catch { /* device gone */ } }
    for (const [name, value] of [['user_rotation', originalRotation], ['accelerometer_rotation', originalAccelerometer]]) {
        try { sh(value === 'null' ? `settings delete system ${name}` : `settings put system ${name} ${value}`); } catch { /* device gone */ }
    }
    try { sh(`rm -f ${UI_FILE}`); } catch { /* device gone */ }
};

try {
    mkdirSync(work, { recursive: true });
    console.log(`device: ${sh('getprop ro.product.model')} / Android ${sh('getprop ro.build.version.release')} (API ${sh('getprop ro.build.version.sdk')})${sh('getprop ro.boot.qemu.avd_name') ? ` / AVD ${sh('getprop ro.boot.qemu.avd_name')}` : ''}`);
    console.log(`apk: ${apk}\napk sha256: ${createHash('sha256').update(readFileSync(apk)).digest('hex')}`);
    for (const name of PROPS) setProp(name, '');

    // (a) Upgrade-install over any existing development data, boot, capture.
    const beforeInstall = front();
    if (!beforeInstall.includes(`${PKG}/`) && !beforeInstall.includes(`${home}/`)) {
        throw new Stopped(`another app is in front: ${beforeInstall.trim()}`);
    }
    execFileSync(adbBin, ['-s', serial, 'install', '-r', apk], { stdio: 'inherit' });
    launch();
    let nodes = await loaded();
    rotate(0);
    let processId = pid();
    let total = header(nodes);
    check(rowsTitled(...Object.values(titles)) === 0, '(a) this run\'s titles are not in the database yet');
    check(boots(processId) === 1, `(a) one host boot in process ${processId}`);
    await type(titles.a);
    await tapAdd();
    nodes = await waitFor('capture a', (current) => header(current) === total + 1 && field(current)?.text === '');
    total += 1;
    check(hasText(nodes, titles.a) && rowsTitled(titles.a) === 1, '(a) captured task is listed and stored once');

    // (b) Save during recreation.
    setProp('delay_before_ms', '5000');
    await type(titles.b);
    await tapAdd();
    check(busyField(await screen()), '(b) save is in flight');
    const recreatedBefore = recreations(processId).length;
    rotate(1);
    await waitFor('rotation recreation', () => recreations(processId).length > recreatedBefore, 15_000);
    check(recreations(processId).at(-1).includes('inFlight=true'), '(b) new Activity attached to the running host during the save');
    nodes = await waitFor('save b after rotation', (current) => header(current) === total + 1 && field(current)?.text === '');
    total += 1;
    check(hasText(nodes, titles.b), '(b) the recreated Activity shows the saved task');
    check(rowsTitled(titles.b) === 1, '(b) exactly one stored row for the capture');
    check(pid() === processId && boots(processId) === 1, '(b) same process, no second host boot');
    setProp('delay_before_ms', '');
    rotate(0);
    await waitFor('rotation back', () => recreations(processId).length > recreatedBefore + 1, 15_000);
    await loaded();

    // (c1) Process death before the commit: the restored draft retries once.
    setProp('delay_before_ms', '8000');
    await type(titles.c1);
    await tapAdd();
    check(busyField(await screen()), '(c1) save is in flight');
    requireAppFront();
    sh('input keyevent KEYCODE_HOME');
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    await sleep(1500);
    sh(`run-as ${PKG} kill -9 ${processId}`);
    await waitFor('process death', () => pid() !== processId, 10_000);
    setProp('delay_before_ms', '');
    check(rowsTitled(titles.c1) === 0, '(c1) no row before the retry (killed before commit)');
    launch();
    nodes = await loaded();
    processId = pid();
    check(boots(processId) === 1, '(c1) one host boot after process death');
    check(field(nodes)?.text === titles.c1, '(c1) unacknowledged draft restored');
    await tapAdd();
    nodes = await waitFor('retry c1', (current) => header(current) === total + 1 && field(current)?.text === '');
    total += 1;
    check(rowsTitled(titles.c1) === 1, '(c1) retry stored exactly one row');

    // (c2) Process death after the commit, before the acknowledgment.
    setProp('delay_after_ms', '8000');
    await type(titles.c2);
    await tapAdd();
    await waitFor('commit c2', () => rowsTitled(titles.c2) === 1, 6000);
    check(busyField(await screen()), '(c2) row committed while the acknowledgment is still pending');
    requireAppFront();
    sh('input keyevent KEYCODE_HOME');
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    await sleep(1500);
    sh(`run-as ${PKG} kill -9 ${processId}`);
    await waitFor('process death', () => pid() !== processId, 10_000);
    setProp('delay_after_ms', '');
    launch();
    nodes = await loaded();
    processId = pid();
    total += 1;
    check(boots(processId) === 1 && header(nodes) === total, '(c2) relaunch loads the committed row');
    check(field(nodes)?.text === titles.c2, '(c2) unacknowledged draft restored');
    await tapAdd();
    nodes = await waitFor('retry c2', (current) => field(current)?.text === '' && !busyField(current));
    check(header(nodes) === total && rowsTitled(titles.c2) === 1, '(c2) same-captureId retry added no duplicate');

    // (c3) Force-stop after the commit, before the acknowledgment.
    setProp('delay_after_ms', '8000');
    await type(titles.c3);
    await tapAdd();
    await waitFor('commit c3', () => rowsTitled(titles.c3) === 1, 6000);
    sh(`am force-stop ${PKG}`);
    setProp('delay_after_ms', '');
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    launch();
    nodes = await loaded();
    processId = pid();
    total += 1;
    check(boots(processId) === 1 && header(nodes) === total && hasText(nodes, titles.c3), '(c3) committed row survives force-stop');
    // Force-stop finishes the task, so Android keeps no saved state to restore.
    check(field(nodes)?.text === '' && rowsTitled(titles.c3) === 1, '(c3) exactly one row, no stale draft');

    // (d) Failed write stays visible and retryable across recreation.
    setProp('fail_commit', '1');
    await type(titles.d);
    await tapAdd();
    nodes = await waitFor('save failure', hasError);
    const failedState = (current, label) => {
        check(field(current)?.text === titles.d && field(current)?.enabled === 'false', `(d${label}) draft kept and locked`);
        check(button(current, 'Add')?.enabled === 'true', `(d${label}) exact retry allowed`);
        check(button(current, 'Refresh')?.enabled === 'false', `(d${label}) Refresh blocked`);
        const completes = current.filter((node) => node['content-desc']?.startsWith('Complete '))
            .map((node) => button(current, node['content-desc'])).filter(Boolean); // a clipped edge row has no match
        check(completes.length > 0 && completes.every((node) => node.enabled === 'false'), `(d${label}) Complete blocked`);
    };
    failedState(nodes, '');
    check(rowsTitled(titles.d) === 0, '(d) failed commit stored nothing');
    const recreatedBeforeFailure = recreations(processId).length;
    rotate(1);
    await waitFor('rotation recreation', () => recreations(processId).length > recreatedBeforeFailure, 15_000);
    nodes = await waitFor('failed state after rotation', hasError);
    failedState(nodes, ' after rotation');
    rotate(0);
    await waitFor('rotation back', () => recreations(processId).length > recreatedBeforeFailure + 1, 15_000);

    // (d) Back and reopen: the failed save and its exact retry are still there.
    for (let attempt = 0; attempt < 2 && front().includes(`${PKG}/`); attempt += 1) {
        sh('input keyevent KEYCODE_BACK'); // the first Back may only close the keyboard
        await sleep(1500);
    }
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    launch();
    nodes = await waitFor('failed state after Back and reopen', hasError);
    failedState(nodes, ' after Back and reopen');
    // Android 12+ keeps a root Activity on Back, so also finish it: the new
    // screen gets a new ViewModel and must restore the retry from the process.
    const newScreensBefore = newScreens(processId);
    requireAppFront();
    sh(`am start -W -f 0x10008000 -n ${ACTIVITY}`); // NEW_TASK | CLEAR_TASK
    await waitFor('a new screen on the running host', () => newScreens(processId) > newScreensBefore, 15_000);
    nodes = await waitFor('failed state on the new screen', hasError);
    failedState(nodes, ' on a new screen');
    check(pid() === processId && boots(processId) === 1 && rowsTitled(titles.d) === 0, '(d) same process and host, still no row');
    setProp('fail_commit', '');
    await tapAdd();
    nodes = await waitFor('retry d', (current) => header(current) === total + 1 && field(current)?.text === '');
    total += 1;
    check(!hasError(nodes) && button(nodes, 'Refresh')?.enabled === 'true', '(d) retry cleared the failure');
    check(rowsTitled(titles.d) === 1 && boots(processId) === 1, '(d) exactly one row, still one host');

    // (e) Relaunch: boot validation passes and the counts match.
    requireAppFront();
    sh(`am force-stop ${PKG}`);
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    launch();
    nodes = await loaded();
    processId = pid();
    check(boots(processId) === 1 && !nodes.some((node) => node.text?.startsWith('Storage unavailable')), '(e) boot validation passed');
    check(header(nodes) === total, `(e) Inbox total is ${total}`);
    for (const [name, title] of Object.entries(titles)) check(rowsTitled(title) === 1, `(e) ${name} stored once`);
    console.log('Lifecycle device check passed');
} catch (error) {
    console.error(error instanceof Stopped ? `STOPPED: ${error.message}` : `FAIL: ${error.message}`);
    process.exitCode = error instanceof Stopped ? 3 : 1;
} finally {
    restore();
}
