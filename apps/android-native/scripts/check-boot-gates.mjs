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
assert.match(sqliteBridge, /syncFile\(partial\)[\s\S]*?renameTo\(checkpointFile\)[\s\S]*?syncDirectory/);
assert(coreHost.indexOf('database.ensureRecoveryCheckpoint()') < coreHost.indexOf('engine.evaluate(bundle'));
assert(coreHost.indexOf('database.ensureRecoveryCheckpoint()') < coreHost.indexOf('callAsync("boot")'));
const source = (name) => readFileSync(resolve(app, 'android/app/src/main/java/tech/dongdongbh/mindwtr/pilot', name), 'utf8');
const activity = source('MainActivity.kt');
const model = source('InboxViewModel.kt');
const owner = source('ProcessCoreHost.kt');
const editorUi = source('TaskEditor.kt');
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
for (const file of [activity, model, editorUi]) {
    assert.doesNotMatch(file, /close\(|onDestroy|onCleared|CoreHost\(/);
}
const guard = readFileSync(resolve(app, 'android/app/src/main/java/tech/dongdongbh/mindwtr/pilot/core/LegacyRnStoreGuard.kt'), 'utf8');
const kotlinFiles = [activity, model, owner, editorUi, coreHost, sqliteBridge, guard];
assert.equal(kotlinFiles.join('\n').match(/(?<!class )CoreHost\(/g).length, 1);
// The dev build keeps its own database. The upgradetest build gets the RN database only from the
// guard, before CoreHost exists: before any open of it, the checkpoint, and any core write.
assert.match(owner, /val database = if \(BuildConfig\.RN_STORAGE\) \{\s*\/\/[^\n]*\s*LegacyRnStoreGuard\.requireClear\(app\.dataDir, File\(app\.cacheDir, "legacy-rn-guard"\)\)\s*\} else \{\s*File\(app\.filesDir, "mindwtr-native-dev\.db"\)\s*\}\s*val runtime = CoreHost\(database\)/);
assert.equal(kotlinFiles.join('\n').match(/LegacyRnStoreGuard\.requireClear\(/g).length, 1);
assert.match(guard, /val database = File\(dataDir, "files\/SQLite\/mindwtr\.db"\)/);
// Missing database with RN state, then the json-ahead marker, then quick_check; only a clear result may create the folder.
const decision = guard.slice(guard.indexOf('private fun blockedReason'));
const order = ['"database-missing"', 'return "json-ahead"', 'queryCopy(database, scratch)', '"database-unreadable"'].map((text) => decision.indexOf(text));
assert(order.every((index, i) => index > (i ? order[i - 1] : -1)), `guard order ${order}`);
assert(guard.indexOf('check(blocked == null)') < guard.indexOf('.mkdirs()\n        return database'));
assert.match(guard, /\/\/ ponytail: copies the whole database on every boot\. Skip it once a native-owned\s*\/\/ marker proves the last shutdown was clean\./);
// RKStorage and the RN database are only read as bytes: SQLite writes -wal/-shm even through a
// read-only connection, and a failed read-write open can checkpoint the WAL into the file on close.
const originalUses = [...guard.matchAll(/\b(asyncStorage|database|file|source)\.(\w+)/g)].map(([, name, member]) => `${name}.${member}`);
assert.deepEqual([...new Set(originalUses)].sort(), ['asyncStorage.exists', 'database.exists', 'database.parentFile', 'file.name', 'file.path', 'source.copyTo', 'source.exists']);
assert.equal(guard.match(/BundledSQLiteDriver\(\)\.open\(/g).length, 1);
assert.match(guard, /BundledSQLiteDriver\(\)\.open\(File\(scratch, file\.name\)\.path\)/);
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
assert.match(model, /PendingFailure\(failed, message, rows, total, editor\)/);
assert.match(model, /pending\.editor\?\.let\(::keepEditor\)/);
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
assert.equal(bridgeCallbacks.length, 6);
for (const line of bridgeCallbacks) assert.match(line, /^bridge\.setProperty\("\w+", guarded \{/);
assert.match(coreHost, /setProperty\("log", guarded \{ args -> runCatching \{/);
assert.match(coreHost, /try \{ work\(args\) \} catch \(error: Throwable\) \{ NATIVE_ERROR \+/);
// Fault hooks exist only behind BuildConfig.DEBUG.
assert.equal(coreHost.match(/getprop/g).length, 1);
assert.match(coreHost, /private fun debugFault\(name: String\): String \{\s*if \(!BuildConfig\.DEBUG\) return ""/);
assert.equal(coreHost.match(/failCommits =/g).length, 1);
assert.match(coreHost, /failCommits = debugFault\("fail_commit"\) == "1"/);
assert.equal([activity, model, owner, editorUi].join('\n').match(/failCommits|debugFault|getprop/g), null);
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
assert.equal([activity, editorUi].join('\n').replace(/^import .*$/gm, '').match(/CoreHost|callAsync|\bruntime\b/g), null);
// The patch holds only changed fields; base holds the loaded values of exactly those; no change means no call.
assert.match(editorUi, /val patch: Map<String, String\?> get\(\) = EDITOR_FIELDS\.filter \{ edited\[it\] != loaded\[it\] \}\.associateWith \{ edited\[it\] \}/);
assert.match(editorUi, /val base: Map<String, String\?> get\(\) = patch\.keys\.associateWith \{ loaded\[it\] \}/);
assert.match(editorUi, /val EDITOR_FIELDS = listOf\("title", "description", "status", "priority", "projectId", "startTime", "dueDate"\)/);
assert.match(model, /val current = editor \?: return\s+if \(current\.patch\.isEmpty\(\)\) \{ closeEditor\(\); return \}\s+val action = updateAction\(current\)\s+perform\(action\)/);
assert.match(model, /FailedAction\("update", current\.id, base = current\.base, patch = current\.patch\)/);
// Reload: an edit survives only where the stored value still equals the old base.
assert.match(editorUi, /if \(fresh\.fields\[field\] == loaded\[field\]\) edited\[field\] else fresh\.fields\[field\]/);
// No Kotlin date parsing, and no formatting of stored values: the only date call formats picker output.
assert.doesNotMatch([editorUi, model, activity].join('\n'), /java\.time|LocalDate|Instant|DateTimeFormatter|Calendar|(?<!InboxPage)\.parse\(|DateFormat\.get/);
assert.equal(editorUi.match(/SimpleDateFormat|\.format\(/g).length, 3); // import, constructor, one format call
assert.match(editorUi, /private fun pickedDay\(pickerMillis: Long\): String =\s*SimpleDateFormat\("yyyy-MM-dd", Locale\.US\)\.apply \{ timeZone = TimeZone\.getTimeZone\("UTC"\) \}\.format\(Date\(pickerMillis\)\)/);
assert.equal(editorUi.match(/pickedDay\(/g).length, 2);
assert.match(editorUi, /state\.selectedDateMillis\?\.let \{ pickerMillis -> editField\(field, pickedDay\(pickerMillis\)\) \}/);
// Read-only offers no Save; a failed save allows only its exact retry and leaves Back to the system.
assert.match(editorUi, /if \(!editor\.readOnly\) \{\s*Button\(onClick = model::saveEditor,\s*enabled = writable && !busy && \(failedAction == null \|\| failedAction == updateAction\(editor\)\)\)/);
assert.match(editorUi, /val locked = busy \|\| failed \|\| editor\.readOnly/);
assert.match(editorUi, /BackHandler\(enabled = !failed\)/);

const fakeCore = `
export class SqliteAdapter {
  async getData() { return globalThis.fakeDataSequence.shift() || globalThis.fakeData; }
}
export function splitSqlStatements(sql) { return [sql]; }
export function setStorageAdapter(adapter) { globalThis.adapter = adapter; }
export function createNativeHostContract() {
  return {
    async activate() {
      await globalThis.adapter.getData();
      globalThis.activationCount++;
      globalThis.saveCount++;
      return { ok: true, value: null };
    },
    getInboxWindow() {
      globalThis.queryCount++;
      return { ok: true, value: { version: 1, revision: 'r', total: 0, rows: [] } };
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
  _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
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
        createCount: 0, completeCount: 0, persistenceFailure: null, editorInputs: [], updateInputs: [],
        updateResult: { ok: true, value: { id: 't', changed: true } },
        __mindwtrNative: {
            sqlAll(sql) {
                if (sql.includes('COUNT(*)') && sql.includes('tasks')) return JSON.stringify([{ n: taskCount }]);
                if (sql.includes('COUNT(*)')) return '[{"n":0}]';
                return '[]';
            },
            sqlRun() {}, sqlExec() {},
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
const brokenStorage = makeState(0);
brokenStorage.__mindwtrNative.sqlAll = () => '!MindwtrNativeError:disk I/O error';
const brokenBoot = await poll(brokenStorage, brokenStorage.MindwtrHost.boot());
assert.equal(brokenBoot.ok, false);
assert.match(brokenBoot.error, /disk I\/O error/);
assert.equal(brokenStorage.activationCount, 0);
console.log('Storage exception rethrown in JS;', 'lifecycle ownership and debug-only fault hooks checked');
console.log('RN legacy guard runs before the RN database opens and reads RKStorage and the database only as byte copies');
console.log('Editor: reads and writes only through CoreHost, patch of changed fields only, no Kotlin date parsing');
console.log('Boot gates, second-read failure, failed-save refresh and editor read, and diagnostic acknowledgment passed');
