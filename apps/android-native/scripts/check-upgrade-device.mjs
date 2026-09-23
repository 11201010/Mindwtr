// Upgrade check: a real RN v1.3.2 install, replaced in place by the native
// upgradetest build, then by a newer RN recovery build.
//
//   node apps/android-native/scripts/build-upgrade-harness.mjs
//   node apps/android-native/scripts/check-upgrade-device.mjs <adb-serial> [--only=1,4,2,3,3b,5] [--keep]
//
// Scenarios, each from a fresh RN v1.3.2 install:
//   1   happy upgrade: the native app shows the RN data, captures once, keeps
//       every pre-upgrade row and every non-database file, and leaves a
//       .prewrite checkpoint that holds the pre-upgrade rows;
//   4   recovery (continues 1): the RN 154 build opens the database and keeps
//       the native edit. While the recovery source is v1.3.2 a failure is
//       reported as BLOCKED (RN startup snapshot bug) and does not fail the run;
//   2   RN left unsaved work (json-ahead marker): the native app changes no file;
//   3   damaged database, empty WAL: the native app changes no file;
//   3b  damaged database with WAL frames: the native app changes no file;
//   5   database missing while other RN state exists: the native app creates nothing.
//
// RN writes every seed row through its own code: queued captures in
// files/pending-captures, which RN imports at launch (tasks, a +Project task,
// a widget check-off), and one switch in RN Settings. Faults are injected on
// the host and printed as INJECTED. The script touches only
// tech.dongdongbh.mindwtr.upgradetest: it refuses any other APK, uninstalls
// only that package (before each scenario and at the end; --keep leaves it
// installed), installs with -g so no permission dialog can appear, and sends
// input only while that package is in front. Exit 0 = pass, 1 = fail,
// 2 = refused, 3 = stopped.
import { execFileSync } from 'node:child_process';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { button, check, connect, fail, field, hasText, Stopped } from './device.mjs';

const SCENARIOS = ['1', '4', '2', '3', '3b', '5'];
const USAGE = `usage: node check-upgrade-device.mjs <adb-serial> [--only=${SCENARIOS.join(',')}] [--keep]`;
const args = process.argv.slice(2);
const serials = args.filter((arg) => !arg.startsWith('--'));
const onlyArg = args.find((arg) => arg.startsWith('--only='));
const only = onlyArg?.slice('--only='.length).split(',');
if (serials.length !== 1 || args.some((arg) => arg.startsWith('--') && arg !== '--keep' && arg !== onlyArg)
    || (only && only.some((scenario) => !SCENARIOS.includes(scenario)))) {
    console.error(USAGE);
    process.exit(2);
}
const [serial] = serials;
const want = (scenario) => !only || only.includes(scenario) || (scenario === '1' && only.includes('4'));
const PKG = 'tech.dongdongbh.mindwtr.upgradetest';
const V132 = 'ee82a9e3e9a1d4e0c406f5ffff80e768a1f1f812';
const app = resolve(import.meta.dirname, '..');
const harness = process.env.MINDWTR_HARNESS_DIR ?? '/home/dd/.mindwtr-harness';
const aapt2 = process.env.AAPT2 ?? '/home/dd/Android/Sdk/build-tools/36.1.0/aapt2';
let built;
try {
    built = JSON.parse(readFileSync(resolve(harness, 'apks/manifest.json'), 'utf8'));
} catch {
    console.error(`REFUSED: no ${harness}/apks/manifest.json; run build-upgrade-harness.mjs first`);
    process.exit(2);
}
if (built.rnSource !== V132 || !built.recoverySource) {
    console.error('REFUSED: apks/manifest.json predates the pinned sources; rerun build-upgrade-harness.mjs');
    process.exit(2);
}
const APKS = { rn152: built.rn152.path, native153: built.native153.path, rn154: built.rn154.path };
// install -r would upgrade whatever package the APK names: allow only the throwaway one.
for (const apk of Object.values(APKS)) {
    const apkPackage = execFileSync(aapt2, ['dump', 'packagename', apk], { encoding: 'utf8' }).trim();
    if (apkPackage !== PKG) {
        console.error(`REFUSED: ${apk} is package "${apkPackage}", not ${PKG}`);
        process.exit(2);
    }
}

// Expo prebuild derives the Java namespace from the harness package, so the
// harness RN activity is not the store app's `tech.dongdongbh.mindwtr.MainActivity`.
const RN_ACTIVITY = `${PKG}/${PKG}.MainActivity`;
const NATIVE_ACTIVITY = `${PKG}/tech.dongdongbh.mindwtr.pilot.MainActivity`;
const TAG = 'MindwtrNativeDev';
const GUARD = 'releaseCheck=v1.3.3/native-android-legacy-json-ahead-guard';
const MARKER = 'mindwtr-data:json-ahead-of-sqlite';
const AUTO_CLEAN_LABEL = 'Clean up quick add text'; // RN v1.3.2 English label of settings.quickAddAutoClean
const TMP = '/data/local/tmp/mindwtr-upgradetest';
const DB = 'files/SQLite/mindwtr.db';
const TABLES = ['tasks', 'projects', 'areas', 'people', 'sections', 'settings', 'saved_filters', 'schema_migrations', 'calendar_sync'];
const TASK_SQL = 'SELECT id, title, status, projectId, deletedAt FROM tasks ORDER BY id';
const work = resolve(app, 'android/build/upgrade-check');
// Digits only for typed titles: some keyboards hold letters in a composition strip.
const run = `${String(Date.now()).slice(-6)}${String(randomInt(1_000_000)).padStart(6, '0')}`;
const titlesFor = (n) => ({
    inbox: [1, 2, 3, 4].map((i) => `${n}${i}${run}`),
    project: `${n}5${run}`, done: `${n}6${run}`, queued: `${n}7${run}`, native: `${n}8${run}`,
    projectName: `Upgrade${n}${run}`,
});

const device = connect({ serial, pkg: PKG, uiFile: `${TMP}-ui.xml` });
const { adbRaw, sh, home, front, requireAppFront, pid, screen, waitFor, tap, type, pull } = device;
const runAs = (command) => sh(`run-as ${PKG} ${command}`);

// ---- device ----
const installed = () => sh(`pm list packages ${PKG}`).split('\n').some((line) => line.trim() === `package:${PKG}`);
const install = (apk, replace) => {
    console.log(`install ${replace ? '-r ' : ''}-g ${basename(apk)}`);
    // -g grants every runtime permission, so the app never shows a permission dialog.
    adbRaw('install', ...(replace ? ['-r'] : []), '-g', apk);
};
const fresh = () => {
    if (installed()) sh(`pm uninstall ${PKG}`);
    install(APKS.rn152, false);
};
const until = async (description, predicate, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { if (await predicate()) return; } catch { /* not ready yet */ }
        await sleep(1000);
    }
    fail(`timed out waiting for ${description}`);
};
const stopApp = async () => {
    sh(`am force-stop ${PKG}`);
    await until('the app process to end', () => pid() === '', 10_000);
};
const openLink = (url) => {
    const current = front();
    if (!current.includes(`${PKG}/`) && !current.includes(`${home}/`)) {
        throw new Stopped(`another app is in front; not opening a link over it: ${current.trim()}`);
    }
    sh(`am start -W -a android.intent.action.VIEW -d '${url}' ${PKG}`);
};
const pushPrivate = (local, remote) => {
    const staged = `${TMP}-${basename(local)}`;
    adbRaw('push', local, staged);
    try { runAs(`cp ${staged} ${remote}`); } finally { sh(`rm -f ${staged}`); }
};
// RN's own capture queue: one JSON file per item, imported through RN's store at launch.
const queue = (items) => {
    runAs('mkdir -p files/pending-captures');
    for (const item of items) {
        const local = resolve(work, `${item.id}.json`);
        writeFileSync(local, JSON.stringify(item));
        pushPrivate(local, `files/pending-captures/${item.id}.json`);
    }
};
const drained = (items, description) => until(`RN to import ${description}`, () => {
    const present = runAs('ls files/pending-captures');
    return items.every((item) => !present.includes(item.id));
}, 90_000);
// path -> sha256 of every file the app keeps outside cache/ and code_cache/. A find
// error (an unreadable folder) exits non-zero, and adb then throws: never a silent gap.
const snapshot = () => new Map(runAs(
    `sh -c 'set --; for dir in files shared_prefs databases no_backup; do if [ -e "$dir" ]; then set -- "$@" "$dir"; fi; done; find "$@" -type f -exec sha256sum {} +'`,
).split('\n').filter(Boolean).map((line) => {
    const [hash, path] = line.split(/\s+/, 2);
    return [path, hash];
}));
// androidx profileinstaller rewrites this marker after every package update; it holds no user data.
const PLATFORM_STATE = new Set(['files/profileInstalled']);
const differences = (before, after, { changedOk = () => false, newOk = () => false } = {}) => [
    ...[...before].filter(([path, hash]) => !PLATFORM_STATE.has(path) && !changedOk(path) && after.get(path) !== hash)
        .map(([path]) => `${after.has(path) ? 'changed' : 'removed'} ${path}`),
    ...[...after.keys()].filter((path) => !before.has(path) && !PLATFORM_STATE.has(path) && !newOk(path)).map((path) => `new ${path}`),
];
const isDatabase = (path) => /^files\/SQLite\/mindwtr\.db(-wal|-shm)?$/.test(path);

// ---- database (host sqlite3 on pulled copies) ----
const sql = (db, statement, json = true) => execFileSync('sqlite3', [...(json ? ['-json'] : []), db, statement], { encoding: 'utf8' }).trim();
const rows = (db, statement) => { const text = sql(db, statement); return text ? JSON.parse(text) : []; };
const pullDatabase = (name) => {
    const dir = resolve(work, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    // .db, -wal and -shm together: committed rows can live only in -wal.
    const present = runAs('ls files/SQLite').split(/\s+/);
    for (const file of ['mindwtr.db', 'mindwtr.db-wal', 'mindwtr.db-shm']) {
        if (present.includes(file)) pull(`files/SQLite/${file}`, resolve(dir, file));
    }
    return resolve(dir, 'mindwtr.db');
};
const counts = (db) => Object.fromEntries(TABLES.map((table) => [table, Number(sql(db, `SELECT COUNT(*) FROM ${table}`, false))]));
const settingsOf = (db) => rows(db, "SELECT json_extract(data, '$.quickAddAutoClean') AS autoClean FROM settings WHERE id = 1")[0] ?? {};
// Every column of every core table as an SQL literal (quote() keeps the type and the exact bytes).
const tableRows = (db, table, names) => rows(db, `SELECT ${names.map((name) => `quote("${name}") AS "${name}"`).join(', ')} FROM "${table}"`);
const allRows = (db) => Object.fromEntries(TABLES.map((table) => {
    const columns = rows(db, `PRAGMA table_info("${table}")`);
    const names = columns.map((column) => column.name);
    const keys = columns.filter((column) => column.pk > 0).map((column) => column.name);
    return [table, { names, keys: keys.length ? keys : names, rows: tableRows(db, table, names) }];
}));
const rowCount = (snapshotRows) => Object.values(snapshotRows).reduce((total, table) => total + table.rows.length, 0);
// Names only (never values) of the top-level JSON keys that differ, for a changed JSON column.
const changedKeys = (before, after) => {
    try {
        const parse = (literal) => JSON.parse(literal.slice(1, -1).replaceAll("''", "'"));
        const [a, b] = [parse(before), parse(after)];
        return ` (keys ${[...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !isDeepStrictEqual(a[key], b[key])).join(', ')})`;
    } catch {
        return '';
    }
};
// Pre-upgrade rows that are gone, or differ in any pre-upgrade column. Only columns a later
// schema added may differ, and they are not read. New rows are allowed.
const rowChanges = (pre, db) => Object.entries(pre).flatMap(([table, { names, keys, rows: preRows }]) => {
    const keyOf = (row) => keys.map((name) => row[name]).join('|');
    const now = new Map(tableRows(db, table, names).map((row) => [keyOf(row), row]));
    return preRows.flatMap((row) => {
        const current = now.get(keyOf(row));
        if (!current) return [`${table} ${keyOf(row)} missing`];
        return names.filter((name) => current[name] !== row[name])
            .map((name) => `${table} ${keyOf(row)} ${name}${changedKeys(row[name], current[name])}`);
    });
});
const readState = (db) => ({ counts: counts(db), rows: allRows(db), tasks: rows(db, TASK_SQL) });
const shortList = (items) => (items.length ? `: ${items.slice(0, 10).join('; ')}${items.length > 10 ? ` (+${items.length - 10} more)` : ''}` : '');

// ---- UI ----
const header = (nodes) => Number(nodes.map((node) => /^Inbox · (\d+)$/.exec(node.text ?? '')?.[1]).find(Boolean) ?? NaN);
const unavailable = (nodes) => nodes.find((node) => node.text?.startsWith('Storage unavailable'))?.text;
const nativeScreen = () => waitFor('the native screen', (nodes) => Boolean(field(nodes)), 60_000);
const autoCleanSwitch = (nodes) => nodes.find((node) => node.class === 'android.widget.Switch' && node['content-desc'] === AUTO_CLEAN_LABEL);
const nativeGuardLog = () => device.logs(pid(), TAG).split('\n').find((line) => line.includes(GUARD)) ?? '';
// Installs the native build over the prepared RN state and checks it fails closed.
const expectBlocked = async (label, reason, message) => {
    install(APKS.native153, true);
    device.launch(NATIVE_ACTIVITY);
    const nodes = await nativeScreen();
    check((unavailable(nodes) ?? '').startsWith(`Storage unavailable: ${message}`), `(${label}) native app shows: ${unavailable(nodes)}`);
    check(nativeGuardLog().includes(`${GUARD} outcome=blocked reason=${reason}`), `(${label}) guard logged outcome=blocked reason=${reason}`);
    await type(`9${run}`);
    const typed = await screen();
    check(button(typed, 'Add')?.enabled === 'false', `(${label}) Add stays disabled with a typed draft`);
    check(button(typed, 'Refresh')?.enabled === 'false', `(${label}) Refresh is disabled`);
    await stopApp();
};

// ---- RN seeding ----
const seed = async (n) => {
    const t = titlesFor(n);
    const now = () => new Date().toISOString();
    const capture = (title) => ({ id: randomUUID(), title, createdAt: now(), source: 'android-quick-capture' });
    const inbox = t.inbox.map(capture);
    const inProject = capture(`${t.project} +${t.projectName}`); // quick-add syntax: RN creates the project
    const toComplete = capture(t.done);
    queue([...inbox, inProject, toComplete]);
    device.launch(RN_ACTIVITY);
    await drained([...inbox, inProject, toComplete], 'six queued captures');
    await stopApp();
    // A widget check-off, applied through RN's store on the next launch.
    const checkoff = { id: randomUUID(), kind: 'complete', taskId: toComplete.id, completedAt: now(), source: 'android-widget' };
    queue([checkoff]);
    device.launch(RN_ACTIVITY);
    await drained([checkoff], 'the widget check-off');
    // One synced setting (GTD group), changed in RN's own Settings screen.
    openLink('mindwtr-upgradetest://settings?settingsScreen=gtd-capture');
    let nodes = await waitFor('RN Settings > Capture', (current) => Boolean(autoCleanSwitch(current)), 60_000);
    check(autoCleanSwitch(nodes).checked === 'false', `(${n}) RN shows "${AUTO_CLEAN_LABEL}" off by default`);
    await tap(autoCleanSwitch(nodes));
    nodes = await waitFor('the switch to turn on', (current) => autoCleanSwitch(current)?.checked === 'true', 10_000);
    requireAppFront();
    sh('input keyevent KEYCODE_HOME');
    await until('RN to save the setting', () => settingsOf(pullDatabase(`${n}-poll`)).autoClean === 1, 30_000);
    await stopApp();

    const db = pullDatabase(`${n}-seeded`);
    const tasks = rows(db, TASK_SQL);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    check(inbox.every((item) => byId.get(item.id)?.title === item.title && byId.get(item.id)?.status === 'inbox'),
        `(${n}) RN imported ${inbox.length} Inbox tasks through its capture queue`);
    const project = rows(db, `SELECT id FROM projects WHERE title = '${t.projectName}' AND deletedAt IS NULL`)[0];
    check(Boolean(project) && byId.get(inProject.id)?.title === t.project && byId.get(inProject.id)?.projectId === project.id,
        `(${n}) RN created project ${t.projectName} and filed a task in it`);
    check(byId.get(toComplete.id)?.status === 'done', `(${n}) RN applied the widget check-off (status done)`);
    check(settingsOf(db).autoClean === 1, `(${n}) RN saved quickAddAutoClean = true in the settings row`);
    return t;
};

// INJECTED: every committed row moved into the main file, optionally new WAL frames that
// touch only the settings row, then the tasks root page overwritten in the main file.
const damageDatabase = (label, withWal) => {
    const db = pullDatabase(`${label}-damaged`);
    sql(db, 'PRAGMA wal_checkpoint(TRUNCATE);', false);
    const pageSize = Number(sql(db, 'PRAGMA page_size', false));
    const root = Number(sql(db, "SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'tasks'", false));
    if (withWal) {
        // no_ckpt_on_close keeps the frames in -wal when sqlite3 exits.
        execFileSync('sqlite3', [db, '.dbconfig no_ckpt_on_close on', 'PRAGMA wal_autocheckpoint = 0;',
            "UPDATE settings SET data = json_set(data, '$.harnessWalProbe', 1) WHERE id = 1;"], { stdio: 'ignore' });
        check(statSync(`${db}-wal`).size > 32, `INJECTED (${label}): -wal holds ${statSync(`${db}-wal`).size} bytes of frames for the settings row`);
    }
    const bytes = readFileSync(db);
    bytes.fill(0xa5, (root - 1) * pageSize, root * pageSize);
    writeFileSync(db, bytes);
    const probe = resolve(work, `${label}-probe`);
    rmSync(probe, { recursive: true, force: true });
    mkdirSync(probe, { recursive: true });
    copyFileSync(db, resolve(probe, 'mindwtr.db'));
    if (withWal) copyFileSync(`${db}-wal`, resolve(probe, 'mindwtr.db-wal'));
    let quickCheck; // sqlite3 prints the problems, then exits 1 on the damaged page
    try { quickCheck = sql(resolve(probe, 'mindwtr.db'), 'PRAGMA quick_check', false); } catch (error) { quickCheck = String(error.stdout ?? error.message).trim(); }
    check(quickCheck !== 'ok', `INJECTED (${label}): tasks root page ${root} overwritten; quick_check on a host copy says: ${quickCheck.split('\n')[1] ?? quickCheck}`);
    pushPrivate(db, DB);
    if (withWal) pushPrivate(`${db}-wal`, `${DB}-wal`);
    runAs(withWal ? `rm -f ${DB}-shm` : `rm -f ${DB}-wal ${DB}-shm`);
};

// ---- scenarios ----
const scenarioUpgrade = async () => {
    console.log('\n# 1 happy upgrade');
    fresh();
    const t = await seed('1');
    // RN is stopped and never runs again before the native app: this capture stays un-imported.
    const queued = { id: randomUUID(), title: t.queued, createdAt: new Date().toISOString(), source: 'android-quick-capture' };
    queue([queued]);
    const queuedPath = `files/pending-captures/${queued.id}.json`;
    const before = snapshot();
    const pre = readState(pullDatabase('1-pre'));
    const expected = pre.tasks.filter((task) => task.status === 'inbox' && !task.deletedAt).map((task) => task.title).sort();
    console.log(`pre-upgrade rows: ${JSON.stringify(pre.counts)}; ${before.size} files hashed`);

    install(APKS.native153, true);
    device.launch(NATIVE_ACTIVITY);
    let nodes = await nativeScreen();
    check(!unavailable(nodes), `(1) native boot succeeded ${unavailable(nodes) ?? ''}`);
    check(header(nodes) === expected.length, `(1) native Inbox counts ${expected.length} RN Inbox tasks`);
    for (const title of expected) check(hasText(nodes, title), `(1) native Inbox shows RN task ${title}`);
    check(!hasText(nodes, t.done), '(1) the completed RN task is not in the native Inbox');
    check(nativeGuardLog().includes(`${GUARD} outcome=clear`), '(1) guard logged outcome=clear');
    await type(t.native);
    await tap(button(await screen(), 'Add'));
    nodes = await waitFor('the native capture', (current) => header(current) === expected.length + 1 && field(current)?.text === '');
    check(hasText(nodes, t.native), '(1) native capture is listed');
    await stopApp();

    const after = snapshot();
    const post = pullDatabase('1-post');
    check(rows(post, TASK_SQL).filter((task) => task.title === t.native && !task.deletedAt).length === 1, '(1) native capture stored exactly once');
    const changes = rowChanges(pre.rows, post);
    check(changes.length === 0, `(1) all ${rowCount(pre.rows)} pre-upgrade rows of every core table, settings included, are unchanged in every pre-upgrade column${shortList(changes)}`);
    const checkpoint = resolve(work, '1-post/mindwtr.db.prewrite');
    check(runAs('ls files/SQLite').split(/\s+/).includes('mindwtr.db.prewrite'), '(1) .prewrite checkpoint exists beside the RN database');
    pull(`${DB}.prewrite`, checkpoint);
    check(isDeepStrictEqual(counts(checkpoint), pre.counts), '(1) .prewrite has the pre-upgrade row count of every core table');
    const checkpointChanges = rowChanges(pre.rows, checkpoint);
    check(checkpointChanges.length === 0, `(1) .prewrite holds every pre-upgrade row exactly${shortList(checkpointChanges)}`);
    const changed = differences(before, after, { changedOk: isDatabase, newOk: (path) => isDatabase(path) || path === `${DB}.prewrite` });
    check(changed.length === 0, `(1) every non-database file is unchanged (${[...before.keys()].filter((path) => !isDatabase(path)).length} files)${shortList(changed)}`);
    check(before.has(queuedPath) && after.get(queuedPath) === before.get(queuedPath), '(1) the un-imported pending capture is byte-identical');
    return { t, pre, queued };
};

const scenarioRecovery = async ({ t, pre, queued }) => {
    console.log('\n# 4 recovery: RN 154 over the native build');
    install(APKS.rn154, true);
    device.launch(RN_ACTIVITY);
    openLink('mindwtr-upgradetest://inbox');
    const nodes = await waitFor('the RN Inbox with the native task', (current) => hasText(current, t.native), 90_000);
    for (const title of [t.native, ...t.inbox]) check(hasText(nodes, title), `(4) RN recovery Inbox shows ${title}`);
    await drained([queued], 'the queued capture');
    const rnPid = pid();
    await stopApp();
    const db = pullDatabase('4-post');
    check(rows(db, TASK_SQL).filter((task) => task.title === t.native && !task.deletedAt).length === 1, '(4) the native-created task is present once');
    check(rows(db, TASK_SQL).filter((task) => task.title === t.queued && !task.deletedAt).length === 1, '(4) RN imported the capture the native app left queued, once');
    const changes = rowChanges(pre.rows, db);
    check(changes.length === 0, `(4) every pre-upgrade row, settings included, is unchanged${shortList(changes)}`);
    // Findings, not assertions: RN warnings or errors while it opened a database the native app wrote.
    const log = resolve(work, '4-rn-logcat.txt');
    writeFileSync(log, adbRaw('logcat', '-d', `--pid=${rnPid}`, '*:W').toString('utf8'));
    const suspicious = readFileSync(log, 'utf8').split('\n').filter((line) => /sqlite|schema|migrat|merge|corrupt/i.test(line));
    console.log(`RN recovery warnings mentioning sqlite/schema/migration/merge/corrupt: ${suspicious.length} (full log ${log})`);
    for (const line of suspicious.slice(0, 20)) console.log(`  ${line}`);
};

const scenarioJsonAhead = async () => {
    console.log('\n# 2 RN left unsaved work: json-ahead marker');
    fresh();
    await seed('2');
    const dir = resolve(work, '2-rkstorage');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const present = runAs('ls databases').split(/\s+/);
    for (const file of ['RKStorage', 'RKStorage-wal', 'RKStorage-journal']) {
        if (present.includes(file)) pull(`databases/${file}`, resolve(dir, file));
    }
    sql(resolve(dir, 'RKStorage'), `INSERT OR REPLACE INTO catalystLocalStorage (key, value) VALUES ('${MARKER}', '1'); PRAGMA wal_checkpoint(TRUNCATE);`, false);
    pushPrivate(resolve(dir, 'RKStorage'), 'databases/RKStorage');
    runAs('rm -f databases/RKStorage-wal databases/RKStorage-shm databases/RKStorage-journal');
    console.log(`INJECTED (2): AsyncStorage row ${MARKER} = '1' in databases/RKStorage (the state RN leaves after a save reached only its JSON backup)`);
    const before = snapshot();
    for (const path of [DB, `${DB}-wal`, 'databases/RKStorage']) if (before.has(path)) console.log(`sha256 ${path} ${before.get(path)}`);

    await expectBlocked('2', 'json-ahead', 'Unsaved changes from the previous app version');
    const changed = differences(before, snapshot());
    check(changed.length === 0, `(2) every file is unchanged, database and RKStorage included, and none is new (${before.size} files)${shortList(changed)}`);
};

const scenarioUnreadable = async (label, withWal) => {
    console.log(`\n# ${label} damaged database, ${withWal ? 'WAL holds frames' : 'empty WAL'}`);
    fresh();
    await seed(withWal ? '6' : '3'); // digit prefixes keep seed titles digits-only
    damageDatabase(label, withWal);
    const before = snapshot();
    for (const path of [DB, `${DB}-wal`]) if (before.has(path)) console.log(`sha256 ${path} ${before.get(path)}`);
    if (withWal) check(before.has(`${DB}-wal`), `(${label}) the phone holds the damaged database and its -wal`);

    await expectBlocked(label, 'database-unreadable', "The previous app version's database failed its integrity check");
    const after = snapshot();
    check(after.get(DB) === before.get(DB), `(${label}) database bytes are unchanged`);
    check(after.get(`${DB}-wal`) === before.get(`${DB}-wal`), `(${label}) -wal bytes are unchanged (${withWal ? 'frames kept, no checkpoint' : 'still absent'})`);
    const changed = differences(before, after);
    check(changed.length === 0, `(${label}) every file is unchanged and none is new, so no .prewrite and no task write (${before.size} files)${shortList(changed)}`);
};

const scenarioMissing = async () => {
    console.log('\n# 5 database missing while RN state exists');
    fresh();
    await seed('5');
    runAs(`rm -f ${DB} ${DB}-wal ${DB}-shm`);
    console.log(`INJECTED (5): deleted ${DB} and its -wal and -shm; RKStorage, shared_prefs and files/ stay`);
    const before = snapshot();
    check(![...before.keys()].some((path) => path.startsWith(DB)) && before.has('databases/RKStorage'), '(5) no database file, RN AsyncStorage present');

    await expectBlocked('5', 'database-missing', "The previous app version's database is missing");
    const changed = differences(before, snapshot());
    check(changed.length === 0, `(5) nothing was created or changed, so no empty database (${before.size} files)${shortList(changed)}`);
};

let blocked4 = '';
try {
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    console.log(`device: ${sh('getprop ro.product.model')} / Android ${sh('getprop ro.build.version.release')} (API ${sh('getprop ro.build.version.sdk')})`);
    for (const [name, apk] of Object.entries(APKS)) console.log(`${name}: ${apk} sha256 ${createHash('sha256').update(readFileSync(apk)).digest('hex')}`);
    console.log(`RN source ${built.rnSource}; recovery source ${built.recoverySource}`);
    const current = front();
    if (!current.includes(`${PKG}/`) && !current.includes(`${home}/`)) throw new Stopped(`another app is in front: ${current.trim()}`);
    if (want('1')) {
        const upgraded = await scenarioUpgrade();
        if (want('4') && built.recoverySource !== V132) await scenarioRecovery(upgraded);
        else if (want('4')) {
            // v1.3.2 applies its stale AsyncStorage startup snapshot, and the capture drain then
            // drops the canonical SQLite load. Report it; the RN fix repoints RECOVERY_COMMIT.
            try {
                await scenarioRecovery(upgraded);
                console.log('(4) passed although the recovery source is still v1.3.2');
            } catch (error) {
                if (error instanceof Stopped) throw error;
                blocked4 = `(4) BLOCKED by the RN startup snapshot bug (task mobile-drain-after-canonical): ${error.message}`;
                console.log(blocked4);
            }
        }
    }
    if (want('2')) await scenarioJsonAhead();
    if (want('3')) await scenarioUnreadable('3', false);
    if (want('3b')) await scenarioUnreadable('3b', true);
    if (want('5')) await scenarioMissing();
    console.log(`\nUpgrade device check passed${blocked4 ? '; scenario 4 BLOCKED (see above)' : ''}`);
} catch (error) {
    console.error(error instanceof Stopped ? `STOPPED: ${error.message}` : `FAIL: ${error.message}`);
    process.exitCode = error instanceof Stopped ? 3 : 1;
} finally {
    try { sh(`rm -f ${TMP}-*`); } catch { /* device gone */ }
    if (!args.includes('--keep')) {
        try { if (installed()) sh(`pm uninstall ${PKG}`); } catch { /* device gone */ }
    }
}
