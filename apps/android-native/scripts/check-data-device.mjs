// Settings › Data check (pass D1a) on the test phone, in the throwaway upgrade-harness package only.
//
//   MINDWTR_HARNESS_DIR=<dir> node apps/android-native/scripts/check-data-device.mjs <adb-serial>
//
// A restore replaces a whole library, so this check never runs in the development app: it reinstalls the harness's native
// build (tech.dongdongbh.mindwtr.upgradetest, as check-upgrade-device.mjs does before each scenario) and works only on rows it
// merges in itself (titles `d1…<run>`, tag d1test). The test backups are pushed to the phone's Download/mindwtr-test-d1/, the
// exports land there, and the folder is removed on exit. Steps (design D1 §7):
//   E3 Merge backup (the system document picker), Undo from its toast, then Restore backup from the E1 file;
//   E1 Export backup, CSV and TaskNotes through RN's folder picker (Use this folder, Allow); each file is pulled and read;
//   E2 a cancelled folder picker falls back to the share sheet (Back, nothing is picked or sent);
//   Sync › Recovery snapshots: RN's rows, and Restore with RN's question;
//   E4 process death at each step of a merge (debug properties backup_stop and journal_stop): it lands at most once, the
//      journal and the operation folder end empty, a commit replayed at start meets its document even with a task that became
//      due meanwhile (E4a), and a result a death left unshown shows once;
//   E2b a death in the middle of a folder write: the half file is gone at the next start;
//   E5 while a merge waits (delay_before_ms), one row is busy and every other row is off.
// With D1_MEASURE=1 it measures the transfer limit instead (design §4.1): for each size it reinstalls, merges a backup of that
// size, then restores the same file over it, sampling the app's native heap (QuickJS allocates there) and Java heap each second.
// It clears every debug property it sets, puts rotation back, and leaves the phone on its home screen.
// Exit 0 = pass, 1 = fail, 2 = refused, 3 = stopped.
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { box, check, connect, evidenced, fail, hasText, inboxCount, Stopped, tab, tagged, withDescription } from './device.mjs';
import { cleanupOnExit } from './check-net-device.mjs';

const [serial] = process.argv.slice(2);
if (!serial) {
    console.error('usage: node check-data-device.mjs <adb-serial>');
    process.exit(2);
}
const app = resolve(import.meta.dirname, '..');
const repo = resolve(app, '../..');
const PKG = 'tech.dongdongbh.mindwtr.upgradetest';
const harness = process.env.MINDWTR_HARNESS_DIR ?? '/home/dd/.mindwtr-harness';
const aapt2 = process.env.AAPT2 ?? '/home/dd/Android/Sdk/build-tools/36.1.0/aapt2';
let apk;
try {
    apk = JSON.parse(readFileSync(resolve(harness, 'apks/manifest.json'), 'utf8')).native153.path;
} catch {
    console.error(`REFUSED: no ${harness}/apks/manifest.json; run build-upgrade-harness.mjs first`);
    process.exit(2);
}
if (execFileSync(aapt2, ['dump', 'packagename', apk], { encoding: 'utf8' }).trim() !== PKG) {
    console.error(`REFUSED: ${apk} is not the throwaway ${PKG}`);
    process.exit(2);
}
const ACTIVITY = `${PKG}/${PKG}.MainActivity`;
const TAG = 'MindwtrNativeDev';
const UI_FILE = '/data/local/tmp/mindwtr-d1-ui.xml';
const PHONE_DIR = '/sdcard/Download/mindwtr-test-d1';
// The folder picker's starting place (EXTRA_INITIAL_URI takes a document URI, not a tree URI).
const TREE = 'content://com.android.externalstorage.documents/document/primary%3ADownload%2Fmindwtr-test-d1';
const DB = 'files/SQLite/mindwtr.db';
const PROPS = ['backup_stop', 'journal_stop', 'delay_before_ms', 'export_tree', 'language', 'transfer_limit_mb'];
const work = resolve(app, 'android/build/data-check');
const { en } = await import(resolve(repo, 'packages/core/src/i18n/locales/en.ts'));
const run = `${String(Date.now()).slice(-6)}${String(randomInt(1_000_000)).padStart(6, '0')}`;

// ---- The test backups (RN's backup format: serializeBackupData's pretty JSON of the library) ----
mkdirSync(work, { recursive: true });
const at = () => new Date().toISOString();
const task = (title, extra = {}) => ({ id: randomUUID(), title, status: 'next', tags: ['d1test'], contexts: [], createdAt: at(), updatedAt: at(), rev: 1, ...extra });
const backup = (tasks) => JSON.stringify({ tasks, projects: [], sections: [], areas: [], people: [], settings: {} }, null, 2);
const fixture = (name, tasks) => {
    writeFileSync(resolve(work, name), backup(tasks));
    return { name, tasks };
};

const device = connect({ serial, pkg: PKG, uiFile: UI_FILE });
const { adbRaw, sh, home, front, requireAppFront, pid, screen, waitFor, tap, tapExpecting } = device;
const runAs = (command) => sh(`run-as ${PKG} ${command}`);
const setProp = (name, value) => sh(`setprop debug.mindwtr.native.${name} '${value}'`);
const allLogs = () => adbRaw('logcat', '-d', '-s', `${TAG}:*`).toString('utf8').replace(/\\/g, '');
const until = async (description, holds, timeoutMs = 60_000, everyMs = 1_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try { if (await holds()) return; } catch { /* not ready yet */ }
        if (Date.now() > deadline) fail(`timed out waiting for ${description}`);
        await sleep(everyMs);
    }
};

// ---- The phone's storage ----
const pullDb = (label) => {
    const dir = resolve(work, `db-${label}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const present = runAs('ls files/SQLite').split(/\s+/);
    for (const suffix of ['', '-wal', '-shm']) if (present.includes(`mindwtr.db${suffix}`)) device.pull(`${DB}${suffix}`, resolve(dir, `mindwtr.db${suffix}`));
    return resolve(dir, 'mindwtr.db');
};
const sqlite = (file, sql) => {
    const out = execFileSync('sqlite3', ['-json', file, sql], { encoding: 'utf8' }).trim();
    return out ? JSON.parse(out) : [];
};
/** This run's live task titles (the d1… rows), sorted. */
const liveTitles = (label) => sqlite(pullDb(label), `SELECT title FROM tasks WHERE deletedAt IS NULL AND title LIKE 'd1%${run}'`).map((row) => row.title).sort();
const listing = (path) => runAs(`sh -c 'ls ${path} 2>/dev/null || true'`).split(/\s+/).filter(Boolean);
const snapshots = () => listing('files/snapshots').filter((name) => name.endsWith('.snapshot.json'));
const journal = () => listing('files/journal').filter((name) => name.endsWith('.json'));
const operations = () => listing('no_backup/backup-operations').filter((name) => name !== 'result.json');
const exportsOnPhone = () => sh(`ls ${PHONE_DIR} 2>/dev/null || true`).split(/\s+/).filter((name) => name.startsWith('mindwtr-backup'));

// ---- The app ----
const onInbox = (nodes) => !tagged(nodes, 'menu-screen') && Number.isFinite(inboxCount(nodes));
const onData = (nodes) => Boolean(tagged(nodes, 'settings-data'));
const onSync = (nodes) => Boolean(tagged(nodes, 'settings-sync'));
const sheetOpen = (nodes) => Boolean(tagged(nodes, 'more-sheet'));
const otherAppFront = () => !front().includes(`${PKG}/`);
const toTabs = async () => {
    let nodes = await screen();
    for (let step = 0; step < 8 && !(tab(nodes, en['tab.menu']) && !tagged(nodes, 'menu-screen') && !sheetOpen(nodes)); step += 1) {
        requireAppFront();
        sh('input keyevent KEYCODE_BACK');
        await sleep(900);
        nodes = await screen();
    }
    return nodes;
};
const openSettings = async () => {
    let nodes = await toTabs();
    nodes = await tapExpecting(tab(nodes, en['tab.menu']) ?? fail('no Menu tab'), sheetOpen, 'the More sheet');
    nodes = await device.settle(nodes);
    return tapExpecting(withDescription(nodes, en['nav.settings']) ?? fail('no Settings in the More sheet'), (current) => Boolean(tagged(current, 'settings-main')), 'Settings');
};
const withPrefix = (nodes, prefix) => nodes.find((node) => (node['content-desc'] ?? '').startsWith(prefix));
const openRow = async (label, arrived, what) => {
    let nodes = await openSettings();
    for (let step = 0; step < 6 && !withPrefix(nodes, `${label}. `); step += 1) nodes = await device.swipe(nodes, 'down');
    return tapExpecting(withPrefix(nodes, `${label}. `) ?? fail(`no ${what} row in Settings`), arrived, `Settings › ${what}`);
};
const openData = async () => {
    const nodes = await openRow(en['settings.data'], onData, 'Data');
    if (tagged(nodes, 'data-transfer-export')) return nodes;
    return tapExpecting(tagged(nodes, 'backup-disclosure') ?? fail('no Backup fold'), (current) => Boolean(tagged(current, 'data-transfer-merge')), 'the Backup fold open');
};
const launch = async () => {
    device.launch(ACTIVITY);
    await waitFor('the Inbox', onInbox, 90_000);
};
const relaunch = async () => {
    await device.stopApp();
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    await launch();
};
// ---- The system pickers (another app in front) ----
const anyScreen = async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            const xml = adbRaw('exec-out', 'uiautomator', 'dump', '/dev/tty').toString('utf8');
            if (xml.includes('<hierarchy')) {
                return [...xml.matchAll(/<node [^>]*>/g)].map(([node]) => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)]
                    .map(([, name, value]) => [name, value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&quot;/g, '"').replace(/&amp;/g, '&')])));
            }
        } catch { /* briefly unavailable */ }
        await sleep(500);
    }
    return fail('uiautomator dump failed in the picker');
};
const tapAny = async (node) => {
    const [x1, y1, x2, y2] = box(node);
    sh(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
    await sleep(900);
};
/** RN's document picker (ACTION_OPEN_DOCUMENT): the file named [name], found in its list or through its search. */
const pickDocument = async (name) => {
    await until('the document picker', otherAppFront, 15_000, 500);
    await sleep(1500);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        let nodes = await anyScreen();
        const hit = nodes.find((node) => node.text === name);
        if (hit) return tapAny(hit);
        const search = nodes.find((node) => /search/i.test(`${node['content-desc']} ${node['resource-id']}`) && node.clickable === 'true');
        if (search) {
            await tapAny(search);
            sh(`input text '${name}'`);
            sh('input keyevent KEYCODE_ENTER');
            await sleep(2500);
            nodes = await anyScreen();
            const found = nodes.filter((node) => node.text === name).at(-1);
            if (found) return tapAny(found);
        }
        await sleep(1500);
    }
    return fail(`the document picker did not show ${name}`);
};
/** RN's folder picker (ACTION_OPEN_DOCUMENT_TREE, opened in the test folder): Use this folder, then Allow when it asks. */
const useTestFolder = async () => {
    await until('the folder picker', otherAppFront, 15_000, 500);
    await sleep(1500);
    let nodes = await anyScreen();
    // Opened somewhere else (the provider ignored the starting place): walk to Download › mindwtr-test-d1.
    for (const folder of ['Download', 'mindwtr-test-d1']) {
        if (nodes.some((node) => node['resource-id']?.endsWith('breadcrumb_text') && node.text === folder)) continue;
        if (folder === 'Download' && nodes.some((node) => node.text === 'mindwtr-test-d1' && node['resource-id']?.endsWith('breadcrumb_text'))) continue;
        const entry = nodes.find((node) => node.text === folder && node['resource-id']?.endsWith('android:id/title'));
        if (!entry) continue;
        await tapAny(entry);
        await sleep(1500);
        nodes = await anyScreen();
    }
    const use = nodes.find((node) => /use this folder/i.test(node.text ?? '') && node.enabled !== 'false');
    if (!use) fail(`the folder picker shows no "Use this folder" (${nodes.map((node) => node.text).filter(Boolean).slice(0, 12).join(' | ')})`);
    await tapAny(use);
    await sleep(1200);
    if (otherAppFront()) {
        nodes = await anyScreen();
        const allow = nodes.find((node) => /^allow$/i.test(node.text ?? ''));
        if (allow) await tapAny(allow);
    }
    await until('the app back in front', () => !otherAppFront(), 15_000, 500);
};

// ---- Data actions ----
/** The open question's action button (a dialog window has no test tags): core's Merge, Restore or Import word, its text or TalkBack name. */
const confirmButton = (nodes) => nodes.find((node) => [en['settings.mergeBackupAction'], en['markdown.referenceRestore'], en['settings.backupMobile.import']]
    .some((label) => [node.text, node['content-desc']].some((text) => (text ?? '').toUpperCase() === label.toUpperCase())));
const confirmQuestion = async (title) => {
    const nodes = await waitFor(`the question "${title}"`, (current) => hasText(current, title) && Boolean(confirmButton(current)), 60_000);
    await tap(confirmButton(nodes));
};
const merge = async (file) => {
    await openData();
    await tap(tagged(await screen(), 'data-transfer-merge'));
    await pickDocument(file.name);
    await until('the app back in front', () => !otherAppFront(), 15_000, 500);
};
// The question closed first: a question can carry the same title as its result (Merge Backup).
const toastWith = (title, timeoutMs = 120_000) => waitFor(`the toast "${title}"`, (nodes) => hasText(nodes, title) && !confirmButton(nodes), timeoutMs);
const undoButton = (nodes) => nodes.find((node) => node.text === en['settings.undoImport']);
const push = (file) => adbRaw('push', resolve(work, file.name), `${PHONE_DIR}/${file.name}`);
const exportFile = async (tag, suffix) => {
    const before = exportsOnPhone();
    await openData();
    await tap(tagged(await screen(), tag) ?? fail(`no ${tag} row`));
    await useTestFolder();
    await until(`the ${suffix} file in ${PHONE_DIR}`, () => exportsOnPhone().some((name) => !before.includes(name) && name.endsWith(suffix)), 60_000);
    const name = exportsOnPhone().find((name) => !before.includes(name) && name.endsWith(suffix));
    const local = resolve(work, name);
    writeFileSync(local, adbRaw('exec-out', 'cat', `${PHONE_DIR}/${name}`));
    return { name, local };
};
const replayLines = () => allLogs().split('\n').filter((line) => line.includes('v1.3.5/android-backup-replay'));


// ---- The transfer limit measurement (D1_MEASURE=1) ----
/** `dumpsys meminfo`'s Native Heap and Java Heap sizes (kB) and its TOTAL PSS. */
const memory = () => {
    const text = sh(`dumpsys meminfo ${PKG}`);
    const kb = (pattern) => Number(pattern.exec(text)?.[1] ?? NaN);
    return { native: kb(/Native Heap:\s+(\d+)/), java: kb(/Java Heap:\s+(\d+)/), total: kb(/TOTAL PSS:\s+(\d+)/) };
};
const measureRun = async (label, act, done) => {
    const peak = { native: 0, java: 0, total: 0 };
    const started = Date.now();
    await act();
    let outcome = 'timeout';
    for (let second = 0; second < 300; second += 1) {
        if (!pid()) { outcome = 'died'; break; }
        try { const now = memory(); for (const key of Object.keys(peak)) if (now[key] > peak[key]) peak[key] = now[key]; } catch { /* sampling only */ }
        const nodes = await screen().catch(() => []);
        if (done(nodes)) { outcome = 'done'; break; }
        if (nodes.some((node) => /failed|too large/i.test(node.text ?? ''))) { outcome = `failed: ${nodes.find((node) => /failed|too large/i.test(node.text ?? '')).text}`; break; }
        await sleep(1000);
    }
    console.log(`measure ${label}: ${outcome} in ${Math.round((Date.now() - started) / 1000)} s; peak native ${Math.round(peak.native / 1024)} MiB, java ${Math.round(peak.java / 1024)} MiB, total pss ${Math.round(peak.total / 1024)} MiB`);
    return outcome;
};
const measure = async () => {
    console.log(`heap limits: dalvik.vm.heapgrowthlimit=${sh('getprop dalvik.vm.heapgrowthlimit')} heapsize=${sh('getprop dalvik.vm.heapsize')}; ${sh('grep MemTotal /proc/meminfo')}`);
    for (const mib of (process.env.D1_MEASURE_SIZES ?? '8,16,24,32,48').split(',').map(Number)) {
        const note = 'x'.repeat(64 * 1024);
        const tasks = Array.from({ length: Math.round(mib * 16) }, (_, index) => task(`d1m${index}${run}`, { notes: note }));
        const file = fixture(`d1-measure-${mib}-${run}.json`, tasks);
        push(file);
        if (sh(`pm list packages ${PKG}`).split('\n').some((line) => line.trim() === `package:${PKG}`)) sh(`pm uninstall ${PKG}`);
        adbRaw('install', '-g', apk);
        setProp('transfer_limit_mb', '1024');
        await launch();
        const merged = await measureRun(`${mib} MiB merge`, async () => {
            await merge(file);
            await tap(confirmButton(await waitFor('the question', (current) => Boolean(confirmButton(current)), 300_000)));
        }, (nodes) => hasText(nodes, en['settings.mergeBackup']) && !confirmButton(nodes));
        if (merged !== 'done') { if (!pid()) await launch(); continue; }
        await measureRun(`${mib} MiB restore over a ${mib} MiB library`, async () => {
            await openData();
            await tap(tagged(await screen(), 'data-transfer-restore'));
            await pickDocument(file.name);
            await until('the app back in front', () => !otherAppFront(), 15_000, 500);
            await tap(confirmButton(await waitFor('the question', (current) => Boolean(confirmButton(current)), 300_000)));
        }, (nodes) => hasText(nodes, en['settings.backupMobile.restoreComplete']));
        sh(`rm -f ${PHONE_DIR}/${file.name}`);
    }
    setProp('transfer_limit_mb', '');
};

const originalAccelerometer = sh('settings get system accelerometer_rotation');
const originalRotation = sh('settings get system user_rotation');
const cleanup = cleanupOnExit([
    ...PROPS.map((name) => () => setProp(name, '')),
    () => sh(`rm -rf ${PHONE_DIR}`),
    () => sh(`rm -f ${UI_FILE}`),
    () => { if (front().includes(`${PKG}/`)) sh('input keyevent KEYCODE_HOME'); },
    () => sh(originalRotation === 'null' ? 'settings delete system user_rotation' : `settings put system user_rotation ${originalRotation}`),
    () => sh(originalAccelerometer === 'null' ? 'settings delete system accelerometer_rotation' : `settings put system accelerometer_rotation ${originalAccelerometer}`),
]);

try {
    console.log(`device: ${sh('getprop ro.product.model')} / Android ${sh('getprop ro.build.version.release')} (API ${sh('getprop ro.build.version.sdk')})`);
    console.log(`apk: ${apk}\nrun: ${run}`);
    const beforeInstall = front();
    if (!beforeInstall.includes(`${PKG}/`) && !beforeInstall.includes(`${home}/`)) throw new Stopped(`another app is in front: ${beforeInstall.trim()}`);
    for (const name of PROPS) setProp(name, '');
    setProp('language', 'en');
    sh(`rm -rf ${PHONE_DIR}`);
    sh(`mkdir -p ${PHONE_DIR}`);
    steps: {
    if (process.env.D1_MEASURE === '1') {
        sh('settings put system accelerometer_rotation 0');
        await measure();
        console.log('Transfer limit measurement finished');
        break steps;
    }
    // The throwaway package, fresh (as each check-upgrade-device scenario starts).
    if (sh(`pm list packages ${PKG}`).split('\n').some((line) => line.trim() === `package:${PKG}`)) sh(`pm uninstall ${PKG}`);
    adbRaw('install', '-g', apk);
    adbRaw('logcat', '-c');
    sh('settings put system accelerometer_rotation 0');
    sh('settings put system user_rotation 0');
    await launch();
    check(snapshots().length === 0 && journal().length === 0, 'a fresh library: no recovery snapshot, an empty journal');

    // ---- E3: Merge backup, Undo, Restore backup ----
    const a = fixture(`d1-merge-a-${run}.json`, [task(`d1a${run}`), task(`d1b${run}`, { notes: '日本語 🦉' })]);
    push(a);
    await merge(a);
    await confirmQuestion(en['settings.mergeBackup']);
    let nodes = await toastWith(en['settings.mergeBackup']);
    check(Boolean(undoButton(nodes)), '(E3) the merge result shows RN\'s Undo');
    // Undo straight away (RN's toast lasts 5.6 s): RN's "Undo this change?" with the snapshot's label, then Restore.
    await tap(undoButton(nodes));
    await confirmQuestion(en['settings.undoImportConfirmTitle']);
    await toastWith(en['settings.backupMobile.restoreComplete']);
    check(liveTitles('undo').length === 0, '(E3) Undo restored the snapshot taken before the merge: no merged row is live');
    check(snapshots().length === 1, `(E3) one recovery snapshot (the merge's; a snapshot restore takes none): ${snapshots().join(' ')}`);
    check(journal().length === 0 && operations().length === 0, '(E3) the journal and the operation folder are empty');
    // The same file again: Undo deleted its rows here, and RN's merge keeps a local delete ("items you deleted here stay deleted").
    await merge(a);
    await confirmQuestion(en['settings.mergeBackup']);
    await toastWith(en['settings.mergeBackup']);
    check(liveTitles('remerge').length === 0, '(E3) merging the undone file again keeps its rows deleted, as RN\'s merge does');
    const a2 = fixture(`d1-merge-a2-${run}.json`, [task(`d1a${run}`), task(`d1b${run}`, { notes: '日本語 🦉' })]);
    push(a2);
    await merge(a2);
    await confirmQuestion(en['settings.mergeBackup']);
    await toastWith(en['settings.mergeBackup']);
    check(JSON.stringify(liveTitles('merge')) === JSON.stringify([`d1a${run}`, `d1b${run}`]), '(E3) Merge backup added both rows once');

    // ---- E1: the three exports into the folder RN's picker grants ----
    setProp('export_tree', TREE);
    const json = await exportFile('data-transfer-export', '.json');
    const exported = JSON.parse(readFileSync(json.local, 'utf8'));
    const db = pullDb('export');
    const ids = sqlite(db, 'SELECT id FROM tasks ORDER BY id').map((row) => row.id);
    check(JSON.stringify(exported.tasks.map((item) => item.id).sort()) === JSON.stringify(ids), `(E1) ${json.name} holds every task the library holds (${ids.length})`);
    check(exported.tasks.find((item) => item.title === `d1b${run}`)?.notes === '日本語 🦉', '(E1) the export keeps the notes\' text byte for byte');
    check(allLogs().includes('"releaseCheck":"v1.3.5/android-backup-export"') && allLogs().includes('"route":"saf"'), '(E1) the export line says route=saf');
    const csv = await exportFile('data-transfer-export-csv', '.csv');
    const csvText = readFileSync(csv.local, 'utf8');
    check(csvText.split('\n')[0].includes('title') && csvText.includes(`d1a${run}`), `(E1) ${csv.name} is Mindwtr CSV with this run's rows`);
    const zip = await exportFile('data-transfer-export-tasknotes', '-tasknotes.zip');
    const entries = execFileSync('unzip', ['-Z1', zip.local], { encoding: 'utf8' });
    check(entries.includes(`d1a${run}`), `(E1) ${zip.name} holds a TaskNotes file per task`);
    console.log(`info - persisted grants naming the test folder: ${sh(`dumpsys activity permissions | grep -c 'mindwtr-test-d1' || true`)}`);

    // ---- E2: no folder picked: RN's share fallback; nothing is created ----
    setProp('export_tree', '');
    const beforeShare = exportsOnPhone();
    await openData();
    await tap(tagged(await screen(), 'data-transfer-export'));
    await until('the folder picker', otherAppFront, 15_000, 500);
    await sleep(1200);
    sh('input keyevent KEYCODE_BACK');
    await until('the share sheet', () => sh('dumpsys activity activities').includes('act=android.intent.action.CHOOSER'), 15_000, 500);
    check(true, '(E2) a cancelled folder picker opens the share sheet');
    for (let step = 0; step < 3 && otherAppFront(); step += 1) { sh('input keyevent KEYCODE_BACK'); await sleep(1200); }
    requireAppFront();
    check(JSON.stringify(exportsOnPhone()) === JSON.stringify(beforeShare), '(E2) nothing was written into the folder, and no target was picked');

    // ---- E3: Restore backup from the E1 file replaces the library ----
    const b = fixture(`d1-merge-b-${run}.json`, [task(`d1c${run}`)]);
    push(b);
    await merge(b);
    await confirmQuestion(en['settings.mergeBackup']);
    await toastWith(en['settings.mergeBackup']);
    check(liveTitles('before-restore').includes(`d1c${run}`), '(E3) a second merge added its row');
    await openData();
    await tap(tagged(await screen(), 'data-transfer-restore'));
    await pickDocument(json.name);
    await until('the app back in front', () => !otherAppFront(), 15_000, 500);
    await confirmQuestion(en['settings.backupMobile.restoreBackup']);
    nodes = await toastWith(en['settings.backupMobile.restoreComplete']);
    check(Boolean(undoButton(nodes)), '(E3) the restore result shows Undo too (RN\'s 32c840ec9)');
    check(JSON.stringify(liveTitles('restore')) === JSON.stringify([`d1a${run}`, `d1b${run}`]), '(E3) Restore backup gave the exported library: the later row is gone');

    // ---- Sync › Recovery snapshots: RN's rows and question ----
    nodes = await openRow(en['settings.sync'], onSync, 'Sync');
    for (let step = 0; step < 10 && !tagged(nodes, 'recovery-snapshots-disclosure'); step += 1) nodes = await device.swipe(nodes, 'down');
    nodes = await tapExpecting(tagged(nodes, 'recovery-snapshots-disclosure') ?? fail('no Recovery snapshots card'),
        (current) => current.some((node) => (node['resource-id'] ?? '').includes('recovery-snapshot-data.')), 'the snapshot rows');
    const rows = nodes.filter((node) => (node['resource-id'] ?? '').includes('recovery-snapshot-data.'));
    const newest = [...snapshots()].sort().at(-1);
    check(rows.length === Math.min(5, snapshots().length) && rows.every((row) => /\(data\..*\.snapshot\.json\)|data\..*\.snapshot\.json/.test(row['content-desc'] ?? '')),
        `(snapshots) one row per snapshot on disk, TalkBack names each with its file: ${rows.length}`);
    await tap(rows.find((row) => row['resource-id'].endsWith(newest)) ?? rows[0]);
    await confirmQuestion(en['settings.backupMobile.restoreRecoverySnapshot']);
    nodes = await toastWith(en['settings.backupMobile.restoreComplete']);
    check(!undoButton(nodes), '(snapshots) a snapshot restore offers no Undo, as RN');

    // ---- E5: a merge held before its commit: one busy row, the others off ----
    const c = fixture(`d1-merge-c-${run}.json`, [task(`d1d${run}`)]);
    push(c);
    setProp('delay_before_ms', '8000');
    await merge(c);
    nodes = await waitFor('the question', (current) => Boolean(confirmButton(current)), 60_000);
    await tap(confirmButton(nodes));
    const rowTags = ['data-transfer-export', 'data-transfer-export-csv', 'data-transfer-export-tasknotes', 'data-transfer-restore', 'data-transfer-merge'];
    nodes = await waitFor('the merge to wait', (current) => rowTags.every((tag) => tagged(current, tag)?.enabled === 'false'), 30_000);
    check(true, '(E5) while the merge runs every data row is off (RN\'s isBackupBusy), the merge row with RN\'s spinner (screenshot)');
    writeFileSync(resolve(work, 'e5-busy.png'), adbRaw('exec-out', 'screencap', '-p'));
    await toastWith(en['settings.mergeBackup']);
    setProp('delay_before_ms', '');

    // ---- E4: process death at each step ----
    const crash = async (label, props, file, { landed, expectReplay }) => {
        for (const [name, value] of Object.entries(props)) setProp(name, value);
        push(file);
        await merge(file);
        const question = await waitFor('the question', (current) => Boolean(confirmButton(current)), 60_000);
        await tap(confirmButton(question));
        await until(`the process to end (${label})`, () => !pid(), 90_000, 500);
        for (const name of Object.keys(props)) setProp(name, '');
        const replays = replayLines().length;
        await launch();
        const titles = liveTitles(label);
        const mine = file.tasks.map((item) => item.title);
        check(mine.every((title) => titles.filter((seen) => seen === title).length === (landed ? 1 : 0)), `(E4 ${label}) the merge ${landed ? 'landed once' : 'did not land'}`);
        await until(`(E4 ${label}) the journal and the operation folder to empty`, () => journal().length === 0 && operations().length === 0, 30_000);
        if (expectReplay) check(replayLines().length > replays && replayLines().at(-1).includes('"outcome":"committed"'), `(E4 ${label}) the start replayed the commit: ${replayLines().at(-1)?.slice(replayLines().at(-1).indexOf('{'))}`);
        if (landed) await toastWith(en['settings.mergeBackup'], 60_000);
        check(true, `(E4 ${label}) the journal and the operation folder are empty`);
    };
    await crash('after-snapshot', { backup_stop: 'after-snapshot' }, fixture(`d1-crash-1-${run}.json`, [task(`d1e${run}`)]), { landed: false });
    await crash('mid-plan', { backup_stop: 'mid-plan' }, fixture(`d1-crash-2-${run}.json`, [task(`d1f${run}`)]), { landed: false });
    await crash('before-commit', { journal_stop: 'before:backupDocumentCommit' }, fixture(`d1-crash-3-${run}.json`, [task(`d1g${run}`)]), { landed: true, expectReplay: true });
    await crash('after-commit', { journal_stop: 'after:backupDocumentCommit' }, fixture(`d1-crash-4-${run}.json`, [task(`d1h${run}`)]), { landed: true, expectReplay: true });
    await crash('after-settle', { backup_stop: 'after-settle' }, fixture(`d1-crash-5-${run}.json`, [task(`d1i${run}`)]), { landed: true });

    // settle-fail: the merge shows its result, but its entry and plan stay until the next start replays them from the receipt.
    setProp('backup_stop', 'settle-fail');
    const f = fixture(`d1-crash-6-${run}.json`, [task(`d1j${run}`)]);
    push(f);
    await merge(f);
    await confirmQuestion(en['settings.mergeBackup']);
    await toastWith(en['settings.mergeBackup']);
    setProp('backup_stop', '');
    check(journal().length === 1 && operations().length === 1, '(E4 settle-fail) the entry and its plan stay while the journal owns them');
    await relaunch();
    await until('(E4 settle-fail) the replay to empty them', () => journal().length === 0 && operations().length === 0, 30_000);
    check(liveTitles('settle-fail').filter((title) => title === `d1j${run}`).length === 1, '(E4 settle-fail) the replay answered from the receipt: the row is there once');

    // E4a: a task that becomes due while the commit waits in the journal; the recovery boot replays before the promotion.
    const due = fixture(`d1-due-${run}.json`, [task(`d1k${run}`, { status: 'inbox', startTime: new Date(Date.now() + 45_000).toISOString() })]);
    push(due);
    await merge(due);
    await confirmQuestion(en['settings.mergeBackup']);
    await toastWith(en['settings.mergeBackup']);
    const g = fixture(`d1-crash-7-${run}.json`, [task(`d1l${run}`)]);
    setProp('journal_stop', 'before:backupDocumentCommit');
    push(g);
    await merge(g);
    await confirmQuestion(en['settings.mergeBackup']);
    await until('the process to end (E4a)', () => !pid(), 90_000, 500);
    setProp('journal_stop', '');
    await sleep(Math.max(0, Date.parse(due.tasks[0].startTime) - Date.now()) + 5_000);
    const replays = replayLines().length;
    await launch();
    check(replayLines().length > replays && replayLines().at(-1).includes('"outcome":"committed"'), '(E4a) the commit replayed after a task became due landed, not stale');
    check(liveTitles('due').includes(`d1l${run}`), '(E4a) its row is in the library');
    let promoted;
    await until('(E4a) the due task to be promoted', () => (promoted = sqlite(pullDb('due-status'), `SELECT status FROM tasks WHERE title = 'd1k${run}'`)[0]?.status) === 'next', 30_000)
        .catch(() => undefined);
    check(promoted === 'next', `(E4a) normal activation ran after the replay: the due task is promoted (${promoted})`);

    // ---- E2b: a death in the middle of a folder write ----
    setProp('export_tree', TREE);
    setProp('backup_stop', 'mid-export');
    const beforeKill = exportsOnPhone();
    await openData();
    await tap(tagged(await screen(), 'data-transfer-export'));
    await useTestFolder().catch(() => undefined);
    await until('the process to end mid-export', () => !pid(), 60_000, 500);
    setProp('backup_stop', '');
    check(exportsOnPhone().length > beforeKill.length, '(E2b) the half-written file is in the folder after the death');
    await launch();
    await until('(E2b) the half file to go', () => exportsOnPhone().length === beforeKill.length, 30_000);
    check(allLogs().includes('v1.3.5/android-export-cleanup'), '(E2b) the start removed it and logged android-export-cleanup');
    setProp('export_tree', '');

    console.log('Settings › Data device check passed');
    }
} catch (error) {
    evidenced(error);
    console.error(error instanceof Stopped ? `STOPPED: ${error.message}` : `FAIL: ${error.message}`);
    process.exitCode = error instanceof Stopped ? 3 : 1;
} finally {
    cleanup();
}
