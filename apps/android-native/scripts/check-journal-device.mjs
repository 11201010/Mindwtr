// Write-ahead journal check for the isolated native Android development app.
//
//   node apps/android-native/scripts/check-journal-device.mjs <adb-serial> [apk]
//
// Installs the debug APK with `install -r` (existing development data stays). For three writes, a create (an Inbox capture), a
// revision write (Mark Done on a task found by search) and a bulk write (Archived's Select all → Restore to Inbox), it stops the
// process through the debug property `debug.mindwtr.native.journal_stop` at two points: (a) after the journal write, before the
// engine call, and (b) after core's reply, before the journal delete. Each time it reads the journal entry on disk, relaunches,
// and proves from the app's own database copy (.db, -wal and -shm pulled together, read with sqlite3) that the write landed
// exactly once: the row count, and each task's revision exactly one write past where it started. It also checks that the boot's
// replay emptied the journal and logged its counts, and that a replay that left nothing (only such a one) pruned core's old
// receipts after it. (4) A boot replay under an injected failed save keeps its entry, and the screen's Try again sends it once
// saving works. It touches only the development package (it refuses any other APK), never
// launches over another app, restores rotation, and clears its debug properties on exit. Leave the device on its home screen.
// Exit 0 = pass, 1 = fail, 2 = refused before touching the device, 3 = stopped.
import { execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { box, button, check, connect, evidenced, fail, field, hasText, inboxCount, inEditor, owedRetry, Stopped, tab, tabSelected, tagged, taskRows, withDescription } from './device.mjs';

const [serial, apkArg] = process.argv.slice(2);
if (!serial) {
    console.error('usage: node check-journal-device.mjs <adb-serial> [apk]');
    process.exit(2);
}
const app = resolve(import.meta.dirname, '..');
const apk = apkArg ?? resolve(app, 'android/app/build/outputs/apk/debug/app-debug.apk');
const adbBin = process.env.ADB ?? '/home/dd/Android/Sdk/platform-tools/adb';
const aapt2 = process.env.AAPT2 ?? '/home/dd/Android/Sdk/build-tools/36.1.0/aapt2';
const PKG = 'tech.dongdongbh.mindwtr.nativeclient.dev';
const apkPackage = execFileSync(aapt2, ['dump', 'packagename', apk], { encoding: 'utf8' }).trim();
if (apkPackage !== PKG) {
    console.error(`REFUSED: ${apk} is package "${apkPackage}", not ${PKG}`);
    process.exit(2);
}
const ACTIVITY = `${PKG}/tech.dongdongbh.mindwtr.pilot.MainActivity`;
const TAG = 'MindwtrNativeDev';
const UI_FILE = '/data/local/tmp/mindwtr-native-dev-ui.xml';
const PROPS = ['fail_commit', 'delay_before_ms', 'delay_after_ms', 'language', 'journal_stop'];
const DB = 'mindwtr-native-dev.db';
const work = resolve(app, 'android/build/journal-check');
const { en } = await import(resolve(app, '../../packages/core/src/i18n/locales/en.ts'));
// Digits only: the keyboard guard allows only an English layout, and digits never compose.
const run = `${String(Date.now()).slice(-6)}${String(randomInt(1_000_000)).padStart(6, '0')}`;
const titles = {
    create: { before: `71${run}`, after: `72${run}` },
    done: { before: `73${run}`, after: `74${run}` },
    bulk: { before: [`75${run}1`, `75${run}2`], after: [`76${run}1`, `76${run}2`] },
    owed: { before: `77${run}` },
};

const device = connect({ serial, pkg: PKG, uiFile: UI_FILE, adb: adbBin });
const { sh, home, front, requireAppFront, pid, screen, waitFor, tap, tapExpecting } = device;
const setProp = (name, value) => sh(`setprop debug.mindwtr.native.${name} '${value}'`);
const logs = (processId) => device.logs(processId, TAG);

// ---- the app's database and journal ----
const pullDatabase = () => {
    const dir = resolve(work, 'db');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const present = sh(`run-as ${PKG} ls files`).split(/\s+/);
    for (const suffix of ['', '-wal', '-shm']) if (present.includes(`${DB}${suffix}`)) device.pull(`files/${DB}${suffix}`, resolve(dir, `${DB}${suffix}`));
    return resolve(dir, DB);
};
/** The live tasks titled [title] as stored: id, status and revision. */
const stored = (title) => {
    const out = execFileSync('sqlite3', ['-json', pullDatabase(), `SELECT id, status, rev FROM tasks WHERE title = '${title}' AND deletedAt IS NULL`], { encoding: 'utf8' }).trim();
    return out ? JSON.parse(out) : [];
};
/** The journal's entries (`files/journal/<sequence>.json`), oldest first, each as its method and exact arguments. */
const journal = () => sh(`run-as ${PKG} ls files/journal`).split(/\s+/).filter((name) => /^\d{16}\.json$/.test(name)).sort()
    .map((name) => ({ name, ...JSON.parse(sh(`run-as ${PKG} cat files/journal/${name}`)) }));
const aside = () => sh(`run-as ${PKG} ls files/journal/aside 2>/dev/null || true`).split(/\s+/).filter(Boolean);

// ---- UI (core's English) ----
const inPopup = (nodes) => Boolean(tagged(nodes, 'quick-capture'));
const onInbox = (nodes) => !inPopup(nodes) && !tagged(nodes, 'menu-screen') && !tagged(nodes, 'global-search') && !inEditor(nodes)
    && tabSelected(nodes, en['tab.inbox']) && Number.isFinite(inboxCount(nodes));
const inSearch = (nodes) => Boolean(tagged(nodes, 'global-search')) && !inEditor(nodes);
const sheetOpen = (nodes) => Boolean(tagged(nodes, 'more-sheet'));
const onArchived = (nodes) => Boolean(tagged(nodes, 'menu-screen')) && hasText(nodes, en['nav.history']) && tabSelected(nodes, en['nav.archived']);
// A clickable row's label can sit on a child node with the row's own bounds (Archived's rows): read it there.
const rowLabel = (nodes, row) => row.text || row['content-desc']
    || nodes.find((node) => node !== row && node.bounds === row.bounds && (node.text || node['content-desc']))?.['content-desc'] || '';
const rowTitles = (nodes) => taskRows(nodes).sort((a, b) => box(a)[1] - box(b)[1]).map((node) => rowLabel(nodes, node));
const results = (nodes) => nodes.filter((node) => (node['resource-id'] ?? '').endsWith('search-result')).map((node) => node['content-desc'] || node.text);
/** Back until the Inbox tab shows (a relaunch can restore search or History), then the Inbox tab itself. */
const toInbox = async () => {
    for (let step = 0; step < 6; step += 1) {
        const nodes = await screen();
        if (onInbox(nodes)) return nodes;
        requireAppFront();
        if (tagged(nodes, 'menu-screen') || inSearch(nodes) || inPopup(nodes) || sheetOpen(nodes) || inEditor(nodes)) {
            if (/mInputShown=true/.test(sh('dumpsys input_method'))) sh('input keyevent KEYCODE_BACK');
            sh('input keyevent KEYCODE_BACK');
            await sleep(1200);
        } else if (tab(nodes, en['tab.inbox']) && !tabSelected(nodes, en['tab.inbox'])) {
            await tap(tab(nodes, en['tab.inbox']));
        } else {
            await sleep(1000);
        }
    }
    return waitFor('the Inbox', onInbox, 30_000);
};
/** Opens the capture popup and types [text] ('%s' is a space for `input text`) until the field reads [shown]. */
const typeCapture = async (text, shown) => {
    // A popup that a relaunch or an earlier run brought back keeps its draft: close it first (RN's Close discards it).
    let nodes = await screen();
    if (inPopup(nodes) && tagged(nodes, 'capture-title')?.text) {
        nodes = await tapExpecting(withDescription(nodes, en['common.close']) ?? fail('no Close in the popup'), (current) => !inPopup(current), 'the kept popup to close');
    }
    nodes = await device.openCapture();
    await device.focusAtEnd(tagged(nodes, 'capture-title') ?? fail('no capture field'));
    requireAppFront();
    sh(`input text '${text}'`);
    return waitFor(`"${shown}" in the capture field`, (current) => tagged(current, 'capture-title')?.text === shown, 15_000);
};
/** A capture saved with no stop: the popup closes on Save, as in RN. */
const capture = async (text, shown) => {
    await typeCapture(text, shown);
    await tapExpecting(button(await screen(), en['common.save']) ?? fail('no Save'), onInbox, 'the capture to close the popup');
};
/** The header's Search, with [query] typed; waits for its one result. */
const searchFor = async (query) => {
    let nodes = await toInbox();
    nodes = await tapExpecting(withDescription(nodes, en['search.title']) ?? fail('no Search button in the header'), inSearch, 'the search screen');
    await device.focusAtEnd(field(nodes) ?? fail('no search field'));
    requireAppFront();
    sh(`input text ${query}`);
    return waitFor(`the result ${query}`, (current) => JSON.stringify(results(current)) === JSON.stringify([query]), 20_000);
};
/** History › Archived with [query] in its search box (a kept query is deleted first); waits for [rows]. */
const archivedWith = async (query, rows) => {
    let nodes = await toInbox();
    nodes = await tapExpecting(tab(nodes, en['tab.menu']) ?? fail('no Menu tab'), sheetOpen, 'the More sheet');
    nodes = await tapExpecting(withDescription(await device.settle(nodes), en['nav.history']) ?? fail('no History tile'),
        (current) => Boolean(tagged(current, 'menu-screen')) && hasText(current, en['nav.history']), 'History');
    if (!tabSelected(nodes, en['nav.archived'])) nodes = await tapExpecting(tab(nodes, en['nav.archived']), onArchived, 'the Archived tab');
    const searchBox = withDescription(nodes, en['common.search']) ?? fail('no search box');
    await device.focusAtEnd(searchBox);
    requireAppFront();
    const kept = nodes.find((node) => node.class === 'android.widget.EditText' && node.focused === 'true')?.text ?? searchBox.text ?? '';
    if (kept) sh(`input keyevent ${Array(kept.length + 2).fill('KEYCODE_DEL').join(' ')}`);
    sh(`input text ${query}`);
    return waitFor(`Archived's rows for ${query}`, (current) => JSON.stringify(rowTitles(current).sort()) === JSON.stringify([...rows].sort()), 20_000);
};

// ---- stop and relaunch ----
/**
 * Arms the stop at [at] for the write [op], runs [trigger] (the tap that sends it), and waits for the process to die. The stop
 * is disarmed at once: the relaunched app's own re-sends must run.
 */
const stopAt = async (at, op, trigger) => {
    const before = pid();
    setProp('journal_stop', `${at}:${op}`);
    try {
        await trigger();
        const deadline = Date.now() + 30_000;
        while (pid() === before) {
            if (Date.now() > deadline) fail(`the process did not stop ${at} ${op}`);
            await sleep(100);
        }
    } finally {
        setProp('journal_stop', '');
    }
    check(logs(before).includes(`Native Android journal stop at=${at} op=${op}`), `the process stopped ${at === 'before' ? 'after the journal write, before the engine call' : 'after core\'s reply, before the journal delete'} (${op})`);
    return before;
};
/** The app again after a stop (the system may restart it by itself; else from the launcher), and its boot's replay line. */
const relaunch = async (stopped) => {
    await sleep(1500);
    if (!pid() || pid() === stopped) {
        await waitFor('the home screen or the app', () => front().includes(`${home}/`) || front().includes(`${PKG}/`), 15_000);
        device.launch(ACTIVITY);
    }
    let processId = '';
    const replay = await waitFor('the boot\'s journal replay', () => {
        processId = pid();
        return Boolean(processId) && logs(processId).includes('Native Android journal replay');
    }, 60_000).then(() => logs(processId).split('\n').find((line) => line.includes('Native Android journal replay')));
    return { processId, replay };
};
const replayed = (replay, sent, dropped) => replay.includes(`sent=${sent} dropped=${dropped} left=0 owed=none`);
const PRUNED = 'Native Android receipts pruned=';
/** A replay that left nothing prunes core's old receipts: the boot logs it after its replay line, never before. */
const prunedAfterReplay = async (processId) => {
    await waitFor('the boot\'s receipt prune', () => logs(processId).includes(PRUNED), 15_000);
    const text = logs(processId);
    return text.indexOf(PRUNED) > text.indexOf('Native Android journal replay');
};

const originalAccelerometer = sh('settings get system accelerometer_rotation');
const originalRotation = sh('settings get system user_rotation');
const restore = async () => {
    for (const name of PROPS) { try { setProp(name, ''); } catch { /* device gone */ } }
    try { if (front().includes(`${PKG}/`)) await toInbox(); } catch { /* the app is gone */ }
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
    await waitFor('the boot\'s journal replay', () => logs(pid()).includes('Native Android journal replay'), 60_000);
    // A capture popup the boot brings back appears just after the lists: let the screen settle first.
    await device.settle();
    await toInbox();
    // The boot replayed whatever an earlier check's process death left; the checks below start from an empty journal.
    check(journal().length === 0 && aside().length === 0, 'the journal starts empty, with nothing set aside');
    check(Object.values(titles).flatMap((pair) => Object.values(pair).flat()).every((title) => stored(title).length === 0), 'this run\'s titles are not stored yet');

    // (1) A create: the Inbox capture (its capture UUID names the task).
    for (const at of ['before', 'after']) {
        const title = titles.create[at];
        await toInbox();
        await typeCapture(title, title);
        const stopped = await stopAt(at, 'captureSubmit', async () => tap(button(await screen(), en['common.save']) ?? fail('no Save')));
        const [entry, ...more] = journal();
        const request = JSON.parse(entry?.args?.[0] ?? '{}');
        check(more.length === 0 && entry.method === 'captureSubmit' && request.text === title && Boolean(request.captureId),
            `(1${at === 'before' ? 'a' : 'b'}) the journal holds the capture's exact request, with its capture UUID`);
        const id = request.captureId.toLowerCase();
        const atStop = stored(title);
        if (at === 'before') check(atStop.length === 0, '(1a) nothing is stored: the engine never saw the request');
        else check(atStop.length === 1 && atStop[0].id === id, '(1b) the row is stored under the capture UUID, and the entry is still on disk');
        const { replay, processId } = await relaunch(stopped);
        check(replayed(replay, 1, 1), `(1${at === 'before' ? 'a' : 'b'}) the boot replayed the entry and dropped it after core's reply: ${replay.split('journal replay ')[1]}`);
        check(await prunedAfterReplay(processId), `(1${at === 'before' ? 'a' : 'b'}) the boot pruned core's old receipts after the replay`);
        // The popup's own owed request comes back too; core answers it from the same task.
        await waitFor('the popup to settle', (nodes) => !inPopup(nodes) && Number.isFinite(inboxCount(nodes)), 30_000);
        const rows = stored(title);
        check(rows.length === 1 && rows[0].id === id && rows[0].rev === (at === 'before' ? 1 : atStop[0].rev),
            `(1${at === 'before' ? 'a' : 'b'}) one row, the task with the capture UUID, written once (rev ${rows[0]?.rev}): no duplicate, no lost write`);
        check(journal().length === 0, `(1${at === 'before' ? 'a' : 'b'}) the journal is empty`);
    }

    // (2) A revision write: Mark Done on a task found by search (core's completeTask with the row's taskRevision).
    for (const at of ['before', 'after']) {
        const title = titles.done[at];
        await toInbox();
        await capture(title, title);
        const [start] = stored(title);
        check(start?.status === 'inbox', `(2${at === 'before' ? 'a' : 'b'}) the task is in the Inbox at rev ${start?.rev}`);
        const nodes = await searchFor(title);
        const stopped = await stopAt(at, 'complete', async () => tap(withDescription(nodes, en['review.markDone']) ?? fail('no Mark Done on the result')));
        const [entry, ...more] = journal();
        check(more.length === 0 && entry.method === 'complete' && entry.args[0] === start.id && typeof entry.args[1] === 'string' && entry.args[1].length > 0,
            `(2${at === 'before' ? 'a' : 'b'}) the journal holds the exact request: the task and the revision its row showed`);
        const [atStop] = stored(title);
        if (at === 'before') check(atStop.status === 'inbox' && atStop.rev === start.rev, '(2a) nothing is written: the engine never saw the request');
        else check(atStop.status === 'done' && atStop.rev === start.rev + 1, '(2b) Done is stored once, and the entry is still on disk');
        const { replay } = await relaunch(stopped);
        check(replayed(replay, 1, 1), `(2${at === 'before' ? 'a' : 'b'}) the boot replayed the entry and dropped it after core's reply: ${replay.split('journal replay ')[1]}`);
        const [end, ...twins] = stored(title);
        check(twins.length === 0 && end.status === 'done' && end.rev === start.rev + 1,
            `(2${at === 'before' ? 'a' : 'b'}) the task is done, exactly one write past its start (rev ${start.rev} → ${end.rev})`);
        check(journal().length === 0, `(2${at === 'before' ? 'a' : 'b'}) the journal is empty`);
    }

    // (3) A bulk write: Archived's Select all → Restore to Inbox (core's moveTasksToInbox on its stateless Select all).
    const selectAll = `${en['bulk.select']} ${en['common.all']}`;
    for (const at of ['before', 'after']) {
        const pair = titles.bulk[at];
        await toInbox();
        for (const title of pair) await capture(`${title}%s/archived`, `${title} /archived`);
        const start = pair.map((title) => stored(title)[0]);
        check(start.every((row) => row?.status === 'archived'), `(3${at === 'before' ? 'a' : 'b'}) the two tasks are archived at revs ${start.map((row) => row?.rev)}`);
        let nodes = await archivedWith(pair[0].slice(0, -1), pair);
        // A relaunch can bring Archived back already selecting.
        if (!button(nodes, selectAll)) nodes = await tapExpecting(button(nodes, en['bulk.select']) ?? fail('no Select'), (current) => Boolean(button(current, selectAll)), 'selection');
        nodes = await tapExpecting(button(nodes, selectAll), (current) => hasText(current, `2 ${en['bulk.selected']}`), 'Select all');
        const stopped = await stopAt(at, 'archiveAction', async () => tap(button(nodes, en['trash.restoreToInbox']) ?? fail('no Restore to Inbox')));
        const [entry, ...more] = journal();
        const input = JSON.parse(entry?.args?.[1] ?? '{}');
        check(more.length === 0 && entry.method === 'menuCommand' && entry.args[0] === 'archiveAction' && input.action?.type === 'moveTasksToInbox'
            && Boolean(input.action?.selectAll) && Boolean(input.requestId),
            `(3${at === 'before' ? 'a' : 'b'}) the journal holds the exact request: Select all's restore, with its request UUID`);
        const atStop = pair.map((title) => stored(title)[0]);
        if (at === 'before') check(atStop.every((row, index) => row.status === 'archived' && row.rev === start[index].rev), '(3a) nothing is written: the engine never saw the request');
        else check(atStop.every((row, index) => row.status === 'inbox' && row.rev === start[index].rev + 1), '(3b) both moves are stored once, and the entry is still on disk');
        const { replay } = await relaunch(stopped);
        check(replayed(replay, 1, 1), `(3${at === 'before' ? 'a' : 'b'}) the boot replayed the entry and dropped it after core's reply: ${replay.split('journal replay ')[1]}`);
        const end = pair.map((title) => stored(title));
        check(end.every((rows, index) => rows.length === 1 && rows[0].status === 'inbox' && rows[0].rev === start[index].rev + 1),
            `(3${at === 'before' ? 'a' : 'b'}) both tasks are in the Inbox, each exactly one write past its start (revs ${end.map((rows) => rows[0]?.rev)})`);
        check(journal().length === 0, `(3${at === 'before' ? 'a' : 'b'}) the journal is empty`);
    }
    // (4) A boot replay that meets a failed save (the injected commit failure) keeps its entry and stops; the screen opens on the
    // exact retry (Try again), which sends the journal's request again once saving works.
    {
        const title = titles.owed.before;
        await toInbox();
        await capture(title, title);
        const [start] = stored(title);
        const nodes = await searchFor(title);
        // Set before the stop, so a boot the system starts at once replays under it too; the stopped send never reached the engine.
        setProp('fail_commit', '1');
        const stopped = await stopAt('before', 'complete', async () => tap(withDescription(nodes, en['review.markDone']) ?? fail('no Mark Done on the result')));
        const { replay, processId } = await relaunch(stopped);
        check(replay.includes('sent=1 dropped=0 left=1 owed=SAVE_FAILED'), `(4) the boot's replay met the failed save, kept the entry and stopped: ${replay.split('journal replay ')[1]}`);
        const failed = (current) => current.some((node) => node.text?.includes('Injected commit failure'));
        const shown = await waitFor('the owed retry', (current) => Boolean(owedRetry(current)) && failed(current), 30_000);
        const [atFailure] = stored(title);
        check(journal().length === 1 && atFailure.status === 'inbox' && atFailure.rev === start.rev, '(4) the screen offers Try again; nothing is stored and the entry is still on disk');
        check(!logs(processId).includes(PRUNED), '(4) a replay that stopped with an entry left pruned no receipt');
        setProp('fail_commit', '');
        await tapExpecting(owedRetry(shown), (current) => !owedRetry(current) && !failed(current), 'Try again');
        await toInbox();
        const [end, ...twins] = stored(title);
        check(twins.length === 0 && end.status === 'done' && end.rev === start.rev + 1, `(4) Try again sent the journal's request: done, one write (rev ${start.rev} → ${end.rev})`);
        check(journal().length === 0, '(4) the journal is empty');
    }
    check(aside().length === 0, 'nothing was set aside');
    console.log('Journal device check passed');
} catch (error) {
    evidenced(error);
    console.error(error instanceof Stopped ? `STOPPED: ${error.message}` : `FAIL: ${error.message}`);
    process.exitCode = error instanceof Stopped ? 3 : 1;
} finally {
    await restore();
}
