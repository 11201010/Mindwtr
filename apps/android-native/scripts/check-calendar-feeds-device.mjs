// External calendars check for the isolated native Android development app (pass C3): Settings › Advanced › Calendar's ICS
// subscriptions, and their events in the Calendar and the reviews, against a local ICS server only.
//
//   node apps/android-native/scripts/check-calendar-feeds-device.mjs <adb-serial> [apk]
//
// Serves a calendar on this computer (calendar-feed-server.mjs, 127.0.0.1:<port>, MINDWTR_CALENDAR_PORT or 18783) and maps the
// phone's port to it (`adb reverse`). Then, through the app's own screens:
//   (1) Settings › Advanced › Calendar opens with RN's cards (push, device calendars) and the subscription form; the device
//       calendars stay off (this check never reads the phone's own calendars);
//   (2) Add stores the subscription under RN's key in RKStorage and in the synced settings, and the list shows it; a URL with a
//       user name and password shows masked, and neither URL reaches the write journal, the diagnostics log or logcat;
//   (3) Test answers RN's toast ("Loaded N events"); no request carries an Origin header (#1309);
//   (4) the Calendar's week shows the feed's events, the load's diagnostics line names it, and an event's sheet offers RN's
//       Create task (no Open in calendar: a subscription's event has no calendar app to open it);
//   (5) the Weekly and the Daily Review load their own external calendars;
//   (6) a subscription answering 403, 500, a body cut short, or a declared body past the limit: Test answers RN's failure toast,
//       nothing stored changes, and the Calendar shows the feed's events no more;
//   (7) Remove takes the subscription out of RKStorage and the synced settings;
//   (8) on an emulator only (never the test phone: it would read the owner's calendars): a local calendar and event seeded
//       through the calendar provider; the device calendars switch asks with the system prompt (Don't allow: RN's denied
//       text; Grant access asks again; Allow: the calendar listed), the Calendar's week shows the device event, and its sheet
//       offers Open in calendar, which hands it to the calendar app. The switch goes off and the seeded calendar is deleted.
// It installs with `install -r` (development data stays), touches only the development package, and on exit removes the port
// mapping and stops the server. Exit 0 = pass, 1 = fail, 2 = refused, 3 = stopped.
import { execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { box, button, check, chipOn, connect, evidenced, fail, hasText, inEditor, mainList, Stopped, tab, tagged, withDescription } from './device.mjs';
import { cleanupOnExit } from './check-net-device.mjs';
import { icsCalendar, serveCalendar } from './calendar-feed-server.mjs';

const [serial, apkArg] = process.argv.slice(2);
if (!serial) {
    console.error('usage: node check-calendar-feeds-device.mjs <adb-serial> [apk]');
    process.exit(2);
}
const app = resolve(import.meta.dirname, '..');
const repo = resolve(app, '../..');
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
const TAG = 'MindwtrNativeDev';
const UI_FILE = '/data/local/tmp/mindwtr-native-dev-ui.xml';
const DB = 'mindwtr-native-dev.db';
const work = resolve(app, 'android/build/calendar-check');
const { en } = await import(resolve(repo, 'packages/core/src/i18n/locales/en.ts'));

// This run's names: letters and digits only for what the phone types.
const run = `${String(Date.now()).slice(-6)}${String(randomInt(1_000_000)).padStart(6, '0')}`;
const PORT = Number(process.env.MINDWTR_CALENDAR_PORT ?? 18783);
const FEED = `feed${run}`;
const URL = `http://127.0.0.1:${PORT}/${FEED}.ics`;
const SECRET = `pw${run}`;
const AUTH_URL = `http://u${run}:${SECRET}@127.0.0.1:${PORT}/auth${run}.ics`;
const NAME = `Team${run}`;
const EVENTS = { timed: `Standup ${run}`, allDay: `Offsite ${run}` };
/** Events this month the Test counts (core's getCalendarTestRange): today's, and tomorrow's when it is still this month. */
const thisMonth = new Date(Date.now() + 86_400_000).getMonth() === new Date().getMonth() ? 2 : 1;

const device = connect({ serial, pkg: PKG, uiFile: UI_FILE, adb: adbBin });
const { sh, home, front, requireAppFront, pid, screen, waitFor, tap, tapExpecting } = device;
const logs = () => device.logs(pid(), TAG);

// ---- The phone's storage (run-as copies, read on this computer) ----
const pullFile = (remote, name) => {
    const dir = resolve(work, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const base = remote.split('/').pop();
    const folder = remote.slice(0, remote.length - base.length - 1);
    const present = sh(`run-as ${PKG} ls ${folder}`).split(/\s+/);
    for (const suffix of ['', '-wal', '-shm', '-journal']) if (present.includes(`${base}${suffix}`)) device.pull(`${remote}${suffix}`, resolve(dir, `${base}${suffix}`));
    return resolve(dir, base);
};
const sqlite = (file, sql) => {
    const out = execFileSync('sqlite3', ['-json', file, sql], { encoding: 'utf8' }).trim();
    return out ? JSON.parse(out) : [];
};
const synced = () => JSON.parse(sqlite(pullFile(`files/${DB}`, 'db'), 'SELECT data FROM settings WHERE id = 1')[0]?.data ?? '{}').externalCalendars ?? null;
const deviceCopy = () => JSON.parse(Object.fromEntries(sqlite(pullFile('databases/RKStorage', 'rk'), 'SELECT key, value FROM catalystLocalStorage')
    .map((row) => [row.key, row.value]))['mindwtr-external-calendars'] ?? 'null');
const stored = () => JSON.stringify({ synced: synced(), device: deviceCopy() });
const grepApp = (text, folders) => sh(`run-as ${PKG} sh -c "grep -rl '${text}' ${folders} 2>/dev/null || true"`).split(/\s+/).filter(Boolean);

// ---- UI (core's English) ----
const sheetOpen = (nodes) => Boolean(tagged(nodes, 'more-sheet'));
const onCalendarSettings = (nodes) => Boolean(tagged(nodes, 'settings-calendar'));
const onCalendar = (nodes) => Boolean(tagged(nodes, 'calendar'));
const keyboardShown = () => /mInputShown=true/.test(sh('dumpsys input_method'));
const hideKeyboard = async () => {
    if (!keyboardShown()) return;
    requireAppFront();
    sh('input keyevent KEYCODE_BACK');
    await sleep(600);
};
const toTabs = async () => {
    for (let step = 0; step < 10; step += 1) {
        const nodes = await screen();
        if (tab(nodes, en['tab.menu']) && !tagged(nodes, 'menu-screen') && !sheetOpen(nodes) && !inEditor(nodes) && !tagged(nodes, 'weekly-review')
            && !tagged(nodes, 'daily-review')) return nodes;
        await hideKeyboard();
        requireAppFront();
        sh('input keyevent KEYCODE_BACK');
        await sleep(1000);
    }
    return fail('the tabs did not come back');
};
const reveal = async (find, description) => {
    let nodes = await device.toTop();
    const inView = (current) => {
        const node = find(current);
        const list = mainList(current);
        return node && (!list || (box(node)[1] >= box(list)[1] && box(node)[3] <= box(list)[3] - 40)) ? node : null;
    };
    for (let step = 0; step < 20 && !inView(nodes); step += 1) nodes = await device.swipe(nodes, 'down');
    return inView(nodes) ?? fail(`no ${description} on screen`);
};
const openTile = async (label, done, description) => {
    let nodes = await toTabs();
    nodes = await tapExpecting(tab(nodes, en['tab.menu']) ?? fail('no Menu tab'), sheetOpen, 'the More sheet');
    return tapExpecting(withDescription(await device.settle(nodes), label) ?? fail(`no ${label} tile`), done, description);
};
const openCalendarSettings = async () => {
    if (onCalendarSettings(await screen())) return screen();
    await openTile(en['nav.settings'], (next) => Boolean(tagged(next, 'settings-main')), 'Settings');
    await tapExpecting(await reveal((next) => withDescription(next, `${en['settings.advanced']}. ${en['settings.menuDesc.advanced']}`), 'Advanced row'),
        (next) => Boolean(tagged(next, 'settings-advanced')), 'Settings › Advanced');
    return tapExpecting(await reveal((next) => withDescription(next, `${en['settings.calendar']}. ${en['settings.menuDesc.calendar']}`), 'Calendar row'),
        onCalendarSettings, 'Settings › Calendar', 30_000);
};
const typeInto = async (tag, text) => {
    const node = await reveal((current) => tagged(current, tag), tag);
    await device.focusAtEnd(node);
    requireAppFront();
    sh('input keycombination KEYCODE_CTRL_LEFT KEYCODE_A');
    sh('input keyevent KEYCODE_DEL');
    sh(`input text '${text}'`);
    await waitFor(`"${text.slice(0, 20)}…" in ${tag}`, (current) => tagged(current, tag)?.text === text, 15_000);
};
const tapTag = async (tag, expected, description, timeoutMs = 30_000) => {
    await hideKeyboard();
    return tapExpecting(await reveal((current) => tagged(current, tag), tag), expected, description, timeoutMs);
};
/** The subscription list's row whose name is [name] (its index tag `calendar-feed-<n>`). */
const feedRow = (nodes, name) => nodes.find((node) => /calendar-feed-\d+$/.test(node['resource-id'] ?? '')
    && nodes.some((inner) => inner.text === name && box(inner)[1] >= box(node)[1] && box(inner)[3] <= box(node)[3]));
const removeFeed = async (name) => {
    const nodes = await openCalendarSettings();
    const row = feedRow(await reveal((current) => feedRow(current, name), `${name}'s row`), name) ?? feedRow(nodes, name);
    const index = /calendar-feed-(\d+)$/.exec(row['resource-id'])[1];
    await tapTag(`calendar-feed-${index}-remove`, (current) => !current.some((node) => node.text === name), `${name} removed`);
};
/** Test, and the toast it shows: RN's [expected] message. */
const testFeeds = async (expected) => {
    const before = logs().split('\n').filter((line) => line.includes('command=testCalendarFeeds')).length;
    await openCalendarSettings();
    await tapTag('calendar-test', (current) => hasText(current, expected), `the Test toast "${expected}"`, 60_000);
    await waitFor('the Test toast in the log', () => logs().split('\n').filter((line) => line.includes('command=testCalendarFeeds')).length > before, 10_000);
};
const calendarMode = async (label) => {
    const nodes = await waitFor(`the ${label} mode`, (current) => Boolean(withDescription(current, label)), 15_000);
    if (!chipOn(nodes, label)) await tap(withDescription(nodes, label));
    return waitFor(`the ${label} view`, (current) => chipOn(current, label), 15_000);
};
const eventBlock = (nodes, title) => nodes.find((node) => (node['content-desc'] ?? '').includes(title));
const feedLines = (slot) => logs().split('\n').filter((line) => line.includes('Native Android external calendars loaded') && line.includes(`"slot":"${slot}"`));
const restart = async () => {
    await device.stopApp();
    await waitFor('home screen', () => front().includes(`${home}/`), 10_000);
    device.launch(ACTIVITY);
    return waitFor('the tabs', (current) => Boolean(tab(current, en['tab.inbox'])), 60_000);
};

let server = null;
const added = new Set();
/** The emulator's seeded calendar (step 8), deleted on any exit. */
let seededCalendar = null;
const cleanup = cleanupOnExit([
    () => execFileSync(adbBin, ['-s', serial, 'reverse', '--remove', `tcp:${PORT}`], { stdio: 'ignore' }),
    () => { void server?.close(); },
    () => { if (seededCalendar) sh(`content delete --uri 'content://com.android.calendar/calendars?caller_is_syncadapter=true&account_name=check&account_type=LOCAL' --where "_id=${seededCalendar}"`); },
    () => sh(`rm -f ${UI_FILE}`),
]);

try {
    console.log(`device: ${sh('getprop ro.product.model')} / Android ${sh('getprop ro.build.version.release')} (API ${sh('getprop ro.build.version.sdk')})`);
    console.log(`apk: ${apk}\napk sha256: ${createHash('sha256').update(readFileSync(apk)).digest('hex')}\nrun: ${run}`);
    const beforeInstall = front();
    if (!beforeInstall.includes(`${PKG}/`) && !beforeInstall.includes(`${home}/`)) throw new Stopped(`another app is in front: ${beforeInstall.trim()}`);
    server = await serveCalendar(PORT, icsCalendar(EVENTS));
    execFileSync(adbBin, ['-s', serial, 'reverse', `tcp:${PORT}`, `tcp:${PORT}`], { stdio: 'inherit' });
    execFileSync(adbBin, ['-s', serial, 'install', '-r', apk], { stdio: 'inherit' });
    await restart();

    // (1) The screen, RN's cards; the device calendars are never turned on here.
    let nodes = await openCalendarSettings();
    check(Boolean(tagged(nodes, 'calendar-push')), '(1) Settings › Calendar opens with the push card');
    check(Boolean(tagged(nodes, 'calendar-device')), '(1) and the device calendars card');
    check(Boolean(await reveal((current) => tagged(current, 'calendar-url'), 'URL field')), '(1) and the subscription form');

    // (2) Add, and a URL with credentials.
    await typeInto('calendar-name', NAME);
    await typeInto('calendar-url', URL);
    await tapTag('calendar-add', (current) => Boolean(feedRow(current, NAME)), `${NAME} in the list`);
    added.add(NAME);
    check(deviceCopy()?.some((feed) => feed.url === URL && feed.name === NAME) === true, '(2) Add stored the subscription under RN\'s key in RKStorage');
    check(synced()?.some((feed) => feed.url === URL) === true, '(2) and in the synced settings');
    const authName = `Auth${run}`;
    await typeInto('calendar-name', authName);
    await typeInto('calendar-url', AUTH_URL);
    nodes = await tapTag('calendar-add', (current) => Boolean(feedRow(current, authName)), `${authName} in the list`);
    added.add(authName);
    nodes = await reveal((current) => feedRow(current, authName), `${authName}'s row`);
    check(!nodes.some((node) => (node.text ?? '').includes(SECRET) || (node['content-desc'] ?? '').includes(SECRET)), '(2) a URL\'s password never shows (masked)');
    check(grepApp(SECRET, 'files/journal files/logs').length === 0 && grepApp(FEED, 'files/journal files/logs').length === 0,
        '(2) no subscription URL reaches the write journal or the diagnostics log');
    check(!logs().includes(SECRET) && !logs().includes(`${FEED}.ics`), '(2) nor logcat');
    await removeFeed(authName);
    added.delete(authName);

    // (3) Test; no Origin header.
    await testFeeds(`Loaded ${thisMonth} events`);
    check(true, `(3) Test answers RN's toast "Loaded ${thisMonth} events"`);
    check(server.state.seen.length > 0 && server.state.seen.every((entry) => entry.origin === null), `(3) no request carries an Origin header (${server.state.seen.length} requests)`);

    // (4) The Calendar's week: the feed's events; the event's sheet.
    const linesBefore = feedLines('calendar').length;
    nodes = await openTile(en['nav.calendar'], onCalendar, 'the Calendar');
    await calendarMode(en['calendar.mobile.week']);
    nodes = await waitFor('the feed\'s events in the week', (current) => Boolean(eventBlock(current, EVENTS.timed)) && Boolean(eventBlock(current, EVENTS.allDay)), 45_000);
    check(true, `(4) the Calendar's week shows "${EVENTS.timed}" and the all-day "${EVENTS.allDay}"`);
    await waitFor('the load\'s diagnostics line', () => feedLines('calendar').length > linesBefore, 15_000);
    const line = feedLines('calendar').at(-1);
    check(line.includes('"outcome":"ready"') && line.includes('"releaseCheck":"v1.3.5/native-android-calendar-feeds"') && !line.includes('127.0.0.1'),
        '(4) the load\'s line: slot calendar, outcome ready, no URL');
    nodes = await tapExpecting(eventBlock(nodes, EVENTS.timed), (current) => Boolean(tagged(current, 'calendar-sheet')), 'the event\'s sheet');
    check(Boolean(button(nodes, en['calendar.createTaskFromEvent'])) && !button(nodes, en['calendar.openInCalendar']),
        '(4) the event\'s sheet offers RN\'s Create task, and no Open in calendar for a subscription\'s event');
    await tapExpecting(button(nodes, en['common.cancel']) ?? fail('no Cancel'), (current) => !tagged(current, 'calendar-sheet'), 'the sheet closed');

    // (5) The reviews load their own.
    for (const [label, slot, tag] of [[en['review.openGuide'], 'weeklyReview', 'weekly-review'], [en['dailyReview.title'], 'dailyReview', 'daily-review']]) {
        const before = feedLines(slot).length;
        await openTile(en['nav.review'], (current) => Boolean(tagged(current, 'review-list')), 'Review');
        const choices = await tapExpecting(button(await screen(), en['review.startReview']) ?? fail('no Start Review'), (current) => Boolean(button(current, label)), 'the review choices');
        await tapExpecting(button(choices, label), (current) => Boolean(tagged(current, tag)), label);
        await waitFor(`the ${slot} load`, () => feedLines(slot).length > before, 30_000);
        const loaded = feedLines(slot).at(-1);
        check(loaded.includes('"outcome":"ready"') && /"eventCount":"[1-9]/.test(loaded), `(5) ${label} loads its external calendars (${/"eventCount":"(\d+)"/.exec(loaded)?.[1]} events)`);
        await toTabs();
    }

    // (6) A subscription that fails: RN's failure toast, nothing stored changes, the Calendar shows its events no more.
    for (const mode of ['403', '500', 'truncated', 'oversized']) {
        server.state.mode(FEED, mode);
        const before = stored();
        await testFeeds(en['settings.calendarMobile.failedToLoadEvents']);
        check(stored() === before, `(6) ${mode}: Test answers RN's "${en['settings.calendarMobile.failedToLoadEvents']}", and nothing stored changed`);
    }
    nodes = await openTile(en['nav.calendar'], onCalendar, 'the Calendar');
    await calendarMode(en['calendar.mobile.week']);
    await sleep(3000);
    check(!eventBlock(await screen(), EVENTS.timed), '(6) the Calendar shows the failing subscription\'s events no more');
    server.state.mode(FEED, 'ok');

    // (7) Remove.
    await removeFeed(NAME);
    added.delete(NAME);
    check(!deviceCopy()?.some((feed) => feed.url === URL) && !synced()?.some((feed) => feed.url === URL), '(7) Remove took it out of RKStorage and the synced settings');
    check(server.state.seen.every((entry) => entry.origin === null), `(3) still no Origin header after ${server.state.seen.length} requests`);
    await toTabs();

    // (8) Device calendars: an emulator only.
    if (serial.startsWith('emulator-')) {
        const CAL = `Check${run}`;
        const DEVICE_EVENT = `Dentist ${run}`;
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0, 0).getTime();
        const calendarUri = 'content://com.android.calendar/calendars?caller_is_syncadapter=true&account_name=check&account_type=LOCAL';
        sh(`content insert --uri '${calendarUri}' --bind account_name:s:check --bind account_type:s:LOCAL --bind name:s:${CAL} --bind calendar_displayName:s:${CAL} --bind calendar_color:i:-16744448 --bind calendar_access_level:i:700 --bind ownerAccount:s:check --bind visible:i:1 --bind sync_events:i:1`);
        const calendarId = /_id=(\d+)/.exec(sh(`content query --uri content://com.android.calendar/calendars --projection _id --where "name='${CAL}'"`))?.[1] ?? fail('the seeded calendar has no id');
        seededCalendar = calendarId;
        sh(`content insert --uri content://com.android.calendar/events --bind calendar_id:i:${calendarId} --bind title:s:'${DEVICE_EVENT}' --bind dtstart:l:${start} --bind dtend:l:${start + 3_600_000} --bind eventTimezone:s:UTC`);
        for (const permission of ['READ_CALENDAR', 'WRITE_CALENDAR']) {
            sh(`pm revoke ${PKG} android.permission.${permission} || true`);
            sh(`pm clear-permission-flags ${PKG} android.permission.${permission} user-set user-fixed || true`);
        }
        await restart();
        const prompt = (current) => current.find((node) => /permission_(allow|deny)_button$/.test(node['resource-id'] ?? '')) !== undefined;
        const promptButton = (current, which) => current.find((node) => (node['resource-id'] ?? '').endsWith(`permission_${which}_button`));
        nodes = await openCalendarSettings();
        nodes = await tapTag('calendar-device-switch', prompt, 'the system prompt for the calendar');
        check(true, '(8) turning the device calendars on asks with the system prompt');
        await tap(promptButton(nodes, 'deny'));
        nodes = await waitFor('RN\'s denied text', (current) => hasText(current, en['settings.calendarAccessDenied']), 20_000);
        check(Boolean(tagged(nodes, 'calendar-grant')), `(8) Don't allow: RN's "${en['settings.calendarAccessDenied']}" with Grant access`);
        nodes = await tapTag('calendar-grant', prompt, 'the system prompt again');
        await tap(promptButton(nodes, 'allow'));
        nodes = await waitFor(`${CAL} listed`, (current) => hasText(current, CAL), 30_000);
        check(hasText(nodes, en['settings.deviceCalendar']), `(8) Allow: the device calendar ${CAL} is listed as RN lists it`);
        nodes = await openTile(en['nav.calendar'], onCalendar, 'the Calendar');
        await calendarMode(en['calendar.mobile.week']);
        nodes = await waitFor('the device event in the week', (current) => Boolean(eventBlock(current, DEVICE_EVENT)), 45_000);
        check(true, `(8) the Calendar's week shows the device event "${DEVICE_EVENT}"`);
        nodes = await tapExpecting(eventBlock(nodes, DEVICE_EVENT), (current) => Boolean(tagged(current, 'calendar-sheet')), 'the device event\'s sheet');
        check(Boolean(button(nodes, en['calendar.openInCalendar'])) && Boolean(button(nodes, en['calendar.createTaskFromEvent'])), '(8) its sheet offers Create task and Open in calendar');
        await tap(button(nodes, en['calendar.openInCalendar']));
        await sleep(3000);
        const opened = front();
        console.log(`note - Open in calendar: ${opened.includes(`${PKG}/`) ? 'the app stayed in front (no calendar app answered)' : `handed to ${opened.trim().split(/\s+/).pop()}`}`);
        sh('input keyevent KEYCODE_BACK');
        await sleep(1500);
        if (!front().includes(`${PKG}/`)) device.launch(ACTIVITY);
        nodes = await openCalendarSettings();
        await tapTag('calendar-device-switch', (current) => !hasText(current, CAL), 'the device calendars off');
        sh(`content delete --uri '${calendarUri}' --where "_id=${calendarId}"`);
        seededCalendar = null;
        await toTabs();
    } else console.log('note - (8) device calendars: not on the test phone (an emulator runs it)');
    console.log('Calendar feeds device check passed');
} catch (error) {
    try {
        console.log(`evidence - server saw: ${JSON.stringify(server?.state.seen.map(({ path, mode, origin, at }) => `${at} ${path?.replace(/\d{6,}/, '<run>')} ${mode} ${origin}`))}`);
        console.log(`evidence - app log (calendar):\n${logs().split('\n').filter((line) => /alendar/.test(line)).slice(-30).map((line) => line.slice(0, 300)).join('\n')}`);
    } catch { /* the app is gone */ }
    evidenced(error);
    for (const name of added) {
        try { await removeFeed(name); console.log(`note - removed this run's subscription ${name}`); } catch (cleanupError) { console.error(`RESTORE FAILED: ${name} stays: ${cleanupError.message}`); }
    }
    console.error(error instanceof Stopped ? `STOPPED: ${error.message}` : `FAIL: ${error.message}`);
    process.exitCode = error instanceof Stopped ? 3 : 1;
} finally {
    cleanup();
    await sleep(500);
    process.exit(process.exitCode ?? 0);
}
