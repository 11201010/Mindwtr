// Projects check for the isolated native Android development app.
//
//   node apps/android-native/scripts/check-projects-device.mjs <adb-serial> [apk] [--prune-old]
//
// Installs the debug APK with `install -r` (existing development data stays).
// The app cannot create projects, so the script stops the app and, through
// core's own store (Bun runs core's TypeScript) on a host copy of the app's
// database, prepares ONE fixture found by its stable titles (marker 424242424242):
// a sequential project in its own area with two sections and four tasks, an
// archived project with one task, and a project with 55 tasks. The first run
// INJECTS it; every later run REUSES it and only sets the sequential project's
// tasks back to Next (the run completes two of them), so the development data
// no longer grows. --prune-old also deletes, through core (tombstones), the
// projects and areas earlier versions of this check injected per run (titles
// Area/Seq/Arch/Many plus 12 digits) and their detached tasks (61-66 plus 12 digits); nothing else is touched. It then checks the Projects tab:
// (a) each project row shows core's task count and next action, and Archived
// ("Closed") starts closed; (b) the open project shows core's section markers,
// rows, and sequence cues in core's order; (c) Done from the project stores
// `done` once; (d) a row opens the editor and Cancel returns to the project;
// (e) rotation and (f) process death keep the open project; (g) a failed Done
// keeps its exact retry through rotation, Back, and a new screen, then stores
// once; (h) Back returns to the list, which shows core's new count; (i) the
// archived project shows its rows without Done and opens a read-only editor;
// (j) More loads the next window of the 55-task project. Core's expected lists
// come from core's own contract run on a fresh host copy of the database. It
// touches only the development package (it refuses any other APK), never
// launches over another app, leaves the app on its Inbox tab, and restores
// rotation and clears its debug properties on exit. Leave the device on its
// home screen before running. It needs host `sqlite3` and `bun`.
// Exit 0 = pass, 1 = fail, 2 = refused before touching the device, 3 = stopped.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { bootFailure, box, button, check, connect, doneButtons, evidenced, fail, field, hasText, Stopped, tab, tabSelected } from './device.mjs';

const cliArgs = process.argv.slice(2);
const prune = cliArgs.includes('--prune-old');
const [serial, apkArg] = cliArgs.filter((arg) => !arg.startsWith('--'));
if (!serial || cliArgs.some((arg) => arg.startsWith('--') && arg !== '--prune-old')) {
    console.error('usage: node check-projects-device.mjs <adb-serial> [apk] [--prune-old]');
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
const STAGED = '/data/local/tmp/mindwtr-native-dev-projects.db';
// `language` is cleared so the app shows core's English on the (English) test phone.
const PROPS = ['fail_commit', 'delay_before_ms', 'delay_after_ms', 'language'];
const DB = 'mindwtr-native-dev.db';
const work = resolve(app, 'android/build/projects-check');
const coreSrc = resolve(app, '../../packages/core/src');
// The fixture's stable marker: every run finds the same projects and tasks, so it injects them only once.
// Digits only in task titles (the editor step picks a task by its digits-only title).
const run = '424242424242';
const names = { area: `Area${run}`, sequential: `Seq${run}`, archived: `Arch${run}`, many: `Many${run}` };

const device = connect({ serial, pkg: PKG, uiFile: UI_FILE, adb: adbBin });
const { adbRaw, sh, home, front, requireAppFront, pid, screen, waitFor, tap, reveal, toTop } = device;
const setProp = (name, value) => sh(`setprop debug.mindwtr.native.${name} '${value}'`);
const runAs = (command) => sh(`run-as ${PKG} ${command}`);

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
const stopApp = async () => {
    sh(`am force-stop ${PKG}`);
    await waitFor('the app process to end', () => pid() === '', 10_000);
};

// ---- UI (core's English labels: nav.projects, projects.closed, common.back, common.done, common.more, taskEdit.editTask) ----
const inEditor = (nodes) => hasText(nodes, 'Edit Task');
const inbox = () => waitFor('the Inbox', (nodes) => tabSelected(nodes, 'Inbox') && !inEditor(nodes) && hasText(nodes, 'Inbox'), 60_000);
const textNode = (nodes, text) => nodes.find((node) => node.text === text && node.class !== 'android.widget.EditText');
/** The open project: the Projects tab, core's project title as the heading, and Back. */
const inProject = (nodes, title) => tabSelected(nodes, 'Projects') && !inEditor(nodes) && hasText(nodes, title) && Boolean(button(nodes, 'Back'));
const openProject = (title, description = `the project ${title}`) => waitFor(description, (nodes) => inProject(nodes, title), 60_000);
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
/** Scrolls the Projects list to [title] and opens it; a tap can land while the list still moves, so tap again. */
const openRow = async (title) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        // The last tap opened it after the wait ran out: do not tap the detail screen.
        if (attempt > 0 && inProject(await screen(), title)) return screen();
        const nodes = await reveal(title, 80);
        await tap(textNode(nodes, title) ?? fail(`${title} is not on the Projects list`));
        try { return await waitFor(`the project ${title}`, (current) => inProject(current, title), 8_000); } catch { /* tap again */ }
    }
    return openProject(title);
};
/** The content description of the task count on the Projects row titled [title] ("<n> tasks"). */
const rowCount = (nodes, title) => {
    const [, top, , bottom] = box(textNode(nodes, title) ?? fail(`${title} is not on screen`));
    return nodes.find((node) => /^\d+ tasks$/.test(node['content-desc'] ?? '') && box(node)[1] < bottom + 60 && box(node)[3] > top - 20)?.['content-desc'];
};
/** The texts of [expected] as the screen shows them, top to bottom. */
const shownOrder = (nodes, expected) => nodes.filter((node) => expected.includes(node.text) && node.class !== 'android.widget.EditText')
    .sort((a, b) => box(a)[1] - box(b)[1]).map((node) => node.text);

// ---- database: a host copy of .db, -wal and -shm; core runs on it in Bun ----
const pullDatabase = (name) => {
    const dir = resolve(work, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const present = runAs('ls files').split(/\s+/);
    for (const suffix of ['', '-wal', '-shm']) {
        if (present.includes(`${DB}${suffix}`)) device.pull(`files/${DB}${suffix}`, resolve(dir, `${DB}${suffix}`));
    }
    return resolve(dir, DB);
};
const sqlite = (db, sql) => JSON.parse(execFileSync('sqlite3', ['-json', db, sql], { encoding: 'utf8' }) || '[]');
/**
 * Runs core's contract on a database copy: `prepare` finds the fixture by its titles (or injects it once) through
 * core's store, resets it, and prints the ids; `projects` and `detail` print core's getProjects row and
 * getProjectDetail items as the app shows them.
 */
const core = (db, mode, extra = {}) => JSON.parse(execFileSync('bun', ['-e', `
    import { Database } from 'bun:sqlite';
    import { SqliteAdapter, createNativeHostContract, flushPendingSave, setStorageAdapter, useTaskStore } from '${coreSrc}/index.ts';
    const db = new Database(process.env.CHECK_DB);
    const client = {
        run: async (sql, params = []) => { db.query(sql).run(...params); },
        all: async (sql, params = []) => db.query(sql).all(...params),
        get: async (sql, params = []) => db.query(sql).get(...params) ?? undefined,
        exec: async (sql) => { db.exec(sql); },
    };
    setStorageAdapter(new SqliteAdapter(client));
    const host = createNativeHostContract();
    const ready = await host.activate({ writeSafetyReady: true });
    if (!ready.ok) throw new Error(ready.error.message);
    const names = JSON.parse(process.env.CHECK_NAMES);
    const store = () => useTaskStore.getState();
    const value = (result) => { if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message); return result.value; };
    let out;
    if (process.env.CHECK_MODE === 'prepare') {
        const live = (items) => items.filter((item) => !item.deletedAt);
        let pruned = 0;
        if (process.env.CHECK_PRUNE === '1') {
            // Only what earlier versions of this check injected per run: its four title shapes with a 12-digit run id.
            // [0-9], not \\d: this code sits in a template literal, which drops the backslash.
            for (const project of live(store()._allProjects).filter((item) => /^(Seq|Arch|Many)[0-9]{12}$/.test(item.title) && !item.title.endsWith(names.run))) {
                const result = await store().deleteProject(project.id);
                if (!result.success) throw new Error('prune failed: ' + result.error);
                await flushPendingSave();
                pruned += 1;
            }
            for (const area of live(store()._allAreas).filter((item) => /^Area[0-9]{12}$/.test(item.name) && !item.name.endsWith(names.run))) {
                const result = await store().deleteArea(area.id);
                if (!result.success) throw new Error('prune failed: ' + result.error);
                await flushPendingSave();
                pruned += 1;
            }
            // Deleting a project detaches its tasks, so the old runs' tasks stay as loose next actions:
            // tombstone them by their title shape (61-66, a 12-digit run id, an optional index).
            const oldTasks = live(store()._allTasks).filter((item) => {
                const match = /^6[1-6]([0-9]{12})([0-9]{2})?$/.exec(item.title);
                return match !== null && match[1] !== names.run;
            }).map((item) => item.id);
            if (oldTasks.length > 0) {
                const result = await store().batchDeleteTasks(oldTasks);
                if (!result.success) throw new Error('prune failed: ' + result.error);
                await flushPendingSave();
                pruned += oldTasks.length;
            }
        }
        const find = (title) => live(store()._allProjects).filter((project) => project.title === title);
        const found = [names.sequential, names.archived, names.many].map(find);
        if (found.some((list) => list.length > 1)) throw new Error('the fixture project titles are not unique');
        if (found.every((list) => list.length === 1)) {
            const [sequential, archived, many] = found.map(([project]) => project);
            // Reset: the run completes two of the sequential project's tasks; put all four back to Next.
            let reset = 0;
            for (const task of live(store()._allTasks).filter((item) => item.projectId === sequential.id && item.status !== 'next')) {
                const result = await store().updateTask(task.id, { status: 'next' });
                if (!result.success) throw new Error('reset failed: ' + result.error);
                await flushPendingSave(); // one save at a time: core's incremental saves share one SQLite connection
                reset += 1;
            }
            await flushPendingSave();
            if (store().persistenceFailure) throw new Error('save failed: ' + store().persistenceFailure.message);
            out = { reused: true, reset, pruned, sequential: sequential.id, archived: archived.id, many: many.id };
        } else if (found.some((list) => list.length === 1)) {
            throw new Error('only part of the fixture is in the database; restore or remove it by hand');
        } else {
            const add = async (title, props) => {
                const result = await store().addTask(title, { status: 'next', ...props });
                if (!result.success || !result.id) throw new Error('addTask failed: ' + result.error);
                return result.id;
            };
            const area = await store().addArea(names.area);
            const sequential = await store().addProject(names.sequential, '#3b82f6', { areaId: area.id, isSequential: true });
            const first = await store().addSection(sequential.id, 'S1' + names.run);
            const second = await store().addSection(sequential.id, 'S2' + names.run);
            await add('61' + names.run, { projectId: sequential.id, sectionId: first.id });
            await add('62' + names.run, { projectId: sequential.id, sectionId: first.id });
            await add('63' + names.run, { projectId: sequential.id, sectionId: second.id });
            await add('64' + names.run, { projectId: sequential.id });
            const archived = await store().addProject(names.archived, '#64748b');
            await add('65' + names.run, { projectId: archived.id });
            const archivedResult = await store().updateProject(archived.id, { status: 'archived' });
            if (!archivedResult.success) throw new Error('archive failed: ' + archivedResult.error);
            const many = await store().addProject(names.many, '#10b981');
            for (let index = 0; index < 55; index += 1) await add('66' + names.run + String(index).padStart(2, '0'), { projectId: many.id });
            await flushPendingSave();
            if (store().persistenceFailure) throw new Error('save failed: ' + store().persistenceFailure.message);
            out = { reused: false, reset: 0, pruned, sequential: sequential.id, archived: archived.id, many: many.id };
        }
    } else if (process.env.CHECK_MODE === 'projects') {
        const view = value(host.getProjects());
        out = [...view.active, ...view.deferred, ...view.archived].flatMap((group) => group.projects).find((row) => row.id === process.env.CHECK_PROJECT);
    } else {
        const detail = value(host.getProjectDetail({ projectId: process.env.CHECK_PROJECT, offset: 0, limit: 100 }));
        out = {
            readOnly: detail.readOnly,
            total: detail.total,
            items: detail.items.map((item) => (item.type === 'section'
                ? { text: item.title + ' · ' + item.count }
                : { text: item.row.title, cue: item.sequenceCue })),
        };
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    console.log(JSON.stringify(out));
    process.exit(0);
`], {
    encoding: 'utf8', maxBuffer: 64 << 20,
    env: { ...process.env, CHECK_DB: db, CHECK_MODE: mode, CHECK_NAMES: JSON.stringify({ ...names, run }), CHECK_PRUNE: prune ? '1' : '', ...extra },
}).trim().split('\n').pop());
const CUES = { available: 'Available next action', later: 'Later in sequence' }; // core's en projects.availableNextAction / laterInSequence
let ids = {};
const coreDetail = (label, project) => core(pullDatabase(label), 'detail', { CHECK_PROJECT: project });
const coreRow = (label, project) => core(pullDatabase(label), 'projects', { CHECK_PROJECT: project });
const storedTask = (title) => sqlite(pullDatabase('task'), `SELECT status, rev FROM tasks WHERE title = '${title}' AND deletedAt IS NULL`);
/** The open project shows core's items in core's order, and each cue under its row. */
const expectCoreOrder = (nodes, detail, label) => {
    const expected = detail.items.map((item) => item.text);
    const shown = shownOrder(nodes, expected);
    check(isDeepStrictEqual(shown, expected), `${label} shows core's ${expected.length} items in core's order${isDeepStrictEqual(shown, expected) ? '' : `: ${JSON.stringify(shown)} vs core ${JSON.stringify(expected)}`}`);
    for (const [cue, text] of Object.entries(CUES)) {
        const want = detail.items.filter((item) => item.cue === cue).length;
        const got = nodes.filter((node) => node.text === text).length;
        check(got === want, `${label} shows core's "${cue}" cue ${want} time(s) (screen ${got})`);
    }
};

const originalAccelerometer = sh('settings get system accelerometer_rotation');
const originalRotation = sh('settings get system user_rotation');
const restore = async () => {
    for (const name of PROPS) { try { setProp(name, ''); } catch { /* device gone */ } }
    // Leave the app on its Inbox tab with no project open: the other checks start there.
    try {
        if (front().includes(`${PKG}/`)) {
            let nodes = await screen();
            if (button(nodes, 'Back') && tabSelected(nodes, 'Projects')) { sh('input keyevent KEYCODE_BACK'); await sleep(1000); nodes = await screen(); }
            if (tab(nodes, 'Inbox') && !tabSelected(nodes, 'Inbox')) await tap(tab(nodes, 'Inbox'));
        }
    } catch { /* the app is gone */ }
    for (const [name, value] of [['user_rotation', originalRotation], ['accelerometer_rotation', originalAccelerometer]]) {
        try { sh(value === 'null' ? `settings delete system ${name}` : `settings put system ${name} ${value}`); } catch { /* device gone */ }
    }
    try { sh(`rm -f ${UI_FILE} ${STAGED}`); } catch { /* device gone */ }
};

try {
    mkdirSync(work, { recursive: true });
    console.log(`device: ${sh('getprop ro.product.model')} / Android ${sh('getprop ro.build.version.release')} (API ${sh('getprop ro.build.version.sdk')})${sh('getprop ro.boot.qemu.avd_name') ? ` / AVD ${sh('getprop ro.boot.qemu.avd_name')}` : ''}`);
    console.log(`apk: ${apk}\napk sha256: ${createHash('sha256').update(readFileSync(apk)).digest('hex')}`);
    for (const name of PROPS) setProp(name, '');

    // Setup: upgrade-install, boot once (so the database has this build's schema), stop, prepare the fixture.
    const beforeInstall = front();
    if (!beforeInstall.includes(`${PKG}/`) && !beforeInstall.includes(`${home}/`)) {
        throw new Stopped(`another app is in front: ${beforeInstall.trim()}`);
    }
    execFileSync(adbBin, ['-s', serial, 'install', '-r', apk], { stdio: 'inherit' });
    launch();
    await showTab('Inbox');
    setRotation(0);
    await inbox();
    await stopApp();
    const db = pullDatabase('inject');
    ids = core(db, 'prepare');
    // Only the main file goes back, so core's checkpoint must have moved every frame into it.
    check(!existsSync(`${db}-wal`) || statSync(`${db}-wal`).size === 0, 'the injected rows are all in the main database file');
    adbRaw('push', db, STAGED);
    try { runAs(`cp ${STAGED} files/${DB}`); } finally { sh(`rm -f ${STAGED}`); }
    runAs(`rm -f files/${DB}-wal files/${DB}-shm`);
    console.log(ids.reused
        ? `REUSED: the fixture ${names.sequential}, ${names.archived}, ${names.many}; ${ids.reset} task(s) set back to Next through core's store`
        : `INJECTED (once): through core's store, area ${names.area}; sequential project ${names.sequential} (sections S1${run}, S2${run}; tasks 61-64${run}); archived project ${names.archived} (task 65${run}); project ${names.many} (55 tasks 66${run}00-54)`);
    if (prune) console.log(`PRUNED: ${ids.pruned} project(s), area(s) and task(s) earlier runs injected, deleted through core's store`);

    launch();
    let nodes = await inbox();
    let processId = pid();
    check(boots(processId) === 1 && !bootFailure(nodes), 'boot validation passed on the injected database');

    // (a) The list: core's count and next action on the row; the area header above it; Archived starts closed.
    await showTab('Projects');
    let row = coreRow('a', ids.sequential);
    nodes = await reveal(names.sequential, 80);
    // Found at the top edge, the row's area header can sit just above the screen: one drag toward the top shows both.
    if (!textNode(nodes, names.area)) await device.swipe(nodes, 'up');
    nodes = await waitFor(`${names.sequential} with its area`, (current) => textNode(current, names.sequential) && textNode(current, names.area));
    check(box(textNode(nodes, names.area))[1] < box(textNode(nodes, names.sequential))[1], `(a) ${names.sequential} is under core's area ${names.area}`);
    check(rowCount(nodes, names.sequential) === `${row.activeTaskCount} tasks`, `(a) the row shows core's count: ${row.activeTaskCount} tasks`);
    const startCount = row.activeTaskCount;
    check(Boolean(row.nextActionTitle) && hasText(nodes, `↳ ${row.nextActionTitle}`), `(a) the row shows core's next action ${row.nextActionTitle}`);
    // Archived is core's last group, so a closed "Closed" is the list's last row: nothing is listed below it.
    nodes = await reveal('Closed', 80);
    const closedBottom = box(textNode(nodes, 'Closed') ?? fail('no "Closed" group on the list'))[3];
    // Only the list's own rows count: the tab bar below the list has labels too (a list that fits is not scrollable).
    const listBottom = box(tab(nodes, 'Inbox') ?? fail('no tab bar on the Projects tab'))[1];
    const below = nodes.filter((node) => node.package === PKG && node.text && box(node)[1] >= closedBottom && box(node)[3] <= listBottom);
    check(below.length === 0, `(a) Archived ("Closed") starts closed: nothing is listed below it${below.length ? ` (${below.map((node) => node.text).join(', ')})` : ''}`);

    // (b) The open project: core's section markers, rows, and cues, in core's order.
    nodes = await openRow(names.sequential);
    let detail = coreDetail('b', ids.sequential);
    check(!detail.readOnly && detail.total === detail.items.length && detail.items.length <= 10, `(b) core lists ${detail.items.length} items`);
    expectCoreOrder(nodes, detail, '(b)');
    const firstTask = detail.items.find((item) => item.cue === 'available')?.text ?? fail('core marks no available task');

    // (c) Done from the project: the row leaves, done is stored once, and the project matches core again.
    const beforeDone = storedTask(firstTask)[0];
    const savedBefore = completes(processId, 'saved');
    nodes = await tapUntil(`Done ${firstTask}`, `${firstTask} to leave the project`, (current) => inProject(current, names.sequential) && !textNode(current, firstTask));
    const afterDone = storedTask(firstTask);
    check(afterDone.length === 1 && afterDone[0].status === 'done' && afterDone[0].rev === beforeDone.rev + 1, `(c) ${firstTask} stored done in one write`);
    check(completes(processId, 'saved') === savedBefore + 1, '(c) task-command log shows one operation=complete saved');
    detail = coreDetail('c', ids.sequential);
    expectCoreOrder(await screen(), detail, '(c) after Done,');

    // (d) A row opens the editor; Cancel returns to the open project.
    const editTask = detail.items.find((item) => item.cue !== undefined && item.text !== firstTask && /^\d+$/.test(item.text))?.text
        ?? fail('core lists no task to edit');
    nodes = await tapUntil(editTask, `the editor for ${editTask}`, (current) => inEditor(current) && field(current)?.text === editTask);
    await tap(button(nodes, 'Cancel'));
    await openProject(names.sequential, 'the project after Cancel');
    check(true, '(d) the editor opened from the project, and Cancel returned to it');

    // (e) Rotation keeps the open project, on the same process and host.
    await rotate(1);
    nodes = await openProject(names.sequential, 'the project in landscape');
    check(hasText(nodes, editTask) || hasText(await toTop(), editTask), '(e) landscape: the project is still open with its rows');
    await rotate(0);
    nodes = await openProject(names.sequential, 'the project in portrait');
    check(pid() === processId && boots(processId) === 1, '(e) portrait: same process, one host boot');

    // (f) Home, process death, relaunch: the open project comes back with core's rows.
    await goHome();
    await sleep(1500);
    sh(`run-as ${PKG} kill -9 ${processId}`);
    await waitFor('process death', () => pid() !== processId, 10_000);
    launch();
    nodes = await waitFor('the restored project', (current) => inProject(current, names.sequential) && textNode(current, editTask), 60_000);
    processId = pid();
    check(boots(processId) === 1, '(f) the open project restored after process death, one host boot');
    expectCoreOrder(nodes, detail, '(f)');

    // (g) A failed Done keeps only its exact retry across rotation, Back, and a new screen.
    const beforeFailure = storedTask(editTask)[0];
    setProp('fail_commit', '1');
    await tapUntil(`Done ${editTask}`, 'the failed Done', hasError);
    const failedProject = async (description, label) => {
        const current = await waitFor(description, (screenNodes) => inProject(screenNodes, names.sequential) && hasError(screenNodes));
        check(button(current, `Done ${editTask}`)?.enabled === 'true', `(g${label}) exact retry allowed`);
        const others = doneButtons(current).filter((node) => node['content-desc'] !== `Done ${editTask}`)
            .map((node) => button(current, node['content-desc'])).filter(Boolean);
        check(others.every((node) => node.enabled === 'false'), `(g${label}) ${others.length} other Done buttons blocked`);
        check(button(current, 'Back')?.enabled === 'false' && !button(current, 'Try again'), `(g${label}) Back and Try again blocked`);
        check(tab(current, 'Inbox')?.enabled === 'true', `(g${label}) tabs still work`);
    };
    await failedProject('the failure', '');
    check(storedTask(editTask)[0].rev === beforeFailure.rev, '(g) failed commit stored nothing');
    await rotate(1);
    await failedProject('the failure after rotation', ' landscape');
    await rotate(0);
    await failedProject('the failure after rotating back', ' portrait');
    // Back is left to the system while the retry is owed, so it leaves the app.
    for (let attempt = 0; attempt < 2 && front().includes(`${PKG}/`); attempt += 1) {
        sh('input keyevent KEYCODE_BACK');
        await sleep(1500);
    }
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    launch();
    await failedProject('the failure after Back and reopen', ' after Back and reopen');
    // Android 12+ keeps a root Activity on Back, so also finish it: the new screen gets a new
    // ViewModel and must restore the Projects tab, the open project, and the retry from the process.
    const newScreensBefore = newScreens(processId);
    requireAppFront();
    sh(`am start -W -f 0x10008000 -n ${ACTIVITY}`); // NEW_TASK | CLEAR_TASK
    await waitFor('a new screen on the running host', () => newScreens(processId) > newScreensBefore, 15_000);
    await failedProject('the failure on a new screen', ' on a new screen');
    check(pid() === processId && boots(processId) === 1 && storedTask(editTask)[0].rev === beforeFailure.rev,
        '(g) same process and host, still nothing stored before the retry');
    // Reads wait while the retry is owed, so no read failure can have replaced the Done retry.
    check(!logs(processId).includes('lock=storage'), '(g) no read failed while the retry was owed (log has no lock=storage)');
    setProp('fail_commit', '');
    await tapUntil(`Done ${editTask}`, 'the retry', (current) => !hasError(current) && !textNode(current, editTask));
    const retried = storedTask(editTask)[0];
    check(retried.status === 'done' && retried.rev === beforeFailure.rev + 1, '(g) retry stored done once');
    check(completes(processId, 'failed') >= 1 && completes(processId, 'saved') >= 1, '(g) task-command log shows the failed and the saved complete');

    // (h) Back returns to the list, which shows core's new count.
    requireAppFront();
    sh('input keyevent KEYCODE_BACK');
    await waitFor('the Projects list', (current) => tabSelected(current, 'Projects') && !button(current, 'Back'));
    row = coreRow('h', ids.sequential);
    nodes = await reveal(names.sequential, 80);
    check(rowCount(nodes, names.sequential) === `${row.activeTaskCount} tasks` && row.activeTaskCount === startCount - 2,
        `(h) Back showed the list; ${names.sequential} shows core's count ${startCount} - 2 = ${row.activeTaskCount}`);

    // (i) The archived project: Closed opens on a tap; rows show without Done; the editor is read-only.
    nodes = await reveal('Closed', 80);
    await tap(button(nodes, 'Closed') ?? textNode(nodes, 'Closed'));
    nodes = await openRow(names.archived);
    detail = coreDetail('i', ids.archived);
    check(detail.readOnly, '(i) core marks the archived project read-only');
    expectCoreOrder(nodes, detail, '(i)');
    check(doneButtons(nodes).length === 0, '(i) no row offers Done');
    nodes = await tapUntil(`65${run}`, 'the read-only editor', (current) => inEditor(current) && button(current, 'Close'));
    check(hasText(nodes, 'Archived project. Reactivate it to edit this task.') && !button(nodes, 'Save'), '(i) the editor is read-only');
    await tap(button(nodes, 'Close'));
    await openProject(names.archived, 'the archived project after Close');
    sh('input keyevent KEYCODE_BACK');
    await waitFor('the Projects list', (current) => tabSelected(current, 'Projects') && !button(current, 'Back'));

    // (j) More: the 55-task project opens at core's first window, and More loads the rest.
    nodes = await openRow(names.many);
    detail = coreDetail('j', ids.many);
    const last = detail.items.at(-1).text;
    check(detail.total > 50 && !hasText(nodes, last), `(j) core lists ${detail.total} items; the last is not loaded yet`);
    nodes = await reveal(last, 80);
    check(hasText(nodes, last) && !button(nodes, 'More'), `(j) More loaded the rest: ${last} shows and More is gone`);
    sh('input keyevent KEYCODE_BACK');
    await waitFor('the Projects list', (current) => tabSelected(current, 'Projects') && !button(current, 'Back'));

    // Relaunch: boot validation passes on the final data.
    requireAppFront();
    await stopApp();
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    launch();
    await showTab('Inbox');
    nodes = await inbox();
    processId = pid();
    check(boots(processId) === 1 && !bootFailure(nodes), 'relaunch: boot validation passed');
    console.log('Projects device check passed');
} catch (error) {
    evidenced(error);
    console.error(error instanceof Stopped ? `STOPPED: ${error.message}` : `FAIL: ${error.message}`);
    process.exitCode = error instanceof Stopped ? 3 : 1;
} finally {
    await restore();
}
