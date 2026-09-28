import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';

const app = resolve(import.meta.dirname, '..');
const consoleState = {
    console: { info() { throw new Error('QuickJS stdout missing'); } },
    __mindwtrNative: { log() { throw new Error('logcat unavailable'); } },
};
vm.runInNewContext(readFileSync(resolve(app, 'bundle/host-polyfills.js'), 'utf8'), consoleState);
assert.doesNotThrow(() => consoleState.console.info('saved'));
// The URL polyfill parses a person's mailto: and tel: links as the platform URL does, so their open button shows.
for (const text of ['mailto:alex@example.com', 'tel:+1-555-0100', 'MAILTO:bea@example.com?subject=Hi', 'javascript:alert(1)', 'obsidian://people/alex', 'https://bea.example/fail']) {
    const parts = (url) => [url.protocol, url.pathname, url.search, url.hash, url.host, String(url)];
    assert.deepEqual(parts(new consoleState.URL(text)), parts(new URL(text)), text);
}
// QuickJS has no Intl: the polyfill's Collator and localeCompare sort by the host's ICU collation keys (one bridge call per
// text and options), so titles order as in RN; without the bridge they fall back to a plain comparison.
{
    const polyfills = readFileSync(resolve(app, 'bundle/host-polyfills.js'), 'utf8');
    const calls = [];
    // A stand-in for Android's keys: accents and case folded first, as ICU's primary level does.
    const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const bridge = { log() {}, collationKey(text, options) { calls.push(`${options}|${text}`); return fold(text) + (options.startsWith('base:') ? '' : `\u0001${text}`); } };
    const withKeys = vm.createContext({ console: { info() {} }, Intl: undefined, __mindwtrNative: bridge });
    vm.runInContext(polyfills, withKeys);
    assert.deepEqual([...vm.runInContext("['Zoo', 'éclair', 'apple'].sort(new Intl.Collator().compare)", withKeys)], ['apple', 'éclair', 'Zoo']);
    assert.equal(vm.runInContext("'éclair'.localeCompare('Zoo')", withKeys), -1, 'localeCompare uses the ICU keys');
    assert.equal(vm.runInContext("'ÉCLAIR'.localeCompare('eclair', undefined, { sensitivity: 'base' })", withKeys), 0);
    assert.equal(new Set(calls).size, calls.length, 'one key per text and options');
    assert.equal(vm.runInContext("Object.keys(String.prototype).includes('localeCompare')", withKeys), false);
    const noKeys = vm.createContext({ console: { info() {} }, Intl: undefined, __mindwtrNative: { log() {} } });
    vm.runInContext(polyfills, noKeys);
    assert.deepEqual([...vm.runInContext("['b', 'a', 'C'].sort(new Intl.Collator().compare)", noKeys)], ['C', 'a', 'b'], 'the fallback without the bridge');
}
const coreHost = readFileSync(resolve(app, 'android/app/src/main/java/tech/dongdongbh/mindwtr/pilot/core/CoreHost.kt'), 'utf8');
const sqliteBridge = readFileSync(resolve(app, 'android/app/src/main/java/tech/dongdongbh/mindwtr/pilot/core/SqliteBridge.kt'), 'utf8');
const hostEntry = readFileSync(resolve(app, 'bundle/host-entry.ts'), 'utf8');
assert.match(hostEntry, /new ValidatedSqliteAdapter\(sqlite, \{ rejectConcurrentWrites: true \}\)/);
assert.match(sqliteBridge, /PRAGMA synchronous = FULL/);
// Nothing writes the RN database before its .prewrite snapshot: the open sets only foreign_keys (a connection
// setting), and WAL (which rewrites a rollback-journal header) and synchronous follow VACUUM INTO or the
// validated existing snapshot.
const bridgeOpen = sqliteBridge.slice(sqliteBridge.indexOf('private val connection'), sqliteBridge.indexOf('private val statements'));
assert.deepEqual(bridgeOpen.match(/PRAGMA [^"]*/g), ['PRAGMA foreign_keys = ON']);
const bridgeCheckpoint = sqliteBridge.slice(sqliteBridge.indexOf('fun ensureRecoveryCheckpoint'), sqliteBridge.indexOf('private fun syncCheckpoint'));
const pragmaOrder = ['checkIntegrity(connection)', 'syncCheckpoint(checkpointFile)', 'exec("VACUUM INTO', 'syncDirectory(checkpointFile.parentFile!!)',
    'exec("PRAGMA journal_mode = WAL")', 'exec("PRAGMA synchronous = FULL")'].map((text) => bridgeCheckpoint.indexOf(text));
assert(pragmaOrder.every((index, i) => index > (i ? pragmaOrder[i - 1] : -1)), `SQLite pragma order ${pragmaOrder}`);
assert.equal(sqliteBridge.match(/journal_mode|synchronous =/g).length, 2);
assert.doesNotMatch(bridgeCheckpoint, /\breturn\b/);
assert.match(sqliteBridge, /syncFile\(partial\)[\s\S]*?renameTo\(checkpointFile\)[\s\S]*?syncDirectory/);
assert(coreHost.indexOf('database.ensureRecoveryCheckpoint()') < coreHost.indexOf('engine.evaluate(bundle'));
assert(coreHost.indexOf('database.ensureRecoveryCheckpoint()') < coreHost.indexOf('callAsync("boot", legacyState, legacyBackup)'));
const source = (name) => readFileSync(resolve(app, 'android/app/src/main/java/tech/dongdongbh/mindwtr/pilot', name), 'utf8');
const activity = source('MainActivity.kt');
const model = source('InboxViewModel.kt');
const owner = source('ProcessCoreHost.kt');
const editorUi = source('TaskEditor.kt');
const focusUi = source('FocusScreen.kt');
const projectsUi = source('ProjectsScreen.kt');
const labelsKt = source('Labels.kt');
const rowUi = source('TaskRowView.kt');
const areaUi = source('AreaSwitcher.kt');
const viewStateKt = source('ViewState.kt');
const searchUi = source('SearchScreen.kt');
const processUi = source('ProcessInbox.kt');
const captureUi = source('CaptureScreen.kt');
// The Menu tab (pass 6): its model, the More sheet, the shared widgets, and one file per list screen.
const menuModel = source('MenuModel.kt');
const moreUi = source('MoreSheet.kt');
const menuUi = source('MenuWidgets.kt');
const waitingUi = source('WaitingScreen.kt');
const somedayUi = source('SomedayScreen.kt');
const statusListUi = source('StatusListScreen.kt');
const archiveUi = source('ArchiveScreen.kt');
// Pass 7: Contexts, Trash, Review and the Weekly and Daily Review, each in its own file, and core's list actions they send.
const contextsUi = source('ContextsScreen.kt');
const trashUi = source('TrashScreen.kt');
const reviewUi = source('ReviewScreen.kt');
const weeklyUi = source('WeeklyReviewScreen.kt');
const dailyUi = source('DailyReviewScreen.kt');
const listActionsKt = source('ListActions.kt');
const reviewScreens = { contextsUi, trashUi, reviewUi, weeklyUi, dailyUi, listActionsKt };
// Pass 9: the Inbox tab on its view contract, the lists' selection mode (the bulk bar and its dialogs), and Focus's controls.
const inboxUi = source('InboxScreen.kt');
const bulkUi = source('BulkBar.kt');
const focusControlsUi = source('FocusControls.kt');
const focusModelKt = source('FocusModel.kt');
// Pass 11: a saved search's screen draws the menu list machinery's page (its model is MenuModel's).
const savedSearchUi = source('SavedSearchScreen.kt');
const menuScreens = { moreUi, menuUi, waitingUi, somedayUi, statusListUi, archiveUi, ...reviewScreens, inboxUi, bulkUi, focusControlsUi, savedSearchUi };
const snapshotsKt = readFileSync(resolve(app, 'android/app/src/main/java/tech/dongdongbh/mindwtr/pilot/core/RecoverySnapshots.kt'), 'utf8');
// Comments may name the rules below; only code is checked against them.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
// A failed read offers Try again; while a failed command's retry is owed, nothing else is offered.
assert.match(activity, /if \(failedAction == null\) TextButton\(onClick = \{ refresh\(\) \}, enabled = !busy, modifier = Modifier\.testTag\("read-retry"\)\)/);
// Every owed command keeps a reachable retry: each screen's failure banner offers Try again (retryOwed), which re-sends the
// exact recorded FailedAction, whatever screen or control started it (a status change from Focus's menu included).
assert.match(activity, /fun OwedRetry\(model: InboxViewModel\) \{\s+if \(model\.failedAction != null\) TextButton\(onClick = model::retryOwed, enabled = !model\.busy, modifier = Modifier\.testTag\("owed-retry"\)\)/);
// The read refresh and the owed retry are told apart (test tags): the checks assert the owed one only while a retry is owed.
assert.match(activity, /\} else OwedRetry\(model\)|else OwedRetry\(model\)/);
for (const [name, text] of Object.entries({ activity, editorUi, searchUi, processUi, menuUi, weeklyUi, dailyUi })) {
    assert.match(text, /FailureBanner\(message\) \{[\s\S]{0,320}?OwedRetry\(model\)/, `${name}: the failure banner offers the owed retry`);
}
{
    const retry = code(model.slice(model.indexOf('fun retryOwed()'), model.indexOf('\n    }\n', model.indexOf('fun retryOwed()'))));
    const kinds = new Set([...code(model + activity + editorUi + searchUi + processUi + rowUi).matchAll(/FailedAction\("(\w+)"/g)].map(([, kind]) => kind));
    for (const kind of [...kinds, 'inboxCommit', 'inboxSkip']) assert.match(retry, new RegExp(`"${kind}"`), `retryOwed re-sends a failed ${kind}`);
    assert.match(retry, /"update" -> sendUpdate\(action\)/);
    assert.match(retry, /"saveDraft" -> sendDraft\(action\)/);
    assert.match(retry, /"inboxCommit", "inboxSkip" -> sendAnswer\(action,/);
}
assert.match(rowUi, /failedAction == null \|\| failedAction == FailedAction\("complete", task\.id\)/);
// The swipe is core's meta.swipe (RN's getLeftAction moved to core); it and TalkBack's custom action are one command with one enabled rule.
// Done keeps core's completeTask and its retry; Restore and Next are the status change with theirs. RN draws no Done button.
assert.match(rowUi, /val target = meta\.swipe\.target\s+val swipeLabel = meta\.swipe\.label/);
assert.match(model, /meta\.getJSONObject\("swipe"\)\.let \{ RowSwipe\(it\.getString\("target"\), it\.getString\("label"\), it\.getString\("icon"\)\) \}/);
// No Kotlin status-to-swipe map: no status literal decides a swipe target, label, or icon.
const STATUS = '"(?:inbox|next|waiting|someday|reference|done)"';
for (const [name, text] of Object.entries({ rowUi, model, focusUi, projectsUi, activity })) {
    assert.doesNotMatch(code(text), new RegExp(`${STATUS}(?:\\s*,\\s*${STATUS})*\\s*->\\s*${STATUS}`), `${name}: no status-to-swipe map in Kotlin`);
}
assert.doesNotMatch(code(rowUi), /swipeTarget|archived\.restoreToInbox/);
assert.match(rowUi, /when \(swipe\.icon\) \{ "restore" -> Lucide\.RotateCcw; "done" -> Lucide\.Check; else -> Lucide\.ArrowRight \}/);
// A list whose contract writes its rows (Contexts, the Review screens) sends its own status action, with the same enabled rule for swipe and TalkBack.
// A selecting row has no swipe; a list with core's bulk contract (RowActions without a status) keeps the row's own swipe.
assert.match(rowUi, /val listed = actions\?\.status\s+val swipeOn = !selecting && if \(listed != null\) canEdit else completable && \(if \(target == "done"\) canComplete else canMove\)/);
assert.match(rowUi, /val canMove = writable && !busy && \(failedAction == null \|\| failedAction == statusAction\(task, target\)\)/);
assert.match(rowUi, /val onSwipe = listed\?\.let \{ status -> \{ status\(target\) \} \} \?: \{ if \(target == "done"\) complete\(task\.id\) else changeStatus\(task, target\) \}/);
assert.match(rowUi, /SwipeAction\(enabled = swipeOn, swipe = meta\.swipe, shape = shape, onSwipe = onSwipe, onMenu = \{ showStatusMenu\(task\) \}, onDelete = onDelete\)/);
assert.match(rowUi, /if \(swipeOn\) customActions = listOf\(CustomAccessibilityAction\(swipeLabel\) \{ onSwipe\(\); true \},\s*CustomAccessibilityAction\(t\("taskStatus\.changeStatus"\)\) \{ showStatusMenu\(task\); true \}\)/);
assert.doesNotMatch(code(rowUi + activity), /IconButton\(onClick = \{ complete\(/, 'no visible Done button: RN has none');
// RN's reveal-then-tap (#1275): the swipe only reveals the button; its tap runs the action, its long-press opens the status menu.
assert.match(rowUi, /\.combinedClickable\(enabled = enabled, role = Role\.Button, onLongClick = \{ settle\(0f\); onMenu\(\) \}\) \{ settle\(0f\); onSwipe\(\) \}/);
assert.match(rowUi, /onDragStopped = \{ settle\(if \(offset\.value > open \/ 2\) open else if \(offset\.value < left \/ 2\) left else 0f\) \}/, 'a drag only opens or closes the row');
// RN's Delete swipe exists only where a list's contract trashes rows with core's Undo; a selecting list has no swipe.
assert.match(rowUi, /val left = if \(onDelete != null\) -open else 0f/);
assert.match(rowUi, /val onDelete = actions\?\.delete\?\.takeIf \{ canEdit && !selecting \}/);
assert.doesNotMatch(code(rowUi), /SwipeToDismissBox|combinedClickable\([^)]*\)[^\n]*openEditor/, 'no one-gesture swipe; the row\'s own long-press stays free');
// Every failed command holds its exact retry, except an update or editor save core refused before writing.
assert.match(model, /internal val UPDATE_REFUSALS = listOf\("STALE_REVISION", "INVALID_INPUT", "TASK_NOT_FOUND"\)/);
assert.match(model, /private val REFUSABLE = setOf\("update", "saveDraft", "resetChecklist", "saveSearch", "inboxCommit", "inboxSkip", "capture", "captureLines", "capturePicker"\) \+ MENU_KINDS/);
assert.match(model, /val refused = action\?\.kind in REFUSABLE && UPDATE_REFUSALS\.any \{ message\.startsWith\(it\) \}/);
assert.match(model, /\(action != null && !refused\) \|\| message\.startsWith\("SAVE_FAILED"\)/);
// While a failed command's retry is owed, only that exact command runs: no read starts, and the retry
// keeps the failure on screen. A read's failure never replaces an owed command, in the ViewModel or the process record.
assert.match(model, /if \(busy \|\| runtime == null \|\| \(failedAction != null && failedAction != action\)\) return\s+busy = true\s+if \(action != null\) commandAt = \+\+issued\s+if \(failedAction == null\) error = null/);
assert.equal(code(model).match(/\berror = null\b/g).length, 4, 'perform and a read\'s success (no retry owed), closeEditor, and an accepted edit clearing only a refused edit\'s message');
assert.match(model, /if \(error != null && error == editRefusal\) error = null/);
assert.match(model, /if \(failedAction == null\) error = null\s+\}/, 'a read\'s success never clears an owed retry\'s failure');
assert.match(model, /val owed = failedAction\?\.takeIf \{ action == null && it\.kind != "storage" \}\s+if \(owed == null\) \{\s+error = message[\s\S]{0,120}?if \(failed != null\) failedAction = failed/);
assert.match(owner, /if \(pending\.action\.kind == "storage" && failure\?\.action\?\.kind\.let \{ it != null && it != "storage" \}\) return/);
// User actions go through perform: the three commands with their action, the reads the user asked for without one.
assert.equal(code(model).match(/\bperform\(action\)/g).length, 14, 'complete, editor save, Reset checklist, task star, project star, status, project create, area filter, saved search, Process Inbox answer, the storage retry, and the capture popup\'s capture, lines and picker create');
assert.equal(code(model).match(/\bperform\s*\{/g).length, 9, 'editor, reload, Try again, two More (Focus, a project), open project, open Process Inbox, open the capture popup, a Focus control\'s edit');
// Background reads (resume, each minute, after a command) never take busy, so they disable no control and never
// turn a user's tap away: only perform sets busy, and its guard knows nothing of reads in flight.
const backgroundFn = code(model.slice(model.indexOf('internal fun <T> background('), model.indexOf('internal fun perform(')));
assert.match(backgroundFn, /if \(runtime == null \|\| busy \|\| failedAction != null\) return\s+val mine = \+\+issued/);
assert.doesNotMatch(backgroundFn, /busy = /);
assert.equal(code(model).match(/\bbusy = true\b/g).length, 1, 'only a user action takes busy');
assert.match(model, /fun refreshFocus\(\) \{\s+val depth = focus\.depth\(\)\s+val controls = menu\.focusControls\.state\.toString\(\)\s+background\(/);
assert.match(model, /fun refreshProjects\(\) \{\s+val at = depth\(\)\s+background\(/);
assert.match(model, /private fun refreshAll\(\) \{\s+val at = depth\(\)\s+background\(Part\.entries, \{ runtime -> read\(runtime, at\) \}, ::showLists\)/);
// A command's lists are read again only after it succeeds, in the background, once busy is released.
assert.match(model, /try \{ work\(runtime\); done = true \}/);
assert.match(model, /ui \{\s+busy = false\s+if \(done && action != null\) refreshAll\(\)\s+\}/);
assert.doesNotMatch(code(model.slice(model.indexOf('fun add()'), model.indexOf('fun openEditor('))), /read\(runtime/);
// Stale results never overwrite newer state: every list read takes a number; a command outdates every earlier read;
// a result is shown only if nothing newer was shown first (a background failure too).
// Freshness is per list (Inbox, Focus, Projects, the open project, the area filter): a faster single-list read never
// makes a full read after an area change drop its other lists, and an older read never overwrites a newer one.
assert.match(model, /internal fun fresh\(mine: Long, part: Part\) = \(mine > commandAt && mine > \(shownAt\[part\] \?: 0L\)\)\.also \{ if \(it\) shownAt\[part\] = mine \}/);
assert.match(model, /internal enum class Part \{ Focus, Projects, Project, Areas, Editor, TaskView, Search, Menu, More, MenuDialog \}/);
{
    const show = code(model.slice(model.indexOf('private fun showLists('), model.indexOf('internal fun readSucceeded(')));
    for (const part of ['Focus', 'Projects', 'Project', 'Areas']) assert.match(show, new RegExp(`if \\(fresh\\(mine, Part\\.${part}\\)\\)`), `a full read applies ${part} on its own`);
    assert.doesNotMatch(code(model), /\bfresh\(mine\)/, 'every freshness check names its list');
}
assert.match(backgroundFn, /if \(result\.isFailure && parts\.map \{ fresh\(mine, it\) \}\.none \{ it \}\) return@ui\s+result\.onSuccess \{ apply\(it, mine\) \}\.onFailure/);
assert.match(backgroundFn, /if \(busy \|\| failedAction != null\) return@onFailure/, 'a background failure never replaces an owed retry or a running action');
for (const read of ['fun refresh()', 'fun loadMoreFocus(', 'fun openProject(', 'fun loadMoreProject(']) {
    const body = code(model.slice(model.indexOf(read), model.indexOf('\n    }\n', model.indexOf(read))));
    assert.match(body, /val mine = \+\+issued[\s\S]*ui \{ (if \(fresh\(mine, Part\.\w+\)\)|showLists\(lists, mine\))/, `${read} shows its result only if nothing newer came first`);
}
assert.equal(code(model).match(/(?<!var )\bcommandAt = /g).length, 1, 'only a command\'s start outdates reads');
// The exact retry of a failed Done is enabled wherever its row shows: Inbox, Focus, and a project.
assert.match(rowUi, /val canComplete = writable && !busy &&\s*\(failedAction == null \|\| failedAction == FailedAction\("complete", task\.id\)\)/);
// Only the capture draft survives process death; a restored unchanged draft reuses its capture UUID.
// The editor draft survives process death through a synced file in the no-backup folder; the Bundle holds only its key.
// The model is read again from core, and the saved edits go on top with their own bases.
assert.match(model, /private var editorKey: String\? = saved\.get<String>\("editorKey"\)/);
assert.doesNotMatch(code(model), /saved\["editor(?!Key)/, 'no editor model or draft in the Bundle');
assert.match(model, /EditorDrafts\(File\(app\.noBackupFilesDir, "editor"\)\)/);
assert.match(model, /FileOutputStream\(partial\)\.use \{ out -> out\.write\(state\.toString\(\)\.toByteArray\(\)\); out\.fd\.sync\(\) \}\s+check\(partial\.renameTo\(file\(key\)\)\)/);
assert.match(model, /TaskEditor\.restore\(readEditor\(runtime, draft\.getString\("id"\)\), draft\)/);
assert.match(editorUi, /put\("bases", JSONObject\(edited\.keys\.associateWith \{ base\(it\) \}\)\)/);
// An uncertain save's exact request is on disk before the call; after process death it is sent again before the draft unlocks.
assert.match(model, /val action = saveDraftAction\(current\)\s+pendingSave = action\s+keepEditor\(current\)\s+sendDraft\(action\)/);
assert.match(model, /pendingSave\?\.let \{ state\.put\("pending", JSONObject\(\)\.put\("base", JSONObject\(it\.base\)\)\.put\("patch", JSONObject\(it\.patch\)\)\.put\("checklist", it\.title\)\) \}\s+drafts\.write\(key, state\)/);
assert.match(model, /val action = FailedAction\("saveDraft", restored\.id, pending\.optString\("checklist"\), base = map\("base"\), patch = map\("patch"\)\)\s+failedAction = action\s+sendDraft\(action\)/);
// Unresolved typed text is an unsaved edit: Close asks, and Save waits for core, then saves.
assert.match(editorUi, /val dirty get\(\) = patch\.isNotEmpty\(\) \|\| waiting \|\| checklistChanged/);
assert.match(editorUi, /val leave = \{ if \(editor\.readOnly \|\| \(!editor\.dirty && !editsPending\)\) closeEditor\(\) else confirmLeave = true \}/);
assert.match(model, /if \(current\.waiting \|\| editsPending\) \{ saveQueued = true; return \}/);
assert.match(model, /if \(saveQueued && !resolved\.waiting && !editsPending\) \{ saveQueued = false; saveEditor\(\) \}/);
// Text the app puts in a field (a chosen suggestion) leaves the cursor at its end, as RN's TextInput does.
assert.match(editorUi, /if \(field\.text != value\) field = TextFieldValue\(value, TextRange\(value\.length\)\)\s+BasicTextField\(field, \{ typed -> field = typed;/);
// A chip's click, label, and state are one accessibility node: one-of-many choices are selectable (TalkBack says
// "selected" as RN does; uiautomator reports selected), and only on/off chips (quick tokens, after completion) toggle.
assert.match(editorUi, /\.semantics \{ contentDescription = description \}\s+\.then\(if \(toggle\) Modifier\.toggleable\(value = active, enabled = enabled, role = Role\.Button, onValueChange = \{ onClick\(\) \}\)\s+else Modifier\.selectable\(selected = active, enabled = enabled, role = Role\.Tab, onClick = onClick\)\)/);
assert.equal(code(editorUi).match(/toggle = true/g).length, 2, 'only the quick token chips and "Repeat after completion" toggle');
// RN's Waiting prompt: choosing Waiting asks for the person first, with core's people suggestions.
assert.match(editorUi, /if \(status == "waiting" && !active\) openWaitingPrompt\(\) else editFields\(mapOf\("status" to status\)\)/);
assert.match(model, /keepEditor\(current\.assignWaiting\(person\)\)\s+editFields\(mapOf\("status" to "waiting", "assignedTo" to person\)\)/);
// One host per process: the Activity and ViewModel never close it, and only the owner constructs it.
for (const file of [activity, model, editorUi, focusUi, projectsUi, labelsKt, rowUi, areaUi, viewStateKt, searchUi, processUi, captureUi, menuModel, ...Object.values(menuScreens)]) {
    assert.doesNotMatch(file, /close\(|onDestroy|onCleared|CoreHost\(/);
}
const guard = readFileSync(resolve(app, 'android/app/src/main/java/tech/dongdongbh/mindwtr/pilot/core/LegacyRnStoreGuard.kt'), 'utf8');
const themeKt = source('Theme.kt');
const iconsKt = source('Icons.kt');
const kotlinFiles = [activity, model, owner, editorUi, focusUi, projectsUi, labelsKt, themeKt, iconsKt, rowUi, areaUi, viewStateKt, searchUi, processUi, captureUi, snapshotsKt, coreHost, sqliteBridge, guard,
    menuModel, ...Object.values(menuScreens)];
assert.equal(kotlinFiles.join('\n').match(/(?<!class )CoreHost\(/g).length, 1);
// The dev build keeps its own database. The upgradetest build gets the RN database and RN's state
// only from the guard, before CoreHost exists: before any open of it, the checkpoint, and any core write.
assert.match(owner, /val legacy = if \(BuildConfig\.RN_STORAGE\) \{\s*LegacyRnStoreGuard\.requireClear\(app\.dataDir, File\(app\.cacheDir, "legacy-rn-guard"\)\)\s*\} else \{\s*null\s*\}\s*val runtime = CoreHost\(legacy\?\.database \?: File\(app\.filesDir, "mindwtr-native-dev\.db"\), legacy\?\.let \{ app\.dataDir \}\)\s*try \{\s*runtime\.start\([^\n]*, legacy\?\.bootState \?: "", legacy\?\.backup \?: ""\)/);
assert.match(coreHost, /callAsync\("boot", legacyState, legacyBackup\)/);
assert.equal(kotlinFiles.join('\n').match(/LegacyRnStoreGuard\.requireClear\(/g).length, 1);
assert.match(guard, /private const val DATABASE = "files\/SQLite\/mindwtr\.db"/);
assert.match(guard, /val database = File\(dataDir, DATABASE\)/);
// AsyncStorage first (unreadable, then an oversized backup), then a missing database with RN state and
// no backup, then quick_check; only a clear result may create the folder. json-ahead no longer blocks.
const decision = guard.slice(guard.indexOf('fun requireClear'), guard.indexOf('private fun readState'));
const order = ['"async-storage-unreadable"', '"json-too-large"', '"database-missing"', 'queryCopy(database, scratch)', '"database-unreadable"']
    .map((text) => decision.indexOf(text));
assert(order.every((index, i) => index > (i ? order[i - 1] : -1)), `guard order ${order}`);
assert.match(decision, /state\.backup == null && hasRnState\(dataDir, asyncStorage\)\) "database-missing"/);
assert.doesNotMatch(guard, /"json-ahead"/);
assert(guard.indexOf('check(blocked == null)') < guard.indexOf('database.parentFile!!.mkdirs()'));
assert.match(guard, /\/\/ ponytail: copies the whole database on every boot\. Skip it once a native-owned\s*\/\/ marker proves the last shutdown was clean\./);
// RKStorage and the RN database are only read as bytes: SQLite writes -wal/-shm even through a
// read-only connection, and a failed read-write open can checkpoint the WAL into the file on close.
const originalUses = [...guard.matchAll(/\b(asyncStorage|database|file|source)\.(\w+)/g)].map(([, name, member]) => `${name}.${member}`);
assert.deepEqual([...new Set(originalUses)].sort(), ['asyncStorage.exists', 'asyncStorage.path', 'database.exists', 'database.parentFile',
    'file.name', 'file.path', 'source.copyTo', 'source.exists', 'source.name']);
assert.equal(guard.match(/BundledSQLiteDriver\(\)\.open\(/g).length, 2);
assert.match(guard, /BundledSQLiteDriver\(\)\.open\(File\(scratch, file\.name\)\.path\)/);
// The one read-write open of an original is RKStorage in commitRnState, after its byte checkpoint, and it
// only deletes the json-ahead marker and sets the reconcile flag, in one transaction.
const commit = guard.slice(guard.indexOf('fun commitRnState'), guard.indexOf('private fun ensureRnStateCheckpoint'));
assert(commit.indexOf('ensureRnStateCheckpoint(asyncStorage') > 0
    && commit.indexOf('ensureRnStateCheckpoint(asyncStorage') < commit.indexOf('BundledSQLiteDriver().open(asyncStorage.path)'));
assert.equal(guard.match(/asyncStorage\.path\)/g).length, 1);
assert.deepEqual(commit.match(/"(BEGIN IMMEDIATE|COMMIT|ROLLBACK|DELETE FROM[^"]*|INSERT[^"]*|PRAGMA[^"]*)"/g), [
    '"PRAGMA synchronous = FULL"', '"BEGIN IMMEDIATE"', '"DELETE FROM catalystLocalStorage WHERE key = ?"',
    '"INSERT OR REPLACE INTO catalystLocalStorage VALUES (?, ?)"', '"COMMIT"', '"ROLLBACK"']);
assert.match(commit, /bindText\(1, JSON_AHEAD\)[\s\S]*bindText\(1, RECONCILED\)\s*it\.bindText\(2, "1"\)/);
// The checkpoint: each file synced, the folder synced, then promoted by rename, then the parent synced.
const rnCheckpoint = guard.slice(guard.indexOf('private fun ensureRnStateCheckpoint'), guard.indexOf('private fun hasRnState'));
assert.match(rnCheckpoint, /if \(!checkpoint\.exists\(\)\)[\s\S]*listOf\("", "-wal", "-journal", "-shm"\)[\s\S]*syncFile\(source\.copyTo[\s\S]*syncDirectory\(partial\)[\s\S]*renameTo\(checkpoint\)[\s\S]*syncDirectory\(checkpoint\.parentFile!!\)/);
assert.match(guard, /RN_STATE_CHECKPOINT = "files\/SQLite\/RKStorage\.prewrite"/);
// Kotlin reads, JS decides: no merge, and the backup is passed on as text, never parsed.
assert.doesNotMatch(code(kotlinFiles.join('\n')), /merge|JSONObject\((state\.)?backup|JSONArray\((state\.)?backup/i);
assert.match(guard, /return Opened\(database, bootState\.toString\(\), state\.backup \?: "", state\.language, state\.theme\)/);
// RN's device-local language is one more AsyncStorage row read from the byte copy, passed on as text.
assert.match(guard, /private const val LANGUAGE = "mindwtr-language"/);
assert.match(guard, /listOf\(JSON_AHEAD, RECONCILED, BACKUP_VERSION, LANGUAGE, THEME\)/);
assert.match(guard, /language = if \(LANGUAGE in sizes\) value\(LANGUAGE\) else null/);
// RN's device-local theme is one more row read the same way (theme-context.tsx THEME_STORAGE_KEY).
assert.match(guard, /private const val THEME = "@mindwtr_theme"/);
assert.match(guard, /theme = if \(THEME in sizes\) value\(THEME\) else null/);
assert.match(coreHost, /LegacyRnStoreGuard\.commitRnState\(checkNotNull\(rnDataDir\)/);
assert.equal(kotlinFiles.join('\n').match(/commitRnState\(/g).length, 2, 'defined once, called once from the guarded bridge callback');
assert.match(guard, /queryCopy\(asyncStorage, scratch\)/);
assert.match(guard, /for \(suffix in listOf\("", "-wal", "-journal"\)\)/);
assert.match(guard, /PRAGMA quick_check/);
const guardLog = /Log\.i\(CoreHost\.TAG, ("[\s\S]*?")\)\n/.exec(guard)?.[1] ?? '';
assert.match(guardLog, /releaseCheck=v1\.3\.3\/native-android-legacy-json-ahead-guard/);
assert.match(guardLog, /outcome=\$\{if \(blocked == null\) "clear" else "blocked"\}/);
for (const [, name] of guardLog.matchAll(/(\w+)=/g)) assert.doesNotMatch(name, /key|pass|user/i);
assert.equal(owner.match(/close\(\)/g).length, 1);
assert.match(owner, /catch \(failure: Throwable\) \{\s*runCatching \{ runtime\.close\(\) \}/);
assert.match(activity, /model\.attach\(\)/);
// A failed command's exact retry outlives its screen inside this process only.
assert.match(model, /val failed = if \(\(action != null[\s\S]*?ProcessCoreHost\.recordFailure\([\s\S]*?ui \{/);
// A failed update keeps its editor draft with the retry, so a new screen reopens the editor on it.
assert.match(model, /PendingFailure\(failed, message, menu\.page, editor, screen, focus, projects, project, areaFilter\)/);
assert.match(model, /pending\.menuPage\?\.let\(menu::restorePage\)/, 'a new screen shows the failed command\'s list page again');
assert.match(model, /pending\.editor\?\.let\(::keepEditor\)/);
// ...and a failure on Focus reopens Focus with its rows, since reads wait for the retry.
assert.match(model, /focus = pending\.focus\s+projects = pending\.projects\s+keepProject\(pending\.project\?\.projectId\)\s+project = pending\.project\s+show\(pending\.screen\)/);
assert.equal(model.match(/ProcessCoreHost\.failure\?\.let \{ pending -> ui \{ host = runtime; restore\(pending, storedProcessing, storedCapture\) \}/g).length, 2);
assert.match(model, /runtime\.completeTask\(id\)\s+acknowledged\(action\)/);
assert.match(model, /runtime\.saveTaskDraft\(action\.id, draftJson\(action\.base\), draftJson\(action\.patch\), action\.title\)\s+\} catch \(failure: Exception\) \{[\s\S]{0,300}?throw failure\s+\}\s+acknowledged\(action\)\s+ui \{ closeEditor\(\) \}/);
// The new contract commands: each is a perform(action) with its exact retry, acknowledged only after core's reply.
for (const [call, fn] of [
    ['runtime\\.setTaskFocus\\(id, focused\\)', 'fun setTaskFocus('], ['runtime\\.setProjectFocus\\(id, focused\\)', 'fun setProjectFocus('],
    ['runtime\\.updateTask\\(action\\.id, json\\(action\\.base\\), json\\(action\\.patch\\)\\)', 'private fun sendUpdate('],
    ['runtime\\.createProject\\(action\\.title, areaId, action\\.id\\)', 'fun createProject('], ['runtime\\.setAreaFilter\\(action\\.id\\)', 'private fun sendAreaFilter('],
]) {
    const body = model.slice(model.indexOf(fn), model.indexOf('\n    }\n', model.indexOf(fn)));
    assert.match(body, new RegExp(`perform\\(action\\) \\{ runtime ->\\s+(val reply = )?${call}\\s+acknowledged\\(action\\)`), `${fn} runs through perform(action) with its exact retry`);
}
// A star's retry re-sends the same target; a new project's retry re-sends the same request UUID, kept with its draft.
assert.match(model, /FailedAction\("taskFocus", id, patch = mapOf\("focused" to "\$focused"\)\)/);
assert.match(model, /FailedAction\("projectFocus", id, patch = mapOf\("focused" to "\$focused"\)\)/);
assert.match(model, /FailedAction\("createProject", projectRequestId, projectDraft, base = mapOf\("areaId" to areaId\)\)/);
for (const field of ['projectDraft', 'projectRequestId']) assert.match(model, new RegExp(`saved\\.get<String>\\("${field}"\\)`));
assert.match(model, /if \(action\.kind == "createProject"\) setProjectDraft\(action\.title, action\.base\["areaId"\], action\.id\)/, 'a new screen restores the owed create, never re-sends it');
// A refused star shows core's own text (RN's toast); an empty refusal shows nothing.
assert.match(model, /val blocked = reply\.optString\("blocked"\)\s+if \(blocked\.isNotEmpty\(\)\) ui \{ showToast\(reply\.getString\("blockedTitle"\), blocked\) \}/);
// The area filter is read with every list, so its label and the lists change together.
assert.match(model, /readOpen\(runtime, at\),\s+AreaFilter\.parse\(runtime\.areaFilter\(\)\),\s+\)/);
for (const [fn, js] of [['setTaskFocus', 'taskFocus'], ['setProjectFocus', 'projectFocus'], ['createProject', 'createProject'], ['areaFilter', 'areaFilter'], ['setAreaFilter', 'setAreaFilter']]) {
    assert.match(coreHost, new RegExp(`fun ${fn}\\([^)]*\\): JSONObject =\\s*callAsync\\("${js}"`), `CoreHost.${fn} reaches host method ${js}`);
}
assert.equal([activity, owner, editorUi, focusUi, projectsUi, rowUi, areaUi].join('\n').match(/\.setTaskFocus\(|\.setProjectFocus\(|\.createProject\(|\.setAreaFilter\(|\.areaFilter\(\)/g), null);
assert.equal(model.match(/clearFailure/g).length, 1);
assert.doesNotMatch(owner, /SharedPreferences|SavedStateHandle|File\(app\.filesDir, "(?!mindwtr-native-dev\.db"|SQLite\/mindwtr\.db")/);
assert.match(model, /ProcessCoreHost\.get\(/);
// Storage exceptions never cross the QuickJS JNI boundary.
assert.equal(coreHost.match(/JSCallFunction \{/g).length, 1, 'the only JS callback constructor is guarded');
const bridgeCallbacks = coreHost.match(/bridge\.setProperty\([^\n]*/g);
assert.equal(bridgeCallbacks.length, 8, 'the SQL calls, nowMs, randomBytes, rnStateCommit, collationKey and log: each guarded');
for (const line of bridgeCallbacks) assert.match(line, /^bridge\.setProperty\("\w+", guarded \{/);
assert.match(coreHost, /setProperty\("log", guarded \{ args -> runCatching \{/);
assert.match(coreHost, /try \{ work\(args\) \} catch \(error: Throwable\) \{ NATIVE_ERROR \+/);
// Fault hooks exist only behind BuildConfig.DEBUG.
assert.equal(coreHost.match(/getprop/g).length, 1);
assert.match(coreHost, /private fun debugFault\(name: String\): String = debugProperty\(name\)/);
assert.match(coreHost, /fun debugProperty\(name: String\): String \{\s*if \(!BuildConfig\.DEBUG\) return ""/);
// The only other debug property: the capture check's clipboard, put there for the field's real Paste.
assert.equal([activity, model, owner, editorUi, focusUi, projectsUi, labelsKt, captureUi].join('\n').match(/debugProperty\(/g).length, 1);
assert.match(captureUi, /withContext\(Dispatchers\.IO\) \{ debugProperty\("clipboard"\) \}\.takeIf \{ it\.isNotEmpty\(\) \}\?\.let \{ clipboard\.setText\(/);
assert.equal(coreHost.match(/failCommits =/g).length, 1);
assert.match(coreHost, /failCommits = debugFault\("fail_commit"\) == "1"/);
assert.equal([activity, model, owner, editorUi, focusUi, projectsUi, labelsKt].join('\n').match(/failCommits|debugFault|getprop/g), null);
// The language override is the same debug-only property read, and it replaces only the stored language.
assert.match(coreHost, /fun language\(stored: String, system: String\): JSONObject =\s*callAsync\("language", debugFault\("language"\)\.ifEmpty \{ stored \}, system\)/);
assert.equal(coreHost.match(/debugFault\("language"\)/g).length, 1);
// update and the editor's saveDraft are task commands: the fault hooks and the diagnostic line cover them.
assert.match(coreHost, /val command = method in setOf\("captureSubmit", "captureLines", "capturePicker", "complete", "update", "saveDraft", "resetChecklist", "taskFocus", "projectFocus",\s*"createProject", "setAreaFilter", "saveSearch", "inboxCommit", "inboxSkip", "menuCommand"\)/);

// The editor reads core's model (getTaskEditorModel, getTaskView's saved checklist and attachments, and editTaskChecklist's field)
// and saves only through core's saveTaskDraft (draft fields and checklist in one write), via perform with an exact FailedAction.
// The status menu keeps updateTask.
assert.match(coreHost, /fun taskEditorModel\(id: String\): JSONObject = callAsync\("editorModel", id\)/);
assert.match(coreHost, /fun taskView\(json: String\): JSONObject = callAsync\("taskView", json\)/);
assert.match(coreHost, /fun editTaskChecklist\(id: String, draftJson: String, checklistJson: String, editJson: String\): JSONObject =\s*callAsync\("editChecklist"/);
assert.match(coreHost, /fun resetTaskChecklist\(id: String, requestId: String\): JSONObject =\s*callAsync\("resetChecklist", JSONObject\(\)\.put\("id", id\)\.put\("requestId", requestId\)\.toString\(\)\)/);
assert.match(coreHost, /fun editorSuggestions\(id: String, field: String, query: String, limit: Int\): JSONObject =\s*callAsync\("editorSuggestions", id, field, query, limit\)/);
assert.match(coreHost, /fun saveTaskDraft\(id: String, baseJson: String, patchJson: String, checklistJson: String\): JSONObject =\s*callAsync\("saveDraft", JSONObject\(\)\.put\("id", id\)\.put\("base", JSONObject\(baseJson\)\)\.put\("patch", JSONObject\(patchJson\)\)\s*\.apply \{ if \(checklistJson\.isNotEmpty\(\)\) put\("checklist", JSONObject\(checklistJson\)\) \}\.toString\(\)\)/);
assert.match(coreHost, /fun updateTask\(id: String, baseJson: String, patchJson: String\): JSONObject =\s*callAsync\("update", JSONObject\(\)\.put\("id", id\)\.put\("base", JSONObject\(baseJson\)\)\.put\("patch", JSONObject\(patchJson\)\)\.toString\(\)\)/);
assert.doesNotMatch(coreHost + hostEntry, /taskEditor\(|getTaskEditor\(/, 'the seven-field editor reply is gone');
assert.match(hostEntry, /editorModel\(id: string\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.getTaskEditorModel\(\{ id \}\)\);/);
assert.match(hostEntry, /taskView\(json: string\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.getTaskView\(JSON\.parse\(json\)\)\);/);
assert.match(hostEntry, /editChecklist\(json: string\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.editTaskChecklist\(JSON\.parse\(json\)\)\);/);
assert.match(hostEntry, /resetChecklist\(json: string\): string \{\s*return submit\(async \(\) => taskResult\('resetChecklist', await contract\.resetTaskChecklist\(JSON\.parse\(json\)\)\)\);/);
assert.match(hostEntry, /editorSuggestions\(id: string, field: string, query: string, limit: number\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.getTaskEditorSuggestions\(\{ id, field: [^,]*, query, limit \}\)\);/);
assert.match(hostEntry, /saveDraft\(json: string\): string \{\s*return submit\(async \(\) => taskResult\('saveTaskDraft', await contract\.saveTaskDraft\(JSON\.parse\(json\)\)\)\);/);
assert.match(hostEntry, /update\(json: string\): string \{\s*return submit\(async \(\) => taskResult\('update', await contract\.updateTask\(JSON\.parse\(json\)\)\)\);/);
assert.equal(model.match(/runtime\.taskEditorModel\(id\)/g).length, 1, 'readEditor: open and Reload');
assert.match(model, /val model = runtime\.taskEditorModel\(id\)\s+val view = runtime\.taskView\(JSONObject\(\)\.put\("id", id\)\.toString\(\)\)[\s\S]{0,300}?return EditorModel\.of\(model, view, field\)/);
assert.equal(model.match(/readEditor\(runtime, id\)/g).length, 2, 'open and Reload');
assert.equal(model.match(/runtime\.saveTaskDraft\(/g).length, 1, 'the editor save');
assert.equal(model.match(/runtime\.updateTask\(/g).length, 1, 'the status menu and the Restore and Next swipes');
assert.equal(model.match(/runtime\.editorSuggestions\(/g).length, 1);
assert.equal([activity, owner, editorUi].join('\n').match(/taskEditorModel\(|taskView\(|editTaskChecklist\(|resetTaskChecklist\(|editorSuggestions\(|saveTaskDraft\(|updateTask\(/g), null);
assert.equal([activity, editorUi, focusUi, projectsUi, rowUi, areaUi, viewStateKt, searchUi, processUi, captureUi, ...Object.values(menuScreens)].join('\n').replace(/^import .*$/gm, '').match(/CoreHost|callAsync|\bruntime\b/g), null);
// The save: exactly the changed draft fields, base = their loaded values, as a perform with its exact FailedAction; no change means no call.
assert.match(editorUi, /val patch: Map<String, String\?> get\(\) = edited\.filter \{ \(field, literal\) -> literal != base\(field\) \}/);
assert.match(editorUi, /val base: Map<String, String\?> get\(\) = patch\.keys\.associateWith \{ base\(it\) \}/);
assert.match(model, /fun saveDraftAction\(current: TaskEditor\) = FailedAction\("saveDraft", current\.id, current\.checklistSave, base = current\.base, patch = current\.patch\)/);
assert.match(model, /val current = editor \?: return\s+if \(current\.waiting \|\| editsPending\) \{ saveQueued = true; return \}\s+if \(current\.patch\.isEmpty\(\) && !current\.checklistChanged\) \{ closeEditor\(\); return \}/);
// The checklist rides the same save: its base is the checklist the editor loaded (getTaskView's checklistBase), sent only when changed.
assert.match(editorUi, /val checklistSave: String get\(\) = if \(!checklistChanged\) "" else JSONObject\(\)\.put\("base", JSONArray\(model\.checklistBase\)\)\.put\("value", JSONArray\(checklistNow\)\)\.toString\(\)/);
assert.match(editorUi, /val checklistBase: String = content\.getJSONArray\("checklistBase"\)\.toString\(\)/);
assert.match(model, /private fun sendDraft\(action: FailedAction\) = perform\(action\) \{ runtime ->\s+try \{\s+runtime\.saveTaskDraft\(action\.id, draftJson\(action\.base\), draftJson\(action\.patch\), action\.title\)/);
// Draft values are core's own JSON, compared and sent as JSON text; null stays JSON null.
assert.match(editorUi, /fun draftJson\(values: Map<String, String\?>\): String =\s*JSONObject\(\)\.apply \{ values\.forEach \{ \(field, literal\) -> put\(field, draftValue\(literal\)\) \} \}\.toString\(\)/);
// Typed token and person text becomes core's draft value (getTaskEditorSuggestions), applied only while the text is unchanged; Save waits for it.
assert.match(editorUi, /if \(field !in inputs \|\| input\(field\) != text\) this\s+else withEdits\(mapOf\(field to draftLiteral\(draftValue\)\)\)\.copy\(resolved = resolved \+ \(field to text\)\)/);
assert.match(model, /val resolved = current\.resolve\(field, text, found\.draftValue\)\s+keepEditor\(resolved\)/);
assert.match(editorUi, /val saveEnabled = if \(editor\.readOnly\) true else writable && !busy &&\s*\(failedAction == null \|\| failedAction == saveDraftAction\(editor\)\)/);
// Suggestions are a background read: they never take busy and never replace an owed retry.
assert.match(model, /background\(listOf\(Part\.Editor\), \{ runtime -> EditorSuggestions\.parse\(text, runtime\.editorSuggestions\(id, coreField, text, SUGGESTIONS\)\) \}\)/);
// Reload after a conflict: an edit survives only where the stored value still equals the old base.
assert.match(editorUi, /val kept = \{ field: String -> \(fresh\.draft\[field\] \?: "null"\) == base\(field\) \}/);
// Kotlin holds no editor rule: the fields, their order, sections, open state, badges, and choices are core's model, walked as sent.
assert.match(editorUi, /for \(section in editor\.view\.sections\) \{/);
// Every structural edit goes through core's editTaskDraft, one at a time, and the editor shows the model core returns.
assert.match(coreHost, /fun editTaskDraft\(id: String, draftJson: String, editJson: String, checklistJson: String = ""\): JSONObject =\s*callAsync\("editDraft"[\s\S]{0,300}?put\("checklist", JSONArray\(checklistJson\)\)/);
// The layout follows the editor's own checklist (unsaved items included), as RN's: every step sends it.
assert.match(model, /if \(queued == null\) edit else "", list\)/);
assert.match(hostEntry, /editDraft\(json: string\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.editTaskDraft\(JSON\.parse\(json\)\)\);/);
assert.match(model, /background\(listOf\(Part\.Editor\), \{ engine -> runCatching \{ stepEditor\(engine, current, sent, next\.edit\) \} \}\)/);
// A checklist edit is queued with the draft's edits: core's editTaskChecklist first (a list task's status follows its items), then
// core's model for the draft, and core's checklist field for it. Kotlin never edits a checklist item itself.
assert.match(model, /val checked = listEdit\?\.let \{ engine\.editTaskChecklist\(current\.id, draftJson\(sent\), current\.checklistNow, it\.toString\(\)\) \}/);
assert.match(model, /val model = engine\.editTaskDraft\(current\.id, checked\?\.getJSONObject\("draft"\)\?\.toString\(\) \?: draftJson\(sent\), if \(queued == null\) edit else "", list\)/, 'a dropped checklist edit only reads the view');
assert.match(model, /fun editChecklist\(edit: JSONObject, field: String\? = null\) = editDraft\(JSONObject\(\)\.put\("checklist", edit\), field\)/);
assert.match(model, /if \(inFlight != null \|\| current == null \|\| runtime == null \|\| busy \|\| failedAction != null\) return/);
// Generation and sequence: a reply counts only for its own editor session and the edit it answers, still first in the
// queue; open, restore and Reload start a new session, and Close drops the in-flight ticket.
assert.match(model, /val ticket = current\.session to next\.seq/);
assert.match(model, /val now = editor\?\.takeIf \{ it\.session == ticket\.first && it\.pending\.firstOrNull\(\)\?\.seq == ticket\.second \}/);
assert.match(editorUi, /val session: String = UUID\.randomUUID\(\)\.toString\(\)/);
assert.match(model, /fun closeEditor\(\) \{\s+inFlight = null/);
// Pending edits are in the draft file before dispatch; each reply's draft and the removal of its edit are one write;
// a restore sends them again in order.
assert.match(model, /keepEditor\(current\.queued\(edit\.toString\(\), field\)\)\s+pumpEdits\(\)/);
assert.match(model, /keepEditor\(now\.viewed\(step\.view, sent\)\.copy\(pending = now\.pending\.drop\(1\), checklist = step\.checklist \?: now\.checklist\)\)/);
assert.match(editorUi, /\.put\("edits", JSONArray\(\)\.apply \{ pending\.forEach/);
assert.match(editorUi, /val edits = saved\.optJSONArray\("edits"\)/);
assert.match(model, /restored\?\.let \{ resumeEditor\(it, savedDraft\.optJSONObject\("pending"\)\) \}\s+\/\/[^\n]*\s+pumpEdits\(\)/);
// A refused edit cancels a queued Save and keeps core's message; typed text keeps newer typing; Reload waits for the queue.
assert.match(model, /error = editRefusal\s+saveQueued = false/);
assert.match(editorUi, /LaunchedEffect\(coreValue\) \{ if \(!pending\) text = coreValue \}/);
assert.match(editorUi, /enabled = !busy && !failed && !editsPending\) \{ Text\(t\("common\.retry"\)\) \}/);
assert.match(model, /\.put\("amount", amount \?: latest\?\.get\("amount"\) \?: shown\.getInt\("amount"\)\)/);
assert.match(model, /fun editFields\(values: Map<String, Any\?>\) =\s*editDraft\(JSONObject\(\)\.put\("type", "fields"\)/);
assert.match(editorUi, /if \(\(current\[field\] \?: "null"\) != \(sent\[field\] \?: "null"\)\) current\[field\] \?: "null" else reply\.draft\[field\] \?: "null"/);
// Dates: core's label, core's picker starts, core's date edits; Kotlin never writes a date value of its own.
assert.match(editorUi, /DateButton\(part\.label, label, !locked, Modifier\.weight\(1f\)\) \{ pickDate\(id\) \}/);
assert.match(editorUi, /JSONObject\(\)\.put\("type", "pickDate"\)\.put\("field", target\)\.put\("date", day\)/);
assert.match(editorUi, /JSONObject\(\)\.put\("type", "pickTime"\)\.put\("field", target\)\.put\("time", pickedTime\(state\.hour, state\.minute\)\)/);
assert.doesNotMatch(code(editorUi), /relativeStartOffset" to null\)(?!\))/, 'the relative start cascade is core\'s');
assert.equal(code(editorUi).match(/"relativeStartOffset"/g).length, 1, 'only the Absolute chip names the relative start');
assert.match(editorUi, /section\.fields\.forEach \{ field\(it\) \}/);
assert.doesNotMatch(code(editorUi), /\.(sort\w*|sorted\w*|groupBy|reversed|shuffled|distinct\w*)\b/);
// No Kotlin date parsing or formatting of stored values: dates show core's labels. Two helpers convert only between the
// picker and core's picker strings: pickedDay (picker output) and pickerStart (core's picker start, yyyy-MM-dd, back into
// the picker); pickerClock splits core's HH:mm picker start into the time picker's hour and minute.
const PICKER_START = /private fun pickerStart\(coreDate: String\): Long\? =\s*runCatching \{ SimpleDateFormat\("yyyy-MM-dd", Locale\.US\)\.apply \{ timeZone = TimeZone\.getTimeZone\("UTC"\) \}\.parse\(coreDate\)\?\.time \}\.getOrNull\(\)/;
assert.match(editorUi, PICKER_START);
assert.equal(editorUi.match(/pickerStart\(/g).length, 2, 'defined once, used once: the date picker\'s start');
assert.match(editorUi, /val state = rememberDatePickerState\(initialSelectedDateMillis = start\?\.let \{ pickerStart\(it\) \}\)/);
assert.match(editorUi, /val \(hour, minute\) = pickerClock\(editor\.view\.fields\.dates\.getValue\(target\)\.pickerTime\)/);
assert.doesNotMatch([editorUi.replace(PICKER_START, ''), model, activity, focusUi, projectsUi, rowUi, areaUi, viewStateKt, menuModel, ...Object.values(menuScreens)].join('\n'),
    /java\.time|LocalDate|Instant|DateTimeFormatter|java\.util\.Calendar|GregorianCalendar|Calendar\.getInstance|(?<!InboxPage|FocusView|ProjectsView|ProjectDetail|AreaFilter|EditorSuggestions|SearchView)\.parse\(|DateFormat\.get|SimpleDateFormat\(\)/);
assert.equal([model, activity, focusUi, projectsUi, rowUi, areaUi, viewStateKt, menuModel, ...Object.values(menuScreens)].join('\n').match(/SimpleDateFormat|\.format\(/g), null);
// A fade is always a layer (Theme.kt fade): Modifier.alpha(1f) drops its layer, which left the capture popup's
// enabled Save pills undrawn on the test phone (runs 31-32).
{
    const { readdirSync } = await import('node:fs');
    const dir = resolve(app, 'android/app/src/main/java/tech/dongdongbh/mindwtr/pilot');
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.kt'))) {
        assert.doesNotMatch(code(readFileSync(resolve(dir, name), 'utf8')), /\.alpha\(|ui\.draw\.alpha/, `${name} uses Modifier.alpha; use fade`);
    }
}
assert.match(source('Theme.kt'), /fun Modifier\.fade\(alpha: Float\): Modifier = graphicsLayer \{ this\.alpha = alpha \}/);
// RN's Android Switch for Add another (the M3 Switch hid the off thumb): a toggleable Role.Switch node.
assert.match(captureUi, /toggleable\(on, enabled = enabled, role = Role\.Switch\)/);
assert.doesNotMatch(code(captureUi), /material3\.Switch|SwitchDefaults/);
// No Kotlin date formatting or date coloring anywhere in the UI package: dates and their tones are core's (row meta, the Focus date line).
{
    const { readdirSync } = await import('node:fs');
    const dir = resolve(app, 'android/app/src/main/java/tech/dongdongbh/mindwtr/pilot');
    // The Calendar composer's time edits are core's edit names (NativeCalendarComposerEdit), not a task's field: that one line is left out.
    const composerTimeEdit = 'put("type", if (field == "start") "startTime" else "endTime")';
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.kt') && file !== 'TaskEditor.kt')) {
        assert.doesNotMatch(code(readFileSync(resolve(dir, name), 'utf8')).replace(composerTimeEdit, ''), /SimpleDateFormat|DateTimeFormatter|LocalDate|java\.time|\bdueDate\b|\bstartTime\b/,
            `${name} formats, parses, or colors a date; only core's meta text is shown`);
    }
}
assert.equal(editorUi.match(/SimpleDateFormat|\.format\(/g).length, 4); // import, pickedDay's constructor and format call, pickerStart's constructor
assert.match(editorUi, /private fun pickedDay\(pickerMillis: Long\): String =\s*SimpleDateFormat\("yyyy-MM-dd", Locale\.US\)\.apply \{ timeZone = TimeZone\.getTimeZone\("UTC"\) \}\.format\(Date\(pickerMillis\)\)/);
assert.equal(editorUi.match(/pickedDay\(/g).length, 2);
assert.match(editorUi, /internal fun pickedTime\(hour: Int, minute: Int\) = "\$\{hour\.toString\(\)\.padStart\(2, '0'\)\}:\$\{minute\.toString\(\)\.padStart\(2, '0'\)\}"/);
assert.equal(editorUi.match(/pickedTime\(/g).length, 3, 'defined once; the editor\'s time picker and the shared ClockPickerDialog (the capture popup\'s due time)');
// A draft date is never read apart: no substring, split, or pattern over a date field's value.
assert.doesNotMatch(code(editorUi), /text\("(dueDate|startTime|reviewAt)"\)\.(substring|split|take|drop|contains|startsWith|endsWith|matches|replace)/);
assert.doesNotMatch(code(editorUi), /\b(due|value)\.(substring|split|take|drop|contains|startsWith|endsWith|matches)\(/);
// Read-only offers only Close; a failed save allows only its exact retry and leaves Back to the system.
assert.match(editorUi, /val locked = busy \|\| failed \|\| editor\.readOnly/);
assert.match(editorUi, /BackHandler\(enabled = !failed\)/);
assert.match(editorUi, /clickable\(enabled = !busy && !failed, role = Role\.Button, onClick = leave\)/);

// Focus reaches core only through CoreHost's two calls, which reach only core's two Focus queries. Kotlin sends Focus's control
// state (FocusModel) with both, and a control's edit with the first; a read that sends neither keeps the flat Focus.
assert.match(coreHost, /fun focus\(limit: Int, controls: String = "", controlEdit: String = ""\): JSONObject = callAsync\("focus", limit, controls, controlEdit\)/);
assert.match(coreHost, /fun focusWindow\(key: String, offset: Int, limit: Int, revision: String, controls: String = ""\): JSONObject =\s*callAsync\("focusWindow", key, offset, limit, revision, controls\)/);
assert.match(hostEntry, /focus\(limit: number, controls = '', controlEdit = ''\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.getFocus\(\{ limit, \.\.\.\(controls \? \{ controls: JSON\.parse\(controls\) \} : \{\}\), \.\.\.\(controlEdit \? \{ controlEdit: JSON\.parse\(controlEdit\) \} : \{\}\) \}\)\);/);
assert.match(hostEntry, /focusWindow\(key: string, offset: number, limit: number, revision: string, controls = ''\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.getFocusSectionWindow\(\{ key: key as FocusTaskSectionKey, offset, limit, revision, \.\.\.\(controls \? \{ controls: JSON\.parse\(controls\) \} : \{\}\) \}\)\);/);
assert.equal(model.match(/runtime\.focus\(/g).length, 1);
assert.equal(model.match(/runtime\.focusWindow\(/g).length, 1);
assert.match(model, /FocusView\.parse\(runtime\.focus\(PAGE, controls, edit\)\)/, 'every Focus read sends the control state');
assert.match(model, /view\.append\(runtime\.focusWindow\(key, loaded\.rows\.size, PAGE, view\.revision, state\)\)/, 'later windows go with the state core answered');
assert.equal([activity, owner, editorUi, focusUi, projectsUi].join('\n').match(/\.focus\(|focusWindow\(/g), null);
// Rows render in core's order: sections and rows are walked as parsed, never sorted, filtered, or regrouped.
const focusCode = code(focusUi) + code(model.slice(model.indexOf('fun JSONObject.taskRows()'), model.indexOf('private const val PAGE')));
assert.doesNotMatch(focusCode, /\.(sort\w*|sorted\w*|filter(?!Bg\b)\w*|groupBy|reversed|asReversed|shuffled|distinct\w*|partition|minBy|maxBy)\b/);
assert.match(focusUi, /return FocusView\(json\.getString\("revision"\), json\.getString\("dateLabel"\), List\(items\.length\(\)\) \{ index ->/);
assert.match(model, /fun JSONObject\.taskRows\(\): List<TaskRow> = getJSONArray\("rows"\)\.let \{ items ->\s*List\(items\.length\(\)\) \{ index ->/);
assert.match(focusUi, /for \(section in focus\?\.sections\.orEmpty\(\)\) \{/);
assert.match(focusUi, /section\.rows\.forEachIndexed \{ index, task ->/);
// Core's row data is the only row data Focus acts on: laterToday places one subheading, revealLabel is shown as text,
// and the section's focusBlockedLabel disables the star with core's reason.
assert.match(focusUi, /val laterToday = section\.rows\.indexOfFirst \{ it\.laterToday \}/);
assert.equal(code([focusUi, activity, model, rowUi].join('\n')).match(/(?<!"agenda)\.laterToday\b/g).length, 1); // not the label key
assert.match(rowUi, /task\.revealLabel\?\.let \{ MetaText\(it, c\.secondaryText, 600, Modifier\.padding\(top = 4\.dp\)\) \}/);
assert.equal(code([focusUi, activity, model, rowUi].join('\n')).match(/\.revealLabel\b/g).length, 1);
assert.doesNotMatch(code([focusUi, activity, model, rowUi].join('\n')), /revealDate/);
assert.match(focusUi, /star = RowStar\.Shown, starBlocked = section\.focusBlockedLabel/);
assert.doesNotMatch(code(focusUi), /"upcoming"/, 'Focus never names a section to decide a control');
assert.match(rowUi, /val label = blocked \?: t\(if \(task\.isFocusedToday\) "agenda\.removeFromFocus" else "agenda\.addToFocus"\)/);
// A stale Load more reads Focus again from offset 0; it is never shown as an error.
assert.match(model, /if \(failure\.message\?\.startsWith\("STALE_REVISION"\) != true\) throw failure[\s\S]{0,200}?readFocus\(runtime, null, depth, state\)/);
// Time-aware refresh: on resume and each minute, only while the Focus list is composed and resumed.
assert.match(focusUi, /LaunchedEffect\(owner\) \{\s*owner\.repeatOnLifecycle\(Lifecycle\.State\.RESUMED\) \{\s*while \(true\) \{\s*model\.refreshFocus\(\)\s*delay\(60_000\)/);
assert.equal(code([activity, model, focusUi].join('\n')).match(/(?<!fun )refreshFocus\(\)/g).length, 1, 'one caller: the lifecycle loop');
assert.match(activity, /Screen\.Focus -> FocusList\(model, Modifier\.fillMaxSize\(\)\)/);
// Commands from Focus and a project use the Inbox's command path and its exact-retry lock.
assert.match(rowUi, /fun TaskRowItem\(\s*model: InboxViewModel, task: TaskRow, status: RowStatus = RowStatus\.Hidden, star: RowStar = RowStar\.Hidden,/);
// A task grouped under two Next actions headings shows under each: its heading is part of its key.
assert.match(focusUi, /item\(key = "\$\{section\.key\}:\$\{group\}:\$\{task\.id\}"\) \{\s*GroupedRow\(grouped\) \{\s*TaskRowItem\(model, task,/);
// RN hides a section core counts as empty, "Projects to review" included, and folds a section on its title.
assert.match(focusUi, /if \(section\.total == 0\) continue/);
assert.match(focusUi, /if \(reviewCount > 0\) \{/);
assert.match(focusUi, /if \(!open\) continue/);
assert.match(focusUi, /view\.dateLabel\.uppercase\(\)/, 'the Focus date line is core\'s text');
// Open sections are device-local, under RN's keys and defaults.
assert.match(viewStateKt, /const val FOCUS_VIEW_KEY = "mindwtr:view:focus:v1"/);
assert.match(viewStateKt, /const val PROJECTS_VIEW_KEY = "mindwtr:view:projects:v1"/);
assert.match(viewStateKt, /val FOCUS_SECTION_KEYS = listOf\("focus", "schedule", "next", "upcoming", "reviewDue", "reviewProjects"\)/);
assert.match(focusUi, /onClick = \{ loadMoreFocus\(section\.key\) \}, enabled = writable && !busy && failedAction == null/);
// The selected list survives rotation (ViewModel) and process death (SavedStateHandle).
assert.match(model, /saved\.get<String>\("screen"\)/);
assert.match(model, /screen = target\s+saved\["screen"\] = target\.name/);

// Labels: every word on screen comes from core's getStrings. One Kotlin map of core keys, filled at boot and
// read again right after setLanguage; it holds no text of its own (a key core lacks shows as the key).
const enSource = readFileSync(resolve(app, '../../packages/core/src/i18n/locales/en.ts'), 'utf8');
const enKeys = new Set([...enSource.matchAll(/^\s*'([^']+)':/gm)].map(([, name]) => name));
const labelBlock = labelsKt.slice(labelsKt.indexOf('val LABEL_KEYS = listOf('), labelsKt.indexOf('object Labels'));
const labelKeys = [...code(labelBlock).matchAll(/"([^"]*)"/g)].map(([, name]) => name);
assert(labelKeys.length > 0 && labelKeys.length <= 500 && new Set(labelKeys).size === labelKeys.length, 'LABEL_KEYS: unique, at most getStrings\' 500');
for (const name of labelKeys) assert(enKeys.has(name), `LABEL_KEYS: ${name} is not a key in core's en.ts`);
assert.match(labelsKt, /operator fun get\(name: String\): String = strings\[name\] \?: name\.also\(::missing\)/);
assert.match(labelsKt, /strings = LABEL_KEYS\.filter\(values::has\)\.associateWith\(values::getString\)/);
assert.match(labelsKt, /if \(logged\.add\(name\)\) Log\.w\(/, 'a missing key is logged once');
assert.equal(kotlinFiles.join('\n').match(/Labels\.load\(/g).length, 1);
assert.match(owner, /runtime\.language\(stored \?: "", Locale\.getDefault\(\)\.toLanguageTag\(\)\)\s+Labels\.load\(runtime\.strings\(LABEL_KEYS\)\)/);
assert.match(owner, /runtime\.start\([^\n]*\)\s+setLanguage\(runtime, legacy\?\.language\)\s+loadTheme\(runtime, legacy\?\.theme\)\s+return runtime/);
assert.equal(kotlinFiles.join('\n').match(/runtime\.language\(|runtime\.strings\(/g).length, 2);
// Core's editor statuses and priorities each have their label key.
const contractSource = readFileSync(resolve(app, '../../packages/core/src/native-host-contract.ts'), 'utf8');
for (const [list, prefix] of [['EDITOR_STATUSES', 'status'], ['EDITOR_PRIORITIES', 'priority']]) {
    const values = [...new RegExp(`const ${list} = \\[([^\\]]*)\\]`).exec(contractSource)[1].matchAll(/'([^']+)'/g)].map(([, value]) => value);
    for (const value of values) assert(labelKeys.includes(`${prefix}.${value}`), `LABEL_KEYS lacks ${prefix}.${value}`);
}
assert.match(editorUi, /for \(status in editor\.view\.statuses\)/);
assert.match(editorUi, /ChoiceChips\(editor, "priority", editor\.view\.priorities, !locked, t\("taskEdit\.priorityLabel"\), \{ t\("priority\.\$it"\) \}\)/);
// Every label key core's editor model can send (recurrence choices, energy levels, section titles) is in LABEL_KEYS.
{
    const modelSource = readFileSync(resolve(app, '../../packages/core/src/task-editor-model.ts'), 'utf8');
    for (const [, key] of modelSource.matchAll(/labelKey: '([^']+)'/g)) assert(labelKeys.includes(key), `LABEL_KEYS lacks ${key}`);
    for (const value of [...modelSource.matchAll(/TASK_EDITOR_ENERGY_LEVEL_OPTIONS: TaskEnergyLevel\[\] = \[([^\]]*)\]/g)][0][1].matchAll(/'([^']+)'/g)) {
        assert(labelKeys.includes(`energyLevel.${value[1]}`), `LABEL_KEYS lacks energyLevel.${value[1]}`);
    }
    for (const id of ['scheduling', 'organization', 'details']) assert(labelKeys.includes(`taskEdit.${id}`), `LABEL_KEYS lacks taskEdit.${id}`);
}
// No literal text reaches a Text, a content description, or a click label; key literals are label keys.
// Pass 8's Calendar and Board screens and models are held to the same rule.
const pass8Sources = { calendarModel: source('CalendarModel.kt'), calendarUi: source('CalendarScreen.kt'), boardModel: source('BoardModel.kt'), boardUi: source('BoardScreen.kt') };
for (const [name, text] of Object.entries({ activity, model, editorUi, focusUi, projectsUi, themeKt, iconsKt, rowUi, areaUi, viewStateKt, searchUi, processUi, captureUi, menuModel, ...menuScreens, ...pass8Sources })) {
    // Icons.kt's bySymbol keys are core's SF Symbols names (more-menu-model.ts), not label keys.
    const body = code(text).replace(/val bySymbol = mapOf\([\s\S]*?\n {4}\)/, '');
    for (const [, key] of body.matchAll(/"([a-z][A-Za-z]*(?:\.[A-Za-z]+)+)"/g)) assert(labelKeys.includes(key), `${name}: ${key} is not in LABEL_KEYS`);
    for (const [, rest] of body.matchAll(/(?:\bText\(|contentDescription = |onClickLabel = )([^\n]*)/g)) {
        // Core's JSON is read by key (getString("label")); a key names a field of core's text, it is not text.
        // A test tag (a Modifier's, or one set in a control's semantics block) names the control for the checks; it is not text.
        for (const [, literal] of rest.replace(/\b(t|testTag|getString|optString|text|getJSONObject|optJSONObject|getBoolean|optBoolean|getInt|menuText|menuObjects)\("[^"]*"\)/g, '').replace(/\btestTag = "[^"]*"/g, '').matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
            if (labelKeys.includes(literal)) continue;
            assert.doesNotMatch(literal.replace(/\$\{[^}]*\}|\$\w+/g, ''), /\p{L}/u, `${name}: hard-coded UI text "${literal}"`);
        }
    }
}
assert.match(activity, /Text\(t\(label\), style = rnText\(10, if \(active\) 700 else 600, 12\)/);
assert.match(activity, /private fun RowScope\.TabItem\(model: InboxViewModel, tab: Screen, icon: ImageVector, label: String = tab\.label\)/);
assert.match(model, /enum class Screen\(val label: String\) \{ Inbox\("tab\.inbox"\), Focus\("tab\.next"\), Projects\("nav\.projects"\) \}/);
// A failed boot shows only its message, found by a test tag, and no command control.
assert.match(activity, /\} else if \(!writable\) \{[^}]*Text\(error\.orEmpty\(\), color = MaterialTheme\.colorScheme\.error, modifier = Modifier\.testTag\("boot-failure"\)\.padding\(24\.dp\)\)\s*\} else \{/);
assert.match(activity, /if \(open != null && writable\) TaskEditorScreen\(model, open\)/);

// Landscape: the Inbox's controls, Process button and scope line are the list's first items; only the header, the tabs (and a
// failure, and the bulk bar while selecting) stay fixed.
assert.match(inboxUi, /LazyColumn\(Modifier\.weight\(1f\)\.fillMaxWidth\(\), contentPadding = PaddingValues\(bottom = 12\.dp\)\) \{\s*val view = shown\?\.view \?: return@LazyColumn\s*item\(key = "toolbar"\)[\s\S]*?item\(key = "header"\)[\s\S]*?items\(shown\.items, key = \{ it\.key \}\)/);
assert.match(activity, /Screen\.Inbox -> InboxList\(model, Modifier\.fillMaxSize\(\)\)/);
// Capture: RN's center tab button opens RN's capture popup (CaptureScreen.kt), on core's quick capture contract.
assert.match(activity, /CaptureButton\(model\)[\s\S]*?clickable\(role = Role\.Button\) \{ model\.menu\.closeSheet\(\); model\.openCapture\(\) \}/);
assert.match(activity, /capture\?\.let \{ CapturePopup\(model, it\) \}/);
assert.doesNotMatch(code(activity + model), /CaptureSheet|createInboxTask|showCapture/, 'the pass-1 capture sheet is gone');
// The tab bar: RN's order, Menu last (it opens RN's More sheet), and RN's lucide icons.
const tabBar = activity.slice(activity.indexOf('private fun TabBar('), activity.indexOf('private fun RowScope.TabItem('));
assert.deepEqual([...tabBar.matchAll(/TabItem\(model, Screen\.(\w+)|CaptureButton\(model\)|MenuTab\(model\)/g)]
    .map(([whole, tab]) => tab ?? (whole.startsWith('Capture') ? 'capture' : 'menu')), ['Focus', 'Inbox', 'capture', 'Projects', 'menu']);
// The failure text stays in the accessibility tree: drawn above the list, a live region, reached first, and the list is clipped.
const banner = activity.slice(activity.indexOf('fun FailureBanner('), activity.indexOf('private fun TabBar('));
assert.match(banner, /\.zIndex\(1f\)/);
assert.match(banner, /isTraversalGroup = true; traversalIndex = -1f/);
assert.match(banner, /Text\(message,[\s\S]*?liveRegion = LiveRegionMode\.Assertive/);
assert(activity.indexOf('FailureBanner(message)') < activity.indexOf('Screen.Inbox -> InboxList('), 'the banner sits above the lists');
assert.match(activity, /Box\(Modifier\.weight\(1f\)\.fillMaxWidth\(\)\.background\(c\.bg\)\.clipToBounds\(\)\)/);
// Section titles draw RN's capitals but expose core's own title and count.
assert.match(activity, /clearAndSetSemantics \{ text = AnnotatedString\(spoken\); heading\(\) \}/);
assert.match(activity, /val spoken = if \(count == null\) title else "\$title · \$count"/);

// Theme: one Kotlin theme object holds RN's palettes, value for value, and every color the screens draw.
const mobile = resolve(app, '../mobile');
const hexes = (text) => [...text.matchAll(/"(#[0-9A-Fa-f]{6})"/g)].map(([, hex]) => hex.toUpperCase());
const kotlinPalette = (name) => hexes(new RegExp(`${name} palette\\(([^)]*)\\)`).exec(themeKt)?.[1] ?? '');
const FIELDS = ['bg', 'cardBg', 'taskItemBg', 'text', 'secondaryText', 'icon', 'border', 'tint', 'onTint', 'tabIconDefault',
    'tabIconSelected', 'inputBg', 'danger', 'success', 'warning', 'filterBg'];
assert.match(themeKt, new RegExp(`data class ThemeColors\\(\\s*${FIELDS.map((field) => `val ${field}: Color,`).join('\\s*')}\\s*\\)`), 'ThemeColors has RN\'s fields in order');
const presetSource = readFileSync(resolve(mobile, 'constants/theme-presets.ts'), 'utf8');
for (const [, preset, body] of presetSource.matchAll(/^ {4}'?([\w-]+)'?: \{\n([\s\S]*?)\n {4}\},/gm)) {
    const values = Object.fromEntries([...body.matchAll(/(\w+): '(#[0-9A-Fa-f]{6})'/g)].map(([, field, hex]) => [field, hex.toUpperCase()]));
    assert.deepEqual(kotlinPalette(`"${preset}" to`), FIELDS.map((field) => values[field]), `preset ${preset} matches RN`);
}
const m3Source = readFileSync(resolve(mobile, 'constants/material3/m3-color.ts'), 'utf8');
const m3Role = (scheme, role) => new RegExp(`${scheme}: \\{[\\s\\S]*?\\b${role}: '(#[0-9A-Fa-f]{6})'`).exec(m3Source)[1].toUpperCase();
const m3Map = { bg: 'background', cardBg: 'surfaceContainer', taskItemBg: 'surfaceContainerHigh', text: 'text', secondaryText: 'secondaryText',
    icon: 'secondaryText', border: 'outline', tint: 'primary', onTint: 'onPrimary', tabIconDefault: 'secondaryText', tabIconSelected: 'primary',
    inputBg: 'surfaceVariant', danger: 'error', success: 'success', warning: 'warning', filterBg: 'surfaceVariant' };
for (const scheme of ['light', 'dark']) {
    assert.deepEqual(kotlinPalette(`M3_${scheme.toUpperCase()} =`), FIELDS.map((field) => m3Role(scheme, m3Map[field])), `Material 3 ${scheme} matches RN`);
}
const tokenSource = readFileSync(resolve(mobile, 'hooks/use-theme-tokens.ts'), 'utf8');
const generic = tokenSource.slice(tokenSource.indexOf('const isDark = theme.isDark;'), tokenSource.indexOf('const FALLBACK: ThemeTokens'));
const baseSource = readFileSync(resolve(mobile, 'constants/theme.ts'), 'utf8');
const baseColor = (scheme, name) => {
    const block = new RegExp(`${scheme}: \\{([\\s\\S]*?)\\}`).exec(baseSource)[1];
    const value = new RegExp(`\\b${name}: ([^,]+),`).exec(block)[1].trim();
    return (value.startsWith("'") ? value.slice(1, -1) : new RegExp(`const ${value} = '([^']+)'`).exec(baseSource)[1]).toUpperCase();
};
const genericValue = (scheme, field) => {
    const expression = new RegExp(`\\b${field}: ([^,\\n]+)`).exec(generic)[1];
    const choice = expression.includes('?') ? expression.split('?')[1].split(':')[scheme === 'dark' ? 0 : 1].trim() : expression.trim();
    const colors = /^Colors\.(light|dark)\.(\w+)$/.exec(choice);
    return colors ? baseColor(colors[1], colors[2]) : choice.replace(/'/g, '').toUpperCase();
};
for (const scheme of ['light', 'dark']) {
    assert.deepEqual(kotlinPalette(`${scheme.toUpperCase()} =`), FIELDS.map((field) => genericValue(scheme, field)), `RN default ${scheme} matches`);
}
// No color is written anywhere else: every other file draws with LocalTheme.
for (const [name, text] of Object.entries({ activity, model, editorUi, focusUi, projectsUi, labelsKt, iconsKt, owner, rowUi, areaUi, viewStateKt, searchUi, processUi, captureUi, menuModel, ...menuScreens })) {
    assert.doesNotMatch(code(text), /\bColor\(|Color\.(Black|White|Red|Green|Blue|Gray|Yellow|Cyan|Magenta|DarkGray|LightGray|Transparent)\b|parseColor|"#[0-9A-Fa-f]{3,8}"|0x[0-9A-Fa-f]{8}/,
        `${name} writes a color; colors live only in Theme.kt`);
}
assert.equal([activity, focusUi, projectsUi, rowUi, areaUi, searchUi, processUi, captureUi, ...Object.values(menuScreens)].join('\n').match(/MaterialTheme\.typography/g), null, 'the lists use RN\'s type (rnText), not Material\'s');
assert.equal(code(activity).match(/MindwtrTheme\(/g).length, 1, 'one theme wraps the whole app');
// Core classifies the theme and owns its hues; Kotlin never names a theme mode.
assert.doesNotMatch(code(themeKt + owner), /"(system|material3-light|material3-dark)"/);
assert.match(themeKt, /json\.getString\("preset"\), json\.getBoolean\("material"\), if \(json\.isNull\("scheme"\)\) null else json\.getString\("scheme"\)/);
assert.match(coreHost, /fun theme\(stored: String\): JSONObject = callAsync\("theme", stored\)/);
assert.equal(owner.match(/runtime\.theme\(/g).length, 1);
assert.match(owner, /runCatching \{ ThemeChoice\.load\(runtime\.theme\(stored \?: ""\)\) \}/, 'a failed theme read keeps RN\'s default look');
const themeCall = hostEntry.slice(hostEntry.indexOf('theme(stored: string): string {'), hostEntry.indexOf('    projects(): string {'));
assert.match(themeCall, /const mode = typeof synced === 'string' && synced \? synced : \(stored \|\| 'system'\);/, 'RN: the synced setting wins over the device-local choice');
assert.match(themeCall, /themeDescriptor\(mode\)/);
assert.doesNotMatch(themeCall, /requireSaved/);
// Rows read core's meta: the parts in core's order (detail parts hidden, as RN's lists and default Focus hide them),
// core's due tone mapped to RN's colors, the strip from meta.priority, and TalkBack's label from meta.accessibilityLabel.
assert.match(model, /fun JSONObject\.taskRow\(\) = getJSONObject\("meta"\)\.let \{ meta ->/);
assert.match(model, /meta\.getJSONArray\("parts"\)\.let \{ parts -> List\(parts\.length\(\)\) \{ parts\.getJSONObject\(it\)\.metaPart\(\) \} \}/);
assert.match(rowUi, /val parts = if \(details\) meta\.parts else meta\.parts\.filter \{ !it\.detail \}/, 'detail parts show only where RN\'s list shows them');
assert.match(rowUi, /for \(part in parts\) MetaPartView\(part\)/);
assert.match(rowUi, /"due" -> MetaText\(part\.text, when \(part\.tone\) \{ "overdue" -> c\.danger; "dueSoon" -> c\.warning; else -> c\.secondaryText \}, 600\)/);
assert.match(rowUi, /val strip = theme\.priority\(meta\.priority\)/);
assert.match(rowUi, /contentDescription = meta\.accessibilityLabel/);
assert.match(rowUi, /coreColorOrNull\(part\.dotColor\) \?: c\.tint/, 'a null dot color is the tint, as RN');
assert.doesNotMatch(code(model), /"dueDate"|"startTime"|"projectTitle"/, 'no row reads core\'s raw dates');
// Icons are lucide's own paths, with its ISC notice.
assert.match(iconsKt, /Lucide is ISC licensed/);
assert.match(iconsKt, /val Target = lucide\("Target", circle\(12, 12, 10\), circle\(12, 12, 6\), circle\(12, 12, 2\)\)/);

// Projects: read only through CoreHost's two calls, which reach only core's two project queries.
assert.match(coreHost, /fun projects\(\): JSONObject = callAsync\("projects"\)/);
assert.match(coreHost, /fun projectDetail\(id: String, offset: Int, limit: Int, revision: String\): JSONObject =\s*callAsync\("projectDetail", id, offset, limit, revision\)/);
assert.match(coreHost, /fun strings\(keys: List<String>\): JSONObject = callAsync\("strings", JSONArray\(keys\)\.toString\(\)\)/);
assert.match(hostEntry, /projects\(\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.getProjects\(\)\);/);
assert.match(hostEntry, /projectDetail\(id: string, offset: number, limit: number, revision: string\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.getProjectDetail\(\{ projectId: id, offset, limit, revision: revision \|\| undefined \}\)\);/);
// Labels are not stored data: a failed save never blocks them.
const labelCalls = hostEntry.slice(hostEntry.indexOf('language(stored: string, system: string): string {'), hostEntry.indexOf('    projects(): string {'));
assert.match(labelCalls, /contract\.setLanguage\(\{ storedLanguage: stored \|\| null, systemLocale: system \|\| null \}\)/);
assert.match(labelCalls, /contract\.getStrings\(\{ keys: JSON\.parse\(keysJson\) as string\[\] \}\)/);
assert.doesNotMatch(labelCalls, /requireSaved/);
assert.equal(model.match(/runtime\.projects\(\)/g).length, 2, 'read() after boot and commands, and the resume refresh');
assert.equal(model.match(/runtime\.projectDetail\(/g).length, 2, 'the first window and the next');
assert.equal([activity, owner, editorUi, focusUi, projectsUi].join('\n').match(/\.projects\(\)|projectDetail\(/g), null);
// Projects render only core's order: groups, areas, rows, and detail items are walked as parsed, never sorted or dropped.
assert.doesNotMatch(code(projectsUi) + code(model), /\.(sort\w*|sorted\w*|filter(?!Bg\b)\w*|groupBy|reversed|asReversed|shuffled|distinct\w*|partition|minBy|maxBy)\b/);
assert.match(projectsUi, /val PROJECT_BUCKETS = listOf\("active" to "projects\.activeSection", "deferred" to "projects\.deferredSection", "archived" to "projects\.closed"\)/);
for (const walk of [/List\(groups\.length\(\)\) \{ index ->/, /List\(rows\.length\(\)\) \{ row ->/, /List\(items\.length\(\)\) \{ index ->/,
    /for \(\(bucket, heading\) in PROJECT_BUCKETS\) \{/, /for \(group in groups\) \{/, /for \(row in group\.projects\) item/,
    /for \(entry in detail\?\.items\.orEmpty\(\)\) when \(entry\)/]) assert.match(projectsUi, walk);
assert.match(projectsUi, /group\.areaName \?: t\("projects\.noArea"\)/);
// The project status line is core's text (Completed or Cancelled for a closed project).
assert.match(projectsUi, /Text\(row\.statusLabel, style = rnText\(12, 400\), color = color\)/);
assert.doesNotMatch(code(projectsUi), /"list\.done"/);
assert.match(projectsUi, /val open = !collapsible \|\| \(if \(bucket == "deferred"\) projectsView\.showDeferred else projectsView\.showArchived\)/, 'Deferred and Archived start closed (RN\'s default)');
assert.match(projectsUi, /val areaKey = group\.areaId \?: "no-area"/);
// A read-only project's rows have no Complete; its cue is core's value, shown with mobile's label.
assert.match(projectsUi, /val completable = detail\?\.readOnly == false/);
assert.match(projectsUi, /TaskRowItem\(model, entry\.row, status = RowStatus\.Badge, completable = completable,\s*note = entry\.sequenceCue\?\.let\(CUE_KEYS::get\)\?\.let\(::t\), available = entry\.sequenceCue == "available"\)/);
// A stale window restarts the project from offset 0; it is never shown as an error.
assert.match(model, /if \(failure\.message\?\.startsWith\("STALE_REVISION"\) != true\) throw failure\s+return if \(start == null\) view else readProject\(runtime, id, null, depth\)/);
assert.match(model, /if \(id != openProjectId\) return\s+if \(detail == null\) keepProject\(null\)\s+project = detail/,
    'a reply for a closed project is dropped; a project core no longer has closes');
assert.match(model, /if \(failure\.message\?\.startsWith\("TASK_NOT_FOUND"\) != true\) throw failure\s+null/);
// Read on every resume of the Projects tab and after every command, as Focus is.
assert.match(projectsUi, /LaunchedEffect\(owner\) \{\s*owner\.repeatOnLifecycle\(Lifecycle\.State\.RESUMED\) \{ model\.refreshProjects\(\) \}/);
assert.equal(code([activity, model, projectsUi].join('\n')).match(/(?<!fun )refreshProjects\(\)/g).length, 1, 'one caller: the lifecycle loop');
assert.match(model, /ProjectsView\.parse\(runtime\.projects\(\)\),\s*at\.project,\s*readOpen\(runtime, at\),/);
// The open project survives rotation (ViewModel) and process death (SavedStateHandle); Back closes it unless a retry is owed.
assert.match(model, /var openProjectId by mutableStateOf\(saved\.get<String>\("project"\)\)/);
assert.match(model, /openProjectId = id\s+saved\["project"\] = id/);
assert.match(projectsUi, /BackHandler\(enabled = failedAction == null\) \{ closeProject\(\) \}/);

// Global search: core's searchTasks is a background read (per-view freshness, and an answer for another query is dropped
// by core's echoed query); saving a search is a perform(action) with its request UUID kept with the dialog.
assert.match(coreHost, /fun searchTasks\(json: String\): JSONObject = callAsync\("search", json\)/);
assert.match(coreHost, /fun saveSearch\(json: String\): JSONObject = callAsync\("saveSearch", json\)/);
assert.match(hostEntry, /search\(json: string\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*const input = JSON\.parse\(json\);\s*return unwrap\(await contract\.searchTasks\(\{ \.\.\.input, filters: input\.filters \?\? DEFAULT_GLOBAL_SEARCH_FILTERS \}\)\);/);
// Core owns what Kotlin once copied (core batch 4946dca7a): the search defaults (defaultFilters, and core's constant for the first
// read), each chip's cleared filters, the cancelled flag, the Markdown-free note preview, the More-options edit, and the picked-day edit.
assert.doesNotMatch(code(searchUi), /defaultSearchFilters|fun JSONObject\.(cleared|removed)\(|"cancelled"\)? *\}|getString\("kind"\) == "cancelled"|"(includeReference|hideFutureTasks|duePreset|scope|selectedArea)", *(true|false|"all"|"any")\)/,
    'no Kotlin copy of core\'s search defaults, chip clearing, or cancelled detection');
assert.match(searchUi, /row\.getBoolean\("cancelled"\)/);
assert.match(searchUi, /\{ focusManager\.clearFocus\(\); showSearchFilters\(true\) \}/, 'RN blurs the search field before its filter sheet opens');
assert.match(searchUi, /it\.getString\("label"\) to it\.getJSONObject\("clearedFilters"\)/);
assert.match(searchUi, /json\.getJSONObject\("defaultFilters"\)/);
assert.doesNotMatch(code(processUi), /"setDate"|"toggleAdvancedOptions"|take\(200\)|\.trim\(\)\.take/, 'no Kotlin copy of core\'s picked-day edit, More-options edit, or note preview');
assert.match(processUi, /send\(JSONObject\(it\.getJSONObject\("pick"\)\.toString\(\)\)\.put\("day", day\)\)/);
assert.match(processUi, /send\(more\.getJSONObject\("edit"\)\)/);
assert.match(processUi, /capture\.getString\("notePreview"\)/);
assert.doesNotMatch(code(searchUi + processUi), /Pending core field/);
assert.doesNotMatch(searchUi + processUi, /Pending core field/, 'the pending-core comments are gone with the copies');
assert.match(hostEntry, /saveSearch\(json: string\): string \{\s*return submit\(async \(\) => taskResult\('saveSearch', await contract\.saveSearch\(JSON\.parse\(json\)\)\)\);/);
assert.match(model, /background\(listOf\(Part\.Search\), \{ runtime -> SearchView\.parse\(runtime\.searchTasks\(request\)\) \}\) \{ view, mine ->\s+if \(fresh\(mine, Part\.Search\) && view\.query == search\?\.query\?\.trim\(\)\) searchView = view/);
assert.equal(model.match(/runtime\.searchTasks\(/g).length, 1);
assert.match(model, /FailedAction\("saveSearch", current\.saveRequestId, current\.query\.trim\(\), patch = mapOf\("name" to name\.trim\(\)\)\)/);
assert.match(model, /private fun sendSaveSearch\(action: FailedAction\) = perform\(action\) \{ runtime ->\s+try \{\s+runtime\.saveSearch\([^\n]*\.put\("requestId", action\.id\)\.toString\(\)\)[\s\S]{0,400}?acknowledged\(action\)/);
// The submitted Save Search request rides the screen state before the call, locks the dialog, and is reconciled after process death.
assert.match(model, /keepSearch\(current\.copy\(submitted = action\.patch\["name"\]\)\)\s+sendSaveSearch\(action\)/);
assert.match(model, /current\.submitted\?\.let \{ name -> if \(failedAction == null\) saveSearchAction\(current, name\)\.let \{ failedAction = it; sendSaveSearch\(it\) \} \}/);
assert.match(searchUi, /val owed = failedAction != null \|\| state\.submitted != null/);
assert.match(model, /if \(action\.kind == "saveSearch"\) keepSearch\(SearchState\(action\.title, saveName = action\.patch\["name"\], saveRequestId = action\.id, submitted = action\.patch\["name"\]\)\)/,
    'a new screen reopens the save dialog on an owed save, never re-sends it');
assert.match(searchUi, /failedAction == null \|\| failedAction == saveSearchAction\(state, sent\)/);
assert.match(searchUi, /failedAction == null \|\| failedAction == FailedAction\("complete", task\.id\)/, 'Mark Done from search is the lists\' Done with its exact retry');
assert.match(model, /private fun refreshAll\(\) \{[\s\S]*?if \(search != null\) readSearch\(\)\s+\}/, 'search is read again after every command');
// Search results are core's: core's highlight segments, date line and tone, and tap target; Kotlin never sorts or filters them.
assert.doesNotMatch(code(searchUi), /\.(sort\w*|sorted\w*|groupBy|reversed|shuffled|distinct\w*)\b/);
assert.match(searchUi, /row\.getJSONArray\("titleSegments"\)\.segments\(\)/);
assert.match(searchUi, /private val SEARCH_ROUTES = mapOf\("\/inbox" to Screen\.Inbox, "\/focus" to Screen\.Focus, "\/projects-screen" to Screen\.Projects\)/);

// Process Inbox: every read and edit goes to core's session; each answer is a perform(action) with its exact request,
// written to the no-backup file before the call, re-sent after process death, and refused requests unlock.
for (const [fn, js] of [['startInboxProcessing', 'inboxStart'], ['inboxProcessingStep', 'inboxStep'], ['commitInboxProcessingStep', 'inboxCommit'],
    ['skipInboxProcessingTask', 'inboxSkip'], ['endInboxProcessing', 'inboxEnd']]) {
    assert.match(coreHost, new RegExp(`fun ${fn}\\([^)]*\\): JSONObject = callAsync\\("${js}"`), `CoreHost.${fn} reaches host method ${js}`);
}
assert.match(hostEntry, /inboxStart\(mode: string\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);/);
assert.match(hostEntry, /inboxStep\(json: string\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.getInboxProcessingStep\(JSON\.parse\(json\)\)\);/);
assert.match(hostEntry, /inboxCommit\(json: string\): string \{\s*return submit\(async \(\) => taskResult\('inboxCommit', await contract\.commitInboxProcessingStep\(JSON\.parse\(json\)\)\)\);/);
assert.match(hostEntry, /inboxSkip\(json: string\): string \{\s*return submit\(async \(\) => taskResult\('inboxSkip', await contract\.skipInboxProcessingTask\(JSON\.parse\(json\)\)\)\);/);
assert.match(model, /private fun sendAnswer\(action: FailedAction, reopen: Boolean = true\) = perform\(action\) \{ runtime ->/);
assert.match(model, /val action = stepAction\(current, kind, choice\)\s+if \(busy \|\| \(failedAction != null && failedAction != action\)\) return\s+keepProcessing\(current\.copy\(pending = action, queued = null\)\)\s+sendAnswer\(action\)/,
    'the exact request is on disk before the call');
assert.match(model, /current\.pending\?\.takeIf \{ it\.kind == kind && it\.title == choice \}\s+\?: FailedAction\(kind, UUID\.randomUUID\(\)\.toString\(\), choice,/, 'a retry keeps its requestId');
assert.match(model, /keepProcessing\(restored\.copy\(hidden = true\)\)\s+failedAction = action\s+sendAnswer\(action, reopen = false\)/,
    'after process death the app lands on the Inbox; the record and its request stay on disk while they are sent again');
// The durable record goes only after core acknowledges (finishAnswer) or conclusively refuses (a stale session, an invalid request).
assert.match(model, /if \(current\.hidden\) \{ keepProcessing\(null\); return \}/);
assert.match(model, /keepProcessing\(if \(it\.hidden\) null else it\.copy\(pending = null\)\)/);
assert.match(model, /val started = if \(reopen\) InboxProcessing\.started\([^\n]*\) else null\s+acknowledged\(action\)\s+ui \{ keepProcessing\(started\)/);
assert.match(activity, /val flow = processing\?\.takeUnless \{ it\.hidden \}/);
assert.match(processUi, /\.put\("hidden", hidden\)/);
// Clearing an active chip sends core's clearedFilters for it, so a second tap changes nothing (core's clear).
assert.match(searchUi, /for \(\(label, cleared\) in view\.chips\) FilterChip\(label, label, true, true\) \{ setSearchFilters\(cleared\) \}/);
assert.match(model, /acknowledged\(action\)\s+ui \{ finishAnswer\(reply\) \}/);
assert.equal(code(model).match(/runtime\.(commitInboxProcessingStep|skipInboxProcessingTask)\(/g).length, 2);
assert.match(model, /if \(UPDATE_REFUSALS\.any \{ message\.startsWith\(it\) \}\) ui \{ failedAction = null; processing\?\.let \{ keepProcessing\(if \(it\.hidden\) null else it\.copy\(pending = null\)\) \} \}/,
    'a refused answer wrote nothing, so no request is owed');
assert.match(model, /saved\["processing"\] = value != null/);
assert.doesNotMatch(code(model), /saved\["processing"\] = (?!value != null)/, 'the Bundle holds only whether Process Inbox is open');
assert.match(model, /ProcessingStore\(File\(app\.noBackupFilesDir, "process-inbox"\)\)/);
assert.match(processUi, /FileOutputStream\(partial\)\.use \{ out -> out\.write\(state\.toString\(\)\.toByteArray\(\)\); out\.fd\.sync\(\) \}\s+check\(partial\.renameTo\(file\)\)/);
// Edits: one at a time, answered for their own session and still first in the queue; an older reply never resets newer typing.
assert.match(model, /val now = processing\?\.takeIf \{ it\.sessionId == current\.sessionId && it\.edits\.firstOrNull\(\) === next \}/);
assert.match(processUi, /LaunchedEffect\(key, coreValue, typing\) \{ if \(!typing && !pending && field\.text != coreValue\)/);
assert.match(processUi, /\.onFocusChanged \{ typing = it\.isFocused \}/, 'a focused draft input keeps its typing over core replies');
// No Kotlin policy: every chip sends core's own edit; Kotlin builds only the picker's setDate, the typed text, and the disclosure.
assert.match(processUi, /DayPickerDialog\(row\?\.text\("date"\)/, 'the picker starts on core\'s date and hands core only the picked day');
assert.doesNotMatch(code(processUi), /"(inbox|next|waiting|someday|reference|done)"\s*->/, 'no status decides a Process Inbox control');
assert.match(processUi, /const val PROCESSING_MODE_KEY = "mindwtr:view:inboxProcessingMode:v1"/);
// The Inbox's Process button: core's label (99+ above 99), and TalkBack hears core's exact count as RN does; Mind Sweep takes its
// slot while the Inbox is empty (pass 11: it opens RN's Mind Sweep, as the pill beside the controls does).
assert.match(inboxUi, /view\.optJSONObject\("process"\)\?\.let \{ ProcessButton\(model, it\) \}\s+\?: view\.getJSONObject\("mindSweep"\)\.let \{ sweep ->\s+ActionButton\(Lucide\.Brain, sweep\.getString\("label"\), idle, sweep\.getString\("accessibilityLabel"\)\) \{ openMindSweep\(\) \}/);
assert.match(inboxUi, /ActionButton\(Lucide\.ListChecks, process\.getString\("label"\), writable && !busy && failedAction == null, process\.getString\("accessibilityLabel"\)\) \{ openProcessing\(\) \}/);
assert.doesNotMatch(code(activity), /"\$inbox · \$total"/, 'the "Inbox · N" count line is gone, as in RN');

// The capture popup (pass 5): core's quick capture contract, every write through perform with its exact request on disk first.
for (const [fn, js] of [['openQuickCapture', 'captureOpen'], ['quickCaptureView', 'captureView'], ['editQuickCapture', 'captureEdit'],
    ['submitQuickCapture', 'captureSubmit'], ['createQuickCaptureSnapshot', 'captureSnapshot'], ['submitQuickCaptureLines', 'captureLines'],
    ['submitQuickCapturePickerQuery', 'capturePicker']]) {
    assert.match(coreHost, new RegExp(`fun ${fn}\\([^)]*\\): JSONObject = callAsync\\("${js}"`), `CoreHost.${fn} reaches host method ${js}`);
}
for (const read of ['captureOpen(): string', 'captureView(json: string): string', 'captureEdit(json: string): string']) {
    assert.match(hostEntry, new RegExp(`${read.replace(/[()]/g, '\\$&')} \\{\\s*return submit\\(async \\(\\) => \\{\\s*requireSaved\\(\\);`), `${read} waits for an owed save`);
}
for (const [method, operation, call] of [['captureSubmit', 'quickCapture', 'submitQuickCapture'], ['captureLines', 'quickCaptureLines', 'submitQuickCaptureLines'],
    ['capturePicker', 'quickCapturePicker', 'submitQuickCapturePickerQuery']]) {
    assert.match(hostEntry, new RegExp(`${method}\\(json: string\\): string \\{\\s*return submit\\(async \\(\\) => taskResult\\('${operation}', await contract\\.${call}\\(JSON\\.parse\\(json\\)\\)\\)\\);`));
}
for (const [fn, call] of [['sendCapture', 'submitQuickCapture'], ['sendLines', 'submitQuickCaptureLines'], ['sendPicker', 'submitQuickCapturePickerQuery']]) {
    assert.match(model, new RegExp(`private fun ${fn}\\(action: FailedAction\\) = perform\\(action\\) \\{ runtime ->`), `${fn} is a perform(action)`);
    const body = model.slice(model.indexOf(`private fun ${fn}(`), model.indexOf('\n    }\n', model.indexOf(`private fun ${fn}(`)));
    assert.match(body, new RegExp(`runtime\\.${call}\\(`));
    assert.match(body, /acknowledged\(action\)/);
    assert.match(body, /if \(UPDATE_REFUSALS\.any \{ failure\.message\?\.startsWith\(it\) == true \}\)[^\n]*freeCapture\(action\)/, `${fn}: a refusal frees the ID and unlocks`);
}
assert.equal(code(model).match(/runtime\.(submitQuickCapture|submitQuickCapturePickerQuery)\(/g).length, 2);
assert.equal(code(model).match(/runtime\.submitQuickCaptureLines\(/g).length, 1);
// Each request is on disk before its call; a retry reuses the same capture UUID(s) or request UUID.
for (const [kind, fn] of [['capture', 'sendCapture'], ['captureLines', 'sendLines'], ['capturePicker', 'sendPicker']]) {
    assert.match(model, new RegExp(`current\\.pending\\?\\.takeIf \\{ it\\.kind == "${kind}" \\}`), `${kind}: a retry reuses the pending request`);
    assert.match(model, new RegExp(`keepCapture\\(current\\.copy\\(pending = action[^)]*\\)\\)\\s+${fn}\\(action\\)`), `${kind}: the request is persisted before the call`);
}
assert.match(model, /FailedAction\("capture", current\.captureId, current\.text, patch = mapOf\("options" to current\.options\.toString\(\), "openAfterSave" to "\$openAfterSave"\)\)/);
assert.match(model, /FailedAction\("captureLines", current\.lineIds\.first\(\), current\.text,\s*patch = mapOf\("options" to current\.options\.toString\(\), "captureIds" to current\.lineIds\.joinToString\(","\)\)\)/);
assert.match(model, /failedAction = action\s+when \(action\.kind\) \{ "capture" -> sendCapture\(action\); "captureLines" -> sendLines\(action\); else -> sendPicker\(action\) \}/,
    'after process death an uncertain capture is sent again with the same IDs');
assert.match(model, /if \(action\.kind in CAPTURE_KINDS\) storedCapture\?\.let \{ keepCapture\(it\.copy\(pending = action\)\) \}/, 'a new screen reopens the popup on an owed capture, never re-sends it');
assert.match(model, /saved\["capturing"\] = value != null/);
assert.doesNotMatch(code(model), /saved\["capturing"\] = (?!value != null)|saved\["(draft|captureId|submittedTitle)"\]/, 'the Bundle holds only whether the popup is open');
assert.match(model, /CaptureStore\(File\(app\.noBackupFilesDir, "capture"\)\)/);
assert.match(captureUi, /FileOutputStream\(partial\)\.use \{ out -> out\.write\(state\.toString\(\)\.toByteArray\(\)\); out\.fd\.sync\(\) \}\s+check\(partial\.renameTo\(file\)\)/);
// Several lines: core's snapshot is written as mobile writes it (a temporary file, a clash number, the 5 newest) before the batch.
assert.match(model, /RecoverySnapshots\.write\(snapshots, it\.getString\("fileName"\), it\.getString\("contents"\)\)/);
assert.match(model, /private val snapshots = File\(app\.filesDir, "snapshots"\)/);
assert.match(snapshotsKt, /private const val MAX_SNAPSHOTS = 5/);
assert.match(snapshotsKt, /name = fileName\.removeSuffix\(SUFFIX\) \+ "\.\$clash\$SUFFIX"/);
assert.match(snapshotsKt, /FileOutputStream\(pending\)\.use \{ out -> out\.write\(contents\.toByteArray\(\)\); out\.fd\.sync\(\) \}\s+check\(pending\.renameTo\(File\(dir, name\)\)\)/);
// No Kotlin capture policy: every chip, picker row and reset sends core's own edit; Kotlin builds only the typed note and the picked day and time.
assert.deepEqual([...new Set([...code(captureUi).matchAll(/put\("type", "(\w+)"\)/g)].map(([, type]) => type))].sort(), ['setDueDay', 'setDueTime', 'setNote']);
// The Custom date and due time pickers open on core's values (due.custom.startDay, due.time.start).
assert.match(captureUi, /DayPickerDialog\(due\.getJSONObject\("custom"\)\.getString\("startDay"\), \{ pickDay = false \}\) \{ day ->\s+editCapture\(JSONObject\(\)\.put\("type", "setDueDay"\)\.put\("day", day\)\)\s+\}/);
assert.match(captureUi, /due\.child\("time"\)\?\.getString\("start"\)/);
// In landscape the body under the header scrolls with the footer at its end, so Save stays reachable.
assert.match(captureUi, /if \(landscape\) Modifier\.weight\(1f, fill = false\)\.verticalScroll\(rememberScrollState\(\)\)\.testTag\("capture-scroll"\)/);
assert.match(captureUi, /if \(landscape\) footer\(\)\s+\}\s+if \(!landscape\) footer\(\)/);
// Durable draft (review of pass 5): an unanswered request comes back without saved state, edits are on disk before
// they are sent, and the batch sends and persists the snapshot name RecoverySnapshots wrote before the call.
assert.match(model, /storedCapture\?\.takeIf \{ saved\.get<Boolean>\("capturing"\) == true \|\| it\.pending != null \}/);
assert.match(model, /keepCapture\(current\.copy\(requests = current\.requests \+ JSONObject\(\)\.put\("edit", edit\)\)\)\n/, 'an edit is persisted before it is sent');
assert.match(captureUi, /\.put\("edits", /);
assert.match(model, /val written = taken\?\.let \{ RecoverySnapshots\.write\(snapshots, it\.getString\("fileName"\), it\.getString\("contents"\)\) \}\s+onMain \{ capture\?\.let \{ keepCapture\(it\.copy\(snapshot = written, snapshotTaken = true\)\) \} \}\s+submit\(written\)/);
assert.equal(code(model).match(/snapshotFileName/g).length, 1);
assert.match(model, /\.put\("snapshotFileName", name \?: JSONObject\.NULL\)/);
assert.match(model, /if \(!taken\) fresh\(\) else try \{ submit\(name\) \} catch \(failure: Exception\) \{\s+if \(failure\.message\?\.startsWith\("STALE_REVISION"\) != true\) throw failure\s+fresh\(\)/,
    'a replay sends the persisted snapshot name first; a stale one takes, persists and sends a new one with the same IDs');
// RN keeps the field focused for the next capture: a save locks (and unfocuses) the field; it takes focus back after.
assert.match(captureUi, /LaunchedEffect\(draft\.session, locked\) \{ if \(!draft\.expanded && !locked\) \{ delay\(120\); runCatching \{ titleFocus\.requestFocus\(\) \} \} \}/);
assert.match(captureUi, /const val ADD_ANOTHER_KEY = "mindwtr:quickCapture:addAnother"/);

// The Menu tab (pass 6): RN's More sheet and its lists on core's menu view contract, through the shell's command path.
// Every menu write is a perform(action) with its exact FailedAction; a failure keeps it (the banner's Try again re-sends it).
assert.match(coreHost, /fun menuRead\(name: String, json: String\): JSONObject = callAsync\("menuRead", name, json\)/);
assert.match(coreHost, /fun menuCommand\(name: String, json: String\): JSONObject = callAsync\("menuCommand", name, json\)/);
{
    // Settings' commands (pass 10) join the Menu tab's: MENU_KINDS is its own set plus SettingsModel.kt's SETTINGS_KINDS.
    // Pass 11's commands (Bulk organize's create, Mind Sweep's Add, a saved search's Delete) close the set.
    assert.match(menuModel, /"savedSearchDelete"\) \+ SETTINGS_KINDS/);
    const kinds = [...[...new RegExp('val MENU_KINDS = setOf\\(([^)]*)\\)').exec(menuModel)[1].matchAll(/"(\w+)"/g)].map(([, kind]) => kind),
        ...[...new RegExp('val SETTINGS_KINDS = setOf\\(([^)]*)\\)').exec(source('SettingsModel.kt'))[1].matchAll(/"(\w+)"/g)].map(([, kind]) => kind)];
    const hostKinds = [...hostEntry.slice(hostEntry.indexOf('const MENU_COMMANDS'), hostEntry.indexOf('};', hostEntry.indexOf('const MENU_COMMANDS'))).matchAll(/^\s+(\w+): \(input\) => contract\.\w+\(input\),$/gm)].map(([, kind]) => kind);
    assert.deepEqual(hostKinds.sort(), [...kinds].sort(), 'every menu command kind is one host command, logged as its operation');
    assert.match(hostEntry, new RegExp(`type MenuCommand = ${kinds.map((kind) => `'${kind}'`).join('\\s*\\| ')};`));
    assert.match(hostEntry, /menuCommand\(name: string, json: string\): string \{\s*return submit\(async \(\) => \{\s*const command = MENU_COMMANDS\[name as MenuCommand\];[\s\S]{0,120}?return taskResult\(name as MenuCommand, await command\(JSON\.parse\(json\) as never\)\);/);
    assert.match(hostEntry, /menuRead\(name: string, json: string\): string \{\s*return submit\(async \(\) => \{[\s\S]{0,300}?if \(name !== 'more'\) requireSaved\(\);\s*const read = MENU_READS\[name\];[\s\S]{0,100}?return unwrap\(read\(JSON\.parse\(json\) as never\)\);/);
    const input = code(menuModel.slice(menuModel.indexOf('private fun input(action: FailedAction)'), menuModel.indexOf('}.toString()', menuModel.indexOf('private fun input('))));
    // The list actions (Archive, Contexts, Trash, Review, and the Review's project Add task) are core's action with its request UUID.
    const LIST_KINDS = ['archiveAction', 'contextsAction', 'trashAction', 'reviewAction', 'reviewTask'];
    for (const kind of kinds.filter((kind) => !LIST_KINDS.includes(kind))) assert.match(input, new RegExp(`"${kind}"(, "\\w+")* ->`), `input() builds the ${kind} request`);
    for (const kind of LIST_KINDS) assert(kinds.includes(kind), `MENU_KINDS has ${kind}`);
    assert.doesNotMatch(input, new RegExp(`"(${LIST_KINDS.join('|')})" ->`), 'no list action has a request of its own shape');
    assert.match(input, /else -> JSONObject\(\)\.put\("requestId", action\.id\)\.put\("action", JSONObject\(action\.title\)\)/, 'a list action is core\'s action with its request UUID');
}
assert.match(menuModel, /private fun send\(action: FailedAction\) = shell\.perform\(action\) \{ runtime ->\s+val reply = try \{\s+runtime\.menuCommand\(action\.kind, input\(action\)\)[\s\S]{0,2000}?shell\.acknowledged\(action\)/, 'menu writes run through perform with their exact FailedAction');
assert.match(menuModel, /if \(refused && action\.kind == "focusSave"\) shell\.ui \{ focusControls\.refused\(action\) \}/, 'a refused saved filter frees its request UUID');
assert.match(menuModel, /if \(refused && action\.kind == "calendarCreate"\) shell\.ui \{ calendar\.refused\(action\) \}/, 'a refused composer Save frees its request UUID');
assert.equal(code(menuModel).match(/runtime\.menuCommand\(/g).length, 1, 'send is the one menu write');
assert.equal(code(menuModel).match(/shell\.perform\(action\)/g).length, 1);
assert.match(menuModel, /fun retry\(action: FailedAction\) = send\(action\)/);
assert.match(model, /else -> menu\.retry\(action\)\s+\}\s+\}/, 'retryOwed hands every menu kind to its exact re-send');
for (const [name, text] of Object.entries(menuScreens)) {
    assert.doesNotMatch(code(text).replace(/^import .*$/gm, ''), /runtime\.|menuCommand\(|menuRead\(/, `${name}: screens reach core only through MenuModel`);
}
// A Someday create's exact request (a capture UUID, or a section title core finds again) is on disk, synced, before the call;
// after process death it is sent before anything else, even without saved state; it goes only after core answers.
assert.match(menuModel, /fun saveCreate\(\) \{\s+val action = createAction\(\) \?: return\s+if \(shell\.busy \|\| \(shell\.failedAction != null && shell\.failedAction != action\)\) return\s+store\.write\(action\)\s+send\(action\)/);
assert.match(menuModel, /FileOutputStream\(partial\)\.use \{ out -> out\.write\(state\.toString\(\)\.toByteArray\(\)\); out\.fd\.sync\(\) \}\s+check\(partial\.renameTo\(file\)\)/);
assert.match(model, /val menu = MenuModel\(this, saved, prefs, File\(app\.noBackupFilesDir, "menu"\)\)/);
assert.match(menuModel, /store\.read\(\)\?\.let \{ pending ->\s+if \(shell\.failedAction == null\) \{\s+shell\.owe\(pending\)\s+send\(pending\)/);
assert.match(model, /if \(reopenCapture != null\) resumeCapture\(reopenCapture\) else captureStore\.delete\(\)\s+\/\/[^\n]*\s+menu\.start\(sheet\)/);
assert.match(menuModel, /if \(refused && action\.kind in CREATES\) shell\.ui \{ store\.delete\(\) \}/, 'a refused create wrote nothing: its record goes');
assert.match(menuModel, /shell\.acknowledged\(action\)\s+shell\.ui \{\s+if \(action\.kind in CREATES\) store\.delete\(\)/, 'an acknowledged create\'s record goes');
assert.equal(code(menuModel).match(/store\.delete\(\)/g).length, 2, 'only an answer from core removes a pending create');
assert.match(menuModel, /"addTask" -> FailedAction\("somedayTask", open\.getString\("captureId"\), text,/, 'Add task sends its capture UUID, kept with its dialog');
// Reads: background refreshes and user reads, with the shell's per-list freshness; paging stays under one revision and a stale
// window reads the list again from its first window (not an error).
assert.match(menuModel, /shell\.background\(listOf\(Part\.Menu\), \{ runtime -> read\(runtime, list, params, depth, deep, bulk = bulk\) \}\) \{ next, mine ->\s+if \(shell\.fresh\(mine, Part\.Menu\)\) show\(list, next\)/);
assert.match(menuModel, /shell\.ui \{ if \(shell\.fresh\(mine, Part\.Menu\)\) show\(list, next\) \}/);
assert.match(menuModel, /\.put\("offset", page\.items\.size\)\.put\("limit", PAGE\)\.put\("revision", page\.revision\)/, 'later windows carry the view\'s revision');
assert.match(menuModel, /runtime\.menuRead\("collection", JSONObject\(\)\.put\("view", list\)\.put\("collection", name\)\.put\("params", page\.params\)/, 'collections page through getMenuViewCollection with the accepted params');
// The Inbox's and Archive's filter tokens page through their own reads (getInboxFilterTokens, getArchiveFilterTokens), with the
// accepted params and the view's revision; a picker search (query) reads the matches from offset zero.
assert.match(menuModel, /"inbox", "archive" -> runtime\.menuRead\(if \(list == "inbox"\) "inboxTokens" else "archiveTokens", JSONObject\(\)\.put\("params", page\.params\)\s+\.put\("offset", offset\)\.put\("limit", WINDOW\)\.put\("revision", page\.revision\)\.apply \{ query\?\.let \{ put\("query", it\) \} \}/);
assert.equal(code(menuModel).match(/if \(failure\.message\?\.startsWith\("STALE_REVISION"\) != true\) throw failure/g).length, 5,
    'read, More, a collection\'s More, the move dialog\'s choices and a picker search treat a stale window as a reread, never an error');
assert.match(menuModel, /private fun readMoveChoices\(depth: Int = WINDOW\) \{[\s\S]*?\.put\("offset", 0\)[\s\S]*?\.put\("revision", first\.getString\("revision"\)\)[\s\S]*?if \(failure\.message\?\.startsWith\("STALE_REVISION"\) != true\) throw failure/,
    'the move dialog pages its choices under the first window\'s revision and rereads from the first window');
assert.match(menuModel, /fun moreMoveChoices\(\) \{ moveChoices\?\.getJSONObject\("choices"\)\?\.getJSONArray\("items"\)\?\.length\(\)\?\.let \{ readMoveChoices\(it \+ WINDOW\) \} \}/);
assert.match(model, /private fun refreshAll\(\) \{\s+val at = depth\(\)\s+background\(Part\.entries, \{ runtime -> read\(runtime, at\) \}, ::showLists\)\s+menu\.refresh\(\)/, 'the open Menu list is read again after every command');
// Filters, sorts and groups: every choice sends the exact edit or value core put on it; only typed text builds an edit.
{
    // Kotlin names only core's Archive and bulk actions (NativeArchiveAction, NativeBulkAction), the typed text's edits (a filter's
    // setSearch or setLocation through its `type` variable, Bulk Organize's setText), and nothing else.
    const bulkSource = readFileSync(resolve(app, '../../packages/core/src/native-host-contract-bulk-actions.ts'), 'utf8');
    const unionOf = (text, type) => [...(new RegExp(`export type ${type} =([\\s\\S]*?);\\n`).exec(text)?.[1] ?? '').matchAll(/type: '(\w+)'/g)].map(([, name]) => name);
    const allowed = new Set([...unionOf(contractSource, 'NativeArchiveAction'), ...unionOf(bulkSource, 'NativeBulkAction'), 'setSearch', 'setText', 'type']);
    assert(allowed.has('setCompletedAt') && allowed.has('organize') && allowed.has('restoreTasks'), 'core\'s action unions were read');
    const used = new Set([...code(menuModel + menuUi + archiveUi + bulkUi).matchAll(/put\("type", "?(\w+)/g)].map(([, type]) => type));
    for (const type of used) assert(allowed.has(type), `${type} is one of core's Archive or bulk actions, or typed text's edit`);
    assert(['setCompletedAt', 'moveTasks', 'editTaskTokens', 'organize', 'trashTasks'].every((type) => used.has(type)));
}
assert.match(menuModel, /reload\(JSONObject\(\)\.put\("type", type\)\.put\("value", text\)\)/);
assert.match(menuUi, /filterEdit\(option\.getJSONObject\("edit"\)\)/);
assert.match(menuUi, /filterEdit\(filters\.getJSONObject\("clearEdit"\)\)/);
assert.match(menuUi, /removeChip\(chip\.getJSONObject\("action"\)\)/);
// No Kotlin policy in the new files: core's items, headings, collections and options are walked as sent.
for (const [name, text] of Object.entries({ menuModel, ...menuScreens })) {
    assert.doesNotMatch(code(text), /\.(sort\w*|sorted\w*|filter(?!Bg\b|Edit\b)\w*|groupBy|reversed|asReversed|shuffled|distinct\w*|partition|minBy|maxBy)\b/, `${name}: no Kotlin sorting, filtering, or grouping (filterEdit sends core's edit)`);
    // The date APIs, not a calendar icon or heading (Lucide.Calendar, the reviews' calendar cards).
    assert.doesNotMatch(code(text), /SimpleDateFormat|DateTimeFormatter|LocalDate|java\.time|java\.util\.Calendar|Calendar\.getInstance|GregorianCalendar|Instant\b|\.format\(|toLocal/, `${name}: no Kotlin date formatting or parsing`);
    assert.doesNotMatch(code(text), new RegExp(`${STATUS}(?:\\s*,\\s*${STATUS})*\\s*->\\s*${STATUS}`), `${name}: no status-to-status map`);
}
// The More sheet: core's destinations (getMoreMenu); a tile this app builds opens, the others are drawn disabled, never a dead tap.
// One accessibility node holds the label, the role and the state, so TalkBack hears an unbuilt tile as disabled.
assert.equal(moreUi.match(/\.clearAndSetSemantics \{\s+contentDescription = label; role = Role\.Button\s+if \(enabled\) onClick \{ model\.menu\.openTile\(id\); true \} else disabled\(\)\s+\}\s+\.clickable\(enabled = enabled\) \{ model\.menu\.openTile\(id\) \}\.fade\(if \(enabled\) 1f else 0\.45f\)/g)?.length, 2, "an unbuilt tile is disabled and dimmed on its labelled node; a built one is dimmed only while a command runs or a retry is owed");
assert.match(menuModel, /fun opens\(id: String\) = id in setOf\("waiting", "someday", "reference", "history", "projects", "review", "contexts", "trash", "calendar", "board", "settings"\)/);
assert.match(activity, /if \(menu\.sheet\) MoreSheet\(model\)/);
assert.match(activity, /else if \(listed != null && writable\) MenuScreenHost\(model, listed\)/);
// Navigation survives rotation (the model is held by the ViewModel) and process death (the Bundle): the sheet, screen, tab, dialog, session.
for (const key of ['menuSheet', 'menuScreen', 'historyTab', 'menuState', 'menuDialog', 'quickAccess', 'reviewFrom']) assert.match(menuModel, new RegExp(`saved(\\.get<\\w+>\\("${key}"\\)|\\["${key}"\\])`), `${key} rides the Bundle`);
assert.match(menuUi, /BackHandler\(enabled = failedAction == null\) \{ if \(menu\.dialog != null\) menu\.backInDialog\(\) else if \(menu\.page\?\.bulk != null\) menu\.list\?\.let\(menu::endBulk\) else menu\.closeScreen\(\) \}/);
// Search results for the Menu lists open them (review ruling 5 of pass 4).
assert.match(searchUi, /listed != null -> \{ closeSearch\(\); menu\.openRoute\(listed\); highlight\(task\.id\) \}/);
assert.match(menuModel, /"\/waiting" to \(MenuScreen\.Waiting to null\), "\/someday" to \(MenuScreen\.Someday to null\),\s+"\/reference" to \(MenuScreen\.Reference to null\), "\/done" to \(MenuScreen\.History to "done"\), "\/archived" to \(MenuScreen\.History to "archived"\)/);
// RN's device view state: Done and Archived under RN's keys, folded groups under RN's per-list key.
assert.match(viewStateKt, /const val DONE_VIEW_KEY = "mindwtr:view:done:v1"/);
assert.match(viewStateKt, /const val ARCHIVED_VIEW_KEY = "mindwtr:view:archived:v1"/);
assert.match(viewStateKt, /private fun key\(list: String\) = "mindwtr:view:group-collapse:\$list:v1"/);

// Pass 7: Contexts, Trash, Review, and the Weekly and Daily Review, on core's list views and review views.
// Reads pass Kotlin's input to core unchanged; every write is core's action through MenuModel.act -> send -> perform(action).
for (const [name, method] of [['contexts', 'getContextsView'], ['trash', 'getTrashView'], ['review', 'getReviewOverview'], ['weekly', 'getWeeklyReview'],
    ['weeklyList', 'getWeeklyReviewList'], ['daily', 'getDailyReview']]) {
    assert.match(hostEntry, new RegExp(`^\\s+${name}: \\(input\\) => contract\\.${method}\\(input\\),$`, 'm'), `menuRead ${name} is core's ${method}`);
}
for (const [name, method] of [['contextsAction', 'runContextsAction'], ['trashAction', 'runTrashAction'], ['reviewAction', 'runReviewAction'], ['reviewTask', 'runReviewAction']]) {
    assert.match(hostEntry, new RegExp(`^\\s+${name}: \\(input\\) => contract\\.${method}\\(input\\),$`, 'm'), `menuCommand ${name} is core's ${method}`);
}
assert.match(menuModel, /internal fun act\(kind: String, action: JSONObject\) = send\(FailedAction\(kind, UUID\.randomUUID\(\)\.toString\(\), action\.toString\(\)\)\)/,
    'a list action is one command with a new request UUID; the action itself is its exact retry');
for (const [name, text] of Object.entries(reviewScreens)) {
    assert.doesNotMatch(code(text), /\bsend\(|shell\.perform|FailedAction\(/, `${name}: writes go through MenuModel.act or saveCreate, never around perform`);
}
// Kotlin names only core's action types (NativeContextsAction, NativeTrashAction, NativeReviewAction) and Review's expansion edits.
{
    const reviewSource = readFileSync(resolve(app, '../../packages/core/src/native-host-contract-review-views.ts'), 'utf8');
    const union = (text, type) => [...(new RegExp(`export type ${type} =([\\s\\S]*?);\\n`).exec(text)?.[1] ?? '').matchAll(/type: '(\w+)'/g)].map(([, name]) => name);
    const allowed = new Set([...union(contractSource, 'NativeContextsAction'), ...union(contractSource, 'NativeTrashAction'),
        ...union(reviewSource, 'NativeReviewAction'), ...union(reviewSource, 'NativeReviewExpansionEdit')]);
    assert(allowed.has('emptyTrash') && allowed.has('addProjectTask') && allowed.has('toggleArea'), 'core\'s action unions were read');
    const used = new Set([...code(Object.values(reviewScreens).join('\n')).matchAll(/put\("type", "(\w+)"\)/g)].map(([, type]) => type));
    assert(used.size > 0);
    for (const type of used) assert(allowed.has(type), `${type} is one of core's list actions or expansion edits`);
    assert.doesNotMatch(code(Object.values(reviewScreens).join('\n')), /put\("type", [^"]/, 'no action type is built from a variable');
}
// Destructive actions stay as safe as RN: delete forever, the selection's delete forever, and Clear Trash only after core's question;
// Clear Trash sends the revision its question showed (core refuses a stale one).
for (const call of ['purgeItem(kind, id)', 'purgeItems(tasks, projects)', 'emptyTrash(clear.getString("revision"))']) {
    const at = trashUi.indexOf(call);
    assert(at > 0 && trashUi.slice(Math.max(0, at - 160), at).includes('confirm('), `Trash sends ${call} only from core's confirmation`);
}
assert.equal(code(trashUi).match(/\b(purgeItem|purgeItems|emptyTrash)\(/g).length, 3, 'Trash builds each destructive action once, inside its confirmation');
assert.match(menuUi, /confirmButton = \{ TextButton\(onClick = \{ keepDialog\(null\); act\(open\.optString\("command", "archiveAction"\), open\.getJSONObject\("action"\)\) \}, enabled = idle\)/);
// Bulk trash (Contexts, Review) asks core's question first too; a row's trash is the recoverable move with core's Undo, as in RN.
assert.match(contextsUi, /confirm\(bulk\.getJSONObject\("deleteConfirmation"\), trashTasks\(selected\), "contextsAction"\)/);
assert.match(reviewUi, /"delete" -> confirm\(bulk\.getJSONObject\("deleteConfirmation"\), trashTasks\(selected\), "reviewAction"\)/);
// The status menu on a list whose contract writes its rows sends that list's setTaskStatus; elsewhere it keeps updateTask.
assert.match(rowUi, /\.clickable\(enabled = enabled, role = Role\.Button\) \{ if \(!menu\.rowStatus\(task, status\)\) changeStatus\(task, status\) \}/);
assert.match(menuModel, /private val ROW_KINDS = mapOf\("contexts" to "contextsAction", "review" to "reviewAction", "weekly" to "reviewAction", "daily" to "reviewAction"\)/);
// The Weekly Review's project Add task creates a task: its exact request (the request UUID core makes the task's id) is on disk first.
assert.match(menuModel, /private val CREATES = setOf\("somedayTask", "somedaySection", "reviewTask", "calendarCreate", "boardCreate", "focusSave", "manageEditor", "bulkCreate", "mindSweepAdd"\)/);
assert.match(menuModel, /"projectTask" -> FailedAction\("reviewTask", open\.getString\("requestId"\), addProjectTask\(open\.getString\("projectId"\), open\.optString\("text"\)\)\.toString\(\)\)/);
assert.equal(code(weeklyUi).match(/saveCreate\(\)/g).length, 3, 'Return, Save & edit and Add all send the one persisted request');
// A review's place is core's checkpoint, stored under core's key (RN's session keys) and sent back; Finish deletes it.
{
    const reviewModelSource = readFileSync(resolve(app, '../../packages/core/src/review-views-model.ts'), 'utf8');
    for (const [kotlin, core] of [['WEEKLY_REVIEW_KEY', 'WEEKLY_REVIEW_SESSION_STORAGE_KEY'], ['DAILY_REVIEW_KEY', 'DAILY_REVIEW_SESSION_STORAGE_KEY']]) {
        const value = new RegExp(`export const ${core} = '([^']+)'`).exec(reviewModelSource)[1];
        assert.match(viewStateKt, new RegExp(`const val ${kotlin} = "${value}"`), `${kotlin} is core's ${core}`);
    }
}
assert.match(menuModel, /if \(list == "weekly" \|\| list == "daily"\) prefs\.edit\(\)\.putString\(next\.view\.getString\("storageKey"\), next\.view\.getString\("checkpoint"\)\)\.apply\(\)/);
assert.match(weeklyUi, /prefs\.edit\(\)\.remove\(view\.getString\("storageKey"\)\)\.apply\(\)/);
// Paging stays under the view's revision: the Weekly Review's nested lists page through getWeeklyReviewList with the view's own inputs.
assert.match(menuModel, /runtime\.menuRead\("weeklyList", JSONObject\(page\.params\.toString\(\)\)\.put\("list", name\.substringBefore\(':'\)\)[\s\S]{0,160}?\.put\("revision", page\.revision\)/);
// RN's quick-access tab: core's quickAccessView; Review, Contexts and the Calendar (pass 8) are built, anything else shows Projects.
assert.match(menuModel, /val quickView: String get\(\) = quickAccess\?\.takeIf \{ it == "review" \|\| it == "contexts" \|\| it == "calendar" \} \?: "projects"/);
assert.match(activity, /TabItem\(model, Screen\.Projects, when \(quick\) \{ "review" -> Lucide\.ClipboardCheck; "contexts" -> Lucide\.Circle; "calendar" -> Lucide\.Calendar; else -> Lucide\.Folder \}, model\.menu\.quickLabel\)/);
assert.match(model, /val sheet = runCatching \{ menu\.readSheet\(runtime\) \}\.getOrNull\(\)/, 'the quick-access view is read on the boot thread, before the first frame');

// Pass 8: the Calendar and the Board, on core's calendar and Board contracts.
{
    const calendarModel = source('CalendarModel.kt');
    const calendarUi = source('CalendarScreen.kt');
    const boardModel = source('BoardModel.kt');
    const boardUi = source('BoardScreen.kt');
    const pass8 = { calendarModel, calendarUi, boardModel, boardUi };
    // Reads pass Kotlin's input to core unchanged (the composer's open and edit write nothing); writes are core's actions.
    for (const [name, method] of [['calendar', 'getCalendarView'], ['calendarSheet', 'getCalendarItemSheet'], ['calendarComposer', 'openCalendarComposer'],
        ['calendarEdit', 'editCalendarComposer'], ['board', 'getBoardView'], ['boardList', 'getBoardList']]) {
        assert.match(hostEntry, new RegExp(`^\\s+${name}: \\(input\\) => contract\\.${method}\\(input\\),$`, 'm'), `menuRead ${name} is core's ${method}`);
    }
    for (const [name, method] of [['calendarAction', 'runCalendarAction'], ['calendarCreate', 'runCalendarAction'], ['boardAction', 'runBoardAction'], ['boardCreate', 'runBoardAction']]) {
        assert.match(hostEntry, new RegExp(`^\\s+${name}: \\(input\\) => contract\\.${method}\\(input\\),$`, 'm'), `menuCommand ${name} is core's ${method}`);
    }
    // Every write is MenuModel's send -> perform(action) with its exact FailedAction: an action through command (a new request UUID,
    // core's whole input its exact retry), a create (the composer's Save, Duplicate) through create, on disk (synced) before the call.
    assert.match(menuModel, /internal fun command\(kind: String, input: JSONObject\) = send\(FailedAction\(kind, UUID\.randomUUID\(\)\.toString\(\), input\.toString\(\)\)\)/);
    assert.match(menuModel, /internal fun create\(action: FailedAction\) \{\s+if \(shell\.busy \|\| \(shell\.failedAction != null && shell\.failedAction != action\)\) return\s+store\.write\(action\)\s+send\(action\)/);
    assert.match(menuModel, /"calendarAction", "calendarCreate", "boardAction", "boardCreate" -> JSONObject\(action\.title\)\.put\("requestId", action\.id\)/);
    assert.match(menuModel, /"calendarAction", "calendarCreate" -> calendar\.done\(action, reply\)\s+"boardAction", "boardCreate" -> board\.done\(action, reply\)/);
    assert.match(calendarModel, /private fun act\(action: JSONObject\) = menu\.command\("calendarAction", JSONObject\(\)\.put\("action", action\)/);
    assert.match(calendarModel, /private fun saveAction\(draft: ComposerDraft\) = FailedAction\("calendarCreate", draft\.requestId, /, 'a composer Save keeps its request UUID (core makes it the new task\'s id)');
    assert.match(calendarModel, /owed\(draft\)\?\.let \{ return menu\.create\(it\) \}[\s\S]{0,200}?menu\.create\(saveAction\(draft\)\)/, 'Save re-sends the owed request, else the composer\'s own');
    assert.match(boardModel, /fun duplicate\(taskId: String\) = menu\.create\(FailedAction\("boardCreate", UUID\.randomUUID\(\)\.toString\(\),/, 'Duplicate\'s request UUID is the copy\'s id, on disk first');
    assert.equal(code(calendarModel).match(/menu\.command\(/g).length, 1, 'the Calendar writes through act');
    assert.equal(code(boardModel).match(/menu\.command\(/g).length, 2, 'the Board writes moveCard and trashTask through command');
    for (const [name, text] of Object.entries({ calendarUi, boardUi })) {
        assert.doesNotMatch(code(text).replace(/^import .*$/gm, ''), /runtime\.|menuCommand\(|menuRead\(|\bsend\(|shell\.perform|FailedAction\(|menu\.command|menu\.create/, `${name}: the screen reaches core only through its model`);
    }
    for (const [name, text] of Object.entries({ calendarModel, boardModel })) {
        assert.doesNotMatch(code(text), /menuCommand\(|\bsend\(|shell\.perform\(action|\.perform\([A-Za-z]/, `${name}: writes only through MenuModel.command or create`);
    }
    // Kotlin names only core's actions and edits: NativeCalendarAction, NativeCalendarComposerEdit, NativeBoardAction and BoardFilterEdit.
    const calendarSource = readFileSync(resolve(app, '../../packages/core/src/native-host-contract-calendar.ts'), 'utf8');
    const boardSource = readFileSync(resolve(app, '../../packages/core/src/native-host-contract-board.ts'), 'utf8');
    const boardViewSource = readFileSync(resolve(app, '../../packages/core/src/board-view-model.ts'), 'utf8');
    const union = (text, type) => [...(new RegExp(`export type ${type} =([\\s\\S]*?);\\n`).exec(text)?.[1] ?? '').matchAll(/'(\w+)'/g)].map(([, name]) => name);
    const allowed = new Set([...union(calendarSource, 'NativeCalendarAction'), ...union(calendarSource, 'NativeCalendarComposerEdit'),
        ...union(boardSource, 'NativeBoardAction'), ...union(boardViewSource, 'BoardFilterEdit')]);
    for (const name of ['moveTask', 'saveComposer', 'selectTask', 'startTime', 'moveCard', 'duplicateTask', 'toggleDuePreset', 'setMatchMode']) assert(allowed.has(name), `core's unions were read (${name})`);
    const typed = [...code(Object.values(pass8).join('\n')).matchAll(/put\("type", (?:if \([^)]*\) )?"(\w+)"(?: else "(\w+)")?\)/g)].flatMap(([, a, b]) => [a, b].filter(Boolean));
    assert(typed.length > 10);
    for (const type of typed) assert(allowed.has(type), `${type} is one of core's calendar or Board actions or edits`);
    assert.doesNotMatch(code(Object.values(pass8).join('\n')), /put\("type", (?!if \()[^"]/, 'no action or edit type is built from a variable');
    // Paging under one revision; STALE_REVISION reads again from the first window (once), never an error.
    assert.match(calendarModel, /\.put\("offset", items\.length\(\)\)\.put\("limit", WINDOW\)\s*\.put\("revision", first\.getString\("revision"\)\)/);
    assert.match(calendarModel, /if \(failure\.message\?\.startsWith\("STALE_REVISION"\) != true\) throw failure\s+if \(again\) return read\(runtime, sent, sentQuery, again = false\)/);
    assert.match(boardModel, /\.put\("revision", shown\.revision\)/);
    assert.match(boardModel, /if \(failure\.message\?\.startsWith\("STALE_REVISION"\) != true\) throw failure\s+if \(again\) return read\(runtime, view\.getJSONObject\("filters"\), null, depth, again = false\)/);
    // A calendar changes with the clock: read again each minute while it shows, and on resume (the screen hosts' refresh).
    assert.match(calendarUi, /owner\.repeatOnLifecycle\(Lifecycle\.State\.RESUMED\) \{ while \(true\) \{ delay\(60_000\); refresh\(\) \} \}/);
    assert.match(menuModel, /if \(list == "calendar"\) return calendar\.refresh\(\)\s+if \(list == "board"\) return board\.refresh\(\)/);
    // Navigation state rides the Bundle: the Calendar's place, search, sheet and composer draft; the Board's filters, search and sheet.
    for (const key of ['calendarState', 'calendarQuery', 'calendarSheet', 'calendarComposer']) assert.match(calendarModel, new RegExp(`saved(\\.get<\\w+>\\("${key}"\\)|\\["${key}"\\])`), `${key} rides the Bundle`);
    for (const key of ['boardFilters', 'boardSearch', 'boardSheet']) assert.match(boardModel, new RegExp(`saved(\\.get<\\w+>\\("${key}"\\)|\\["${key}"\\])`), `${key} rides the Bundle`);
    // No Kotlin task policy, sorting, filtering, date math or date formatting in the new files.
    for (const [name, text] of Object.entries(pass8)) {
        // `.filters` is core's filter state (the Board view's), not a filtering call.
        assert.doesNotMatch(code(text), /\.(sort\w*|sorted\w*|filter(?!Bg\b|Edit\b|s\b)\w*|groupBy|reversed|asReversed|shuffled|distinct\w*|partition|minBy|maxBy)\b/, `${name}: no Kotlin sorting, filtering, or grouping`);
        assert.doesNotMatch(code(text), /SimpleDateFormat|DateTimeFormatter|LocalDate|LocalTime|java\.time|java\.util\.Calendar|Calendar\.getInstance|GregorianCalendar|Instant\b|\.format\(|toLocal|currentTimeMillis|\bDate\(|TimeZone/, `${name}: no Kotlin date math, formatting or parsing`);
        assert.doesNotMatch(code(text), new RegExp(`${STATUS}(?:\\s*,\\s*${STATUS})*\\s*->\\s*${STATUS}`), `${name}: no status-to-status map`);
    }
    // Kotlin turns a finger's place into core's grid cell only: core's minutes (snapped to core's step), core's day keys, core's extent.
    const calendarModelSource = readFileSync(resolve(app, '../../packages/core/src/calendar-view-model.ts'), 'utf8');
    for (const [kotlin, core] of [['SNAP_MINUTES', 'CALENDAR_SNAP_MINUTES'], ['TAP_MINUTES', 'CALENDAR_TAP_DURATION_MINUTES']]) {
        const value = new RegExp(`export const ${core} = (\\d+);`).exec(calendarModelSource)[1];
        assert.match(calendarUi, new RegExp(`internal const val ${kotlin} = ${value}\\n`), `${kotlin} is core's ${core}`);
    }
    assert.match(calendarUi, /private fun JSONObject\.extentMinutes\(\): Int = \(getJSONArray\("hourLabels"\)\.length\(\) - 1\) \* 60/, 'the grid\'s extent is core\'s hour labels');
    // A drop sends exactly one core action: a Calendar block's moveTask; a Board card's moveCard with the moved card's id (a position only inside its column).
    assert.equal(code(calendarUi).match(/calendar\.move\(/g).length, 1);
    assert.match(calendarModel, /if \(startMinutes == timed\.getInt\("startMinutes"\)\) return/, 'a block let go where it was sends nothing');
    assert.equal(code(boardUi).match(/board\.move\(/g).length, 3, 'a drop into another column, a drop inside its own, and TalkBack\'s Move to');
    assert.match(boardUi, /if \(after != before\) board\.move\(id, status, after, sameColumn = true\)/, 'a drop that changes nothing sends nothing');
    assert.match(boardModel, /if \(sameColumn\) action\.put\("afterId", afterId \?: JSONObject\.NULL\)/);
    // TalkBack reaches every card action (RN's swipes and a Move to per other column), with core's words, and hears the card
    // disabled with no actions while a command runs or a retry is owed (one semantics block: label, role and state).
    assert.match(boardUi, /if \(canEdit\) \{\s+onClick\(t\("common\.edit"\)\) \{ model\.openEditor\(id\); true \}\s+customActions = swipeActions\.map \{ \(side, label\) -> CustomAccessibilityAction\(label\)[^\n]*\+ moveActions\s+\} else disabled\(\)/);
    // Lines lie exactly at their minute (RN's offsets are RN bugs, fixed there separately): the day's 18-high hour rows and the
    // 10-high now line are centered on their minute, and the first hour label shows whole in the day and week timelines.
    assert.match(calendarUi, /Row\(Modifier\.offset\(y = \(index \* 60 \* PPM\)\.dp - 9\.dp\)\.fillMaxWidth\(\)\.height\(18\.dp\)/);
    assert.match(calendarUi, /Box\(Modifier\.fillMaxWidth\(\)\.padding\(vertical = 9\.dp\)\.height\(\(extent \* PPM\)\.dp\)/);
    assert.match(calendarUi, /Row\(Modifier\.offset\(y = \(minutes \* PPM\)\.dp - 5\.dp\)\.then\(modifier\)\.height\(10\.dp\)/);
    assert.match(calendarUi, /Box\(Modifier\.offset\(y = \(index \* 60 \* PPM\)\.dp\)\.fillMaxWidth\(\)\.height\(1\.dp\)/, 'a week hour rule lies at its minute');
    assert.match(calendarUi, /\.verticalScroll\(down\)\.padding\(top = 7\.dp, bottom = 24\.dp\)/, 'the week\'s first hour label shows whole');
    // The screens open from the More sheet, the Calendar also from the quick-access tab, each read on resume.
    assert.match(menuUi, /"calendar" -> CalendarList\(model\)\s+"board" -> BoardList\(model\)/);
    assert.match(menuUi, /"review" -> ReviewList\(model\)\s+"calendar" -> CalendarList\(model\)\s+\}/);
}

// Pass 9: the Inbox tab on core's Inbox view, selection mode on the Inbox, Waiting, Someday, Reference and Done on core's bulk
// contract, Archived's filter sheet, stateless Select all and completion time, and Focus's controls.
{
    // Reads pass Kotlin's input to core unchanged; writes are core's commands, logged as their operation.
    for (const [name, method] of [['inbox', 'getInboxView'], ['inboxTokens', 'getInboxFilterTokens'], ['archiveTokens', 'getArchiveFilterTokens'],
        ['bulk', 'getBulkActions'], ['focusList', 'getFocusControlsList']]) {
        assert.match(hostEntry, new RegExp(`^\\s+${name}: \\(input\\) => contract\\.${method}\\(input\\),$`, 'm'), `menuRead ${name} is core's ${method}`);
    }
    for (const [name, method] of [['bulkAction', 'runBulkAction'], ['focusGroup', 'setFocusGroupBy'], ['focusSave', 'saveFocusFilter'],
        ['focusCriterion', 'removeFocusFilterCriterion'], ['focusDelete', 'deleteFocusFilter'], ['focusReorder', 'reorderFocus']]) {
        assert.match(hostEntry, new RegExp(`^\\s+${name}: \\(input\\) => contract\\.${method}\\(input\\),$`, 'm'), `menuCommand ${name} is core's ${method}`);
    }
    // Every write is MenuModel's send -> perform(action) with its exact FailedAction: core's whole input (with the request UUID).
    assert.match(menuModel, /"bulkAction", "focusGroup", "focusSave", "focusCriterion", "focusDelete", "focusReorder" -> JSONObject\(action\.title\)\.put\("requestId", action\.id\)/);
    assert.match(menuModel, /"bulkAction" -> bulkDone\(action, reply\)\s+"focusGroup", "focusSave", "focusCriterion", "focusDelete", "focusReorder" -> focusControls\.done\(action, reply\)/);
    assert.match(menuModel, /fun bulkAction\(action: JSONObject, busy: String\) \{\s+bulkBusy = busy\s+act\("bulkAction", bulkPayload\(action\) \?: return\)/);
    assert.match(menuModel, /confirm\(bulk\.getJSONObject\("deleteConfirmation"\), bulkPayload\(JSONObject\(\)\.put\("type", "trashTasks"\)\) \?: return, "bulkAction"\)/, 'a bulk delete asks core\'s question first');
    assert.match(menuModel, /undo\?\.let \{ whenIdle \{ bulkBusy = "undo"; act\("bulkAction", JSONObject\(\)\.put\("list", list\)\.put\("action", it\.getJSONObject\("action"\)\)\) \} \}/, 'Undo is core\'s restoreTasks, a new request UUID');
    assert.match(menuModel, /if \(reply\.optBoolean\("changed"\)\) endBulk\(list\)/, 'an action that changed something leaves selection mode');
    assert.match(focusModelKt, /private fun command\(kind: String, input: JSONObject\) = menu\.command\(kind, JSONObject\(input\.toString\(\)\)\.put\("controls", state\)\)/);
    assert.match(focusModelKt, /menu\.create\(FailedAction\("focusSave", open\.getString\("requestId"\), JSONObject\(\)\.put\("controls", state\)\.put\("name", name\)\.toString\(\)\)\)/,
        'a saved Focus filter is a create: its request UUID (the filter\'s id) and its input on disk before the call');
    assert.doesNotMatch(code(focusModelKt), /menuCommand\(|\bsend\(|shell\.perform\(action|FailedAction\((?!"focusSave")/, 'FocusModel writes only through MenuModel.command or create');
    for (const [name, text] of Object.entries({ inboxUi, bulkUi, focusControlsUi })) {
        assert.doesNotMatch(code(text).replace(/^import .*$/gm, ''), /runtime\.|menuCommand\(|menuRead\(|\bsend\(|shell\.perform|FailedAction\(|menu\.command|menu\.create/, `${name}: the screen reaches core only through its model`);
    }
    // The Inbox is RN's TaskList on core's getInboxView through the menu list machinery (paging, filters, folds); its sort is the
    // stored task-list sort (setTaskListSort); a heading's fold keeps core's collapseEdit whole under RN's key, for its grouping.
    assert.match(menuModel, /shell\.screen == Screen\.Inbox -> "inbox"/);
    // The Inbox reads only core's getInboxView: Kotlin has no getInboxWindow call left, and a full read carries no Inbox part.
    assert.doesNotMatch(code(kotlinFiles.join('\n') + inboxUi + bulkUi + focusControlsUi + focusModelKt), /inboxWindow|callAsync\("window"|InboxPage|Part\.Inbox/, 'no getInboxWindow read is left in Kotlin');
    assert.match(model, /private class Lists\(val focus: FocusView, val projects: ProjectsView, val projectId: String\?, val project: ProjectDetail\?, val areas: AreaFilter\)/);
    assert.match(menuModel, /if \(list != this\.list\) return\s+shell\.readSucceeded\(\)/, 'the Inbox view\'s (or a Menu list\'s) success clears a read\'s failure');
    assert.match(menuModel, /"reference", "inbox" -> send\(FailedAction\("taskListSort", value\)\)/);
    assert.match(menuModel, /"inbox" -> kept\(listOf\("groupBy", "filters"\)\)\.put\("collapsedGroupIds", GroupCollapse\.axis\(prefs, "inbox", own\.optString\("groupBy", "none"\), 200\)\)/);
    assert.match(menuModel, /if \(list == "inbox" && collapse != null\) GroupCollapse\.keep\(prefs, list, axis, collapse\.getJSONArray\("collapsedGroupIds"\)\)/);
    assert.match(menuUi, /Choice\(option\.getString\("label"\), option\.getBoolean\("selected"\)\) \{ sort\(option\.optJSONObject\("edit"\)\?\.getString\("sortBy"\) \?: option\.getString\("value"\)\) \}/);
    assert.match(activity, /if \(quick \|\| screen == Screen\.Inbox\) MenuDialogs\(model\)\s+if \(screen == Screen\.Focus\) FocusDialogs\(model\)/);
    assert.match(inboxUi, /empty\.getJSONObject\("action"\)\.optJSONObject\("filterEdit"\)\?\.let\(::filterEdit\) \?: model\.openCapture\(\)/, 'the empty state runs core\'s action');
    // A page belongs to the list it was read for, so a tab change never draws another list's reply.
    assert.match(menuModel, /val page: MenuPage\? get\(\) = loaded\?\.takeIf \{ it\.list == list \}/);
    // Selection mode: RN's session state (the Bundle), core's bar read with the list's accepted params, a row tap as core's
    // selectionEdit, Select all as core's stateless one; read-only rows never select.
    assert.match(menuModel, /bulk\?\.let \{ input -> page = page\.withBulk\(runtime\.menuRead\("bulk", JSONObject\(input\.toString\(\)\)\.put\("params", sent\)\.toString\(\)\)\) \}/);
    assert.match(menuModel, /bulk\.optJSONArray\("except"\)\?\.let \{ put\("selectAll", JSONObject\(\)\.put\("except", it\)\) \} \?: put\("taskIds", bulk\.optJSONArray\("selected"\) \?: JSONArray\(\)\)/);
    assert.match(menuModel, /bulk\.optJSONObject\("selectAll"\)\?\.let \{ put\("selectAll", it\) \} \?: put\("taskIds", bulk\.getJSONArray\("selectedIds"\)\)/, 'an action takes core\'s own Select all object');
    assert.match(menuModel, /reload\(bulkEdit = JSONObject\(\)\.put\("selectionEdit", JSONObject\(\)\.put\("taskId", taskId\)\.put\("range", range\)\)\)/);
    assert.match(menuModel, /if \(list !in BULK_LISTS \|\| readOnly\) return null/);
    for (const [name, text] of Object.entries({ inboxUi, statusListUi, waitingUi, somedayUi })) assert.match(text, /actions = bulkRow\(/, `${name}: rows start and show selection mode`);
    assert.match(menuModel, /val BULK_LISTS = setOf\("inbox", "waiting", "someday", "reference", "done"\)/);
    // Archived: core's filter edits and chips (the deprecated fields are never read), its tokens paged by getArchiveFilterTokens with
    // the open sheet's filterSheetOpen, stateless Select all, and the completion time from a local day and time with core's start.
    assert.doesNotMatch(code(kotlinFiles.join('\n') + inboxUi + bulkUi + focusControlsUi + focusModelKt), /"tokenOptions"|"timeEstimateOptions"/, 'Kotlin never reads the deprecated Archive fields');
    assert.doesNotMatch(code(archiveUi + menuUi), /getJSONObject\("filters"\)\.menuObjects\("chips"\)/, 'chips come from the view\'s own `chips`, not the deprecated filters.chips');
    assert.match(menuModel, /if \(dialog\?\.optString\("kind"\) == "filters"\) put\("filterSheetOpen", true\)/);
    assert.match(menuModel, /own\.optJSONArray\("except"\)\?\.let \{ put\("selectAll", JSONObject\(\)\.put\("except", it\)\) \} \?: put\("selectedIds", own\.optJSONArray\("selected"\) \?: JSONArray\(\)\)/);
    assert.match(menuModel, /view\?\.optJSONObject\("selectAll"\)\?\.let \{ put\("selectAll", it\) \} \?: put\("taskIds", view\?\.optJSONArray\("selectedIds"\) \?: JSONArray\(\)\)/);
    assert.match(menuModel, /archive\(JSONObject\(\)\.put\("type", "setCompletedAt"\)\.put\("taskId", open\.getString\("taskId"\)\)\.put\("day", open\.getString\("day"\)\)\.put\("time", time\)\)/);
    assert.match(archiveUi, /DayPickerDialog\(open\.getString\("day"\), [^\n]*\) \{ pickCompletedDay\(it\) \}/, 'the date dialog starts on core\'s day');
    assert.match(archiveUi, /val \(hour, minute\) = pickerClock\(open\.getString\("time"\)\)/, 'the time dialog starts on core\'s time');
    // Picker search (menu lists, the Inbox, Archive): core's matches for the typed query, read again when the list changes.
    assert.match(menuUi, /LaunchedEffect\(shown\.revision, name\) \{ if \(query\.isNotBlank\(\)\) searchPicker\(name, query,/);
    assert.match(menuUi, /for \(mode in filters\.menuObjects\("matchModes"\)\) MatchModeRow\(mode\.getString\("label"\), mode\.menuObjects\("options"\), idle\) \{ filterEdit\(it\) \}/);
    // Focus: every read sends the control state (asserted with the Focus bridge above); core's answer becomes the state; the state,
    // the open sheet and reorder mode ride the Bundle; reorder mode ends once core no longer offers it.
    for (const key of ['focusControls', 'focusDialog', 'focusReorder']) assert.match(focusModelKt, new RegExp(`saved(\\.get<\\w+>\\("${key}"\\)|\\["${key}"\\])`), `${key} rides the Bundle`);
    assert.match(focusModelKt, /keepState\(controls\.getJSONObject\("state"\)\)\s+if \(reordering && controls\.isNull\("reorder"\)\) keepReordering\(false\)/);
    assert.match(model, /private fun showFocus\(view: FocusView\?\) \{\s+focus = view\s+view\?\.let\(menu\.focusControls::adopt\)/);
    assert.match(focusControlsUi, /if \(to != index\) reorderTo\(ids\.toMutableList\(\)\.apply \{ add\(to, removeAt\(index\)\) \}\)/, 'a drop that moves nothing sends nothing; a move sends one reorderFocus');
    assert.match(focusControlsUi, /row\.optJSONArray\("moveUp"\)\?\.let \{ order -> CustomAccessibilityAction/, 'TalkBack moves a row by core\'s own order');
    // One node per new control: its label, role and state together (the device checks and TalkBack read it there). A backdrop
    // keeps a plain label: clearing its semantics would hide the sheet inside it.
    for (const [name, text] of Object.entries({ inboxUi, bulkUi, focusControlsUi })) {
        assert.doesNotMatch(code(text), /\.clickable\(enabled = [^\n]*\.semantics \{ contentDescription|\.semantics \{ contentDescription[^\n]*\}\s*\.clickable\(enabled/,
            `${name}: no control with a clickable and a separate semantics block`);
        assert(code(text).match(/clearAndSetSemantics \{/g).length >= 3, `${name}: its controls set label, role and state in one block`);
    }
    // No Kotlin policy in the new models and screens (the gates above also hold them to core's text and edits).
    for (const [name, text] of Object.entries({ focusModelKt, focusControlsUi, inboxUi, bulkUi })) {
        assert.doesNotMatch(code(text), /\.(sort\w*|sorted\w*|filter(?!Bg\b|Edit\b)\w*|groupBy|reversed|asReversed|shuffled|distinct\w*|partition|minBy|maxBy)\b/, `${name}: no Kotlin sorting, filtering, or grouping`);
        assert.doesNotMatch(code(text), /SimpleDateFormat|DateTimeFormatter|LocalDate|java\.time|java\.util\.Calendar|Calendar\.getInstance|GregorianCalendar|Instant\b|\.format\(|toLocal/, `${name}: no Kotlin date formatting or parsing`);
    }
}

// Pass 12: Review's row Mark reviewed and Review in 1 week, its batch Mark reviewed and Organize sheet (compare-and-set on the task
// revisions core shows), the token and Board pickers' search, and RN's highlight of a task opened from search.
{
    const organizeKt = source('ReviewOrganize.kt');
    const boardModelKt = source('BoardModel.kt');
    const boardUiKt = source('BoardScreen.kt');
    // A row's links send core's own action (its task revision inside) with a new request UUID; Kotlin builds no row action. Each
    // link sets its label, role, state and test tag in its one semantics block.
    assert.match(reviewUi, /item\.json\.optJSONObject\("review"\)\?\.let \{ review ->[\s\S]{0,700}?act\("reviewAction", link\.getJSONObject\("action"\)\)/);
    assert.match(reviewUi, /\.clearAndSetSemantics \{ contentDescription = description; role = Role\.Button; testTag = tag; if \(enabled\) onClick \{ action\(\); true \} else disabled\(\) \}/);
    assert.doesNotMatch(code(reviewUi), /\.testTag\(tag\)/, 'the link\'s tag sits inside its semantics block');
    assert.doesNotMatch(code(Object.values(reviewScreens).join('\n') + organizeKt + menuModel), /put\("type", "markTaskReviewed"\)/, 'Kotlin never builds a row\'s Mark reviewed');
    // The batch Mark reviewed and Organize's Apply carry the revisions core's bar showed; neither is built without them.
    assert.match(listActionsKt, /internal fun markReviewedTasks\(taskIds: List<String>, taskRevisions: JSONObject\): JSONObject =\s+JSONObject\(\)\.put\("type", "markReviewedTasks"\)\.put\("taskIds", JSONArray\(taskIds\)\)\.put\("taskRevisions", taskRevisions\)/);
    assert.match(listActionsKt, /internal fun organizeTasks\(taskIds: List<String>, draft: JSONObject, taskRevisions: JSONObject\): JSONObject =\s+JSONObject\(\)\.put\("type", "organizeTasks"\)\.put\("taskIds", JSONArray\(taskIds\)\)\.put\("draft", draft\)\.put\("taskRevisions", taskRevisions\)/);
    assert.match(reviewUi, /"markReviewed" -> act\("reviewAction", markReviewedTasks\(selected, bulk\.getJSONObject\("taskRevisions"\)\)\)/);
    assert.match(menuModel, /else if \(review != null\) \{ bulkBusy = "organize"; act\("reviewAction", organizeTasks\(review\.getJSONArray\("selectedIds"\)\.ids\(\), organize\.getJSONObject\("draft"\), review\.getJSONObject\("taskRevisions"\)\)\) \}/);
    // A stale refusal wrote nothing and is never resent: core's view is read again, with its new revisions.
    assert.match(menuModel, /if \(refused && action\.kind == "reviewAction" && failure\.message\?\.startsWith\("STALE_REVISION"\) == true\) shell\.ui \{ bulkBusy = null; whenIdle \{ reload\(\) \} \}/);
    // Review's Organize is the lists' dialog on Review's own bar: the read carries the dialog (its draft, one control's edit, the
    // picker and its search), later windows go without it, and the page's bar is the view's.
    assert.match(menuModel, /first\.optJSONObject\("bulk"\)\?\.takeIf \{ list == "review" \}/);
    assert.match(menuModel, /JSONObject\(params\.toString\(\)\)\.apply \{\s+remove\("organize"\); remove\("picker"\)/, 'later windows go without the dialog\'s inputs');
    for (const list of ['contexts', 'review']) assert.match(menuModel, new RegExp(`"${list}" -> kept\\([\\s\\S]{0,240}?\\.also \\{ dialogInputs\\(list, it\\) \\}`), `${list}'s read carries its open dialog`);
    assert.match(menuModel, /if \(list == "review"\) bulkEdit\?\.optJSONObject\("organizeEdit"\)\?\.let \{ params\.optJSONObject\("organize"\)\?\.put\("edit", it\) \}/);
    assert.match(organizeKt, /into\.put\("organize", JSONObject\(\)\.put\("draft", open\.optJSONObject\("draft"\) \?: JSONObject\(\)\)\)/);
    assert.match(bulkUi, /val bulk = page\?\.bulk\?\.takeIf \{ list in BULK_LISTS \} \?: return/, 'the lists\' bar never draws Review\'s');
    assert.match(menuModel, /if \(type == "organizeTasks"\) \{ bulkBusy = null; closeDialog\("organize"\) \}/);
    // Core ends Review's selection when a selected row is no longer drawn (RN's review.tsx); the dialogs on it close with it.
    assert.match(menuModel, /if \(list == "review" && next\.bulk == null\) closeSelectionDialogs\(list\)/);
    // The token pickers' search: core's matching tokens (Contexts' picker, Review's and the lists' Remove tag query), the typed text
    // kept with the dialog and read once typing pauses; a blank search shows core's whole list.
    assert.match(organizeKt, /into\.put\("picker", \(if \(list == "review"\) JSONObject\(\)\.put\("kind", "removeTag"\) else JSONObject\(\)\.put\("field", open\.getString\("field"\)\)\.put\("mode", open\.getString\("mode"\)\)\)\s+\.put\("query", query\)\)/);
    assert.match(menuModel, /put\("picker", JSONObject\(\)\.put\("kind", "removeTag"\)\.apply \{ tokenQuery\(open\)\?\.let \{ put\("query", it\) \} \}\)/);
    assert.match(contextsUi, /BasicTextField\(text, \{ typed -> typeToken\(/);
    // The Board's picker search: getBoardList's query at the shown revision, read again whenever the Board changes.
    assert.match(boardModelKt, /runtime\.menuRead\("boardList", JSONObject\(\)\.put\("filters", shown\.filters\)\.put\("list", name\)\.put\("query", query\)\s+\.put\("offset", items\.length\(\)\)\.put\("limit", WINDOW\)\.put\("revision", shown\.revision\)\.toString\(\)\)/);
    assert.match(boardUiKt, /LaunchedEffect\(shown\.revision, picker\) \{ if \(query\.isNotBlank\(\)\) board\.searchPicker\(picker, query,/);
    // RN's highlight of a task opened from search, scoped to the list it opens on (the list under the search for the editor, the
    // hit's list for a route, the project once it opens): outlined only there, cleared after RN's 3.5 s or on leaving that list.
    assert.match(searchUi, /task\.editor -> \{ highlight\(task\.id\); openEditor\(task\.id\) \}\s+route != null -> \{ openFromSearch\(route, task\.projectId\); highlight\(task\.id, task\.projectId\) \}\s+listed != null -> \{ closeSearch\(\); menu\.openRoute\(listed\); highlight\(task\.id\) \}/);
    assert.match(model, /private fun listKey\(project: String\? = openProjectId\) = listOf\(menu\.screen\?\.name, menu\.list, screen\.name, project\)\.joinToString\("\|"\)/);
    assert.match(model, /fun isHighlighted\(taskId: String\) = taskId == highlightTaskId && highlightList == listKey\(\)/);
    assert.match(model, /withTimeoutOrNull\(3_500\) \{ snapshotFlow \{ listKey\(\) \}\.dropWhile \{ it != where \}\.first \{ it != where \} \}\s+highlightTaskId = null\s+highlightList = null/);
    assert.match(rowUi, /listed == null && isHighlighted\(task\.id\)/);
    assert.doesNotMatch(code(rowUi), /== highlightTaskId/, 'a row asks the model, which knows the list the highlight belongs to');
    // The new file holds dialog inputs only: no Kotlin policy, no UI text, no write around perform.
    assert.doesNotMatch(code(organizeKt), /\.(sort\w*|sorted\w*|filter\w*|groupBy|distinct\w*)\b|SimpleDateFormat|LocalDate|java\.time|\bText\(|contentDescription|\bsend\(|shell\.perform|FailedAction\(|runtime\./,
        'ReviewOrganize.kt: dialog inputs only');
    // The device check: English for the run (the original language put back), an owed failure settled first, then this run's
    // fixtures removed (never while a write is owed), and an Apply that assigns a project; --prune-old removes interrupted runs' data.
    const check12 = readFileSync(resolve(app, 'scripts/check-review-organize-device.mjs'), 'utf8');
    const restore12 = check12.slice(check12.indexOf('const restore = async () => {'));
    assert(restore12.indexOf('await settleOwed();') > 0 && restore12.indexOf('await settleOwed();') < restore12.indexOf('await removeFixtures();'), 'cleanup settles an owed failure before removing the fixtures');
    assert.match(check12, /const removeFixtures = async \(\) => \{\s+if \(!injected\) return;\s+if \(owed\) \{/);
    assert.match(check12, /done\(await store\(\)\.batchDeleteTasks\(tasks\)\); done\(await store\(\)\.purgeTasks\(tasks\)\);/);
    assert.match(check12, /setProp\('language', 'en'\);/);
    assert.match(check12, /const originalLanguage = sh\('getprop debug\.mindwtr\.native\.language'\);[\s\S]*setProp\('language', originalLanguage\)/);
    assert.doesNotMatch(check12, /setProp\('language', ''\)|for \(const name of PROPS\)/, 'the run never clears the language property to the app\'s own');
    assert.match(check12, /task\.projectId === injected\.project && task\.areaId === null && task\.dueDate === today\.value/);
    assert.match(readFileSync(resolve(app, 'scripts/check-projects-device.mjs'), 'utf8'), /\/\^76\[0-9\]\{12\}\[1-6\]\$\/[\s\S]{0,900}?\/\^76\[0-9\]\{12\}9\$\/[\s\S]{0,500}?\/\^76\[0-9\]\{12\}\[07\]\$\//,
        '--prune-old removes the Review organize check\'s tasks, project and areas');
    // Core draws Review's bar in RN's order (Mark reviewed first on Due), so Kotlin keeps core's order.
    const reviewContract = readFileSync(resolve(app, '../../packages/core/src/native-host-contract-review-views.ts'), 'utf8');
    assert.match(reviewContract, /actions: \[\s+\.\.\.\(scope === 'due' \? \[\{ id: 'markReviewed' as const, label: text\.markReviewed, enabled: true \}\] : \[\]\),\s+\{ id: 'organize'/);
}

// Pass 10: Settings (the menu, General, Manage with its Someday sections, and GTD's seven screens) on core's settings contract,
// and the editor's View tab and checklist editing on core's task view contract.
{
    const settingsModel = source('SettingsModel.kt');
    const settingsUi = source('SettingsScreen.kt');
    const taskViewUi = source('TaskView.kt');
    const settingsIcons = source('SettingsIcons.kt');
    const pass10 = { settingsModel, settingsUi, taskViewUi, settingsIcons };
    const coreFile = (name) => readFileSync(resolve(app, '../../packages/core/src', name), 'utf8');
    // Reads pass Kotlin's input to core unchanged; writes are core's commands, each logged as its operation.
    for (const [name, method] of [['settingsMenu', 'getSettingsMenu'], ['generalSettings', 'getGeneralSettings'], ['gtdSettings', 'getGtdSettings'],
        ['manageSettings', 'getManageSettings'], ['manageList', 'getManageSettingsList'], ['somedaySections', 'getSomedaySections']]) {
        assert.match(hostEntry, new RegExp(`^\\s+${name}: \\(input\\) => contract\\.${method}\\(input\\),$`, 'm'), `menuRead ${name} is core's ${method}`);
    }
    for (const [name, method] of [['generalSetting', 'setGeneralSetting'], ['gtdSetting', 'setGtdSetting'], ['manageEditor', 'saveManageEditor'],
        ['manageDelete', 'deleteManageItem'], ['somedayRename', 'renameSomedaySection'], ['somedayReorder', 'reorderSomedaySections'], ['somedayDelete', 'deleteSomedaySection']]) {
        assert.match(hostEntry, new RegExp(`^\\s+${name}: \\(input\\) => contract\\.${method}\\(input\\),$`, 'm'), `menuCommand ${name} is core's ${method}`);
    }
    // Every Settings write is MenuModel's send -> perform(action) with its exact FailedAction: a control's edit through command (a new
    // request UUID; core's whole input its exact retry), Manage's editor Save through create (its request UUID kept with the dialog, on
    // disk before the call), a delete through core's question (MenuDialogs' confirm -> act).
    assert.match(settingsModel, /fun general\(edit: JSONObject\) = menu\.command\("generalSetting", JSONObject\(\)\.put\("edit", edit\)\)/);
    assert.match(settingsModel, /fun gtd\(edit: JSONObject\) = menu\.command\("gtdSetting", JSONObject\(\)\.put\("edit", edit\)\)/);
    assert.match(settingsModel, /fun saveEditor\(action: FailedAction\) = menu\.create\(action\)/);
    assert.match(settingsModel, /return FailedAction\("manageEditor", open\.getString\("requestId"\), input\.toString\(\)\)/, 'the editor\'s request UUID stays with its dialog');
    assert.match(menuModel, /"generalSetting", "gtdSetting", "manageEditor", "manageDelete" -> JSONObject\(action\.title\)\.put\("requestId", action\.id\)/);
    assert.match(menuModel, /"somedayRename", "somedayReorder", "somedayDelete" -> JSONObject\(action\.title\)/);
    for (const call of ['"manageDelete")', '"somedayDelete")']) {
        const at = settingsUi.indexOf(call);
        assert(at > 0 && settingsUi.slice(Math.max(0, at - 200), at).includes('confirm('), `Settings deletes only after core's question (${call})`);
    }
    assert.doesNotMatch(code(settingsUi).replace(/^import .*$/gm, ''), /runtime\.|menuCommand\(|menuRead\(|\bsend\(|shell\.perform|FailedAction\(|menu\.command|menu\.create/, 'SettingsScreen reaches core only through SettingsModel');
    assert.doesNotMatch(code(settingsModel), /menuCommand\(|\bsend\(|shell\.perform\(action|\.perform\([A-Za-z]/, 'SettingsModel writes only through MenuModel.command or create');
    // Core's device writes are stored under RN's keys before the command counts as done; a new language reloads core's words, a theme its colors.
    assert.match(menuModel, /if \(action\.kind in SETTINGS_KINDS\) settings\.applied\(runtime, reply\)\s+shell\.acknowledged\(action\)/);
    assert.match(settingsModel, /internal fun applied\(runtime: CoreHost, reply: JSONObject\) \{\s+val writes = reply\.optJSONArray\("deviceWrites"\) \?: return\s+store\(writes\)/);
    assert.match(settingsModel, /runtime\.language\(prefs\.getString\(LANGUAGE_KEY, null\)\.orEmpty\(\), Locale\.getDefault\(\)\.toLanguageTag\(\)\)\s+Labels\.load\(runtime\.strings\(LABEL_KEYS\)\)/);
    assert.match(model, /val runtime = ProcessCoreHost\.get\(getApplication\(\)\)\s+\/\/[^\n]*\s+applyDeviceChoices\(runtime, prefs\)/, 'the device\'s own language and theme apply at boot, before any screen');
    for (const [kotlin, file, core] of [['LANGUAGE_KEY', 'i18n/i18n-constants.ts', 'LANGUAGE_STORAGE_KEY'], ['THEME_KEY', 'general-settings-model.ts', 'MOBILE_THEME_STORAGE_KEY'],
        ['MANAGE_SECTIONS_KEY', 'manage-settings-model.ts', 'MANAGE_OPEN_SECTIONS_STORAGE_KEY'], ['TASK_OPEN_MODE_KEY', 'gtd-settings-model.ts', 'MOBILE_TASK_OPEN_MODE_STORAGE_KEY']]) {
        const value = new RegExp(`export const ${core} = '([^']+)'`).exec(coreFile(file))[1];
        assert.match(settingsModel, new RegExp(`const val ${kotlin} = "${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `${kotlin} is core's ${core}`);
    }
    // Kotlin builds only the two text fields' edits (core's GtdSettingsEdit names), from the typed text; every choice sends core's own edit.
    const gtdEdits = [...coreFile('gtd-settings-model.ts').matchAll(/type: '(\w+)'/g)].map(([, name]) => name);
    const built = [...code(settingsModel + settingsUi).matchAll(/put\("type", "(\w+)"\)/g)].map(([, name]) => name);
    assert.deepEqual([...new Set(built)].sort(), ['defaultScheduleTime', 'pomodoroDurations'], 'only the typed text fields build an edit');
    for (const name of built) assert(gtdEdits.includes(name), `${name} is one of core's GTD edits`);
    assert(code(settingsUi).match(/getJSONObject\("edit"\)/g).length >= 10, 'the controls send core\'s edits');
    // Settings' rows come from core as they are: a screen core says is not built here is drawn disabled; the Manage editor's taken-name
    // line and Save state are core's checkManageEditor for the name as typed (read off the main thread); Kotlin holds no copy of the rule.
    assert.match(settingsUi, /val enabled = row\.getBoolean\("enabled"\) && idle/);
    assert.match(hostEntry, /^\s+manageCheck: \(input\) => contract\.checkManageEditor\(input\),$/m, 'menuRead manageCheck is core\'s checkManageEditor');
    assert.match(settingsModel, /shell\.background\(listOf\(Part\.MenuDialog\), \{ runtime ->\s+runtime\.menuRead\("manageCheck", JSONObject\(\)\.put\("target", target\)\.put\("name", name\)\.toString\(\)\)/);
    assert.match(settingsUi, /val canSave = owed \|\| \(idle && checked != null && !checked\.getBoolean\("saveDisabled"\)\)/);
    assert.match(settingsUi, /checked\?\.menuText\("message"\)\?\.let \{ Text\(it,/);
    assert.doesNotMatch(code(settingsUi + settingsModel), /lowercase\(\)|nameTaken"\)|isManageAreaNameTaken/, 'no Kotlin copy of core\'s taken-name rule');
    // Manage's icon buttons name their item as RN's (a6e345eab): "<common.edit>: <name>" and "<common.delete>: <name>"; sections report expanded.
    assert.match(settingsUi, /RowButton\(SettingsIonicons\.PencilOutline, "\$\{t\("common\.edit"\)\}: \$\{unassigned\.getString\("label"\)\}"/);
    assert.equal(code(settingsUi).match(/"\$\{t\("common\.(edit|delete)"\)\}: \$(name|value)"/g).length, 4, 'area and value rows name their item');
    assert.match(settingsUi, /if \(open\) collapse \{ settings\.toggleSection\(section\.getJSONObject\("toggle"\)\); true \} else expand \{/);
    // Navigation: the Settings tile opens, RN's settings stack pops on Back, and the stack, search and screen state ride the Bundle.
    assert.match(menuModel, /"settings" -> open\(MenuScreen\.Settings\)/);
    assert.match(menuModel, /if \(screen == MenuScreen\.Settings && settings\.back\(\)\) return/);
    assert.match(menuModel, /if \(list == "settings"\) return settings\.refresh\(\)/);
    for (const key of ['settingsStack', 'settingsQuery', 'settingsLocal']) assert.match(settingsModel, new RegExp(`saved(\\.get<\\w+>\\("${key}"\\)|\\["${key}"\\])`), `${key} rides the Bundle`);
    assert.match(menuUi, /"settings" -> SettingsList\(model\)/);
    // Manage's lists page under Manage's revision; a list that changed between windows keeps what it read (the next read starts over).
    assert.match(settingsModel, /runtime\.menuRead\("manageList", JSONObject\(\)\.put\("list", list\)\.put\("offset", loaded\.size\)\.put\("limit", WINDOW\)\s*\.put\("revision", view\.getString\("revision"\)\)/);
    assert.match(settingsModel, /\.put\("revision", first\.getString\("revision"\)\)/);
    assert.match(settingsModel, /if \(failure\.message\?\.startsWith\("STALE_REVISION"\) != true\) throw failure/);

    // The editor's View tab: core's getTaskView for the draft and checklist the editor holds, read in the background with its own
    // freshness, its checklist paged under the first window's revision; a read-only task shows the saved task.
    assert.match(model, /if \(!current\.readOnly\) input\.put\("draft", JSONObject\(draftJson\(current\.fullDraft\(\)\)\)\)\.put\("checklist", JSONArray\(current\.checklistNow\)\)/);
    assert.match(model, /background\(listOf\(Part\.TaskView\), \{ runtime -> readView\(runtime, input, depth\) \}\) \{ view, mine ->\s+if \(fresh\(mine, Part\.TaskView\) && editor\?\.id == current\.id\) taskView = view/);
    assert.match(model, /\.put\("offset", items\.length\(\)\)\.put\("limit", VIEW_WINDOW\)\s*\.put\("revision", first\.getString\("revision"\)\)/);
    // RN's resolveTaskOpenTab: read-only shows only the View tab; an explicit edit the Form tab; then the device's "Open tasks in";
    // then the list's own tab: the Inbox list's is the Form tab (defaultEditTab="task"), every other screen's, a search's and a link's View.
    assert.match(model, /val automatic = routeTab \?: if \(menu\.screen == null && screen == Screen\.Inbox && search == null\) "task" else "view"/);
    assert.match(model, /val tab = if \(opened\.readOnly\) "view" else if \(routeTab == "task"\) "task" else if \(mode == "preview"\) "view" else if \(mode == "edit"\) "task" else automatic/);
    // RN's explicit edits (openTaskScreen(…, 'task'), the review's Add task and edit): Save & edit, the Board's Duplicate, the Weekly Review's Add task.
    assert.match(model, /main\.post \{ openEditor\(id, "task"\) \}/);
    assert.match(source('BoardModel.kt'), /shell\.openEditor\(open\.getString\("taskId"\), "task"\)/);
    assert.match(menuModel, /shell\.openEditor\(id, "task"\)/);
    assert.match(editorUi, /if \(editor\.readOnly \|\| editor\.tab == "view"\) TaskViewTab\(/);
    assert.match(editorUi, /\.put\("checklist", checklist \?: JSONObject\.NULL\)\.put\("tab", tab\)/, 'the open tab and the checklist ride the draft file');
    // Every checklist change is one of core's TaskChecklistEdit kinds, queued with the draft's edits; Kotlin never edits an item itself.
    const checklistKinds = [...(/export type TaskChecklistEdit =([\s\S]*?);\n\n/.exec(coreFile('task-checklist-model.ts'))?.[1] ?? '').matchAll(/kind: '(\w+)'/g)].map(([, kind]) => kind);
    assert(checklistKinds.includes('toggle') && checklistKinds.includes('append'), 'core\'s checklist edit kinds were read');
    const kinds = [...code(taskViewUi + model).matchAll(/editChecklist\(JSONObject\(\)\.put\("kind", "(\w+)"\)/g)].map(([, kind]) => kind);
    assert(kinds.length >= 7);
    for (const kind of kinds) assert(checklistKinds.includes(kind), `${kind} is one of core's checklist edits`);
    assert.doesNotMatch(code(taskViewUi), /editChecklist\(JSONObject\(\)\.put\("kind", [^"]/, 'no checklist edit kind is built from a variable');
    // A queued item edit names its item by its stable id (a move by its direction); its position is read only right before the edit is
    // sent, from the checklist as the edits before it left it, and an edit whose item is gone is dropped. The screen never sends a position.
    assert.doesNotMatch(code(taskViewUi), /put\("(index|from|to)"/, 'the checklist screens send no position');
    assert.equal(code(taskViewUi).match(/put\("itemId", /g).length, 9, 'every item edit (the View and Form ticks and moves, each semantics and click; rename, Return, remove) names its item');
    assert.match(model, /private fun currentChecklistEdit\(edit: JSONObject, checklist: String\): JSONObject\? \{\s+if \(!edit\.has\("itemId"\)\) return edit\s+val items = JSONArray\(checklist\)\s+val index = \(0 until items\.length\(\)\)\.firstOrNull \{ items\.getJSONObject\(it\)\.getString\("id"\) == edit\.getString\("itemId"\) \} \?: return null/);
    assert.match(model, /val to = index \+ edit\.getInt\("step"\)\s+return if \(to in 0 until items\.length\(\)\) sent\.put\("from", index\)\.put\("to", to\) else null/);
    assert.match(model, /val listEdit = queued\?\.let \{ currentChecklistEdit\(it, current\.checklistNow\) \}/);
    assert.equal(code(model).match(/currentChecklistEdit\(/g).length, 2, 'resolved in one place, in stepEditor, right before the send');
    // Reset checklist writes at once through perform with its exact retry (its request UUID), then the reset task is the editor's base.
    assert.match(model, /sendReset\(FailedAction\("resetChecklist", current\.id, UUID\.randomUUID\(\)\.toString\(\)\)\)/);
    assert.match(model, /private fun sendReset\(action: FailedAction\) = perform\(action\) \{ runtime ->\s+runtime\.resetTaskChecklist\(action\.id, action\.title\)\s+acknowledged\(action\)/);
    assert.match(model, /"resetChecklist" -> sendReset\(action\)/);
    // A link is core's target: a web, mail or phone link opens outside the app; a project, task, context or tag leaves the editor as
    // Close does (asking first while edits are unsaved).
    assert.match(editorUi, /if \(target\.getString\("kind"\) == "external"\) runCatching \{ context\.startActivity\(Intent\(Intent\.ACTION_VIEW, target\.getString\("href"\)\.toUri\(\)\)\) \}\s+else if \(editor\.readOnly \|\| \(!editor\.dirty && !editsPending\)\) go\(target\)\s+else \{ linkAfterLeave = target\.toString\(\); confirmLeave = true \}/);
    assert.match(taskViewUi, /withLink\(LinkAnnotation\.Clickable\(target\.toString\(\), TextLinkStyles\(SpanStyle\(color = tint, textDecoration = TextDecoration\.Underline\)\)\) \{ follow\(target\) \}\)/);
    // No Kotlin policy in the new files: core's rows, options and words walked as sent; no dates.
    for (const [name, text] of Object.entries(pass10)) {
        assert.doesNotMatch(code(text), /\.(sort\w*|sorted\w*|filter(?!Bg\b|Edit\b|s\b)\w*|groupBy|reversed|asReversed|shuffled|distinct\w*|partition|minBy|maxBy)\b/, `${name}: no Kotlin sorting, filtering, or grouping`);
        assert.doesNotMatch(code(text), /SimpleDateFormat|DateTimeFormatter|LocalDate|LocalTime|java\.time|java\.util\.Calendar|Calendar\.getInstance|GregorianCalendar|Instant\b|\.format\(|toLocal|currentTimeMillis|\bDate\(|TimeZone/, `${name}: no Kotlin date math, formatting or parsing`);
        assert.doesNotMatch(code(text), new RegExp(`${STATUS}(?:\\s*,\\s*${STATUS})*\\s*->\\s*${STATUS}`), `${name}: no status-to-status map`);
        assert.doesNotMatch(code(text), /\bColor\(|Color\.(Black|White|Red|Green|Blue|Gray|Yellow|Cyan|Magenta|DarkGray|LightGray|Transparent)\b|parseColor|"#[0-9A-Fa-f]{3,8}"|0x[0-9A-Fa-f]{8}/, `${name} writes a color; colors live only in Theme.kt`);
        // No literal text reaches a Text, a content description, or a click label; key literals are label keys.
        for (const [, key] of code(text).matchAll(/"([a-z][A-Za-z]*(?:\.[A-Za-z]+)+)"/g)) assert(labelKeys.includes(key), `${name}: ${key} is not in LABEL_KEYS`);
        for (const [, rest] of code(text).matchAll(/(?:\bText\(|contentDescription = |onClickLabel = )([^\n]*)/g)) {
            // Core's JSON is read by key (getString("label"), getJSONObject("edit")); a key names a field of core's text, it is not text.
            for (const [, literal] of rest.replace(/\b(t|testTag|getString|optString|text|getJSONObject|optJSONObject|getBoolean|optBoolean|getInt|menuText|menuObjects)\("[^"]*"\)/g, '').replace(/\btestTag = "[^"]*"/g, '').matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
                if (labelKeys.includes(literal)) continue;
                assert.doesNotMatch(literal.replace(/\$\{[^}]*\}|\$\w+/g, ''), /\p{L}/u, `${name}: hard-coded UI text "${literal}"`);
            }
        }
    }
    // One semantics block per control (label, role and state), as passes 6-8 ruled.
    assert(code(settingsUi).match(/\.clearAndSetSemantics \{/g).length >= 15);
    assert(code(taskViewUi).match(/\.clearAndSetSemantics \{/g).length >= 6);
}

// Pass 11: Mind Sweep and a saved search's screen on core's new contracts; the Focus filter pickers' search;
// Bulk organize's project and area pickers that create one.
{
    const sweepKt = source('MindSweep.kt');
    const pass11 = { sweepKt, savedSearchUi };
    // Reads pass Kotlin's input to core unchanged; writes are core's commands, each logged as its operation.
    for (const [name, method] of [['mindSweep', 'getMindSweep'], ['savedSearch', 'getSavedSearchView']]) {
        assert.match(hostEntry, new RegExp(`^\\s+${name}: \\(input\\) => contract\\.${method}\\(input\\),$`, 'm'), `menuRead ${name} is core's ${method}`);
    }
    for (const [name, method] of [['bulkCreate', 'createBulkOrganizeDestination'], ['mindSweepAdd', 'addMindSweepItem'], ['savedSearchDelete', 'deleteSavedSearch']]) {
        assert.match(hostEntry, new RegExp(`^\\s+${name}: \\(input\\) => contract\\.${method}\\(input\\),$`, 'm'), `menuCommand ${name} is core's ${method}`);
    }
    // Every write is MenuModel's send -> perform(action) with its exact FailedAction: core's whole input with the request UUID. The two
    // creates (a Mind Sweep capture, Bulk organize's project or area) are on disk before the call and sent again first after process death.
    assert.match(menuModel, /"bulkCreate", "mindSweepAdd", "savedSearchDelete" -> JSONObject\(action\.title\)\.put\("requestId", action\.id\)/);
    assert.match(sweepKt, /menu\.create\(addAction\(group\.getString\("id"\)\)\)/, 'a Mind Sweep Add is a create: on disk first');
    assert.match(menuModel, /create\(FailedAction\("bulkCreate", UUID\.randomUUID\(\)\.toString\(\), JSONObject\(\)\.put\("list", list\)\.put\("kind", kind\)\.put\("name", name\)/, 'Bulk organize\'s create is a create: on disk first');
    assert.match(menuModel, /shell\.failedAction\?\.takeIf \{ it\.kind == "bulkCreate" \}\?\.let \{ return retry\(it\) \}/, 'an owed create is sent again exactly');
    for (const [name, text] of Object.entries(pass11)) {
        assert.doesNotMatch(code(text), /menuCommand\(|\bsend\(|shell\.perform\(action|FailedAction\((?!"mindSweepAdd")/, `${name}: writes only through MenuModel.command, act or create`);
    }
    // A write core refused, or whose write did not land (ACTION_FAILED, as core's contracts say for these two), owes nothing: Mind Sweep's
    // failure line or the picker's line shows instead of the failure message.
    assert.match(menuModel, /private val LANDLESS = setOf\("mindSweepAdd", "bulkCreate"\)/);
    assert.match(menuModel, /\|\| \(action\.kind in LANDLESS && failure\.message\?\.startsWith\("ACTION_FAILED"\) == true\)/);
    assert.match(menuModel, /if \(refused && action\.kind in LANDLESS\) \{\s+shell\.acknowledged\(action\)\s+shell\.ui \{ landless\(action\) \}\s+return@perform/);
    // Navigation: the Inbox's Mind Sweep (its pill and its empty-Inbox button) and the Weekly Review's open it; the More sheet's saved
    // searches open their screen; Mind Sweep goes back to the screen it opened over.
    assert.equal(code(inboxUi).match(/openMindSweep\(\)/g).length, 2);
    assert.equal(code(weeklyUi).match(/openMindSweep\(\)/g).length, 2);
    assert.match(menuModel, /private fun isSavedSearch\(id: String\) = more\?\.collection\("savedSearches"\)\?\.any \{ it\.getString\("id"\) == id && it\.getString\("route"\)\.startsWith\("\/saved-search\/"\) \} == true/);
    assert.match(menuModel, /else -> if \(isSavedSearch\(id\)\) openSavedSearch\(id\)/);
    assert.match(menuModel, /leave\(if \(flow \|\| over\) MenuScreen\.entries\.firstOrNull \{ it\.name == saved\.get<String>\(if \(over\) "screenFrom" else "reviewFrom"\) \} else null\)/);
    assert.match(menuUi, /MenuScreen\.MindSweep -> MindSweepScreen\(model\)/);
    assert.match(menuUi, /"savedSearch" -> SavedSearchList\(model\)/);
    // Mind Sweep: RN's React state in a synced file while the screen is open (the Bundle names the screen), so rotation and process death
    // keep it; the controls carry core's scope and steps; Add waits for core's view of the text as typed; an answer counts once, for its sweep.
    assert.match(sweepKt, /var state by mutableStateOf\(if \(menu\.screen == MenuScreen\.MindSweep\) stored\(\) \?: fresh\(\) else fresh\(\)\.also \{ file\.delete\(\) \}\)/);
    assert.match(sweepKt, /FileOutputStream\(partial\)\.use \{ out -> out\.write\(value\.toString\(\)\.toByteArray\(\)\); out\.fd\.sync\(\) \}\s+check\(partial\.renameTo\(file\)\)/);
    for (const control of ['start', 'back', 'next']) assert.match(sweepKt, new RegExp(`\\{ step\\(${control}\\.getInt\\("step"\\)\\) \\}`), `${control} carries core's step`);
    assert.match(sweepKt, /scope\(option\.getString\("value"\)\)/);
    assert.match(sweepKt, /if \(viewDraft != state\.getString\("draft"\) \|\| group\.getJSONObject\("add"\)\.getBoolean\("disabled"\)\) return/);
    assert.match(sweepKt, /private fun ours\(action: FailedAction\) = menu\.screen == MenuScreen\.MindSweep && state\.getString\("requestId"\) == action\.id/);
    assert.match(sweepKt, /\.put\("state", sent\.getJSONObject\("sweep"\)\)\.put\("draft", sent\.getString\("draft"\)\)\.put\("addFailed", sent\.getBoolean\("addFailed"\)\)/);
    // A saved search: the menu list machinery reads core's view for its ID (windows of 50, More); Delete asks core's question, then RN goes back.
    assert.match(menuModel, /"savedSearch" -> JSONObject\(\)\.put\("id", own\.optString\("id"\)\)/);
    assert.match(savedSearchUi, /confirm\(delete\.getJSONObject\("confirm"\), JSONObject\(\)\.put\("id", view\.getString\("id"\)\), "savedSearchDelete"\)/);
    assert.match(menuModel, /"savedSearchDelete" -> if \(screen == MenuScreen\.SavedSearch && own\("savedSearch"\)\.optString\("id"\) == JSONObject\(action\.title\)\.getString\("id"\)\) closeScreen\(\)/);
    assert.match(savedSearchUi, /TaskRowItem\(model, it, status = RowStatus\.Badge\)/, 'rows keep the lists\' own commands and editor');
    // Correction pass 1 (finding 3): a later window that went stale drops the partial view and reads the whole view again from
    // offset 0, a bounded number of times (then core's failure shows), in Mind Sweep.
    assert.match(sweepKt, /private fun <T> wholeView\(read: \(\) -> T\): T \{\s+repeat\(STALE_READS - 1\) \{\s+try \{\s+return read\(\)\s+\} catch \(failure: Exception\) \{\s+if \(failure\.message\?\.startsWith\("STALE_REVISION"\) != true\) throw failure\s+\}\s+\}\s+return read\(\)/);
    assert.match(sweepKt, /private const val STALE_READS = 3/);
    assert.match(sweepKt, /private fun read\(runtime: CoreHost, sent: JSONObject\): JSONObject = wholeView \{/);
    assert.equal(code(sweepKt).match(/startsWith\("STALE_REVISION"\)/g).length, 1, 'no reader keeps a partial view: only wholeView catches a stale window');
    // Correction pass 1 (finding 4): the device check settles an injected failure it left owed (the exact request, through the app's
    // Try again), waits until the retry lock and the request on disk are gone, and fails loudly when it cannot.
    const sweepCheck = readFileSync(resolve(app, 'scripts/check-sweep-saved-device.mjs'), 'utf8');
    assert.match(sweepCheck, /const restore = async \(\) => \{\s+for \(const name of PROPS\) \{ try \{ setProp\(name, ''\); \} catch \{ \/\* device gone \*\/ \} \}\s+await settleOwed\(\);/);
    assert.match(sweepCheck, /if \(!retry && !pendingOnDisk\(\)\) \{/);
    assert.match(sweepCheck, /RESTORE FAILED: \$\{owed\} is still owed[^\n]*\n\s+process\.exitCode = 1;/);
    assert.equal(sweepCheck.match(/owed = '/g).length, 1, 'the injected failure is named while its retry is owed');
    assert.equal(sweepCheck.match(/(?<!let )owed = null;/g).length, 2, 'and cleared once settled');
    // Focus's filter pickers search as the Inbox's: core's matches from offset zero at Focus's revision; a changed Focus is read again.
    assert.match(focusModelKt, /runtime\.menuRead\("focusList", JSONObject\(\)\.put\("controls", JSONObject\(sent\)\)\.put\("list", name\)\.put\("offset", items\.length\(\)\)\s+\.put\("limit", WINDOW\)\.put\("revision", revision\)\.put\("query", query\)\.toString\(\)\)/);
    assert.match(focusModelKt, /else if \(found == null\) shell\.refreshFocus\(\)/);
    assert.match(focusControlsUi, /LaunchedEffect\(revision, picker\) \{ if \(query\.isNotBlank\(\)\) searchPicker\(picker, query,/);
    // Bulk organize's pickers: core's create row and the keyboard's Done (core's submit, after the text as typed is read); a create
    // answers with core's draft, which the dialog keeps.
    assert.match(bulkUi, /picker\?\.optJSONObject\("create"\)\?\.let \{ create ->/);
    assert.match(bulkUi, /organizeCreate\(create\.getString\("name"\)\)/);
    assert.match(menuModel, /submit\.optJSONObject\("edit"\)\?\.let \{ edit -> organizePicker\(null\); organizeEdit\(edit\) \} \?: submit\.menuText\("create"\)\?\.let\(::organizeCreate\)/);
    assert.match(menuModel, /"bulkCreate" -> dialog\?\.takeIf \{ it\.optString\("kind"\) == "organize" \}\?\.let \{ open ->\s+keepDialog\(JSONObject\(open\.toString\(\)\)\.put\("draft", reply\.getJSONObject\("draft"\)\)/);
    // No Kotlin policy, dates, colors or literal text in the new files; one semantics block per control.
    for (const [name, text] of Object.entries(pass11)) {
        assert.doesNotMatch(code(text), /\.(sort\w*|sorted\w*|filter(?!Bg\b|Edit\b|s\b)\w*|groupBy|reversed|asReversed|shuffled|distinct\w*|partition|minBy|maxBy)\b/, `${name}: no Kotlin sorting, filtering, or grouping`);
        assert.doesNotMatch(code(text), /SimpleDateFormat|DateTimeFormatter|LocalDate|LocalTime|java\.time|java\.util\.Calendar|Calendar\.getInstance|GregorianCalendar|Instant\b|\.format\(|toLocal|currentTimeMillis|\bDate\(|TimeZone/, `${name}: no Kotlin date math, formatting or parsing`);
        assert.doesNotMatch(code(text), new RegExp(`${STATUS}(?:\\s*,\\s*${STATUS})*\\s*->\\s*${STATUS}`), `${name}: no status-to-status map`);
        assert.doesNotMatch(code(text), /\bColor\(|Color\.(Black|White|Red|Green|Blue|Gray|Yellow|Cyan|Magenta|DarkGray|LightGray|Transparent)\b|parseColor|"#[0-9A-Fa-f]{3,8}"|0x[0-9A-Fa-f]{8}/, `${name} writes a color; colors live only in Theme.kt`);
        for (const [, key] of code(text).matchAll(/"([a-z][A-Za-z]*(?:\.[A-Za-z]+)+)"/g)) assert(labelKeys.includes(key), `${name}: ${key} is not in LABEL_KEYS`);
        for (const [, rest] of code(text).matchAll(/(?:\bText\(|contentDescription = |onClickLabel = )([^\n]*)/g)) {
            for (const [, literal] of rest.replace(/\b(t|testTag|getString|optString|text|getJSONObject|optJSONObject|getBoolean|optBoolean|getInt|menuText|menuObjects)\("[^"]*"\)/g, '').replace(/\btestTag = "[^"]*"/g, '').matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
                if (labelKeys.includes(literal)) continue;
                assert.doesNotMatch(literal.replace(/\$\{[^}]*\}|\$\w+/g, ''), /\p{L}/u, `${name}: hard-coded UI text "${literal}"`);
            }
        }
        // The screens (the composables after each model) reach core only through their model.
        const ui = code(text).slice(Math.max(0, code(text).indexOf('@Composable')));
        assert.doesNotMatch(ui, /runtime\.|menuCommand\(|menuRead\(|shell\.perform/, `${name}: the screen reaches core only through its model`);
        assert.doesNotMatch(code(text), /\.clickable\(enabled = [^\n]*\.semantics \{ contentDescription|\.semantics \{ contentDescription[^\n]*\}\s*\.clickable\(enabled/, `${name}: no control with a clickable and a separate semantics block`);
    }
    assert(code(sweepKt).match(/\.clearAndSetSemantics \{/g).length >= 3);
    assert(code(savedSearchUi).match(/\.clearAndSetSemantics \{/g).length >= 2);
}

const fakeCore = `
export class SqliteAdapter {
  async getData() {
    globalThis.events.push('load');
    globalThis.lastLoaded = globalThis.fakeDataSequence.shift() || globalThis.fakeData;
    return globalThis.lastLoaded;
  }
  async saveData(data) {
    globalThis.events.push('save');
    if (globalThis.saveError) throw new Error(globalThis.saveError);
    globalThis.fakeData = globalThis.afterSave || data;
  }
}
export function planLegacyJsonImport(state, current, sqliteHasData) {
  globalThis.events.push('plan');
  globalThis.planInputs.push(JSON.stringify([state, current.tasks.length, sqliteHasData]));
  return globalThis.plan;
}
export async function sqliteHasAnyData() { return globalThis.sqliteHasData; }
// Core compares every persisted field; the fake compares the whole snapshot.
export function legacyImportMismatch(merged, saved) { return JSON.stringify(merged) === JSON.stringify(saved) ? null : 'tasks'; }
export function splitSqlStatements(sql) { return [sql]; }
export function setStorageAdapter(adapter) { globalThis.adapter = adapter; }
export async function flushPendingSave() { globalThis.events.push('flush'); }
export function createNativeHostContract() {
  return {
    async activate() {
      globalThis.events.push('activate');
      await globalThis.adapter.getData();
      globalThis.activationCount++;
      globalThis.saveCount++;
      return { ok: true, value: null };
    },
    getInboxWindow() {
      globalThis.queryCount++;
      return { ok: true, value: { version: 1, revision: 'r', total: 0, rows: [] } };
    },
    getFocus(input) {
      globalThis.focusInputs.push(JSON.stringify(input));
      return { ok: true, value: { version: 1, revision: 'f', sections: [] } };
    },
    getFocusSectionWindow(input) {
      globalThis.focusInputs.push(JSON.stringify(input));
      return globalThis.focusWindowResult;
    },
    getTaskEditorModel(input) {
      globalThis.editorInputs.push(JSON.stringify(input));
      return { ok: true, value: { version: 1, id: input.id } };
    },
    getTaskView(input) {
      globalThis.editorInputs.push(JSON.stringify(['view', input]));
      return { ok: true, value: { version: 1, id: input.id, readOnly: false, rows: [], checklistBase: [{ id: 'c', title: 'Milk', isCompleted: true }] } };
    },
    editTaskChecklist(input) {
      globalThis.editorInputs.push(JSON.stringify(['checklist', input]));
      return { ok: true, value: { draft: input.draft, checklist: input.checklist, changed: false, focusId: null, field: { items: [] } } };
    },
    async resetTaskChecklist(input) {
      globalThis.updateInputs.push(JSON.stringify(['reset', input]));
      return { ok: true, value: { id: input.id, checklist: [] } };
    },
    getTaskEditorSuggestions(input) {
      globalThis.editorInputs.push(JSON.stringify(['suggest', input]));
      return { ok: true, value: { draftValue: '@home', matches: [], quick: [] } };
    },
    editTaskDraft(input) {
      globalThis.editorInputs.push(JSON.stringify(['edit', input]));
      return { ok: true, value: { version: 1, id: input.id, draft: input.draft } };
    },
    async saveTaskDraft(input) {
      globalThis.updateInputs.push(JSON.stringify(['draft', input]));
      return globalThis.saveDraftResult;
    },
    async updateTask(input) {
      globalThis.updateInputs.push(JSON.stringify(input));
      return globalThis.updateResult;
    },
    async setLanguage(input) {
      globalThis.languageInputs.push(JSON.stringify(input));
      return { ok: true, value: { language: input.storedLanguage ?? 'en' } };
    },
    getStrings(input) {
      globalThis.languageInputs.push(JSON.stringify(input));
      return { ok: true, value: { language: 'zh', strings: { 'tab.inbox': '收集箱' }, missing: [] } };
    },
    getProjects() {
      globalThis.projectInputs.push('projects');
      return { ok: true, value: { version: 1, revision: 'p', active: [], deferred: [], archived: [] } };
    },
    getProjectDetail(input) {
      globalThis.projectInputs.push(JSON.stringify(input));
      return globalThis.projectDetailResult;
    },
    async submitQuickCapture(input) { globalThis.createCount++; globalThis.captureInputs.push(JSON.stringify(['submit', input])); return { ok: true, value: { kind: 'saved', taskId: 'id', next: 'close', reset: null } }; },
    openQuickCapture() { globalThis.captureInputs.push('open'); return { ok: true, value: { version: 1, options: {} } }; },
    getQuickCaptureView(input) { globalThis.captureInputs.push(JSON.stringify(['view', input])); return { ok: true, value: { version: 1, options: input.options } }; },
    editQuickCapture(input) { globalThis.captureInputs.push(JSON.stringify(['edit', input])); return { ok: true, value: { view: { options: input.options }, notice: null } }; },
    async createQuickCaptureSnapshot() { globalThis.captureInputs.push('snapshot'); return globalThis.snapshotResult; },
    async submitQuickCaptureLines(input) { globalThis.captureInputs.push(JSON.stringify(['lines', input])); return { ok: true, value: { kind: 'saved', taskIds: input.captureIds } }; },
    async submitQuickCapturePickerQuery(input) { globalThis.captureInputs.push(JSON.stringify(['picker', input])); return { ok: true, value: { options: input.options, created: true } }; },
    async setTaskFocus(input) { globalThis.newInputs.push(JSON.stringify(['taskFocus', input])); return globalThis.taskFocusResult; },
    async setProjectFocus(input) { globalThis.newInputs.push(JSON.stringify(['projectFocus', input])); return { ok: true, value: { blocked: '' } }; },
    async createProject(input) { globalThis.newInputs.push(JSON.stringify(['createProject', input])); return { ok: true, value: { id: 'p' } }; },
    getAreaFilter() { globalThis.newInputs.push('areaFilter'); return { ok: true, value: { revision: 'a', label: 'All', summary: 'All areas', options: [] } }; },
    async setAreaFilter(input) { globalThis.newInputs.push(JSON.stringify(['setAreaFilter', input])); return { ok: true, value: input }; },
    async completeTask() { globalThis.completeCount++; return { ok: true, value: { id: 'id' } }; },
    async searchTasks(input) { globalThis.newInputs.push(JSON.stringify(['search', input])); return { ok: true, value: { version: 1, query: input.query.trim() } }; },
    async saveSearch(input) { globalThis.newInputs.push(JSON.stringify(['saveSearch', input])); return { ok: true, value: { id: 's', existing: false } }; },
    startInboxProcessing(input) { globalThis.newInputs.push(JSON.stringify(['inboxStart', input])); return { ok: true, value: { sessionId: 'x', view: { step: 'actionable' } } }; },
    getInboxProcessingStep(input) { globalThis.newInputs.push(JSON.stringify(['inboxStep', input])); return { ok: true, value: { step: 'actionable' } }; },
    async commitInboxProcessingStep(input) { globalThis.newInputs.push(JSON.stringify(['inboxCommit', input])); return globalThis.inboxCommitResult; },
    async skipInboxProcessingTask(input) { globalThis.newInputs.push(JSON.stringify(['inboxSkip', input])); return { ok: true, value: { view: null, notice: null, toast: null } }; },
    endInboxProcessing(input) { globalThis.newInputs.push(JSON.stringify(['inboxEnd', input])); return { ok: true, value: null }; },
    getMoreMenu() { globalThis.menuInputs.push('more'); return { ok: true, value: { version: 1, revision: 'm', primary: [] } }; },
    getWaitingView(input) { globalThis.menuInputs.push(JSON.stringify(['waiting', input])); return { ok: true, value: { version: 1, revision: 'w', total: 0, rows: [] } }; },
    getSomedayView(input) { globalThis.menuInputs.push(JSON.stringify(['someday', input])); return globalThis.menuReadResult; },
    getMenuViewCollection(input) { globalThis.menuInputs.push(JSON.stringify(['collection', input])); return { ok: true, value: { items: [] } }; },
    getArchiveView(input) { globalThis.menuInputs.push(JSON.stringify(['archive', input])); return { ok: true, value: { version: 1, items: [] } }; },
    async moveSomedayTasksToSection(input) { globalThis.menuInputs.push(JSON.stringify(['somedayMove', input])); return globalThis.menuCommandResult; },
    async addSomedaySectionTask(input) { globalThis.menuInputs.push(JSON.stringify(['somedayTask', input])); return { ok: true, value: { id: input.captureId, toast: 'Task created' } }; },
    async runArchiveAction(input) { globalThis.menuInputs.push(JSON.stringify(['archiveAction', input])); return { ok: true, value: { changed: true, toast: null } }; },
    getContextsView(input) { globalThis.menuInputs.push(JSON.stringify(['contexts', input])); return { ok: true, value: { version: 1, revision: 'c', total: 0, rows: [] } }; },
    getTrashView(input) { globalThis.menuInputs.push(JSON.stringify(['trash', input])); return { ok: true, value: { version: 1, revision: 't', total: 0, items: [] } }; },
    getReviewOverview(input) { globalThis.menuInputs.push(JSON.stringify(['review', input])); return { ok: true, value: { version: 1, revision: 'o', total: 0, items: [] } }; },
    getWeeklyReview(input) { globalThis.menuInputs.push(JSON.stringify(['weekly', input])); return { ok: true, value: { version: 1, revision: 'w', total: 0, items: [] } }; },
    getWeeklyReviewList(input) { globalThis.menuInputs.push(JSON.stringify(['weeklyList', input])); return { ok: true, value: { version: 1, revision: 'w', total: 0, items: [] } }; },
    getDailyReview(input) { globalThis.menuInputs.push(JSON.stringify(['daily', input])); return { ok: true, value: { version: 1, revision: 'd', total: 0, items: [] } }; },
    async runContextsAction(input) { globalThis.menuInputs.push(JSON.stringify(['contextsAction', input])); return { ok: true, value: { changed: true, toast: null } }; },
    async runTrashAction(input) { globalThis.menuInputs.push(JSON.stringify(['trashAction', input])); return { ok: true, value: { changed: true, toast: null } }; },
    async runReviewAction(input) {
      globalThis.menuInputs.push(JSON.stringify(['reviewAction', input]));
      return input.action.type === 'markReviewedTasks' ? { ok: false, error: { code: 'SAVE_FAILED', message: 'disk full' } } : { ok: true, value: { changed: true, toast: null, createdId: null } };
    },
  };
}
export const DEFAULT_GLOBAL_SEARCH_FILTERS = { scope: 'all' };
export const STATUS_COLORS_BY_THEME = {
  light: { done: { bg: '#22C55E20', text: '#22C55E', border: '#22C55E' } }, dark: { done: { bg: '#4ADE8026', text: '#4ADE80', border: '#4ADE80' } },
  nord: { done: { bg: '#A3BE8C26', text: '#A3BE8C', border: '#A3BE8C' } },
};
export const TASK_PRIORITY_COLORS = { urgent: '#dc2626', low: '#3b82f6' };
export function themeDescriptor(theme) {
  return { nord: { scheme: 'dark', statusPreset: 'nord' }, 'material3-light': { scheme: 'light', statusPreset: null } }[theme];
}
export const useTaskStore = { getState: () => ({
  settings: globalThis.settings,
  _allTasks: globalThis.lastLoaded ? globalThis.lastLoaded.tasks : [],
  _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
  persistenceFailure: globalThis.persistenceFailure,
}) };
export function logInfo() { throw new Error('diagnostic sink failed'); }
export function logWarn() { throw new Error('diagnostic sink failed'); }
`;
const built = await build({
    entryPoints: [resolve(app, 'bundle/host-entry.ts')], bundle: true, write: false, format: 'iife',
    plugins: [{ name: 'fake-core', setup(plugin) {
        plugin.onResolve({ filter: /^@mindwtr\/core$/ }, () => ({ path: 'core', namespace: 'test' }));
        plugin.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: fakeCore, loader: 'js' }));
    } }],
});
const makeState = (taskCount, fakeDataSequence = []) => {
    const state = {
        fakeData: { tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} },
        fakeDataSequence, activationCount: 0, saveCount: 0, queryCount: 0,
        events: [], planInputs: [], plan: null, sqliteHasData: true, saveError: null, afterSave: null, lastLoaded: null, commitResult: null,
        createCount: 0, completeCount: 0, persistenceFailure: null, captureInputs: [],
        snapshotResult: { ok: true, value: { fileName: 'data.2026-09-24T10-00-00.000.snapshot.json', contents: '{}' } }, editorInputs: [], updateInputs: [], focusInputs: [],
        languageInputs: [], projectInputs: [], settings: undefined, newInputs: [], menuInputs: [],
        menuReadResult: { ok: false, error: { code: 'STALE_REVISION', message: 'Someday changed; restart paging from offset zero' } },
        menuCommandResult: { ok: false, error: { code: 'SAVE_FAILED', message: 'disk full' } },
        taskFocusResult: { ok: true, value: { blocked: 'Max 5 focus items.', blockedTitle: 'Focus' } },
        projectDetailResult: { ok: false, error: { code: 'STALE_REVISION', message: 'Project changed; restart paging from offset zero' } },
        focusWindowResult: { ok: false, error: { code: 'STALE_REVISION', message: 'Focus changed; restart paging' } },
        updateResult: { ok: true, value: { id: 't', changed: true } },
        saveDraftResult: { ok: true, value: { id: 't', draft: { title: 'b' } } },
        inboxCommitResult: { ok: false, error: { code: 'SAVE_FAILED', message: 'disk full' } },
        __mindwtrNative: {
            sqlAll(sql) {
                // 'auto': the tasks count matches the load, as a real database would.
                if (sql.includes('COUNT(*)') && sql.includes('tasks')) {
                    return JSON.stringify([{ n: taskCount === 'auto' ? state.lastLoaded.tasks.length : taskCount }]);
                }
                if (sql.includes('COUNT(*)')) return '[{"n":0}]';
                return '[]';
            },
            sqlRun() {}, sqlExec() {},
            rnStateCommit(change) { state.events.push(`commit:${change}`); return state.commitResult; },
        },
    };
    vm.runInNewContext(built.outputFiles[0].text, state);
    return state;
};
const poll = async (state, id) => {
    await new Promise((resolveTick) => setImmediate(resolveTick));
    return JSON.parse(state.MindwtrHost.poll(id));
};
const state = makeState(1);
const result = await poll(state, state.MindwtrHost.boot());
assert.equal(result.ok, false);
assert.match(result.error, /Incomplete tasks load/);
assert.equal(state.activationCount, 0);
assert.equal(state.saveCount, 0);
assert.equal(state.createCount, 0);
assert.equal(state.completeCount, 0);

const full = { tasks: [{ id: 'first' }], projects: [], sections: [], areas: [], people: [], settings: {} };
const partial = { ...full, tasks: [] };
const secondRead = makeState(1, [full, partial]);
const secondResult = await poll(secondRead, secondRead.MindwtrHost.boot());
assert.equal(secondResult.ok, false);
assert.match(secondResult.error, /Incomplete tasks load/);
assert.equal(secondRead.activationCount, 0);
assert.equal(secondRead.saveCount, 0);

const ready = makeState(0);
assert.equal((await poll(ready, ready.MindwtrHost.boot())).ok, true);
assert.equal(ready.activationCount, 1);
// Activation may write (core backfills a person per assignee): the store is checked against a load taken after its save.
assert.deepEqual(ready.events.slice(ready.events.lastIndexOf('activate')), ['activate', 'load', 'flush', 'load']);
// The capture popup: every call passes Kotlin's JSON to core unchanged; the snapshot comes wrapped, null in sandbox mode.
{
    const draft = { text: 'Call @phone', options: { addAnother: false } };
    const submitInput = { ...draft, captureId: '123', openAfterSave: false };
    assert.equal((await poll(ready, ready.MindwtrHost.captureSubmit(JSON.stringify(submitInput)))).value.kind, 'saved');
    assert.equal(ready.createCount, 1);
    assert.equal((await poll(ready, ready.MindwtrHost.captureOpen())).ok, true);
    assert.deepEqual((await poll(ready, ready.MindwtrHost.captureView(JSON.stringify({ ...draft, picker: { kind: 'project', query: 'h' } })))).value.options, draft.options);
    assert.equal((await poll(ready, ready.MindwtrHost.captureEdit(JSON.stringify({ ...draft, edit: { type: 'toggleFocus' } })))).value.notice, null);
    assert.deepEqual((await poll(ready, ready.MindwtrHost.captureSnapshot())).value,
        { snapshot: { fileName: 'data.2026-09-24T10-00-00.000.snapshot.json', contents: '{}' } });
    ready.snapshotResult = { ok: true, value: null };
    assert.deepEqual((await poll(ready, ready.MindwtrHost.captureSnapshot())).value, { snapshot: null });
    const linesInput = { text: 'a\nb', options: draft.options, captureIds: ['1', '2'], snapshotFileName: null };
    assert.deepEqual((await poll(ready, ready.MindwtrHost.captureLines(JSON.stringify(linesInput)))).value, { kind: 'saved', taskIds: ['1', '2'] });
    const pickerInput = { picker: 'project', query: 'Home', ...draft, requestId: '9' };
    assert.equal((await poll(ready, ready.MindwtrHost.capturePicker(JSON.stringify(pickerInput)))).value.created, true);
    assert.deepEqual(ready.captureInputs, [JSON.stringify(['submit', submitInput]), 'open', JSON.stringify(['view', { ...draft, picker: { kind: 'project', query: 'h' } }]),
        JSON.stringify(['edit', { ...draft, edit: { type: 'toggleFocus' } }]), 'snapshot', 'snapshot', JSON.stringify(['lines', linesInput]), JSON.stringify(['picker', pickerInput])]);
    ready.captureInputs.length = 0;
}
// update passes Kotlin's { id, base, patch } to core unchanged, and a refusal keeps its code prefix.
const updateInput = JSON.stringify({ id: 't', base: { title: 'a', dueDate: null }, patch: { title: 'b', dueDate: '2026-09-15' } });
assert.deepEqual(await poll(ready, ready.MindwtrHost.update(updateInput)), { ok: true, value: { id: 't', changed: true } });
assert.deepEqual(ready.updateInputs, [updateInput]);
ready.updateResult = { ok: false, error: { code: 'STALE_REVISION', message: 'Task changed while editing: title' } };
assert.deepEqual(await poll(ready, ready.MindwtrHost.update(updateInput)),
    { ok: false, error: 'STALE_REVISION: Task changed while editing: title' });
assert.deepEqual(await poll(ready, ready.MindwtrHost.editorModel('t')), { ok: true, value: { version: 1, id: 't' } });
// The View tab and the checklist edit pass Kotlin's input to core unchanged; Reset checklist is a command (no requireSaved).
assert.deepEqual(await poll(ready, ready.MindwtrHost.taskView('{"id":"t"}')),
    { ok: true, value: { version: 1, id: 't', readOnly: false, rows: [], checklistBase: [{ id: 'c', title: 'Milk', isCompleted: true }] } });
const checklistInput = { id: 't', draft: { title: 'a' }, checklist: [{ id: 'c', title: 'Milk', isCompleted: true }], edit: { kind: 'toggle', index: 0 } };
assert.deepEqual((await poll(ready, ready.MindwtrHost.editChecklist(JSON.stringify(checklistInput)))).value.checklist, checklistInput.checklist);
assert.deepEqual(await poll(ready, ready.MindwtrHost.editorSuggestions('t', 'contexts', 'home', 4)),
    { ok: true, value: { draftValue: '@home', matches: [], quick: [] } });
const editInput = { id: 't', draft: { title: 'a', dueDate: '' }, edit: { type: 'pickDate', field: 'dueDate', date: '2026-09-17' } };
assert.deepEqual(await poll(ready, ready.MindwtrHost.editDraft(JSON.stringify(editInput))), { ok: true, value: { version: 1, id: 't', draft: editInput.draft } });
assert.deepEqual(ready.editorInputs, ['{"id":"t"}', '["view",{"id":"t"}]', JSON.stringify(['checklist', checklistInput]), '["suggest",{"id":"t","field":"contexts","query":"home","limit":4}]',
    JSON.stringify(['edit', editInput])]);
// saveDraft passes Kotlin's { id, base, patch } to core's saveTaskDraft unchanged, and a refusal keeps its code prefix.
const draftInput = JSON.stringify({ id: 't', base: { title: 'a', dueDate: '', relativeStartOffset: null }, patch: { title: 'b', dueDate: '2026-09-15T14:05', relativeStartOffset: null } });
assert.deepEqual(await poll(ready, ready.MindwtrHost.saveDraft(draftInput)), { ok: true, value: { id: 't', draft: { title: 'b' } } });
ready.saveDraftResult = { ok: false, error: { code: 'STALE_REVISION', message: 'Task changed while editing: title' } };
assert.deepEqual(await poll(ready, ready.MindwtrHost.saveDraft(draftInput)), { ok: false, error: 'STALE_REVISION: Task changed while editing: title' });
assert.deepEqual(ready.updateInputs.slice(-2), [JSON.stringify(['draft', JSON.parse(draftInput)]), JSON.stringify(['draft', JSON.parse(draftInput)])]);
ready.updateInputs.length = 2;
ready.saveDraftResult = { ok: true, value: { id: 't', draft: { title: 'b' } } };
// Focus queries pass Kotlin's arguments to core unchanged; a stale window keeps its code prefix for Kotlin.
assert.deepEqual(await poll(ready, ready.MindwtrHost.focus(50)), { ok: true, value: { version: 1, revision: 'f', sections: [] } });
assert.deepEqual(await poll(ready, ready.MindwtrHost.focusWindow('next', 50, 50, 'f')),
    { ok: false, error: 'STALE_REVISION: Focus changed; restart paging' });
assert.deepEqual(ready.focusInputs, ['{"limit":50}', '{"key":"next","offset":50,"limit":50,"revision":"f"}']);
// With Focus's control state (and a control's edit), both pass them to core as parsed JSON.
await poll(ready, ready.MindwtrHost.focus(50, '{"sortBy":"due"}', '{"type":"sort","sortBy":"title"}'));
await poll(ready, ready.MindwtrHost.focusWindow('next', 50, 50, 'f', '{"sortBy":"due"}'));
assert.deepEqual(ready.focusInputs.slice(2), ['{"limit":50,"controls":{"sortBy":"due"},"controlEdit":{"type":"sort","sortBy":"title"}}',
    '{"key":"next","offset":50,"limit":50,"revision":"f","controls":{"sortBy":"due"}}']);
// A command is accepted while a read is still in flight: the host neither serializes nor refuses them.
{
    const completesBefore = ready.completeCount;
    const read = ready.MindwtrHost.focus(50);
    const command = ready.MindwtrHost.complete('t');
    assert.equal((await poll(ready, command)).ok, true);
    assert.equal(ready.completeCount, completesBefore + 1);
    assert.equal((await poll(ready, read)).ok, true);
    ready.focusInputs.pop();
}
// Language: "" is no stored language; the keys pass to core unchanged.
assert.deepEqual(await poll(ready, ready.MindwtrHost.language('', 'en-US')), { ok: true, value: { language: 'en' } });
assert.deepEqual(await poll(ready, ready.MindwtrHost.language('zh', 'en-US')), { ok: true, value: { language: 'zh' } });
assert.deepEqual(await poll(ready, ready.MindwtrHost.strings('["tab.inbox"]')),
    { ok: true, value: { language: 'zh', strings: { 'tab.inbox': '收集箱' }, missing: [] } });
assert.deepEqual(ready.languageInputs, ['{"storedLanguage":null,"systemLocale":"en-US"}', '{"storedLanguage":"zh","systemLocale":"en-US"}',
    '{"keys":["tab.inbox"]}']);
// Theme: the synced setting wins over RN's device-local choice, then the system; core classifies it and sends its hues.
{
    const theme = async (stored) => (await poll(ready, ready.MindwtrHost.theme(stored))).value;
    assert.deepEqual(await theme(''), { mode: 'system', preset: 'default', material: false, scheme: null,
        status: { light: { done: { bg: '#22C55E20', text: '#22C55E', border: '#22C55E' } }, dark: { done: { bg: '#4ADE8026', text: '#4ADE80', border: '#4ADE80' } } }, priority: { urgent: '#dc2626', low: '#3b82f6' } });
    assert.deepEqual(await theme('material3-light'), { mode: 'material3-light', preset: 'default', material: true, scheme: 'light',
        status: { light: { done: { bg: '#22C55E20', text: '#22C55E', border: '#22C55E' } }, dark: { done: { bg: '#4ADE8026', text: '#4ADE80', border: '#4ADE80' } } }, priority: { urgent: '#dc2626', low: '#3b82f6' } });
    ready.settings = { theme: 'nord' };
    assert.deepEqual(await theme('material3-light'), { mode: 'nord', preset: 'nord', material: false, scheme: 'dark',
        status: { light: { done: { bg: '#A3BE8C26', text: '#A3BE8C', border: '#A3BE8C' } }, dark: { done: { bg: '#A3BE8C26', text: '#A3BE8C', border: '#A3BE8C' } } }, priority: { urgent: '#dc2626', low: '#3b82f6' } });
    ready.settings = undefined;
}
// Projects pass Kotlin's arguments to core unchanged; the first window has no revision, and a stale one keeps its code prefix.
assert.deepEqual(await poll(ready, ready.MindwtrHost.projects()),
    { ok: true, value: { version: 1, revision: 'p', active: [], deferred: [], archived: [] } });
assert.deepEqual(await poll(ready, ready.MindwtrHost.projectDetail('p1', 50, 50, 'r')),
    { ok: false, error: 'STALE_REVISION: Project changed; restart paging from offset zero' });
ready.projectDetailResult = { ok: true, value: { version: 1, revision: 'r', projectId: 'p1', readOnly: false, total: 0, items: [] } };
assert.equal((await poll(ready, ready.MindwtrHost.projectDetail('p1', 0, 50, ''))).ok, true);
assert.deepEqual(ready.projectInputs, ['projects', '{"projectId":"p1","offset":50,"limit":50,"revision":"r"}', '{"projectId":"p1","offset":0,"limit":50}']);
// The new commands pass Kotlin's arguments to core unchanged: the star's target, the request UUID, "" as no area, a `next` selection.
assert.deepEqual(await poll(ready, ready.MindwtrHost.taskFocus('t', true)), { ok: true, value: { blocked: 'Max 5 focus items.', blockedTitle: 'Focus' } });
assert.deepEqual(await poll(ready, ready.MindwtrHost.projectFocus('p', false)), { ok: true, value: { blocked: '' } });
assert.deepEqual(await poll(ready, ready.MindwtrHost.createProject('New', '', '123')), { ok: true, value: { id: 'p' } });
assert.equal((await poll(ready, ready.MindwtrHost.areaFilter())).value.label, 'All');
assert.equal((await poll(ready, ready.MindwtrHost.setAreaFilter('{"included":["a"],"excluded":[]}'))).ok, true);
assert.deepEqual(ready.newInputs, ['["taskFocus",{"id":"t","focused":true}]', '["projectFocus",{"id":"p","focused":false}]',
    '["createProject",{"title":"New","areaId":null,"requestId":"123"}]', 'areaFilter', '["setAreaFilter",{"included":["a"],"excluded":[]}]']);
ready.taskFocusResult = { ok: false, error: { code: 'SAVE_FAILED', message: 'disk full' } };
assert.deepEqual(await poll(ready, ready.MindwtrHost.taskFocus('t', true)), { ok: false, error: 'SAVE_FAILED: disk full' });
ready.newInputs.length = 0;
// Search and Process Inbox pass Kotlin's JSON to core unchanged; a failed answer keeps its code prefix; end answers an object.
{
    const searchInput = { query: ' milk ', filters: { scope: 'all' }, limit: 50 };
    const stepInput = { sessionId: 'x', taskId: 't', step: 'actionable', edit: { type: 'set', field: 'title', value: 'a' } };
    const commitInput = { sessionId: 'x', taskId: 't', step: 'actionable', decision: { choice: 'trash' }, requestId: 'r' };
    assert.equal((await poll(ready, ready.MindwtrHost.search(JSON.stringify(searchInput)))).value.query, 'milk');
    assert.equal((await poll(ready, ready.MindwtrHost.saveSearch('{"query":"milk","name":"Milk","requestId":"r"}'))).ok, true);
    assert.equal((await poll(ready, ready.MindwtrHost.inboxStart('quick'))).value.sessionId, 'x');
    assert.equal((await poll(ready, ready.MindwtrHost.inboxStep(JSON.stringify(stepInput)))).ok, true);
    assert.deepEqual(await poll(ready, ready.MindwtrHost.inboxCommit(JSON.stringify(commitInput))), { ok: false, error: 'SAVE_FAILED: disk full' });
    assert.equal((await poll(ready, ready.MindwtrHost.inboxSkip('{"sessionId":"x","taskId":"t","requestId":"s"}'))).value.view, null);
    assert.deepEqual(await poll(ready, ready.MindwtrHost.inboxEnd('x')), { ok: true, value: {} });
    assert.deepEqual(ready.newInputs, [JSON.stringify(['search', searchInput]), '["saveSearch",{"query":"milk","name":"Milk","requestId":"r"}]',
        '["inboxStart",{"mode":"quick"}]', JSON.stringify(['inboxStep', stepInput]), JSON.stringify(['inboxCommit', commitInput]),
        '["inboxSkip",{"sessionId":"x","taskId":"t","requestId":"s"}]', '["inboxEnd",{"sessionId":"x"}]']);
    // The screen's first read sends no filters: the host fills in core's defaults.
    await poll(ready, ready.MindwtrHost.search('{"query":"","filters":null,"limit":50}'));
    assert.deepEqual(ready.newInputs.slice(-1), [JSON.stringify(['search', { query: '', filters: { scope: 'all' }, limit: 50 }])]);
    ready.newInputs.length = 0;
}
// The Menu tab's reads and commands pass Kotlin's JSON to core unchanged; a refusal keeps its code prefix; an unknown name is refused.
{
    const somedayInput = { sortBy: 'title', filters: { tokens: ['#home'] }, filterEdit: { type: 'toggleToken', value: '#home' }, offset: 0, limit: 50 };
    const moveInput = { taskIds: ['a', 'b'], sectionId: null, requestId: 'r' };
    assert.equal((await poll(ready, ready.MindwtrHost.menuRead('more', '{}'))).value.revision, 'm');
    assert.equal((await poll(ready, ready.MindwtrHost.menuRead('waiting', '{"person":"","offset":0,"limit":50}'))).ok, true);
    assert.deepEqual(await poll(ready, ready.MindwtrHost.menuRead('someday', JSON.stringify(somedayInput))),
        { ok: false, error: 'STALE_REVISION: Someday changed; restart paging from offset zero' });
    assert.equal((await poll(ready, ready.MindwtrHost.menuRead('archive', '{"offset":0,"limit":50}'))).ok, true);
    assert.deepEqual(await poll(ready, ready.MindwtrHost.menuCommand('somedayMove', JSON.stringify(moveInput))), { ok: false, error: 'SAVE_FAILED: disk full' });
    assert.equal((await poll(ready, ready.MindwtrHost.menuCommand('somedayTask', '{"title":"t","sectionId":null,"captureId":"c"}'))).value.id, 'c');
    assert.match((await poll(ready, ready.MindwtrHost.menuRead('nope', '{}'))).error, /^INVALID_INPUT/);
    assert.match((await poll(ready, ready.MindwtrHost.menuCommand('nope', '{}'))).error, /^INVALID_INPUT/);
    assert.deepEqual(ready.menuInputs, ['more', JSON.stringify(['waiting', { person: '', offset: 0, limit: 50 }]), JSON.stringify(['someday', somedayInput]),
        JSON.stringify(['archive', { offset: 0, limit: 50 }]), JSON.stringify(['somedayMove', moveInput]),
        JSON.stringify(['somedayTask', { title: 't', sectionId: null, captureId: 'c' }])]);
    ready.menuInputs.length = 0;
}
// Pass 7: Contexts, Trash, Review and the reviews pass Kotlin's JSON to core unchanged; a failed save keeps its code prefix.
{
    const reads = [['contexts', { tokens: ['@home'], matchMode: 'all', searchQuery: '', selectedIds: [], offset: 0, limit: 50 }],
        ['trash', { selected: { taskIds: [], projectIds: [] }, offset: 0, limit: 50 }],
        ['review', { scope: 'due', selectedIds: [], expansionEdit: { type: 'cycle' }, offset: 0, limit: 50 }],
        ['weekly', { checkpoint: null, expandedProjectId: null, offset: 0, limit: 50 }],
        ['weeklyList', { checkpoint: 'c', expandedProjectId: null, list: 'contextTasks', key: '@home', offset: 100, limit: 100, revision: 'w' }],
        ['daily', { checkpoint: null, offset: 0, limit: 50 }]];
    for (const [name, input] of reads) assert.equal((await poll(ready, ready.MindwtrHost.menuRead(name, JSON.stringify(input)))).ok, true, `menuRead ${name}`);
    const commands = [['contextsAction', { requestId: 'r1', action: { type: 'trashTask', taskId: 't' } }],
        ['trashAction', { requestId: 'r2', action: { type: 'emptyTrash', revision: 'd' } }],
        ['reviewTask', { requestId: 'r3', action: { type: 'addProjectTask', projectId: 'p', title: 'x' } }]];
    for (const [name, input] of commands) assert.equal((await poll(ready, ready.MindwtrHost.menuCommand(name, JSON.stringify(input)))).ok, true, `menuCommand ${name}`);
    const mark = { requestId: 'r4', action: { type: 'markReviewedTasks', taskIds: ['t'] } };
    assert.deepEqual(await poll(ready, ready.MindwtrHost.menuCommand('reviewAction', JSON.stringify(mark))), { ok: false, error: 'SAVE_FAILED: disk full' });
    assert.deepEqual(ready.menuInputs, [...reads.map(([name, input]) => JSON.stringify([name, input])),
        ...commands.map(([name, input]) => JSON.stringify([name === 'reviewTask' ? 'reviewAction' : name, input])), JSON.stringify(['reviewAction', mark])]);
    ready.menuInputs.length = 0;
}
ready.persistenceFailure = { message: 'disk full' };
const queriesBeforeFailure = ready.queryCount;
const blockedRefresh = await poll(ready, ready.MindwtrHost.window(0, 50, ''));
assert.equal(blockedRefresh.ok, false);
assert.match(blockedRefresh.error, /SAVE_FAILED/);
assert.equal(ready.queryCount, queriesBeforeFailure);
// The editor cannot load unsaved in-memory values as if they were stored.
for (const blocked of [ready.MindwtrHost.editorModel('t'), ready.MindwtrHost.taskView('{"id":"t"}'), ready.MindwtrHost.editChecklist(JSON.stringify(checklistInput)),
    ready.MindwtrHost.editorSuggestions('t', 'tags', 'x', 4), ready.MindwtrHost.editDraft(JSON.stringify(editInput))]) {
    assert.deepEqual(await poll(ready, blocked), { ok: false, error: 'SAVE_FAILED: disk full' });
}
assert.equal(ready.editorInputs.length, 5);
// Focus cannot show unsaved in-memory values as stored either.
for (const blocked of [ready.MindwtrHost.focus(50), ready.MindwtrHost.focusWindow('next', 0, 50, 'f')]) {
    assert.deepEqual(await poll(ready, blocked), { ok: false, error: 'SAVE_FAILED: disk full' });
}
assert.equal(ready.focusInputs.length, 4);
// Commands never wait on requireSaved: the exact retry of a failed command must reach core, which retries the save.
const commandsBefore = ready.completeCount + ready.createCount + ready.updateInputs.length;
assert.equal((await poll(ready, ready.MindwtrHost.complete('t'))).ok, true);
assert.equal((await poll(ready, ready.MindwtrHost.captureSubmit('{"text":"Retry","options":{},"captureId":"123"}'))).ok, true);
// The popup's reads wait for the retry; its commands (a capture, several lines, a picker create) reach core so the retry can save.
for (const blocked of [ready.MindwtrHost.captureOpen(), ready.MindwtrHost.captureView('{"text":"a","options":{}}'), ready.MindwtrHost.captureEdit('{"text":"a","options":{},"edit":{}}')]) {
    assert.deepEqual(await poll(ready, blocked), { ok: false, error: 'SAVE_FAILED: disk full' });
}
for (const command of [ready.MindwtrHost.captureLines('{"text":"a\\nb","options":{},"captureIds":["1","2"],"snapshotFileName":null}'),
    ready.MindwtrHost.capturePicker('{"picker":"area","query":"x","text":"","options":{},"requestId":"9"}')]) {
    assert.equal((await poll(ready, command)).ok, true);
}
ready.updateResult = { ok: true, value: { id: 't', changed: false } };
assert.equal((await poll(ready, ready.MindwtrHost.update(updateInput))).ok, true);
assert.equal((await poll(ready, ready.MindwtrHost.saveDraft(draftInput))).ok, true);
assert.equal(ready.completeCount + ready.createCount + ready.updateInputs.length, commandsBefore + 4);
// Projects cannot show unsaved in-memory values as stored either; labels still load.
for (const blocked of [ready.MindwtrHost.projects(), ready.MindwtrHost.projectDetail('p1', 0, 50, '')]) {
    assert.deepEqual(await poll(ready, blocked), { ok: false, error: 'SAVE_FAILED: disk full' });
}
assert.equal(ready.projectInputs.length, 3);
// The area filter is a read: it waits for the retry. Its commands, like every command, reach core so the retry can save.
assert.deepEqual(await poll(ready, ready.MindwtrHost.areaFilter()), { ok: false, error: 'SAVE_FAILED: disk full' });
ready.taskFocusResult = { ok: true, value: { id: 't', focused: true } };
for (const command of [ready.MindwtrHost.taskFocus('t', true), ready.MindwtrHost.projectFocus('p', true),
    ready.MindwtrHost.createProject('New', 'a', '123'), ready.MindwtrHost.setAreaFilter('{"included":[],"excluded":[]}')]) {
    assert.equal((await poll(ready, command)).ok, true);
}
assert.equal(ready.newInputs.length, 4);
// Search and Process Inbox reads wait for the retry; their commands reach core so the retry can save.
for (const blocked of [ready.MindwtrHost.search('{"query":"a","filters":{},"limit":50}'), ready.MindwtrHost.inboxStart('guided'),
    ready.MindwtrHost.inboxStep('{"sessionId":"x","taskId":"t","step":"actionable"}')]) {
    assert.deepEqual(await poll(ready, blocked), { ok: false, error: 'SAVE_FAILED: disk full' });
}
assert.equal(ready.newInputs.length, 4);
ready.inboxCommitResult = { ok: true, value: { view: null, notice: null, toast: null } };
for (const command of [ready.MindwtrHost.saveSearch('{"query":"a","requestId":"r"}'),
    ready.MindwtrHost.inboxCommit('{"sessionId":"x","taskId":"t","step":"actionable","decision":{"choice":"trash"},"requestId":"r"}'),
    ready.MindwtrHost.inboxSkip('{"sessionId":"x","taskId":"t","requestId":"s"}')]) {
    assert.equal((await poll(ready, command)).ok, true);
}
assert.equal(ready.newInputs.length, 7);
// Menu screen reads wait for the retry; the More sheet's tiles (navigation) do not, so Menu never opens empty;
// menu commands reach core so the retry can save.
assert.deepEqual(await poll(ready, ready.MindwtrHost.menuRead('archive', '{"offset":0,"limit":50}')), { ok: false, error: 'SAVE_FAILED: disk full' });
assert.equal(ready.menuInputs.length, 0);
assert.equal((await poll(ready, ready.MindwtrHost.menuRead('more', '{}'))).ok, true);
assert.equal(ready.menuInputs.length, 1);
assert.equal((await poll(ready, ready.MindwtrHost.menuCommand('archiveAction', '{"requestId":"r","action":{"type":"moveToInbox","taskId":"t"}}'))).ok, true);
assert.equal(ready.menuInputs.length, 2);
assert.equal((await poll(ready, ready.MindwtrHost.language('', 'zh-CN'))).ok, true);
assert.equal((await poll(ready, ready.MindwtrHost.strings('["tab.inbox"]'))).ok, true);
// The RN legacy import runs after the validated load and before activation. RN state changes only
// after the saved import is read back, and a failed RN state change never fails the boot.
const bootBody = hostEntry.slice(hostEntry.indexOf('boot(legacyState: string, legacyBackup: string): string {'), hostEntry.indexOf('    window('));
const bootOrder = ['await adapter.getData();', 'await importLegacyJson(adapter,', 'contract.activate('].map((text) => bootBody.indexOf(text));
assert(bootOrder.every((index, i) => index > (i ? bootOrder[i - 1] : -1)), `boot order ${bootOrder}`);
const importBody = hostEntry.slice(hostEntry.indexOf('const importLegacyJson'), hostEntry.indexOf('// After a failed save'));
const importOrder = ['adapter.latestData', 'planLegacyJsonImport(', 'legacyImportMismatch(plan.merged, loaded)', 'await adapter.saveData(plan.merged)',
    'legacyImportMismatch(plan.merged, await adapter.getData())', 'Legacy import not confirmed', 'native().rnStateCommit(',
    "if (rnState === 'failed') throw new Error("].map((text) => importBody.indexOf(text));
assert(importOrder.every((index, i) => index > (i ? importOrder[i - 1] : -1)), `import order ${importOrder}`);
// A failed RN state change fails the boot closed: the catch only records it, and the throw is unconditional on the log.
assert.match(importBody, /catch \(error\) \{\s*rnState = 'failed';\s*rnFailure = [^\n]*\s*\}/);
assert.equal(importBody.match(/rnState = 'failed'/g).length, 1);
assert.equal(hostEntry.match(/saveData\(/g).length, 1, 'the import is the host\'s only direct save');
assert.equal(hostEntry.match(/rnStateCommit\(/g).length, 2, 'bridge type and one call');
const legacyLine = /extra: Record<string, string> = \{([\s\S]*?)\};/.exec(importBody)?.[1] ?? '';
assert(legacyLine.includes("releaseCheck: 'v1.3.3/native-android-legacy-json-import'"));
// Field names (the counts come from core's plan) are listed in packages/core/src/release-diagnostics-fields.test.ts.
for (const [, name] of legacyLine.matchAll(/(\w+):/g)) assert.doesNotMatch(name, /key|pass|user/i);

const legacyState = (overrides = {}) => JSON.stringify({ jsonAhead: true, reconciled: true, backupVersion: '2', backupPresent: true, ...overrides });
const current = { tasks: [{ id: 'rn' }], projects: [], sections: [], areas: [], people: [], settings: {} };
const merged = { ...current, tasks: [{ id: 'rn' }, { id: 'json-only' }] };
const importPlan = { outcome: 'imported', path: 'json-ahead', merged, clearJsonAhead: true, setReconciled: false,
    counts: { backupTasks: 2, sqliteTasks: 1, mergedTasks: 2, tasksFromBackup: 1 } };
const legacyBoot = async ({ plan = importPlan, overrides = {}, backup = '{"tasks":[]}', setup = () => {} } = {}) => {
    const legacy = makeState('auto', [current]);
    legacy.plan = plan;
    setup(legacy);
    return { legacy, result: await poll(legacy, legacy.MindwtrHost.boot(legacyState(overrides), backup)) };
};
const commitOf = (clearJsonAhead, setReconciled) => `commit:${JSON.stringify({ clearJsonAhead, setReconciled })}`;

assert.equal(ready.events.includes('plan'), false, 'the dev database never plans an import');
{
    const { legacy, result } = await legacyBoot();
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(legacy.events.slice(0, 7), ['load', 'plan', 'save', 'load', commitOf(true, false), 'activate', 'load']);
    assert.deepEqual(JSON.parse(legacy.planInputs[0]), [
        { jsonAhead: true, reconciled: true, backupVersion: '2', backupJson: '{"tasks":[]}' }, 1, true]);
}
{
    const { legacy } = await legacyBoot({ overrides: { backupPresent: false, backupVersion: null } });
    assert.deepEqual(JSON.parse(legacy.planInputs[0])[0], { jsonAhead: true, reconciled: true, backupVersion: null, backupJson: null });
}
{
    const failed = makeState(5, [current]);
    failed.plan = importPlan;
    const result = await poll(failed, failed.MindwtrHost.boot(legacyState(), '{}'));
    assert.match(result.error, /Incomplete tasks load/);
    assert.deepEqual(failed.events, ['load'], 'a failed validated load plans, saves, and commits nothing');
}
{
    const { legacy, result } = await legacyBoot({ setup: (state) => { state.afterSave = current; } });
    assert.match(result.error, /Legacy import not confirmed: tasks/);
    assert.deepEqual(legacy.events, ['load', 'plan', 'save', 'load'], 'an unconfirmed import changes no RN state and never activates');
}
{
    // Every id is there, but one imported field did not persist.
    const lost = { ...merged, tasks: [{ id: 'rn' }, { id: 'json-only', title: 'lost' }] };
    const { legacy, result } = await legacyBoot({ setup: (state) => { state.afterSave = lost; } });
    assert.match(result.error, /Legacy import not confirmed/);
    assert.deepEqual(legacy.events, ['load', 'plan', 'save', 'load'], 'a content mismatch changes no RN state and never activates');
}
{
    // The retry after a failed RN state change: the import is already saved, so only the RN state change runs.
    const { legacy, result } = await legacyBoot({ setup: (state) => { state.fakeDataSequence = [merged]; state.fakeData = merged; } });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(legacy.events.slice(0, 4), ['load', 'plan', commitOf(true, false), 'activate']);
}
{
    const { legacy, result } = await legacyBoot({ setup: (state) => { state.saveError = 'disk full'; } });
    assert.match(result.error, /disk full/);
    assert.deepEqual(legacy.events, ['load', 'plan', 'save']);
}
{
    // A failed RN state change (the RKStorage checkpoint included) fails closed: the import stays, nothing activates.
    const { legacy, result } = await legacyBoot({ setup: (state) => { state.commitResult = '!MindwtrNativeError:Cannot create the RN state checkpoint'; } });
    assert.equal(result.ok, false);
    assert.match(result.error, /^Cannot update the previous app version's saved state: Cannot create the RN state checkpoint$/);
    assert.deepEqual(legacy.events, ['load', 'plan', 'save', 'load', commitOf(true, false)], 'no activation after a failed RN state change');
    assert.equal(legacy.activationCount, 0);
}
{
    const plan = { outcome: 'abandoned', path: 'json-ahead', reason: 'backup-corrupt', clearJsonAhead: true, setReconciled: true };
    const { legacy, result } = await legacyBoot({ plan, setup: (state) => { state.fakeData = current; } });
    assert.equal(result.ok, true);
    assert.deepEqual(legacy.events.slice(0, 3), ['load', 'plan', commitOf(true, true)], 'an abandoned backup saves nothing');
}
{
    const plan = { outcome: 'none', clearJsonAhead: false, setReconciled: false };
    const { legacy, result } = await legacyBoot({ plan, setup: (state) => { state.fakeData = current; } });
    assert.equal(result.ok, true);
    assert.deepEqual(legacy.events.slice(0, 3), ['load', 'plan', 'activate'], 'nothing to import: no save, no RN state change');
}
const brokenStorage = makeState(0);
brokenStorage.__mindwtrNative.sqlAll = () => '!MindwtrNativeError:disk I/O error';
const brokenBoot = await poll(brokenStorage, brokenStorage.MindwtrHost.boot());
assert.equal(brokenBoot.ok, false);
assert.match(brokenBoot.error, /disk I\/O error/);
assert.equal(brokenStorage.activationCount, 0);
console.log('Storage exception rethrown in JS;', 'lifecycle ownership and debug-only fault hooks checked');
console.log('RN legacy guard runs before the RN database opens and reads RKStorage and the database only as byte copies');
console.log('Editor: core\'s model and suggestions in, saveTaskDraft out through perform with an exact retry, changed fields only, no Kotlin date parsing');
console.log('Focus: reads only through CoreHost, core order and flags only, stale windows restart, blocked after a failed save');
console.log('Labels: every UI word from core getStrings, one key map filled after setLanguage, debug-only language override');
console.log('Theme: one Kotlin theme object equal to RN\'s palettes, no color elsewhere, core resolves the mode and owns its hues');
console.log('Accessibility: the failure banner sits above the list (zIndex, live region, first in traversal); sections expose core\'s text');
console.log('Projects: reads only through CoreHost, core order and groups only, stale windows restart, blocked after a failed save');
console.log('RN legacy import: after the validated load, confirmed by a re-read before RN state changes; RKStorage checkpointed first');
console.log('Search and Process Inbox: core reads in the background with freshness, answers and saves through perform with exact, persisted requests');
console.log('RN look: rows read core meta (no Kotlin date formatting or coloring); stars, status, new project, and area filter run through perform with exact retries');
console.log('Menu tab: core\'s menu views through CoreHost, writes through perform with exact requests, Someday creates on disk first, no Kotlin policy');
console.log('Contexts, Trash, Review and the reviews: core\'s views, core\'s actions through perform, destructive actions behind core\'s question, checkpoints under core\'s keys');
console.log('Calendar and Board: core\'s views under one revision, core\'s actions through perform, composer and Duplicate on disk first, a drop is one core action, no Kotlin date math or policy');
console.log('Toolbars and bulk: the Inbox on core\'s view, core\'s bulk bar and Focus controls through perform with exact requests, a saved Focus filter on disk first, stateless Select all, no deprecated Archive fields, no Kotlin policy');
console.log('Review organize and picker search: row and batch Mark reviewed and Organize\'s Apply carry core\'s task revisions, a stale refusal rereads core\'s view, the Organize sheet is the lists\' dialog on Review\'s bar, the token and Board pickers search through core, and a search hit is highlighted on the list it opened on');
console.log('Settings and the editor\'s View tab: core\'s settings and task views through CoreHost, writes through perform with exact requests, device writes under RN\'s keys, checklist edits as core\'s edits in the one save');
console.log('Mind Sweep and saved searches: core\'s views through CoreHost, captures and Bulk organize creates on disk first, stale windows read again whole, Focus picker search, no Kotlin policy');
console.log('Boot gates, second-read failure, failed-save refresh and editor read, and diagnostic acknowledgment passed');
