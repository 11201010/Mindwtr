// Widget list screen check (pass P3, W1b, #1213) for the isolated native Android development app.
//
//   node apps/android-native/scripts/check-widget-list-device.mjs <adb-serial> [apk]
//
// A Tasks widget showing Next Actions or a saved filter links its header to `mindwtr:///widget-list/<id>` (core's openUri; the
// development build's scheme is mindwtr-native-dev). The check never touches a placed widget: it sends the widget's link with
// `am start -d`. Installs the debug APK with `install -r` (development data stays) and writes nothing: (a) `next` opens RN's widget
// list screen titled with core's title (Next Actions) and core's first rows in core's order, not the Inbox; a row's swipe shows
// RN's action (not run) and its tap opens the editor; Back returns to the list, and Back again leaves it; (b) the device's first
// saved filter, when it has one, opens with core's title and rows; (c) a saved filter that is gone (URI-encoded id) shows core's
// "No results" title and empty line, with no row. Screenshots of (a) and (c) go to the harness folder (MINDWTR_HARNESS_DIR) for
// the side-by-side with RN. It touches only the development package (it refuses any other APK), never launches over another
// app, leaves the app on its Inbox tab and restores rotation on exit. Exit 0 = pass, 1 = fail, 2 = refused, 3 = stopped.
import { execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { box, button, check, connect, evidenced, fail, inEditor, Stopped, tab, tabSelected, tagged, taskRows } from './device.mjs';

const [serial, apkArg] = process.argv.slice(2);
if (!serial) {
    console.error('usage: node check-widget-list-device.mjs <adb-serial> [apk]');
    process.exit(2);
}
const app = resolve(import.meta.dirname, '..');
const apk = apkArg ?? resolve(app, 'android/app/build/outputs/apk/play/debug/app-play-debug.apk');
const adbBin = process.env.ADB ?? '/home/dd/Android/Sdk/platform-tools/adb';
const aapt2 = process.env.AAPT2 ?? '/home/dd/Android/Sdk/build-tools/36.1.0/aapt2';
const PKG = 'tech.dongdongbh.mindwtr.nativeclient.dev';
const apkPackage = execFileSync(aapt2, ['dump', 'packagename', apk], { encoding: 'utf8' }).trim();
if (apkPackage !== PKG) {
    console.error(`REFUSED: ${apk} is package "${apkPackage}", not ${PKG}`);
    process.exit(2);
}
const ACTIVITY = `${PKG}/${PKG}.MainActivity`;
const SCHEME = 'mindwtr-native-dev';
const UI_FILE = '/data/local/tmp/mindwtr-native-dev-ui.xml';
const DB = 'mindwtr-native-dev.db';
const work = resolve(app, 'android/build/widget-list-check');
const shots = resolve(process.env.MINDWTR_HARNESS_DIR ?? work, 'widget-list');
const coreSrc = resolve(app, '../../packages/core/src');
const { en } = await import(resolve(coreSrc, 'i18n/locales/en.ts'));
const run = `${String(Date.now()).slice(-6)}${String(randomInt(1_000_000)).padStart(6, '0')}`;

const device = connect({ serial, pkg: PKG, uiFile: UI_FILE, adb: adbBin });
const { adbRaw, sh, home, front, requireAppFront, screen, waitFor, tapExpecting } = device;
const runAs = (command) => sh(`run-as ${PKG} ${command}`);

/** Core's widget list screens on a copy of the app's database: each id's found, title, total, first rows' titles and empty line. */
const core = (ids) => {
    const dir = resolve(work, 'db');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const present = runAs('ls files').split(/\s+/);
    for (const suffix of ['', '-wal', '-shm']) if (present.includes(`${DB}${suffix}`)) device.pull(`files/${DB}${suffix}`, resolve(dir, `${DB}${suffix}`));
    return JSON.parse(execFileSync('bun', ['-e', `
        import { Database } from 'bun:sqlite';
        import { SqliteAdapter, createNativeHostContract, setStorageAdapter, useTaskStore } from '${coreSrc}/index.ts';
        const db = new Database(process.env.CHECK_DB, { readonly: false });
        setStorageAdapter(new SqliteAdapter({
            run: async (sql, params = []) => { db.query(sql).run(...params); },
            all: async (sql, params = []) => db.query(sql).all(...params),
            get: async (sql, params = []) => db.query(sql).get(...params) ?? undefined,
            exec: async (sql) => { db.exec(sql); },
        }));
        const host = createNativeHostContract();
        if (!(await host.setLanguage({ storedLanguage: 'en', systemLocale: null })).ok) throw new Error('language');
        const ready = await host.activate({ writeSafetyReady: true });
        if (!ready.ok) throw new Error(ready.error.message);
        const value = (result) => { if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message); return result.value; };
        const views = Object.fromEntries(JSON.parse(process.env.CHECK_IDS).map((id) => {
            const view = value(host.getWidgetListView({ id, offset: 0, limit: 10 }));
            return [id, { found: view.found, title: view.title, total: view.total, rows: view.rows.map((row) => row.title), empty: view.empty?.message ?? null }];
        }));
        const filters = (useTaskStore.getState().settings.savedFilters ?? []).map((filter) => filter.id);
        console.log(JSON.stringify({ views, filters }));
        process.exit(0);
    `], { encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, CHECK_DB: resolve(dir, DB), CHECK_IDS: JSON.stringify(ids) } })
        .trim().split('\n').pop());
};

// ---- UI (core's English) ----
const onInbox = (nodes) => !tagged(nodes, 'menu-screen') && tabSelected(nodes, en['tab.inbox']);
const header = (nodes, title) => tagged(nodes, 'menu-screen') && nodes.some((node) => node.text === title && node.class !== 'android.widget.EditText');
const rowTitles = (nodes) => taskRows(nodes).sort((a, b) => box(a)[1] - box(b)[1]).map((node) => node.text);
/** The widget's link for [id], as core's openUri builds it (encodeURIComponent), sent to this app only, from the app or home. */
const openLink = (id) => {
    const current = front();
    if (!current.includes(`${PKG}/`) && !current.includes(`${home}/`)) throw new Stopped(`another app is in front: ${current.trim()}`);
    sh(`am start -W -a android.intent.action.VIEW -d '${SCHEME}:///widget-list/${encodeURIComponent(id)}' ${PKG}`);
};
const shot = (name) => {
    mkdirSync(shots, { recursive: true });
    const file = resolve(shots, `${name}-native.png`);
    writeFileSync(file, adbRaw('exec-out', 'screencap', '-p'));
    console.log(`screenshot ${file}`);
};
/** The list for [id]: its header title and core's first rows in core's order (as many as the screen shows), and no Inbox. */
const expectList = async (id, view, label) => {
    openLink(id);
    const nodes = await waitFor(`${label}: the widget list "${view.title}"`, (current) => header(current, view.title)
        && (view.total === 0 || taskRows(current).length > 0), 30_000);
    const shown = rowTitles(nodes);
    check(!onInbox(nodes), `(${label}) the link opens the widget list, not the Inbox`);
    check(shown.length > 0 ? JSON.stringify(shown) === JSON.stringify(view.rows.slice(0, shown.length)) : view.total === 0,
        `(${label}) "${view.title}" shows core's first ${shown.length} of ${view.total} rows in core's order`);
    return nodes;
};
const backTo = async (done, description) => {
    requireAppFront();
    sh('input keyevent KEYCODE_BACK');
    return waitFor(description, done, 15_000);
};

const originalAccelerometer = sh('settings get system accelerometer_rotation');
const originalRotation = sh('settings get system user_rotation');
const restore = async () => {
    try {
        for (let step = 0; step < 6 && front().includes(`${PKG}/`); step += 1) {
            const nodes = await screen();
            if (onInbox(nodes)) break;
            sh('input keyevent KEYCODE_BACK');
            await sleep(800);
        }
        const nodes = await screen();
        if (front().includes(`${PKG}/`) && tab(nodes, en['tab.inbox']) && !tabSelected(nodes, en['tab.inbox'])) await device.tap(tab(nodes, en['tab.inbox']));
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
    const beforeInstall = front();
    if (!beforeInstall.includes(`${PKG}/`) && !beforeInstall.includes(`${home}/`)) throw new Stopped(`another app is in front: ${beforeInstall.trim()}`);
    execFileSync(adbBin, ['-s', serial, 'install', '-r', apk], { stdio: 'inherit' });
    device.launch(ACTIVITY);
    requireAppFront();
    sh('settings put system accelerometer_rotation 0');
    sh('settings put system user_rotation 0');
    await waitFor('the Inbox', onInbox, 60_000);
    const gone = `filter:gone-${run}`;
    let seen = core(['next', gone]);
    const filterId = seen.filters[0] ? `filter:${seen.filters[0]}` : null;
    if (filterId) seen = core(['next', gone, filterId]);
    const next = seen.views.next;
    check(next.found && next.title === (en['nav.next'] ?? 'Next Actions') && next.total > 0, `core's Next Actions list holds ${next.total} tasks`);

    // (a) Next Actions, from the home screen as a widget's tap: core's title and rows; a row's swipe shows RN's action; its tap
    // opens the editor; Back, Back.
    sh('input keyevent KEYCODE_HOME');
    await waitFor('the home screen', () => front().includes(`${home}/`), 10_000);
    let nodes = await expectList('next', next, 'a');
    await sleep(800);
    shot('next');
    const [first] = rowTitles(nodes);
    const action = await device.revealAction(nodes, first);
    check(Boolean(action?.text || action?.['content-desc']), `(a) a row's swipe shows RN's action "${action?.text || action?.['content-desc']}" (not run)`);
    // Dragging back left closes the action without running it.
    {
        const row = taskRows(await screen()).find((node) => node.text === first) ?? fail(`no row ${first}`);
        const [x1, y1, x2, y2] = box(row);
        const y = Math.round((y1 + y2) / 2);
        requireAppFront();
        sh(`input swipe ${Math.round(x2 - 40)} ${y} ${Math.max(x1 + 10, 160)} ${y} 300`);
        await waitFor('the action to close', (current) => !current.some((node) => (node['resource-id'] ?? '').endsWith('swipe-action')), 8_000);
    }
    nodes = await tapExpecting(taskRows(await screen()).find((node) => node.text === first) ?? fail(`no row ${first}`), inEditor, `the editor for ${first}`);
    check(nodes.some((node) => node.text === first), `(a) the row's tap opens the editor on ${first}`);
    nodes = await backTo((current) => !inEditor(current) && header(current, next.title), 'the widget list again');
    check(true, '(a) Back closes the editor onto the widget list');
    await backTo(onInbox, 'the tabs');
    check(true, '(a) Back leaves the widget list');

    // (b) The device's first saved filter, by its id.
    if (filterId) {
        const view = seen.views[filterId];
        check(view.found, `core finds the saved filter ${filterId} ("${view.title}", ${view.total} tasks)`);
        await expectList(filterId, view, 'b');
        await backTo(onInbox, 'the tabs');
    } else {
        console.log('skip - (b) the device has no saved filter');
    }

    // (c) A saved filter that is gone: core's "No results" title and empty line, no row.
    const missing = seen.views[gone];
    check(!missing.found && missing.title === en['search.noResults'] && missing.empty === en['search.noResults'], 'core answers a gone filter with "No results"');
    nodes = await expectList(gone, missing, 'c');
    check(taskRows(nodes).length === 0 && nodes.filter((node) => node.text === missing.empty).length === 2, '(c) the header and the empty line read "No results", with no row');
    shot('gone');
    check(!button(nodes, en['common.more']), '(c) no More');
    await backTo(onInbox, 'the tabs');
    console.log('Widget list device check passed');
} catch (error) {
    evidenced(error);
    console.error(error instanceof Stopped ? `STOPPED: ${error.message}` : `FAIL: ${error.message}`);
    process.exitCode = error instanceof Stopped ? 3 : 1;
} finally {
    await restore();
}
