// Entry points check for the isolated native Android development app.
//
//   node apps/android-native/scripts/check-entry-points-device.mjs <adb-serial> [apk]
//
// Installs the debug APK with `install -r` (existing development data stays) and checks RN's system entry points on the
// development scheme mindwtr-native-dev (the phone's RN app keeps mindwtr://, so no link here can reach it):
// (a) `dumpsys shortcut` lists RN's launcher shortcuts (add_task_inbox, open_focus, open_calendar) as manifest shortcuts;
// (b) a text share (ACTION_SEND text/plain) opens the capture popup with the shared text, and Save stores it once (core,
// on a copy of the app's database); (c) links land on core's screen: the Inbox, Focus (open-feature today), Waiting,
// Someday (open-feature), the Calendar, the global search with its query, a task (the editor over Focus), a project, the
// capture popup (open-feature capture), a capture link's title, an assistant note's name (CREATE_NOTE), and a capture link
// without a title (core's toast); (d) a widget's quick capture link (capture-quick) opens the popup, and its Close puts the
// app behind the previous screen (RN's #1169). Nothing but (b)'s share is saved; its title is 77 + a 12-digit run id + 1
// (check-projects-device.mjs --prune-old removes earlier runs'). It never types, never launches over another app, and
// leaves the app on its Inbox. Leave the device on its home screen before running. It needs host `bun`.
// Exit 0 = pass, 1 = fail, 2 = refused before touching the device, 3 = stopped.
import { execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { button, check, connect, draftText, evidenced, fail, field, hasText, inEditor, Stopped, tab, tabSelected, tagged, withDescription } from './device.mjs';

const [serial, apkArg] = process.argv.slice(2);
if (!serial) {
    console.error('usage: node check-entry-points-device.mjs <adb-serial> [apk]');
    process.exit(2);
}
const app = resolve(import.meta.dirname, '..');
const apk = apkArg ?? resolve(app, 'android/app/build/outputs/apk/debug/app-debug.apk');
const adbBin = process.env.ADB ?? '/home/dd/Android/Sdk/platform-tools/adb';
const aapt2 = process.env.AAPT2 ?? '/home/dd/Android/Sdk/build-tools/36.1.0/aapt2';
const PKG = 'tech.dongdongbh.mindwtr.nativeclient.dev';
const SCHEME = 'mindwtr-native-dev';
const apkPackage = execFileSync(aapt2, ['dump', 'packagename', apk], { encoding: 'utf8' }).trim();
if (apkPackage !== PKG) {
    console.error(`REFUSED: ${apk} is package "${apkPackage}", not ${PKG}`);
    process.exit(2);
}
const ACTIVITY = `${PKG}/tech.dongdongbh.mindwtr.pilot.MainActivity`;
const TAG = 'MindwtrNativeDev';
const UI_FILE = '/data/local/tmp/mindwtr-native-dev-ui.xml';
const PROPS = ['fail_commit', 'delay_before_ms', 'delay_after_ms', 'language'];
const DB = 'mindwtr-native-dev.db';
const work = resolve(app, 'android/build/entry-points-check');
const coreSrc = resolve(app, '../../packages/core/src');
const { en } = await import(resolve(coreSrc, 'i18n/locales/en.ts'));
// Digits only: no keyboard is involved, and the prune shape stays simple.
const run = `${String(Date.now()).slice(-6)}${String(randomInt(1_000_000)).padStart(6, '0')}`;
const titles = { shared: `77${run}1`, link: `77${run}2`, note: `77${run}3` };

const device = connect({ serial, pkg: PKG, uiFile: UI_FILE, adb: adbBin });
const { sh, home, front, requireAppFront, pid, screen, waitFor, tapExpecting } = device;
const setProp = (name, value) => sh(`setprop debug.mindwtr.native.${name} '${value}'`);
const lines = (...needles) => device.logs(pid(), TAG).replace(/\\/g, '').split('\n').filter((line) => needles.every((needle) => line.includes(needle))).length;
const entries = (outcome) => lines('native-android-entry-point', `"outcome":"${outcome}"`);
const captures = () => lines('native-android-dev-task-command', '"operation":"quickCapture"', '"outcome":"saved"');

// ---- core on a copy of the app's database ----
const pullDatabase = () => {
    const dir = resolve(work, 'db');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const present = sh(`run-as ${PKG} ls files`).split(/\s+/);
    for (const suffix of ['', '-wal', '-shm']) if (present.includes(`${DB}${suffix}`)) device.pull(`files/${DB}${suffix}`, resolve(dir, `${DB}${suffix}`));
    return resolve(dir, DB);
};
/** The live tasks titled like this run's entries, with their ids, and one live project that takes tasks (id and title). */
const core = () => JSON.parse(execFileSync('bun', ['-e', `
    import { Database } from 'bun:sqlite';
    import { SqliteAdapter, createNativeHostContract, isSelectableProjectForTaskAssignment, setStorageAdapter, useTaskStore } from '${coreSrc}/index.ts';
    const db = new Database(process.env.CHECK_DB);
    setStorageAdapter(new SqliteAdapter({
        run: async (sql, params = []) => { db.query(sql).run(...params); },
        all: async (sql, params = []) => db.query(sql).all(...params),
        get: async (sql, params = []) => db.query(sql).get(...params) ?? undefined,
        exec: async (sql) => { db.exec(sql); },
    }));
    const host = createNativeHostContract();
    const ready = await host.activate({ writeSafetyReady: true });
    if (!ready.ok) throw new Error(ready.error.message);
    const store = useTaskStore.getState();
    const titles = JSON.parse(process.env.CHECK_TITLES);
    const project = store.projects.find((item) => isSelectableProjectForTaskAssignment(item));
    console.log(JSON.stringify({
        tasks: Object.fromEntries(Object.entries(titles).map(([name, title]) => [name,
            store._allTasks.filter((task) => task.title === title && !task.deletedAt).map((task) => ({ id: task.id, status: task.status }))])),
        project: project ? { id: project.id, title: project.title } : null,
    }));
    process.exit(0);
`], { encoding: 'utf8', env: { ...process.env, CHECK_DB: pullDatabase(), CHECK_TITLES: JSON.stringify(titles) } }).trim().split('\n').pop());

// ---- UI (core's English) ----
const onTabs = (name) => (nodes) => tabSelected(nodes, name) && !inEditor(nodes) && !tagged(nodes, 'global-search') && !tagged(nodes, 'menu-screen');
const inScreen = (title) => (nodes) => Boolean(tagged(nodes, 'menu-screen')) && hasText(nodes, title);
const popup = (text) => (nodes) => Boolean(tagged(nodes, 'quick-capture')) && draftText(nodes) === text;
/** Sends [intent] (am start arguments) to this app only, and waits for [expected]. */
const send = async (intent, expected, description, timeoutMs = 20_000) => {
    requireAppFront();
    sh(`am start -W ${intent} ${PKG}`);
    return waitFor(description, expected, timeoutMs);
};
const link = (path, expected, description) => send(`-a android.intent.action.VIEW -d '${SCHEME}://${path}'`, expected, description);
/** Leaves a screen the check opened with the system Back, back to the tabs. */
const back = async (description) => {
    requireAppFront();
    sh('input keyevent KEYCODE_BACK');
    return waitFor(description, (nodes) => Boolean(tab(nodes, en['tab.inbox'])) && !tagged(nodes, 'menu-screen') && !tagged(nodes, 'global-search') && !inEditor(nodes), 15_000);
};
const closePopup = (nodes) => tapExpecting(withDescription(nodes, en['common.close']) ?? fail('no Close on the capture popup'),
    (current) => !tagged(current, 'quick-capture'), 'the popup to close');

const originalAccelerometer = sh('settings get system accelerometer_rotation');
const originalRotation = sh('settings get system user_rotation');
const restore = async () => {
    for (const name of PROPS) { try { setProp(name, ''); } catch { /* device gone */ } }
    // Leave the app on its Inbox: the other checks start there.
    try {
        if (front().includes(`${PKG}/`)) {
            let nodes = await screen();
            if (tagged(nodes, 'quick-capture')) { sh('input keyevent KEYCODE_BACK'); await sleep(800); nodes = await screen(); }
            for (let step = 0; step < 3 && (inEditor(nodes) || tagged(nodes, 'menu-screen') || tagged(nodes, 'global-search')); step += 1) {
                sh('input keyevent KEYCODE_BACK');
                await sleep(800);
                nodes = await screen();
            }
            if (tab(nodes, en['tab.inbox']) && !tabSelected(nodes, en['tab.inbox'])) await device.tap(tab(nodes, en['tab.inbox']));
        }
    } catch { /* the app is gone */ }
    for (const [name, value] of [['user_rotation', originalRotation], ['accelerometer_rotation', originalAccelerometer]]) {
        try { sh(value === 'null' ? `settings delete system ${name}` : `settings put system ${name} ${value}`); } catch { /* device gone */ }
    }
    try { sh(`rm -f ${UI_FILE}`); } catch { /* device gone */ }
};

try {
    mkdirSync(work, { recursive: true });
    console.log(`device: ${sh('getprop ro.product.model')} / Android ${sh('getprop ro.build.version.release')} (API ${sh('getprop ro.build.version.sdk')})`);
    console.log(`apk: ${apk}\napk sha256: ${createHash('sha256').update(readFileSync(apk)).digest('hex')}`);
    for (const name of PROPS) setProp(name, '');
    const beforeInstall = front();
    if (!beforeInstall.includes(`${PKG}/`) && !beforeInstall.includes(`${home}/`)) throw new Stopped(`another app is in front: ${beforeInstall.trim()}`);
    execFileSync(adbBin, ['-s', serial, 'install', '-r', apk], { stdio: 'inherit' });
    device.launch(ACTIVITY);
    requireAppFront();
    sh('settings put system accelerometer_rotation 0');
    sh('settings put system user_rotation 0');
    await waitFor('the tabs', (nodes) => Boolean(tab(nodes, en['tab.inbox'])), 60_000);

    // (a) RN's launcher shortcuts are the package's manifest shortcuts (RN's App Actions ids live in the same XML; the gate checks them).
    // The package's own section: from its "Package:" line to the next package's or launcher's line at the same depth.
    const dumpLines = sh('dumpsys shortcut').split('\n');
    const start = dumpLines.findIndex((line) => line.trim().startsWith(`Package: ${PKG} `) || line.trim() === `Package: ${PKG}`);
    const depth = start < 0 ? 0 : dumpLines[start].search(/\S/);
    const end = dumpLines.findIndex((line, index) => index > start && line.search(/\S/) === depth && /^\s*(Package|Launcher): /.test(line));
    const ids = start < 0 ? [] : [...dumpLines.slice(start, end < 0 ? undefined : end).join('\n').matchAll(/ShortcutInfo \{id=([^,]+),/g)].map(([, id]) => id);
    check(['add_task_inbox', 'open_focus', 'open_calendar'].every((id) => ids.includes(id)), `(a) dumpsys shortcut lists RN's shortcuts: ${JSON.stringify(ids)}`);

    // (b) A text share opens the popup with the text; Save stores it once.
    const capturesBefore = captures();
    let nodes = await send(`-a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT '${titles.shared}'`, popup(titles.shared), 'the popup with the shared text');
    await tapExpecting(button(nodes, en['common.save']) ?? fail('no Save on the popup'), (current) => !tagged(current, 'quick-capture'), 'the share to save');
    await waitFor('the capture command', () => captures() === capturesBefore + 1, 15_000);
    let stored = core();
    check(stored.tasks.shared.length === 1 && stored.tasks.shared[0].status === 'inbox', `(b) the shared text is stored once, in the Inbox (${JSON.stringify(stored.tasks.shared)})`);

    // (c) Links land on core's screens.
    await link('/inbox', onTabs(en['tab.inbox']), 'the Inbox');
    check(true, '(c) inbox opens the Inbox tab');
    await link('/open-feature?feature=today', onTabs(en['tab.next']), 'Focus');
    check(true, '(c) open-feature today opens the Focus tab');
    await link('/waiting', inScreen(en['waiting.title']), 'Waiting');
    await back('the tabs after Waiting');
    check(true, '(c) waiting opens RN\'s Waiting screen');
    await link('/open-feature?feature=someday', inScreen(en['someday.title']), 'Someday');
    await back('the tabs after Someday');
    check(true, '(c) open-feature someday opens RN\'s Someday screen');
    await link('/calendar', (current) => Boolean(tagged(current, 'calendar')), 'the Calendar');
    await back('the tabs after the Calendar');
    check(true, '(c) calendar opens RN\'s Calendar screen');
    nodes = await link(`/global-search?q=${titles.shared}`, (current) => Boolean(tagged(current, 'global-search')) && field(current)?.text === titles.shared, 'the search with its query');
    await back('the tabs after the search');
    check(true, '(c) global-search opens RN\'s search with the link\'s query');
    await link(`/open?task=${stored.tasks.shared[0].id}`, (current) => inEditor(current) && hasText(current, titles.shared), 'the shared task in the editor');
    nodes = await screen();
    await tapExpecting(withDescription(nodes, en['common.close']) ?? fail('no Close in the editor'), onTabs(en['tab.next']), 'Focus under the editor');
    check(true, '(c) open?task opens the task in the editor over Focus');
    if (stored.project) {
        await link(`/open?project=${stored.project.id}`, (current) => hasText(current, stored.project.title) && Boolean(button(current, 'Back')), 'the project');
        await back('the tabs after the project');
        check(true, `(c) open?project opens the project ${stored.project.title}`);
    } else console.log('skip - (c) open?project: the development data has no project that takes tasks');
    nodes = await link('/open-feature?feature=capture', popup(''), 'the empty capture popup');
    await closePopup(nodes);
    check(true, '(c) open-feature capture opens the capture popup');
    nodes = await link(`/capture?title=${titles.link}&note=77`, popup(titles.link), 'the popup with the link\'s title');
    await closePopup(nodes);
    check(true, '(c) a capture link opens the popup with its title');
    nodes = await send(`-a com.google.android.gms.actions.CREATE_NOTE -t text/plain --es com.google.android.gms.actions.extra.NAME '${titles.note}'`,
        popup(titles.note), 'the popup with the note\'s name');
    await closePopup(nodes);
    check(true, '(c) an assistant note opens the popup with its name');
    await link('/capture?note=77', (current) => hasText(current, en['shortcuts.captureUnavailable']), 'core\'s toast for a capture link without a title', 5_000);
    check(true, '(c) a capture link without a title shows core\'s toast');

    // (d) A widget's quick capture: the popup, and its Close puts the app behind the previous screen.
    nodes = await link('/capture-quick', popup(''), 'the quick capture popup');
    await tapExpecting(withDescription(nodes, en['common.close']) ?? fail('no Close on the capture popup'), () => !front().includes(`${PKG}/`), 'the app to go behind');
    check(true, '(d) capture-quick\'s Close returns to the previous screen');
    device.launch(ACTIVITY);
    await waitFor('the tabs again', (current) => Boolean(tab(current, en['tab.inbox'])), 30_000);

    stored = core();
    check(stored.tasks.shared.length === 1 && stored.tasks.link.length === 0 && stored.tasks.note.length === 0, '(e) only the shared text was stored; the closed popups stored nothing');
    check(entries('capture') >= 5 && entries('notice') >= 1 && entries('task') >= 1 && entries('screen') >= 5,
        `(e) the entry-point log lines: capture ${entries('capture')}, notice ${entries('notice')}, task ${entries('task')}, screen ${entries('screen')}`);
    console.log('Entry points device check passed');
} catch (error) {
    evidenced(error);
    console.error(error instanceof Stopped ? `STOPPED: ${error.message}` : `FAIL: ${error.message}`);
    process.exitCode = error instanceof Stopped ? 3 : 1;
} finally {
    await restore();
}
