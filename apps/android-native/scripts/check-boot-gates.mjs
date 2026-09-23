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
// Comments may name the rules below; only code is checked against them.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
assert.match(activity, /enabled = !busy && failedAction == null,[\s\S]*?modifier = Modifier\.weight\(1f\)/);
assert.match(model, /submittedTitle != null && value != submittedTitle\) setCapture\(value, UUID\.randomUUID\(\)\.toString\(\), null\)/);
assert.match(model, /val id = captureId\s+setCapture\(title, id, submitted = title\)/);
assert.match(activity, /onClick = \{ refresh\(\) \}, enabled = writable && !busy && failedAction == null/);
assert.match(activity, /failedAction == null \|\| failedAction == FailedAction\("create", captureId, draft\)/);
assert.match(activity, /failedAction == null \|\| failedAction == FailedAction\("complete", task\.id\)/);
assert.match(activity, /contentDescription = "Complete \$\{task\.title\}"/);
// Every failed command holds its exact retry, except an update core refused before writing.
assert.match(model, /private val UPDATE_REFUSALS = listOf\("STALE_REVISION", "INVALID_INPUT", "TASK_NOT_FOUND"\)/);
assert.match(model, /val refused = action\?\.kind == "update" && UPDATE_REFUSALS\.any \{ message\.startsWith\(it\) \}/);
assert.match(model, /\(action != null && !refused\) \|\| message\.startsWith\("SAVE_FAILED"\)/);
// Only the capture draft survives process death; a restored unchanged draft reuses its capture UUID.
for (const field of ['draft', 'captureId', 'submittedTitle']) assert.match(model, new RegExp(`saved\\.get<String>\\("${field}"\\)`));
// The editor draft (core's reply = loaded values, plus the edited values) survives process death.
for (const field of ['editor', 'editorEdited']) assert.match(model, new RegExp(`saved\\.get<String>\\("${field}"\\)`));
assert.match(model, /saved\["editor"\] = value\?\.reply\?\.source\s+saved\["editorEdited"\] = value\?\.let \{ json\(it\.edited\) \}/);
// One host per process: the Activity and ViewModel never close it, and only the owner constructs it.
for (const file of [activity, model, editorUi, focusUi]) {
    assert.doesNotMatch(file, /close\(|onDestroy|onCleared|CoreHost\(/);
}
const guard = readFileSync(resolve(app, 'android/app/src/main/java/tech/dongdongbh/mindwtr/pilot/core/LegacyRnStoreGuard.kt'), 'utf8');
const kotlinFiles = [activity, model, owner, editorUi, focusUi, coreHost, sqliteBridge, guard];
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
assert.match(guard, /return Opened\(database, bootState\.toString\(\), state\.backup \?: ""\)/);
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
assert.match(model, /PendingFailure\(failed, message, rows, total, editor, screen, focus\)/);
assert.match(model, /pending\.editor\?\.let\(::keepEditor\)/);
// ...and a failure on Focus reopens Focus with its rows, since reads wait for the retry.
assert.match(model, /focus = pending\.focus\s+show\(pending\.screen\)/);
assert.equal(model.match(/ProcessCoreHost\.failure\?\.let \{ pending -> ui \{ host = runtime; restore\(pending\) \}/g).length, 2);
assert.match(model, /runtime\.createInboxTask\(title, id\)\s+acknowledged\(action\)/);
assert.match(model, /runtime\.completeTask\(id\)\s+acknowledged\(action\)/);
assert.match(model, /runtime\.updateTask\(current\.id, json\(current\.base\), json\(current\.patch\)\)\s+acknowledged\(action\)/);
assert.equal(model.match(/clearFailure/g).length, 1);
assert.doesNotMatch(owner, /SharedPreferences|SavedStateHandle|File\(app\.filesDir, "(?!mindwtr-native-dev\.db"|SQLite\/mindwtr\.db")/);
assert.match(model, /ProcessCoreHost\.get\(/);
// Storage exceptions never cross the QuickJS JNI boundary.
assert.equal(coreHost.match(/JSCallFunction \{/g).length, 1, 'the only JS callback constructor is guarded');
const bridgeCallbacks = coreHost.match(/bridge\.setProperty\([^\n]*/g);
assert.equal(bridgeCallbacks.length, 7);
for (const line of bridgeCallbacks) assert.match(line, /^bridge\.setProperty\("\w+", guarded \{/);
assert.match(coreHost, /setProperty\("log", guarded \{ args -> runCatching \{/);
assert.match(coreHost, /try \{ work\(args\) \} catch \(error: Throwable\) \{ NATIVE_ERROR \+/);
// Fault hooks exist only behind BuildConfig.DEBUG.
assert.equal(coreHost.match(/getprop/g).length, 1);
assert.match(coreHost, /private fun debugFault\(name: String\): String \{\s*if \(!BuildConfig\.DEBUG\) return ""/);
assert.equal(coreHost.match(/failCommits =/g).length, 1);
assert.match(coreHost, /failCommits = debugFault\("fail_commit"\) == "1"/);
assert.equal([activity, model, owner, editorUi, focusUi].join('\n').match(/failCommits|debugFault|getprop/g), null);
// update is a task command: the fault hooks and the diagnostic line cover it.
assert.match(coreHost, /val command = method in setOf\("create", "complete", "update"\)/);

// The editor reaches core only through CoreHost's two calls, which reach only the two contract commands.
assert.match(coreHost, /fun taskEditor\(id: String\): JSONObject = callAsync\("editor", id\)/);
assert.match(coreHost, /fun updateTask\(id: String, baseJson: String, patchJson: String\): JSONObject =\s*callAsync\("update", JSONObject\(\)\.put\("id", id\)\.put\("base", JSONObject\(baseJson\)\)\.put\("patch", JSONObject\(patchJson\)\)\.toString\(\)\)/);
assert.match(hostEntry, /editor\(id: string\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.getTaskEditor\(\{ id \}\)\);/);
assert.match(hostEntry, /update\(json: string\): string \{\s*return submit\(async \(\) => taskResult\('update', await contract\.updateTask\(JSON\.parse\(json\)\)\)\);/);
assert.equal(model.match(/runtime\.taskEditor\(id\)/g).length, 2, 'open and Reload');
assert.equal(model.match(/runtime\.updateTask\(/g).length, 1);
assert.equal([activity, owner, editorUi].join('\n').match(/taskEditor\(|updateTask\(/g), null);
assert.equal([activity, editorUi, focusUi].join('\n').replace(/^import .*$/gm, '').match(/CoreHost|callAsync|\bruntime\b/g), null);
// The patch holds only changed fields; base holds the loaded values of exactly those; no change means no call.
assert.match(editorUi, /val patch: Map<String, String\?> get\(\) = EDITOR_FIELDS\.filter \{ edited\[it\] != loaded\[it\] \}\.associateWith \{ edited\[it\] \}/);
assert.match(editorUi, /val base: Map<String, String\?> get\(\) = patch\.keys\.associateWith \{ loaded\[it\] \}/);
assert.match(editorUi, /val EDITOR_FIELDS = listOf\("title", "description", "status", "priority", "projectId", "startTime", "dueDate"\)/);
assert.match(model, /val current = editor \?: return\s+if \(current\.patch\.isEmpty\(\)\) \{ closeEditor\(\); return \}\s+val action = updateAction\(current\)\s+val depth = focus\.depth\(\)\s+perform\(action\)/);
assert.match(model, /FailedAction\("update", current\.id, base = current\.base, patch = current\.patch\)/);
// Reload: an edit survives only where the stored value still equals the old base.
assert.match(editorUi, /if \(fresh\.fields\[field\] == loaded\[field\]\) edited\[field\] else fresh\.fields\[field\]/);
// No Kotlin date parsing, and no formatting of stored values: the only date call formats picker output.
assert.doesNotMatch([editorUi, model, activity, focusUi].join('\n'), /java\.time|LocalDate|Instant|DateTimeFormatter|Calendar|(?<!InboxPage|FocusView)\.parse\(|DateFormat\.get|SimpleDateFormat\(\)/);
assert.equal([model, activity, focusUi].join('\n').match(/SimpleDateFormat|\.format\(/g), null);
assert.equal(editorUi.match(/SimpleDateFormat|\.format\(/g).length, 3); // import, constructor, one format call
assert.match(editorUi, /private fun pickedDay\(pickerMillis: Long\): String =\s*SimpleDateFormat\("yyyy-MM-dd", Locale\.US\)\.apply \{ timeZone = TimeZone\.getTimeZone\("UTC"\) \}\.format\(Date\(pickerMillis\)\)/);
assert.equal(editorUi.match(/pickedDay\(/g).length, 2);
assert.match(editorUi, /state\.selectedDateMillis\?\.let \{ pickerMillis -> editField\(field, pickedDay\(pickerMillis\)\) \}/);
// Read-only offers no Save; a failed save allows only its exact retry and leaves Back to the system.
assert.match(editorUi, /if \(!editor\.readOnly\) \{\s*Button\(onClick = model::saveEditor,\s*enabled = writable && !busy && \(failedAction == null \|\| failedAction == updateAction\(editor\)\)\)/);
assert.match(editorUi, /val locked = busy \|\| failed \|\| editor\.readOnly/);
assert.match(editorUi, /BackHandler\(enabled = !failed\)/);

// Focus reaches core only through CoreHost's two calls, which reach only core's two Focus queries.
assert.match(coreHost, /fun focus\(limit: Int\): JSONObject = callAsync\("focus", limit\)/);
assert.match(coreHost, /fun focusWindow\(key: String, offset: Int, limit: Int, revision: String\): JSONObject =\s*callAsync\("focusWindow", key, offset, limit, revision\)/);
assert.match(hostEntry, /focus\(limit: number\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.getFocus\(\{ limit \}\)\);/);
assert.match(hostEntry, /focusWindow\(key: string, offset: number, limit: number, revision: string\): string \{\s*return submit\(async \(\) => \{\s*requireSaved\(\);\s*return unwrap\(contract\.getFocusSectionWindow\(\{ key: key as FocusTaskSectionKey, offset, limit, revision \}\)\);/);
assert.equal(model.match(/runtime\.focus\(/g).length, 1);
assert.equal(model.match(/runtime\.focusWindow\(/g).length, 1);
assert.equal([activity, owner, editorUi, focusUi].join('\n').match(/\.focus\(|focusWindow\(/g), null);
// Rows render in core's order: sections and rows are walked as parsed, never sorted, filtered, or regrouped.
const focusCode = code(focusUi) + code(model.slice(model.indexOf('fun JSONObject.taskRows()'), model.indexOf('private const val PAGE')));
assert.doesNotMatch(focusCode, /\.(sort\w*|sorted\w*|filter\w*|groupBy|reversed|asReversed|shuffled|distinct\w*|partition|minBy|maxBy)\b/);
assert.match(focusUi, /return FocusView\(json\.getString\("revision"\), List\(items\.length\(\)\) \{ index ->/);
assert.match(model, /fun JSONObject\.taskRows\(\): List<TaskRow> = getJSONArray\("rows"\)\.let \{ items ->\s*List\(items\.length\(\)\) \{ index ->/);
assert.match(focusUi, /for \(section in focus\?\.sections\.orEmpty\(\)\) \{/);
assert.match(focusUi, /section\.rows\.forEachIndexed \{ index, task ->/);
// Core's two flags are the only row data Focus acts on: laterToday places one subheading, revealDate is shown as text.
assert.match(focusUi, /val laterToday = section\.rows\.indexOfFirst \{ it\.laterToday \}/);
assert.equal(code([focusUi, activity, model].join('\n')).match(/\.laterToday\b/g).length, 1);
assert.match(activity, /task\.revealDate\?\.let \{ Text\(it, style = MaterialTheme\.typography\.bodySmall\) \}/);
assert.equal(code([focusUi, activity, model].join('\n')).match(/\.revealDate\b/g).length, 1);
// A stale Load more reads Focus again from offset 0; it is never shown as an error.
assert.match(model, /if \(failure\.message\?\.startsWith\("STALE_REVISION"\) != true\) throw failure[\s\S]{0,200}?readFocus\(runtime, null, depth\)/);
// Time-aware refresh: on resume and each minute, only while the Focus list is composed and resumed.
assert.match(focusUi, /LaunchedEffect\(owner\) \{\s*owner\.repeatOnLifecycle\(Lifecycle\.State\.RESUMED\) \{\s*while \(true\) \{\s*model\.refreshFocus\(\)\s*delay\(60_000\)/);
assert.equal(code([activity, model, focusUi].join('\n')).match(/(?<!fun )refreshFocus\(\)/g).length, 1, 'one caller: the lifecycle loop');
assert.match(activity, /if \(screen == Screen\.Focus\) FocusList\(model, Modifier\.weight\(1f\)\)/);
// Commands from Focus use the Inbox's command path and its exact-retry lock.
assert.match(activity, /fun TaskRowItem\(model: InboxViewModel, task: TaskRow\)/);
assert.match(focusUi, /item\(key = "\$\{section\.key\}:\$\{task\.id\}"\) \{ TaskRowItem\(model, task\) \}/);
assert.match(focusUi, /onClick = \{ loadMoreFocus\(section\.key\) \}, enabled = writable && !busy && failedAction == null/);
// The selected list survives rotation (ViewModel) and process death (SavedStateHandle).
assert.match(model, /saved\.get<String>\("screen"\)/);
assert.match(model, /screen = target\s+saved\["screen"\] = target\.name/);

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
    getTaskEditor(input) {
      globalThis.editorInputs.push(JSON.stringify(input));
      return { ok: true, value: { version: 1, id: input.id } };
    },
    async updateTask(input) {
      globalThis.updateInputs.push(JSON.stringify(input));
      return globalThis.updateResult;
    },
    async createInboxTask() { globalThis.createCount++; return { ok: true, value: { id: 'id' } }; },
    async completeTask() { globalThis.completeCount++; return { ok: true, value: { id: 'id' } }; },
  };
}
export const useTaskStore = { getState: () => ({
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
        createCount: 0, completeCount: 0, persistenceFailure: null, editorInputs: [], updateInputs: [], focusInputs: [],
        focusWindowResult: { ok: false, error: { code: 'STALE_REVISION', message: 'Focus changed; restart paging' } },
        updateResult: { ok: true, value: { id: 't', changed: true } },
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
assert.equal((await poll(ready, ready.MindwtrHost.create('Test', '123'))).ok, true);
assert.equal(ready.createCount, 1);
// update passes Kotlin's { id, base, patch } to core unchanged, and a refusal keeps its code prefix.
const updateInput = JSON.stringify({ id: 't', base: { title: 'a', dueDate: null }, patch: { title: 'b', dueDate: '2026-09-15' } });
assert.deepEqual(await poll(ready, ready.MindwtrHost.update(updateInput)), { ok: true, value: { id: 't', changed: true } });
assert.deepEqual(ready.updateInputs, [updateInput]);
ready.updateResult = { ok: false, error: { code: 'STALE_REVISION', message: 'Task changed while editing: title' } };
assert.deepEqual(await poll(ready, ready.MindwtrHost.update(updateInput)),
    { ok: false, error: 'STALE_REVISION: Task changed while editing: title' });
assert.deepEqual(await poll(ready, ready.MindwtrHost.editor('t')), { ok: true, value: { version: 1, id: 't' } });
assert.deepEqual(ready.editorInputs, ['{"id":"t"}']);
// Focus queries pass Kotlin's arguments to core unchanged; a stale window keeps its code prefix for Kotlin.
assert.deepEqual(await poll(ready, ready.MindwtrHost.focus(50)), { ok: true, value: { version: 1, revision: 'f', sections: [] } });
assert.deepEqual(await poll(ready, ready.MindwtrHost.focusWindow('next', 50, 50, 'f')),
    { ok: false, error: 'STALE_REVISION: Focus changed; restart paging' });
assert.deepEqual(ready.focusInputs, ['{"limit":50}', '{"key":"next","offset":50,"limit":50,"revision":"f"}']);
ready.persistenceFailure = { message: 'disk full' };
const queriesBeforeFailure = ready.queryCount;
const blockedRefresh = await poll(ready, ready.MindwtrHost.window(0, 50, ''));
assert.equal(blockedRefresh.ok, false);
assert.match(blockedRefresh.error, /SAVE_FAILED/);
assert.equal(ready.queryCount, queriesBeforeFailure);
// The editor cannot load unsaved in-memory values as if they were stored.
const blockedEditor = await poll(ready, ready.MindwtrHost.editor('t'));
assert.equal(blockedEditor.ok, false);
assert.match(blockedEditor.error, /^SAVE_FAILED: disk full$/);
assert.equal(ready.editorInputs.length, 1);
// Focus cannot show unsaved in-memory values as stored either.
for (const blocked of [ready.MindwtrHost.focus(50), ready.MindwtrHost.focusWindow('next', 0, 50, 'f')]) {
    assert.deepEqual(await poll(ready, blocked), { ok: false, error: 'SAVE_FAILED: disk full' });
}
assert.equal(ready.focusInputs.length, 2);
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
console.log('Editor: reads and writes only through CoreHost, patch of changed fields only, no Kotlin date parsing');
console.log('Focus: reads only through CoreHost, core order and flags only, stale windows restart, blocked after a failed save');
console.log('RN legacy import: after the validated load, confirmed by a re-read before RN state changes; RKStorage checkpointed first');
console.log('Boot gates, second-read failure, failed-save refresh and editor read, and diagnostic acknowledgment passed');
