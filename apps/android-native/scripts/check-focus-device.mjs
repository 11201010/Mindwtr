// Focus check for the isolated native Android development app.
//
//   node apps/android-native/scripts/check-focus-device.mjs <adb-serial> [apk]
//
// Installs the debug APK with `install -r` (existing development data stays),
// captures two tasks with titles unique to this run, sets both to Next in the
// editor, and checks Focus: (a) they appear under "Next actions"; (b) a due
// date of today, picked where the date picker marks today, moves one under
// "Today", and Save and Cancel return to Focus; (c) Complete from Focus
// removes it and stores `done` once; (d) rotation keeps the Focus tab and its
// rows; (e) process death restores the Focus tab; (f) a failed Complete keeps
// its exact retry through rotation, Back, and a new screen, then stores once;
// (g) Load more adds rows to a section with more than 50 (skipped when the
// development data has none). It asserts through the app's own database copy
// (.db, -wal and -shm pulled together), the UI hierarchy, and logcat. It
// touches only the development package (it refuses any other APK), never
// launches over another app, leaves the app on its Inbox tab, and restores
// rotation and clears its debug properties on exit. Leave the device on its
// home screen before running. It needs host `sqlite3`.
// Exit 0 = pass, 1 = fail, 2 = refused before touching the device, 3 = stopped.
import { execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { bootFailure, box, button, check, connect, fail, field, hasText, Stopped } from './device.mjs';
// Focus section titles as core renders them in English (core's dictionary, not literals).
const { en } = await import(resolve(import.meta.dirname, '../../../packages/core/src/i18n/locales/en.ts'));
const NEXT_ACTIONS = en['focus.nextActions'];
const TODAY = en['focus.schedule'];

const [serial, apkArg] = process.argv.slice(2);
if (!serial) {
    console.error('usage: node check-focus-device.mjs <adb-serial> [apk]');
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
// `language` is cleared so the app shows core's text for the phone's language (English on the test phone).
const PROPS = ['fail_commit', 'delay_before_ms', 'delay_after_ms', 'language'];
const work = resolve(app, 'android/build/focus-check');
// Digits only: some phone keyboards hold typed letters in a composition strip.
const run = `${String(Date.now()).slice(-6)}${String(randomInt(1_000_000)).padStart(6, '0')}`;
const first = `71${run}`;
const second = `72${run}`;

const device = connect({ serial, pkg: PKG, uiFile: UI_FILE, adb: adbBin });
const { sh, home, front, requireAppFront, pid, screen, waitFor, tap, type, swipe, signature, toTop } = device;
const setProp = (name, value) => sh(`setprop debug.mindwtr.native.${name} '${value}'`);

// ---- device state ----
const launch = () => device.launch(ACTIVITY);
const logs = (processId) => device.logs(processId, TAG);
const count = (text, needle) => text.split('\n').filter((line) => line.includes(needle)).length;
const boots = (processId) => count(logs(processId), 'Core host boot started');
const recreations = (processId) => count(logs(processId), 'reason=activity-recreate');
const newScreens = (processId) => count(logs(processId), 'reason=new-screen');
// The log's `extra` is itself a JSON string, so its quotes arrive escaped.
const completes = (processId, outcome) => logs(processId).replace(/\\/g, '').split('\n').filter((line) => line.includes('native-android-dev-task-command')
    && line.includes('"operation":"complete"') && line.includes(`"outcome":"${outcome}"`)).length;
const setRotation = (rotation) => {
    requireAppFront();
    sh('settings put system accelerometer_rotation 0');
    sh(`settings put system user_rotation ${rotation}`);
};
/** Rotates and waits until the running host logs the recreated Activity. */
const rotate = async (rotation) => {
    const processId = pid();
    const before = recreations(processId);
    setRotation(rotation);
    await waitFor(`rotation ${rotation} recreation`, () => recreations(processId) > before, 15_000);
};
const goHome = async () => {
    requireAppFront();
    sh('input keyevent KEYCODE_HOME');
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
};

// ---- UI ----
const inboxCount = (nodes) => Number(nodes.map((node) => /^Inbox · (\d+)$/.exec(node.text ?? '')?.[1]).find(Boolean) ?? NaN);
const inEditor = (nodes) => hasText(nodes, 'Edit Task');
// A Compose Tab is selectable, not clickable: find it as the smallest focusable node around its label.
const tab = (nodes, name) => {
    const label = nodes.find((node) => node.text === name && node.class === 'android.widget.TextView');
    if (!label) return undefined;
    const [x1, y1, x2, y2] = box(label);
    const area = (node) => { const [l, t, r, b] = box(node); return (r - l) * (b - t); };
    return nodes.filter((node) => node.focusable === 'true').filter((node) => {
        const [l, t, r, b] = box(node);
        return l <= x1 && t <= y1 && r >= x2 && b >= y2;
    }).sort((a, b) => area(a) - area(b))[0];
};
const tabSelected = (nodes, name) => tab(nodes, name)?.selected === 'true';
/** Focus section titles as "<core title> · <core total>"; each title stays pinned above its rows. */
const headers = (nodes) => nodes.flatMap((node) => {
    const match = /^(.+) · (\d+)$/.exec(node.text ?? '');
    return match ? [{ title: match[1], total: Number(match[2]), top: box(node)[1] }] : [];
});
const sectionTotal = (nodes, title) => headers(nodes).find((header) => header.title === title)?.total;
const rowNode = (nodes, title) => nodes.find((node) => node.text === title && node.class !== 'android.widget.EditText');
/** The section a visible row is in: the nearest title at or above the row. */
const sectionOf = (nodes, title) => {
    const row = rowNode(nodes, title);
    if (!row) return undefined;
    const top = box(row)[1];
    return headers(nodes).filter((header) => header.top <= top).sort((a, b) => b.top - a.top)[0]?.title;
};
const inbox = () => waitFor('the Inbox', (nodes) => tabSelected(nodes, 'Inbox') && !inEditor(nodes) && field(nodes)
    && Number.isFinite(inboxCount(nodes)), 60_000);
const focusList = (description = 'Focus') => waitFor(description, (nodes) => tabSelected(nodes, 'Focus') && !inEditor(nodes)
    && headers(nodes).length > 0, 60_000);
const showTab = async (name) => {
    const nodes = await waitFor('the tabs', (current) => tab(current, name), 60_000);
    if (!tabSelected(nodes, name)) await tap(tab(nodes, name));
    await waitFor(`the ${name} tab`, (current) => tabSelected(current, name), 10_000);
};
const hasError = (nodes) => nodes.some((node) => node.text?.includes('Injected commit failure'));
/** Taps the control labelled [label] until [done] holds; a tap can land while the list still moves, so tap again. */
const tapUntil = async (label, description, done) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const nodes = await screen();
        // The last tap took effect after the wait ran out: tapping again would be a second command
        // (after a failure, its exact retry), so stop here.
        if (attempt > 0 && done(nodes)) return nodes;
        const control = button(nodes, label);
        if (!control && attempt > 0) break; // the first tap took effect; only the wait is left
        await tap(control ?? fail(`no control labelled ${label}`));
        try { return await waitFor(description, done, 8_000); } catch { /* tap again */ }
    }
    return waitFor(description, done, 20_000);
};
const labelStarting = (nodes, prefix) => nodes.find((node) => node.text?.startsWith(prefix));
const tapStarting = async (prefix) => {
    const nodes = await screen();
    const label = labelStarting(nodes, prefix) ?? fail(`no control labelled ${prefix}…`);
    await tap(button(nodes, label.text));
};
const shown = (nodes, label) => labelStarting(nodes, `${label}: `)?.text.slice(label.length + 2);
const editorShows = (nodes, title, values = {}) => inEditor(nodes) && field(nodes)?.text === title
    && Object.entries(values).every(([label, value]) => shown(nodes, label) === value);
const choose = async (label, value) => {
    await tapStarting(`${label}: `);
    const menu = await waitFor(`the ${label} option ${value}`, (nodes) => button(nodes, value));
    await tap(button(menu, value));
    await waitFor(`${label}: ${value}`, (nodes) => shown(nodes, label) === value);
};

/**
 * Scrolls Focus from the top until [title] is on screen. An enabled
 * "More <section>" (core's `common.more`) on the way is tapped, since sections page by 50.
 */
const findRow = async (title) => {
    let nodes = await toTop();
    for (let step = 0; step < 80; step += 1) {
        if (rowNode(nodes, title)) return nodes;
        const more = nodes.find((node) => node['content-desc']?.startsWith('More ') && button(nodes, node['content-desc'])?.enabled === 'true');
        if (more) {
            await tap(button(nodes, more['content-desc']));
            nodes = await waitFor('Load more to finish', (current) => !current.some((node) => node['content-desc'] === more['content-desc']
                && node.bounds === more.bounds), 15_000);
            continue;
        }
        const next = await swipe(nodes, 'down');
        if (signature(next) === signature(nodes)) break;
        nodes = next;
    }
    return fail(`row ${title} is not in Focus`);
};
const expectSection = async (title, section, label) => {
    const nodes = await findRow(title);
    check(sectionOf(nodes, title) === section, `${label} ${title} is under "${section}"${sectionOf(nodes, title) === section ? '' : ` (found under "${sectionOf(nodes, title)}")`}`);
    return nodes;
};

/** Opens the editor from the Inbox, scrolling and loading more until the row appears. */
const openFromInbox = async (title) => {
    let nodes = await inbox();
    for (let page = 0; page < 20; page += 1) {
        nodes = await device.reveal(title, 20);
        const row = rowNode(nodes, title);
        if (row) {
            await tap(row);
            return waitFor(`the editor for ${title}`, (current) => editorShows(current, title));
        }
        const more = button(nodes, 'More');
        if (!more) break;
        await tap(more);
        await sleep(1500);
    }
    return fail(`row ${title} is not in the Inbox`);
};
const openFromFocus = async (title) => {
    const nodes = await findRow(title);
    await tap(rowNode(nodes, title));
    return waitFor(`the editor for ${title}`, (current) => editorShows(current, title));
};

// ---- database ----
const sqlite = (sql) => {
    const dir = resolve(work, 'db');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const present = sh(`run-as ${PKG} ls files`).split(/\s+/);
    for (const suffix of ['', '-wal', '-shm']) {
        const name = `mindwtr-native-dev.db${suffix}`;
        if (present.includes(name)) device.pull(`files/${name}`, resolve(dir, name));
    }
    return JSON.parse(execFileSync('sqlite3', ['-json', resolve(dir, 'mindwtr-native-dev.db'), sql], { encoding: 'utf8' }) || '[]');
};
const ids = {};
const stored = (title) => sqlite(`SELECT status, dueDate, rev FROM tasks WHERE id = '${ids[title]}' AND deletedAt IS NULL`)[0];
const expectStored = (title, expected, message) => {
    const row = stored(title);
    const wrong = Object.entries(expected).filter(([name, value]) => row?.[name] !== value);
    check(wrong.length === 0, `${message}${wrong.length ? ` (stored ${JSON.stringify(row)})` : ''}`);
    return row;
};

const originalAccelerometer = sh('settings get system accelerometer_rotation');
const originalRotation = sh('settings get system user_rotation');
const restore = async () => {
    for (const name of PROPS) { try { setProp(name, ''); } catch { /* device gone */ } }
    // Leave the app on its Inbox tab: the other checks start there.
    try {
        const tab = front().includes(`${PKG}/`) ? button(await screen(), 'Inbox') : undefined;
        if (tab && tab.selected !== 'true') await tap(tab);
    } catch { /* the app is gone */ }
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

    // Setup: upgrade-install over existing development data, boot, capture two tasks, set both to Next.
    const beforeInstall = front();
    if (!beforeInstall.includes(`${PKG}/`) && !beforeInstall.includes(`${home}/`)) {
        throw new Stopped(`another app is in front: ${beforeInstall.trim()}`);
    }
    execFileSync(adbBin, ['-s', serial, 'install', '-r', apk], { stdio: 'inherit' });
    launch();
    await showTab('Inbox');
    setRotation(0);
    await sleep(1500);
    let nodes = await inbox();
    let processId = pid();
    check(sqlite(`SELECT id FROM tasks WHERE title IN ('${first}', '${second}')`).length === 0, 'this run\'s titles are not in the database yet');
    for (const title of [first, second]) {
        const total = inboxCount(await inbox());
        await type(title);
        await tap(button(await screen(), 'Add'));
        await waitFor(`the capture of ${title}`, (current) => inboxCount(current) === total + 1 && field(current)?.text === '');
        const found = sqlite(`SELECT id FROM tasks WHERE title = '${title}' AND deletedAt IS NULL`);
        check(found.length === 1, `captured ${title} once`);
        ids[title] = found[0].id;
        await openFromInbox(title);
        await choose('Status', 'Next');
        await tap(button(await screen(), 'Save'));
        await inbox();
        expectStored(title, { status: 'next', dueDate: null }, `${title} stored as next`);
    }

    // (a) Both appear under core's "Next actions" in Focus.
    await showTab('Focus');
    await focusList();
    await expectSection(first, NEXT_ACTIONS, '(a)');
    await expectSection(second, NEXT_ACTIONS, '(a)');

    // (b) The editor opens from Focus, and Cancel and Save both return to Focus.
    await openFromFocus(first);
    await tap(button(await screen(), 'Cancel'));
    await focusList('Focus after Cancel');
    check(true, '(b) Cancel returned to Focus');
    // Due today, picked where the picker marks today: the row moves under "Today".
    await openFromFocus(first);
    const today = sh('date +%Y-%m-%d');
    const day = Number(sh('date +%d'));
    await tapStarting('Due Date: ');
    const label = (node) => `${node.text ?? ''} ${node['content-desc'] ?? ''}`;
    const todayCell = (current) => current.find((node) => node.clickable === 'true' && /\bToday\b/.test(label(node)));
    nodes = await waitFor('the date picker', (current) => button(current, 'OK') && todayCell(current));
    check(new RegExp(`(^|\\D)${day}(\\D|$)`).test(label(todayCell(nodes))), `(b) the picker marks today, day ${day} ("${label(todayCell(nodes)).trim()}")`);
    await tap(todayCell(nodes));
    await waitFor('OK enabled', (current) => button(current, 'OK')?.enabled === 'true', 10_000);
    await tap(button(await screen(), 'OK'));
    await waitFor(`Due Date: ${today}`, (current) => shown(current, 'Due Date') === today);
    const beforeDue = stored(first);
    await tap(button(await screen(), 'Save'));
    await focusList('Focus after Save');
    check(true, '(b) Save returned to Focus');
    const due = expectStored(first, { status: 'next', dueDate: today, rev: beforeDue.rev + 1 }, `(b) due date ${today} stored in one write`);
    nodes = await expectSection(first, TODAY, '(b)');

    // (c) Complete from Focus: the row leaves, core's Today total drops by one, and done is stored once.
    const todayTotal = sectionTotal(nodes, TODAY);
    const savedBefore = completes(processId, 'saved');
    nodes = await tapUntil(`Done ${first}`, `${first} to leave Focus`,
        (current) => !rowNode(current, first) && sectionTotal(current, TODAY) === todayTotal - 1);
    check(true, `(c) ${first} left Focus; Today total ${todayTotal} -> ${todayTotal - 1}`);
    expectStored(first, { status: 'done', dueDate: today, rev: due.rev + 1 }, '(c) done stored in one write');
    check(completes(processId, 'saved') === savedBefore + 1, '(c) task-command log shows one operation=complete saved');

    // (d) Rotation keeps the Focus tab and its rows, on the same process and host.
    await rotate(1);
    await focusList('Focus after rotation');
    await expectSection(second, NEXT_ACTIONS, '(d) landscape: Focus tab kept;');
    await rotate(0);
    await focusList('Focus after rotating back');
    await expectSection(second, NEXT_ACTIONS, '(d) portrait: Focus tab kept;');
    check(pid() === processId && boots(processId) === 1, '(d) same process, one host boot');

    // (e) Home, process death, relaunch: the Focus tab comes back.
    await goHome();
    await sleep(1500);
    sh(`run-as ${PKG} kill -9 ${processId}`);
    await waitFor('process death', () => pid() !== processId, 10_000);
    launch();
    await focusList('the restored Focus tab');
    processId = pid();
    check(boots(processId) === 1, '(e) Focus tab restored after process death, one host boot');
    nodes = await expectSection(second, NEXT_ACTIONS, '(e)');

    // (f) A failed Complete from Focus keeps only its exact retry across rotation, Back, and a new screen.
    const beforeFailure = stored(second);
    setProp('fail_commit', '1');
    nodes = await tapUntil(`Done ${second}`, 'the failed Complete', hasError);
    const failedFocus = async (description, labelText) => {
        // At the top of the list nothing overlaps the pinned failure text, so the tree reports it there.
        await toTop();
        await waitFor(description, (current) => tabSelected(current, 'Focus') && hasError(current));
        const current = await findRow(second);
        // After a scroll, Compose can report a partly scrolled-out row's full bounds over the pinned failure
        // text, so the accessibility tree omits that text although it stays on screen (screenshot-verified,
        // U04 follow-up). The failure was asserted above; here the owed retry itself is the evidence.
        check(tabSelected(current, 'Focus'), `(f${labelText}) Focus tab kept`);
        check(button(current, `Done ${second}`)?.enabled === 'true', `(f${labelText}) exact retry allowed`);
        const others = current.filter((node) => node['content-desc']?.startsWith('Done ') && node['content-desc'] !== `Done ${second}`)
            .map((node) => button(current, node['content-desc'])).filter(Boolean);
        check(others.every((node) => node.enabled === 'false'), `(f${labelText}) ${others.length} other Done buttons blocked`);
        check(tab(current, 'Inbox')?.enabled === 'true', `(f${labelText}) tabs still work`);
    };
    await failedFocus('the failure', '');
    expectStored(second, { status: 'next', rev: beforeFailure.rev }, '(f) failed commit stored nothing');
    await rotate(1);
    await failedFocus('the failure after rotation', ' landscape');
    await rotate(0);
    await failedFocus('the failure after rotating back', ' portrait');
    // Back is left to the system while the retry is owed, so it leaves the app.
    for (let attempt = 0; attempt < 2 && front().includes(`${PKG}/`); attempt += 1) {
        sh('input keyevent KEYCODE_BACK');
        await sleep(1500);
    }
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    launch();
    await failedFocus('the failure after Back and reopen', ' after Back and reopen');
    // Android 12+ keeps a root Activity on Back, so also finish it: the new screen gets
    // a new ViewModel and must restore Focus, its rows, and the retry from the process.
    const newScreensBefore = newScreens(processId);
    requireAppFront();
    sh(`am start -W -f 0x10008000 -n ${ACTIVITY}`); // NEW_TASK | CLEAR_TASK
    await waitFor('a new screen on the running host', () => newScreens(processId) > newScreensBefore, 15_000);
    await failedFocus('the failure on a new screen', ' on a new screen');
    check(pid() === processId && boots(processId) === 1, '(f) same process and host');
    expectStored(second, { status: 'next', rev: beforeFailure.rev }, '(f) still nothing stored before the retry');
    // Reads wait while the retry is owed, so no read failure can have replaced the Done retry.
    check(!logs(processId).includes('lock=storage'), '(f) no read failed while the retry was owed (log has no lock=storage)');
    setProp('fail_commit', '');
    nodes = await tapUntil(`Done ${second}`, 'the retry', (current) => !hasError(current) && !rowNode(current, second));
    expectStored(second, { status: 'done', rev: beforeFailure.rev + 1 }, '(f) retry stored done once');
    check(completes(processId, 'failed') >= 1 && completes(processId, 'saved') >= 1, '(f) task-command log shows the failed and the saved complete');

    // (g) Load more on a section with more than 50 rows, if the development data has one.
    nodes = await toTop();
    let more;
    for (let step = 0; step < 80 && !more; step += 1) {
        more = nodes.find((node) => node['content-desc']?.startsWith('More '));
        if (more) break;
        const next = await swipe(nodes, 'down');
        if (signature(next) === signature(nodes)) break;
        nodes = next;
    }
    if (!more) {
        console.log('skip - (g) no Focus section has more than 50 rows in the development data');
    } else {
        const section = more['content-desc'].slice('More '.length);
        const moreTop = box(more)[1];
        // Row titles as their Complete buttons name them; a row the window added sits where Load more was.
        const rowTitles = (current) => current.filter((node) => node['content-desc']?.startsWith('Done '))
            .map((node) => ({ title: node['content-desc'].slice('Done '.length), top: box(node)[1] }));
        const before = new Set(rowTitles(nodes).map(({ title }) => title));
        const addedRow = (current) => rowTitles(current).find(({ title, top }) => !before.has(title) && top >= moreTop - 5);
        nodes = await tapUntil(more['content-desc'], `rows after Load more ${section}`, addedRow);
        const added = addedRow(nodes).title;
        check(sectionOf(nodes, added) === section, `(g) Load more added ${added} to "${section}"`);
        // A resume reads Focus again from offset 0 and keeps the loaded depth.
        await goHome();
        launch();
        await focusList('Focus after resume');
        await sleep(2000);
        check(rowNode(await screen(), added), `(g) ${added} still loaded after a resume refresh`);
    }

    // Relaunch: boot validation passes on the final data.
    requireAppFront();
    sh(`am force-stop ${PKG}`);
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    launch();
    await showTab('Inbox');
    nodes = await inbox();
    processId = pid();
    check(boots(processId) === 1 && !bootFailure(nodes), 'relaunch: boot validation passed');
    expectStored(first, { status: 'done' }, `relaunch: ${first} done`);
    expectStored(second, { status: 'done' }, `relaunch: ${second} done`);
    console.log('Focus device check passed');
} catch (error) {
    console.error(error instanceof Stopped ? `STOPPED: ${error.message}` : `FAIL: ${error.message}`);
    process.exitCode = error instanceof Stopped ? 3 : 1;
} finally {
    await restore();
}
