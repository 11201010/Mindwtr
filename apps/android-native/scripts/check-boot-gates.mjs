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
const activity = readFileSync(resolve(app, 'android/app/src/main/java/tech/dongdongbh/mindwtr/pilot/MainActivity.kt'), 'utf8');
assert.match(activity, /enabled = !busy && failedAction == null,[\s\S]*?modifier = Modifier\.weight\(1f\)/);
assert.match(activity, /submittedTitle != null && value != submittedTitle[\s\S]*?captureId = UUID\.randomUUID\(\)\.toString\(\)/);
assert.match(activity, /val id = captureId\s+submittedTitle = title/);
assert.match(activity, /onClick = \{ refresh\(\) \}, enabled = writable && !busy && failedAction == null/);
assert.match(activity, /failedAction == null \|\| failedAction == FailedAction\("create", captureId, draft\)/);
assert.match(activity, /failedAction == null \|\| failedAction == FailedAction\("complete", task\.id\)/);
assert.match(activity, /contentDescription = "Complete \$\{task\.title\}"/);
assert.match(activity, /action != null \|\| failure\.message\?\.startsWith\("SAVE_FAILED"\) == true/);

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
        createCount: 0, completeCount: 0, persistenceFailure: null,
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
ready.persistenceFailure = { message: 'disk full' };
const queriesBeforeFailure = ready.queryCount;
const blockedRefresh = await poll(ready, ready.MindwtrHost.window(0, 50, ''));
assert.equal(blockedRefresh.ok, false);
assert.match(blockedRefresh.error, /SAVE_FAILED/);
assert.equal(ready.queryCount, queriesBeforeFailure);
console.log('Boot gates, second-read failure, failed-save refresh, and diagnostic acknowledgment passed');
