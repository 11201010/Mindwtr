/**
 * Test support only (imported by the native host contract tests; not exported).
 * Loads a frozen React Native screen fixture, seeds the store as the mobile harness
 * does, records the store calls the harness records, and opens a native host over
 * that store; replayAfterRestart replays a request on a new host. openSqliteHost
 * runs the host over a real SQLite file with its request receipts, as the app does.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import { loadNativeRequestReceipts, NativeReceiptSqliteAdapter, resetNativeRequestReceipts } from './native-request-receipts';
import { SqliteAdapter, type SqliteClient } from './sqlite-adapter';
import { flushPendingSave, getPersistenceStatus, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, AppSettings, Area, Project, Task } from './types';

export const loadScreenFixture = <T,>(name: string): T => JSON.parse(
    readFileSync(new URL(`./${name}-parity.fixtures.json`, import.meta.url), 'utf8'),
) as T;

export const normalize = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, entry) => (
    entry === undefined ? '<undefined>' : entry
)));

export const value = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

let requestCount = 0;
/** A fresh request UUID. */
export const requestId = () => `00000000-0000-4000-8000-${String(++requestCount).padStart(12, '0')}`;

type StoreFn = (...args: unknown[]) => Promise<unknown>;
const realActions = new Map<string, StoreFn>();

/**
 * Seeds the store with `data` through a storage adapter (`saveData` can fail a save),
 * then opens a native host over it. Each store action named in `record` is logged to
 * `log` as [name, ...its first `record[name]` arguments] (all of them when null),
 * after `intercept` had its say: an intercept that returns a promise answers the call
 * instead of the store.
 */
export async function openScreenHost(input: {
    data: { tasks?: Task[]; projects?: Project[]; areas?: Area[]; settings?: AppSettings };
    record: Record<string, number | null>;
    log: unknown[][];
    saveData?: (data: unknown) => Promise<void>;
    intercept?: (name: string, args: unknown[]) => Promise<unknown> | undefined;
}) {
    await flushPendingSave();
    resetForTests();
    const initial = useTaskStore.getState() as unknown as Record<string, StoreFn>;
    for (const name of Object.keys(input.record)) if (!realActions.has(name)) realActions.set(name, initial[name]);
    let stored = JSON.parse(JSON.stringify({
        tasks: input.data.tasks ?? [], projects: input.data.projects ?? [], sections: [], areas: input.data.areas ?? [], people: [],
        settings: input.data.settings ?? {},
    }));
    setStorageAdapter({
        getData: async () => JSON.parse(JSON.stringify(stored)),
        saveData: async (next) => {
            await input.saveData?.(next);
            stored = JSON.parse(JSON.stringify(next));
        },
    });
    useTaskStore.setState({
        ...Object.fromEntries(Object.keys(input.record).map((name) => [name, realActions.get(name)])),
        _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
    } as never);
    const host = createNativeHostContract();
    value(await host.setLanguage({ storedLanguage: 'en', systemLocale: null }));
    value(await host.activate({ writeSafetyReady: true }));
    useTaskStore.setState(Object.fromEntries(Object.entries(input.record).map(([name, count]) => [name, async (...args: unknown[]) => {
        input.log.push([name, ...(normalize(count === null ? args : args.slice(0, count)) as unknown[])]);
        const answer = input.intercept?.(name, args);
        return answer ?? realActions.get(name)!(...args);
    }])) as never);
    return host;
}
export type ScreenHost = Awaited<ReturnType<typeof openScreenHost>>;

/** A new host over the same store and storage, as after a restart: it holds no request receipts. */
export async function restartScreenHost() {
    await flushPendingSave();
    const host = createNativeHostContract();
    value(await host.setLanguage({ storedLanguage: 'en', systemLocale: null }));
    value(await host.activate({ writeSafetyReady: true }));
    return host;
}

/**
 * A replay after a restart: a new host (restartScreenHost's) runs `replay`, a request that
 * already ran before a later change. `wrote` says whether the store's data changed.
 */
export async function replayAfterRestart<T>(replay: (host: ScreenHost) => Promise<NativeHostResult<T>>) {
    const host = await restartScreenHost();
    const data = () => {
        const state = useTaskStore.getState();
        return [state._allTasks, state._allProjects, state._allSections, state._allAreas, state._allPeople, state.settings];
    };
    const before = data();
    const result = await replay(host);
    return { result, wrote: data().some((entry, index) => entry !== before[index]) };
}

type Statement = { run: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[]; get: (...params: unknown[]) => unknown };
type Database = { exec: (sql: string) => void; close: () => void; prepare?: (sql: string) => Statement; query?: (sql: string) => Statement };
const require = createRequire(import.meta.url);
const openDatabase = (file: string): Database => {
    const bun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
    const Database = bun
        ? (require('bun:sqlite') as { Database: new (file: string) => Database }).Database
        : (require('node:sqlite') as { DatabaseSync: new (file: string) => Database }).DatabaseSync;
    return new Database(file);
};
// bun:sqlite takes the parameters as one array, node:sqlite as arguments.
const clientOf = (database: Database): SqliteClient => {
    const statement = (sql: string) => {
        const prepared = database.prepare ? database.prepare(sql) : database.query!(sql);
        return (method: keyof Statement, params: unknown[] = []) => (database.prepare ? prepared[method](...params) : prepared[method](params));
    };
    return {
        run: async (sql, params) => { statement(sql)('run', params); },
        all: async <T,>(sql: string, params?: unknown[]) => statement(sql)('all', params) as T[],
        get: async <T,>(sql: string, params?: unknown[]) => (statement(sql)('get', params) ?? undefined) as T | undefined,
        exec: async (sql) => { database.exec(sql); },
    };
};

/** A SQLite file and a client over it, for a test's own adapter. */
export const openScratchSqlite = (file: string) => {
    const database = openDatabase(file);
    return { client: clientOf(database), close: () => database.close() };
};

/**
 * The native host over a real SQLite file, booted as the app boots it: core's receipt
 * adapter, the receipts table loaded before activation. `wrap` sees every SQL call (to
 * hold one, or fail one). `restart()` is process death: nothing in memory survives
 * (the store, the receipts, the connection); the host boots again from the file.
 */
export async function openSqliteHost(seed: Partial<AppData>, wrap: (client: SqliteClient) => SqliteClient = (client) => client) {
    const dir = mkdtempSync(join(tmpdir(), 'mindwtr-receipts-'));
    const file = join(dir, 'mindwtr.db');
    let database = openDatabase(file);
    await new SqliteAdapter(clientOf(database)).saveData({
        tasks: [], projects: [], sections: [], areas: [], people: [], settings: {}, ...JSON.parse(JSON.stringify(seed)),
    });
    const boot = async () => {
        resetForTests();
        resetNativeRequestReceipts();
        useTaskStore.setState({
            _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
            settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
        } as never);
        const client = wrap(clientOf(database));
        setStorageAdapter(new NativeReceiptSqliteAdapter(client));
        await loadNativeRequestReceipts(client);
        const host = createNativeHostContract();
        value(await host.setLanguage({ storedLanguage: 'en', systemLocale: null }));
        value(await host.activate({ writeSafetyReady: true }));
        return host;
    };
    let host = await boot();
    const receiptIds = async () => (await clientOf(database).all<{ request_id: string }>('SELECT request_id FROM native_request_receipts ORDER BY request_id'))
        .map((row) => row.request_id);
    return {
        get host() { return host; },
        /** The file itself, outside the host's connection wrapper. */
        client: () => clientOf(database),
        sql: <T,>(query: string, params?: unknown[]) => clientOf(database).all<T>(query, params),
        receiptIds,
        /** A folder for this host's files (copies of the database). */
        dir,
        /** Process death; `from` is a copy of the file taken earlier (the disk as it was then). */
        async restart(from?: string) {
            const status = getPersistenceStatus();
            if (status.queued || status.inFlight || status.immediate) throw new Error('Restart with a save still queued: flush the change first');
            database.close();
            if (from) copyFileSync(from, file);
            database = openDatabase(file);
            host = await boot();
            return host;
        },
        /**
         * A replay after process death: restart, then `replay` the request. `wrote` says whether the
         * store's data changed; `receipts` whether the receipts table did.
         */
        async replay<T>(replay: (restarted: ScreenHost) => Promise<NativeHostResult<T>>, from?: string) {
            const restarted = await this.restart(from);
            const data = () => {
                const state = useTaskStore.getState();
                return [state._allTasks, state._allProjects, state._allSections, state._allAreas, state._allPeople, state.settings];
            };
            const before = data();
            const receiptsBefore = await receiptIds();
            const result = await replay(restarted);
            await flushPendingSave();
            return {
                result,
                wrote: data().some((entry, index) => entry !== before[index]),
                receipts: JSON.stringify(await receiptIds()) !== JSON.stringify(receiptsBefore),
            };
        },
        async close() {
            await flushPendingSave();
            resetNativeRequestReceipts();
            database.close();
            rmSync(dir, { recursive: true, force: true });
        },
    };
}
