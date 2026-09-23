import {
    SqliteAdapter,
    splitSqlStatements,
    type SqliteClient,
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

// This development shell exposes only a boot query. No task mutation crosses the host boundary.
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
            const adapter = new SqliteAdapter(sqlite);
            await adapter.ensureSchema();

            // A short or partial read cannot be treated as a new empty library.
            // This shell has no store or save path; the next integration adds
            // core commands only after its recovery/load guard is in place.
            const data = await adapter.getData();
            for (const table of ['tasks', 'projects', 'sections', 'areas', 'people'] as const) {
                const rows = await sqlite.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
                if (data[table].length !== rows?.n) throw new Error(`Incomplete ${table} load`);
            }
            return { taskCount: data.tasks.length };
        });
    },
};
