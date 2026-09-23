import {
    SqliteAdapter,
    createNativeHostContract,
    logInfo,
    logWarn,
    setStorageAdapter,
    splitSqlStatements,
    type SqliteClient,
    useTaskStore,
} from '@mindwtr/core';

type NativeBridge = {
    sqlRun(sql: string, params: string): void;
    sqlAll(sql: string, params: string): string;
    sqlExec(sql: string): void;
    nowMs(): number;
    randomBytes(length: number): string;
    log(line: string): void;
};

declare const globalThis: Record<string, unknown> & { MindwtrHost?: unknown };
const native = (): NativeBridge => {
    const bridge = globalThis.__mindwtrNative as NativeBridge | undefined;
    if (!bridge) throw new Error('Native bridge unavailable');
    return bridge;
};

const sqlite: SqliteClient = {
    run: async (sql, params) => { native().sqlRun(sql, JSON.stringify(params ?? [])); },
    all: async <T,>(sql: string, params?: unknown[]): Promise<T[]> =>
        JSON.parse(native().sqlAll(sql, JSON.stringify(params ?? []))) as T[],
    get: async <T,>(sql: string, params?: unknown[]): Promise<T | undefined> =>
        (JSON.parse(native().sqlAll(sql, JSON.stringify(params ?? []))) as T[])[0],
    exec: async (sql) => {
        for (const statement of splitSqlStatements(sql)) native().sqlExec(statement);
    },
};

type LoadedData = Awaited<ReturnType<SqliteAdapter['getData']>>;
class ValidatedSqliteAdapter extends SqliteAdapter {
    latestData: LoadedData | null = null;

    override async getData(): Promise<LoadedData> {
        const data = await super.getData();
        for (const table of ['tasks', 'projects', 'sections', 'areas', 'people'] as const) {
            const rows = await sqlite.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
            if (data[table].length !== rows?.n) throw new Error(`Incomplete ${table} load`);
        }
        const settingsCount = await sqlite.get<{ n: number }>('SELECT COUNT(*) AS n FROM settings WHERE id = 1');
        const settings = await sqlite.get<{ data: string }>('SELECT data FROM settings WHERE id = 1');
        if (![0, 1].includes(settingsCount?.n ?? -1) || (settingsCount?.n === 1) !== Boolean(settings)) {
            throw new Error('Incomplete settings load');
        }
        if (settings) {
            const parsed = JSON.parse(settings.data) as Record<string, unknown>;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid settings load');
            for (const [key, value] of Object.entries(parsed)) {
                if (key !== 'savedFilters' && JSON.stringify(data.settings[key as keyof typeof data.settings]) !== JSON.stringify(value)) {
                    throw new Error('Incomplete settings load');
                }
            }
        }
        const savedFilters = await sqlite.get<{ n: number }>('SELECT COUNT(*) AS n FROM saved_filters');
        if (!Number.isSafeInteger(savedFilters?.n) || savedFilters!.n < 0
            || (savedFilters!.n > 0 && data.settings.savedFilters?.length !== savedFilters!.n)) {
            throw new Error('Incomplete saved filters load');
        }
        this.latestData = data;
        return data;
    }
}

type Pending = { done: boolean; value?: unknown; error?: string };
const pending = new Map<number, Pending>();
let nextId = 1;
const submit = (work: () => Promise<unknown>): string => {
    const id = nextId++;
    const slot: Pending = { done: false };
    pending.set(id, slot);
    void work().then(
        (value) => { slot.value = value; },
        (error) => { slot.error = error instanceof Error ? error.message : String(error); },
    ).finally(() => { slot.done = true; });
    return String(id);
};

const contract = createNativeHostContract();
const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if ('error' in result) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
const taskResult = <T>(operation: 'create' | 'complete', result: Parameters<typeof unwrap<T>>[0]): T => {
    const meta = {
        scope: 'native-android',
        category: 'storage' as const,
        extra: { releaseCheck: 'v1.3.3/native-android-dev-task-command', operation, outcome: result.ok ? 'saved' : 'failed' },
    };
    try {
        if (result.ok) logInfo('Native Android task command', meta);
        else logWarn('Native Android task command', meta);
    } catch { /* a diagnostic sink must not change a durable acknowledgment */ }
    return unwrap(result);
};

globalThis.MindwtrHost = {
    poll(idText: string): string | null {
        const id = Number(idText);
        const slot = pending.get(id);
        if (!slot?.done) return null;
        pending.delete(id);
        return JSON.stringify(slot.error === undefined
            ? { ok: true, value: slot.value }
            : { ok: false, error: slot.error });
    },
    boot(): string {
        return submit(async () => {
            const adapter = new ValidatedSqliteAdapter(sqlite, { rejectConcurrentWrites: true });
            // Core's schema setup may write. Kotlin created and validated the
            // app-private pre-write SQLite snapshot before this method runs.
            setStorageAdapter(adapter);
            await adapter.getData();
            unwrap(await contract.activate({ writeSafetyReady: true }));
            const data = adapter.latestData;
            if (!data) throw new Error('Native storage load was not validated');
            const loaded = useTaskStore.getState();
            for (const [table, storeRows] of [
                ['tasks', loaded._allTasks], ['projects', loaded._allProjects],
                ['sections', loaded._allSections], ['areas', loaded._allAreas],
                ['people', loaded._allPeople],
            ] as const) {
                if (storeRows.length !== data[table].length) throw new Error(`Incomplete ${table} activation`);
            }
            return unwrap(contract.getInboxWindow({ offset: 0, limit: 50 }));
        });
    },
    window(offset: number, limit: number, revision: string): string {
        return submit(async () => {
            const failure = useTaskStore.getState().persistenceFailure;
            if (failure) throw new Error(`SAVE_FAILED: ${failure.message}`);
            return unwrap(contract.getInboxWindow({ offset, limit, revision: revision || undefined }));
        });
    },
    create(title: string, captureId: string): string {
        return submit(async () => taskResult('create', await contract.createInboxTask({ title, captureId })));
    },
    complete(id: string): string {
        return submit(async () => taskResult('complete', await contract.completeTask({ id })));
    },
};
