// Task editor check for the isolated native Android development app.
//
//   node apps/android-native/scripts/check-editor-device.mjs <adb-serial> [apk]
//
// Installs the debug APK with `install -r` (existing development data stays),
// captures one task with a title unique to this run, and edits it through the
// editor: (a) a save that changes title, priority, and due date; (b) a draft
// kept through rotation; (c) a draft kept through process death that still
// saves; (d) a failed commit that keeps its exact retry through rotation, Back,
// and a new screen, then stores once; (e) clearing the due date; (f) core's
// refusal of status `reference` with a priority, which writes nothing. It
// asserts through the app's own database copy (.db, -wal and -shm pulled
// together), the UI hierarchy, and logcat. It touches only the development
// package (it refuses any other APK), never launches over another app, and
// restores rotation and clears its debug properties on exit. Leave the device
// on its home screen before running. It needs host `sqlite3`.
// Exit 0 = pass, 1 = fail, 2 = refused before touching the device, 3 = stopped.
import { execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { button, check, connect, fail, field, hasText, Stopped } from './device.mjs';

const [serial, apkArg] = process.argv.slice(2);
if (!serial) {
    console.error('usage: node check-editor-device.mjs <adb-serial> [apk]');
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
const work = resolve(app, 'android/build/editor-check');
// Digits only: some phone keyboards hold typed letters in a composition strip.
const run = `${String(Date.now()).slice(-6)}${String(randomInt(1_000_000)).padStart(6, '0')}`;
const captured = `91${run}`;

const device = connect({ serial, pkg: PKG, uiFile: UI_FILE, adb: adbBin });
const { sh, home, front, requireAppFront, pid, screen, waitFor, tap, type, reveal } = device;
const setProp = (name, value) => sh(`setprop debug.mindwtr.native.${name} '${value}'`);

// ---- device state ----
const launch = () => device.launch(ACTIVITY);
const logs = (processId) => device.logs(processId, TAG);
const count = (text, needle) => text.split('\n').filter((line) => line.includes(needle)).length;
const boots = (processId) => count(logs(processId), 'Core host boot started');
const recreations = (processId) => count(logs(processId), 'reason=activity-recreate');
const newScreens = (processId) => count(logs(processId), 'reason=new-screen');
// The log's `extra` is itself a JSON string, so its quotes arrive escaped.
const updates = (processId, outcome) => logs(processId).replace(/\\/g, '').split('\n').filter((line) => line.includes('native-android-dev-task-command')
    && line.includes('"operation":"update"') && line.includes(`"outcome":"${outcome}"`)).length;
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
const header = (nodes) => Number(nodes.map((node) => /^Inbox · (\d+)$/.exec(node.text ?? '')?.[1]).find(Boolean) ?? NaN);
const inEditor = (nodes) => hasText(nodes, 'Edit task');
const inbox = () => waitFor('the Inbox', (nodes) => !inEditor(nodes) && field(nodes) && Number.isFinite(header(nodes)), 60_000);
const labelStarting = (nodes, prefix) => nodes.find((node) => node.text?.startsWith(prefix));
const tapStarting = async (prefix) => {
    const nodes = await screen();
    const label = labelStarting(nodes, prefix) ?? fail(`no control labelled ${prefix}…`);
    await tap(button(nodes, label.text));
};
/** The editor's draft as its controls show it; the first text field is the title. */
const shown = (nodes, label) => labelStarting(nodes, `${label}: `)?.text.slice(label.length + 2);
const editorShows = (nodes, title, values = {}) => inEditor(nodes) && field(nodes)?.text === title
    && Object.entries(values).every(([label, value]) => shown(nodes, label) === value);

const openEditor = async (title) => {
    let nodes = await inbox();
    // The Inbox grows with every run and pages by 50, so scroll and load more until the row appears.
    for (let page = 0; page < 20; page += 1) {
        nodes = await reveal(title, 20);
        const row = nodes.find((node) => node.text === title && node.class !== 'android.widget.EditText');
        if (row) {
            await tap(row);
            return waitFor(`the editor for ${title}`, (current) => editorShows(current, title));
        }
        const more = button(nodes, 'Load more');
        if (!more) break;
        await tap(more);
        await sleep(1500);
    }
    return fail(`row ${title} is not in the Inbox`);
};
const choose = async (label, value) => {
    await tapStarting(`${label}: `);
    const menu = await waitFor(`the ${label} option ${value}`, (nodes) => button(nodes, value));
    await tap(button(menu, value));
    await waitFor(`${label}: ${value}`, (nodes) => shown(nodes, label) === value);
};
/** Picks [day] of the month the picker opens on (the current month) and returns the stored form. */
const pickDueDay = async (day) => {
    const month = sh('date +%Y-%m');
    await tapStarting('Due date: ');
    const dayPattern = new RegExp(`(^|\\D)${day}(\\D|$)`);
    const picker = await waitFor('the date picker', (nodes) => button(nodes, 'OK')
        && nodes.some((node) => node.clickable === 'true' && dayPattern.test(`${node.text} ${node['content-desc']}`)));
    await tap(picker.find((node) => node.clickable === 'true' && dayPattern.test(`${node.text} ${node['content-desc']}`)));
    await waitFor('OK enabled', (nodes) => button(nodes, 'OK')?.enabled === 'true', 10_000);
    await tap(button(await screen(), 'OK'));
    const value = `${month}-${String(day).padStart(2, '0')}`;
    await waitFor(`Due date: ${value}`, (nodes) => shown(nodes, 'Due date') === value);
    return value;
};
const appendTitle = async (digits, expected) => {
    await tap(field(await screen()));
    requireAppFront();
    sh('input keyevent KEYCODE_MOVE_END');
    sh(`input text ${digits}`);
    await waitFor(`the title ${expected}`, (nodes) => field(nodes)?.text === expected, 10_000);
};
const save = async () => tap(button(await screen(), 'Save'));

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
const FIELDS = 'title, status, priority, dueDate, startTime, description, projectId, rev';
let taskId = '';
const stored = () => sqlite(`SELECT ${FIELDS} FROM tasks WHERE id = '${taskId}' AND deletedAt IS NULL`)[0];
const expectStored = (expected, message) => {
    const row = stored();
    const wrong = Object.entries(expected).filter(([name, value]) => row?.[name] !== value);
    check(wrong.length === 0, `${message}${wrong.length ? ` (stored ${JSON.stringify(row)})` : ''}`);
    return row;
};

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

    // Setup: upgrade-install over existing development data, boot, capture one task.
    const beforeInstall = front();
    if (!beforeInstall.includes(`${PKG}/`) && !beforeInstall.includes(`${home}/`)) {
        throw new Stopped(`another app is in front: ${beforeInstall.trim()}`);
    }
    execFileSync(adbBin, ['-s', serial, 'install', '-r', apk], { stdio: 'inherit' });
    launch();
    await inbox();
    setRotation(0);
    await sleep(1500);
    let nodes = await inbox();
    let processId = pid();
    check(sqlite(`SELECT id FROM tasks WHERE title LIKE '${captured}%'`).length === 0, 'this run\'s titles are not in the database yet');
    const total = header(nodes);
    await type(captured);
    await tap(button(await screen(), 'Add'));
    await waitFor('the capture', (current) => header(current) === total + 1 && field(current)?.text === '');
    const ids = sqlite(`SELECT id FROM tasks WHERE title = '${captured}' AND deletedAt IS NULL`);
    check(ids.length === 1, 'captured one task to edit');
    taskId = ids[0].id;
    let row = expectStored({ title: captured, status: 'inbox', priority: null, dueDate: null }, 'captured task starts plain');

    // (a) Title, priority, and due date change; exactly those are stored, in one write.
    await openEditor(captured);
    await choose('Priority', 'high');
    const due = await pickDueDay(15);
    const titleA = `${captured}7`;
    await appendTitle('7', titleA);
    await save();
    await inbox();
    row = expectStored({
        title: titleA, status: 'inbox', priority: 'high', dueDate: due,
        startTime: null, description: null, projectId: null, rev: row.rev + 1,
    }, '(a) stored exactly the edited title, priority, and due date in one write');

    // (e) Clearing the due date stores null. Done before the restart steps: an Inbox task
    // with a past date is moved to Next by core at startup and would leave the Inbox.
    await openEditor(titleA);
    await tap(button(await screen(), 'Clear due date'));
    await waitFor('Due date: none', (current) => shown(current, 'Due date') === 'none');
    await save();
    await inbox();
    row = expectStored({ title: titleA, priority: 'high', dueDate: null, rev: row.rev + 1 }, '(e) cleared due date stored as null');

    // (b) Rotation mid-edit keeps the draft; nothing is written.
    await openEditor(titleA);
    await choose('Priority', 'low');
    const titleB = `${titleA}8`;
    await appendTitle('8', titleB);
    await rotate(1);
    nodes = await waitFor('the draft after rotation', (current) => editorShows(current, titleB));
    check(pid() === processId, '(b) landscape: same process, draft title kept');
    await rotate(0);
    nodes = await waitFor('the draft after rotating back', (current) => editorShows(current, titleB, { Priority: 'low', 'Due date': 'none' }));
    check(boots(processId) === 1, '(b) portrait: draft title and priority kept, one host boot');
    expectStored({ title: titleA, priority: 'high', rev: row.rev }, '(b) an unsaved draft wrote nothing');

    // (c) Home, process death, relaunch: the draft comes back and saves against its restored base.
    await goHome();
    await sleep(1500);
    sh(`run-as ${PKG} kill -9 ${processId}`);
    await waitFor('process death', () => pid() !== processId, 10_000);
    launch();
    nodes = await waitFor('the restored editor', (current) => editorShows(current, titleB, { Priority: 'low', 'Due date': 'none' }), 60_000);
    processId = pid();
    check(boots(processId) === 1, '(c) editor draft restored after process death, one host boot');
    // Core's startup pass may promote an Inbox task whose date has passed to Next
    // (its own write, same rule as the RN app). The editor's save is measured from here.
    const booted = stored();
    if (booted.rev !== row.rev) console.log(`note - (c) core wrote the task at startup: status ${row.status} -> ${booted.status}, rev ${row.rev} -> ${booted.rev}`);
    await save();
    await inbox();
    row = expectStored({ title: titleB, status: booted.status, priority: 'low', dueDate: null, rev: booted.rev + 1 },
        '(c) restored draft saved once');

    // (d) A failed commit keeps the draft and only its exact retry, across rotation, Back, and a new screen.
    await openEditor(titleB);
    await choose('Priority', 'medium');
    setProp('fail_commit', '1');
    await save();
    const hasError = (current) => current.some((node) => node.text?.includes('Injected commit failure'));
    const failedEditor = (current, label, portrait = true) => {
        check(field(current)?.text === titleB && field(current)?.enabled === 'false', `(d${label}) draft kept and locked`);
        if (portrait) check(shown(current, 'Priority') === 'medium', `(d${label}) edited priority kept`);
        check(button(current, 'Save')?.enabled === 'true', `(d${label}) exact retry allowed`);
        check(button(current, 'Cancel')?.enabled === 'false', `(d${label}) leaving the editor blocked`);
    };
    nodes = await waitFor('save failure', (current) => inEditor(current) && hasError(current));
    failedEditor(nodes, '');
    expectStored({ priority: 'low', rev: row.rev }, '(d) failed commit stored nothing');
    await rotate(1);
    failedEditor(await waitFor('failed state after rotation', (current) => inEditor(current) && hasError(current)), ' landscape', false);
    await rotate(0);
    failedEditor(await waitFor('failed state after rotating back', (current) => inEditor(current) && hasError(current)), ' portrait');
    // Back is left to the system while the retry is owed, so it leaves the app.
    for (let attempt = 0; attempt < 2 && front().includes(`${PKG}/`); attempt += 1) {
        sh('input keyevent KEYCODE_BACK');
        await sleep(1500);
    }
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    launch();
    failedEditor(await waitFor('failed state after Back and reopen', (current) => inEditor(current) && hasError(current)), ' after Back and reopen');
    // Android 12+ keeps a root Activity on Back, so also finish it: the new screen
    // gets a new ViewModel and must restore the editor and its retry from the process.
    const newScreensBefore = newScreens(processId);
    requireAppFront();
    sh(`am start -W -f 0x10008000 -n ${ACTIVITY}`); // NEW_TASK | CLEAR_TASK
    await waitFor('a new screen on the running host', () => newScreens(processId) > newScreensBefore, 15_000);
    failedEditor(await waitFor('failed state on the new screen', (current) => inEditor(current) && hasError(current)), ' on a new screen');
    check(pid() === processId && boots(processId) === 1, '(d) same process and host');
    expectStored({ priority: 'low', rev: row.rev }, '(d) still nothing stored before the retry');
    setProp('fail_commit', '');
    await save();
    nodes = await inbox();
    check(!hasError(nodes) && button(nodes, 'Refresh')?.enabled === 'true', '(d) retry cleared the failure');
    row = expectStored({ title: titleB, priority: 'medium', dueDate: null, rev: row.rev + 1 }, '(d) retry stored the edit once');

    // (f) Status reference with a priority: core refuses, the draft stays editable, nothing is written.
    await openEditor(titleB);
    await choose('Status', 'reference');
    await choose('Priority', 'high');
    await save();
    nodes = await waitFor('core refusal', (current) => current.some((node) => node.text?.includes('priority cannot be set while status is reference')));
    check(nodes.some((node) => node.text?.startsWith('INVALID_INPUT: ')), '(f) core\'s INVALID_INPUT message shown');
    check(editorShows(nodes, titleB, { Status: 'reference', Priority: 'high' }) && field(nodes)?.enabled === 'true'
        && button(nodes, 'Save')?.enabled === 'true', '(f) draft kept and still editable (no retry lock)');
    expectStored({ status: 'inbox', priority: 'medium', rev: row.rev }, '(f) nothing written');
    await tap(button(await screen(), 'Cancel'));
    await tap(button(await waitFor('the discard question', (current) => hasText(current, 'Discard unsaved changes?')), 'Discard'));
    await inbox();
    expectStored({ status: 'inbox', priority: 'medium', rev: row.rev }, '(f) Discard wrote nothing');
    check(updates(processId, 'saved') >= 2 && updates(processId, 'failed') >= 2, // (c) and (d) saves; (d) and (f) failures in this process
        'task-command log shows operation=update saves and failures');

    // Relaunch: boot validation passes and the final values stand.
    requireAppFront();
    sh(`am force-stop ${PKG}`);
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    launch();
    nodes = await inbox();
    processId = pid();
    check(boots(processId) === 1 && !nodes.some((node) => node.text?.startsWith('Storage unavailable')), 'relaunch: boot validation passed');
    expectStored({ title: titleB, status: 'inbox', priority: 'medium', dueDate: null, startTime: null, rev: row.rev },
        'relaunch: final values stored');
    console.log('Editor device check passed');
} catch (error) {
    console.error(error instanceof Stopped ? `STOPPED: ${error.message}` : `FAIL: ${error.message}`);
    process.exitCode = error instanceof Stopped ? 3 : 1;
} finally {
    restore();
}
