import type { NativeHostResult } from './native-host-contract';
import { SqliteAdapter, type SqliteAdapterOptions, type SqliteClient } from './sqlite-adapter';
import { getPersistenceStatus, getSaveSnapshotGeneration, trackSaveSnapshotGenerations, useTaskStore } from './store';
import type { StoreActionResult } from './store-types';
import { isSelectableProjectForTaskAssignment } from './project-utils';
import type { AppData, Project, Task } from './types';
import { deterministicHash128, generateDeterministicUUID } from './uuid';

/**
 * Exact-retry bookkeeping for native host writes, shared by every contract write
 * that takes a `requestId`. One request runs its write at most once:
 *
 * - The first call for a request ID reserves it before anything is awaited; a
 *   concurrent call with the same ID and payload waits for that same run.
 * - A later call with the same ID and payload does not write again. It only
 *   finishes the save if the first call's save failed, then returns the first
 *   call's result.
 * - A call with the same ID and another payload is refused (INVALID_INPUT).
 * - A write whose save has not succeeded is never forgotten, so its retry can
 *   always finish it. Only saved requests are evicted to stay under `limit`;
 *   while the bound holds only unsaved requests, new requests are refused
 *   (ACTION_FAILED) until a retry saves them.
 *
 * - A write that landed in memory while its save failed returns SAVE_FAILED
 *   (with settleWrite). It keeps its receipt as an owed save: a retry only
 *   saves, and never runs the write again. A write returns SAVE_FAILED only
 *   when its change landed (runStoreWrite decides).
 *
 * Any other failure means the write did not land: it leaves no receipt, so the
 * same request can run again.
 *
 * The native host keeps receipts on disk too (loadNativeRequestReceipts,
 * NativeReceiptSqliteAdapter): a write's receipt commits in the same SQLite
 * transaction as its data (or, when a save inside the write committed the data
 * first, in a receipt-only commit right after it), and the reply waits for that
 * commit. So the journal's replay after process death answers a landed request
 * from its first reply and runs nothing. One request ID belongs to one action
 * across all the contract's modules. Without that table (other
 * hosts, tests), or for a write whose data a save committed before its receipt
 * existed, a replay runs the write again, so every write must also be safe to run
 * again after a later change:
 *
 * - target-state: a replay of a request that already landed writes nothing;
 * - compare-and-set: a write to existing rows carries the revision the view showed
 *   for each (revisionOf) and refuses rows changed since (refuseStale), so a
 *   replay never undoes a later change;
 * - a create names its row by the request UUID (a second row by requestRowId), so
 *   a replay finds the row it made.
 */
export type NativeRequestReceipts = {
    run<T>(requestId: unknown, payload: string, write: () => Promise<NativeHostResult<T> | NativeUnsavedWrite<T>>): Promise<NativeHostResult<T>>;
};

/** A write whose change landed while the store could not save it; `value` answers the request once a retry saves. */
export type NativeUnsavedWrite<T> = { ok: false; error: { code: 'SAVE_FAILED'; message: string }; value: T };

type StoreCall = () => Promise<StoreActionResult | void | (StoreActionResult | void | undefined)[]>;
const storeData = () => {
    const state = useTaskStore.getState();
    return [state._allTasks, state._allProjects, state._allSections, state._allAreas, state._allPeople, state.settings];
};

/**
 * Runs a contract write's store call (one, or several together) and says whether it
 * landed. A refusal that left the store's data as it was did not land
 * (ACTION_FAILED). A refusal after the data changed, while the store could not save
 * it, landed (SAVE_FAILED): the request owes only a save.
 */
export async function runStoreWrite(call: StoreCall): Promise<NativeHostResult<null>> {
    const before = storeData();
    let message = 'The action failed';
    try {
        const outcome = await call();
        const refused = (Array.isArray(outcome) ? outcome : [outcome]).find((result) => result && result.success === false);
        if (!refused) return { ok: true, value: null };
        message = refused.error ?? message;
    } catch (error) {
        message = error instanceof Error ? error.message : String(error);
    }
    const failure = useTaskStore.getState().persistenceFailure;
    const landed = storeData().some((data, index) => data !== before[index]);
    if (landed && failure) return { ok: false, error: { code: 'SAVE_FAILED', message: failure.message } };
    return { ok: false, error: { code: 'ACTION_FAILED', message } };
}

/** A write's answer: `value` once it landed, carried by SAVE_FAILED when only its save failed. */
export function settleWrite<T>(written: NativeHostResult<null>, value: T): NativeHostResult<T> | NativeUnsavedWrite<T> {
    if (written.ok) return { ok: true, value };
    if (written.error.code === 'SAVE_FAILED') return { ok: false, error: { code: 'SAVE_FAILED', message: written.error.message }, value };
    return written;
}

/** A synced row: a task, project, area or person. */
type Revisioned = { rev?: number; revBy?: string; updatedAt: string };

/**
 * A row's revision for a compare-and-set write: it changes with every write to the row,
 * here or synced from another device. A command made on one revision refuses a row
 * that changed since, so a replay after a restart never undoes a later change.
 */
export const revisionOf = (row: Revisioned): string => `${row.rev ?? 0}:${row.revBy ?? ''}:${row.updatedAt}`;
export const taskRevisionOf = (task: Task): string => revisionOf(task);

/** Each target row's revision as the view showed it, by ID. */
export type NativeRevisions = Record<string, string>;

/**
 * Whether a write must carry its replay tokens: the revisions the view showed and, for
 * saveTaskDraft, a request UUID. A host that journals its writes and replays them after
 * process death (the native Android host, which says so at boot) sets 'required': a write
 * without them is refused (INVALID_INPUT). Any other host ('optional', the default) may
 * leave them out and keeps the rules from before its writes were journaled: a missing
 * revision skips that row's compare-and-set, and a draft save without a request UUID keeps
 * its process-local retry. A token it sends is checked as in 'required'.
 */
export type NativeReplayTokens = 'required' | 'optional';
let replayTokens: NativeReplayTokens = 'optional';
/** One mode per JS host: createNativeHostContract sets it, and a journaling host's boot sets 'required'. */
export const setNativeReplayTokens = (mode: NativeReplayTokens) => { replayTokens = mode; };
export const replayTokensRequired = (): boolean => replayTokens === 'required';

/** A revision as a command carries it: the non-empty text a view gave (or none, while tokens are optional). */
export const isRevision = (value: unknown): value is string => (value === undefined
    ? !replayTokensRequired()
    : typeof value === 'string' && value.length > 0 && value.length <= 200);

/** Whether `value` holds a revision for each of `ids`, and for nothing else (or is left out, while tokens are optional). */
export const isRevisions = (value: unknown, ids: readonly string[]): value is NativeRevisions => (value === undefined
    ? !replayTokensRequired()
    : typeof value === 'object' && value !== null && !Array.isArray(value)
        && Object.keys(value).length === ids.length && ids.every((id) => isRevision((value as Record<string, unknown>)[id])));

/**
 * Compare-and-set for a write about to change these rows: STALE_REVISION when one is
 * gone or no longer at the revision the view showed. Call it inside the receipts'
 * write (a same-host retry of a landed write still answers from its receipt), after
 * the target-state check (a replay whose target already holds writes nothing), for
 * the rows the write changes.
 */
export function refuseStale(
    rows: readonly (Revisioned | undefined)[],
    revisions: readonly (string | undefined)[],
    message = 'It changed since the view showed it; read the view again',
): NativeHostResult<never> | null {
    // While tokens are optional, a row sent without its revision is not compared.
    return rows.some((row, index) => (revisions[index] !== undefined || replayTokensRequired()) && (!row || revisionOf(row) !== revisions[index]))
        ? { ok: false, error: { code: 'STALE_REVISION', message } }
        : null;
}

/** refuseStale for tasks by ID, against `revisions` (a view's `taskRevisions`). */
export function refuseStaleTasks(ids: readonly string[], revisions: NativeRevisions | undefined): NativeHostResult<never> | null {
    const { _tasksById } = useTaskStore.getState();
    return refuseStale(ids.map((id) => _tasksById.get(id)), ids.map((id) => revisions?.[id]), 'A task changed since the view showed it; read the view again');
}

/** refuseStale for projects by ID, in Trash too. */
export function refuseStaleProjects(ids: readonly string[], revisions: NativeRevisions | undefined): NativeHostResult<never> | null {
    const byId = new Map(useTaskStore.getState()._allProjects.map((project) => [project.id, project]));
    return refuseStale(ids.map((id) => byId.get(id)), ids.map((id) => revisions?.[id]), 'A project changed since the view showed it; read the view again');
}

/** These tasks' revisions now, by ID: what an Undo carries after its write. */
export const taskRevisionsOf = (ids: readonly string[]): NativeRevisions => {
    const { _tasksById } = useTaskStore.getState();
    return Object.fromEntries(ids.flatMap((id) => {
        const task = _tasksById.get(id);
        return task ? [[id, taskRevisionOf(task)]] : [];
    }));
};

/**
 * A revision for many rows at once (a Select all, a context's carriers): their count and
 * a 128-bit hash of their `id@revision` entries. Deterministic, so a token a view gave
 * before a restart still matches after it while those rows are unchanged.
 */
export const revisionsToken = (entries: readonly string[]): string => `${entries.length}:${hash128Hex(JSON.stringify(entries))}`;

const hash128Hex = (text: string): string => deterministicHash128(text).map((part) => part.toString(16).padStart(8, '0')).join('');

/**
 * The ID of a row a request creates beside its main row (a capture's new project),
 * derived from the request UUID and the row's `role`: a retry finds that row by it.
 */
export const requestRowId = (requestId: string, role: string): string => generateDeterministicUUID(`${requestId.toLowerCase()}:${role}`);

/**
 * The addProject a request hands to a core flow that may make a project. The project takes
 * `idOf(title)` (requestRowId, or the request UUID for a main row), and that ID is looked up
 * first: a retry after a failed later write takes the project the first try made, renamed
 * since or not, and never makes a second one. One deleted or archived since sets `stale` and
 * writes nothing; the request then answers STALE_REVISION.
 */
export const requestProjects = (idOf: (title: string) => string) => {
    const made = { stale: false };
    const addProject = async (title: string, color: string, props?: Partial<Project>): Promise<Project | null> => {
        const id = idOf(title);
        const state = useTaskStore.getState();
        const project = state._allProjects.find((entry) => entry.id === id);
        if (!project) return state.addProject(title, color, { ...props, id });
        if (isSelectableProjectForTaskAssignment(project)) return project;
        made.stale = true;
        return null;
    };
    return { addProject, made };
};

/**
 * The projects a request's names are matched against: the project the request made (`id`), when
 * it exists, under `title` (the name the request gives it), in place of every other project of
 * that name. The request's own project wins over one made or renamed since. Null when that
 * project is deleted or archived: the request answers STALE_REVISION.
 */
export const withRequestProject = (projects: readonly Project[], id: string, title: string): Project[] | null => {
    const own = useTaskStore.getState()._allProjects.find((project) => project.id === id);
    if (!own) return [...projects];
    if (!isSelectableProjectForTaskAssignment(own)) return null;
    const key = title.trim().toLowerCase();
    return [{ ...own, title }, ...projects.filter((project) => project.id !== id && project.title.trim().toLowerCase() !== key)];
};

/**
 * Commands (a receipt payload's command name, its first element) the native journal never keeps,
 * such as one that carries a secret: their receipts stay in memory and never reach the disk.
 * calendarFeedAdd: a new calendar subscription, whose URL may carry a password
 * (native-host-contract-settings-calendar.ts addCalendarFeed).
 * setAIKey carries an AI key (NATIVE_AI_UNJOURNALED_COMMANDS); the Sync settings pass adds its own.
 */
export const NATIVE_UNJOURNALED_COMMANDS: ReadonlySet<string> = new Set<string>(['calendarFeedAdd', 'setAIKey']);

const commandOf = (payload: string): string => /^\["([^"\\]{1,64})"/.exec(payload)?.[1] ?? '';
/** What the disk keeps of a request: its command name and a 128-bit hash of its payload, never the payload's text. */
const fingerprintOf = (payload: string): string => `${commandOf(payload)}:${hash128Hex(payload)}`;

// Durable receipts: the native host only (loadNativeRequestReceipts turns them on).
type StoredReceipt = { fingerprint: string; reply: unknown; savedAt: string };
type PendingReceipt = { fingerprint: string; reply: unknown; generation: number };
let durableReceipts: Map<string, StoredReceipt> | null = null;
/** Every request ID a receipts instance holds, and its payload: one ID belongs to one action across the contract's modules. */
const requestPayloads = new Map<string, string>();
/** Landed, not committed yet; `generation` is the store's when it landed (every change it made is saved at or before it). */
const pendingReceipts = new Map<string, PendingReceipt>();
let receiptedWritesRunning = 0;

const RECEIPTS_TABLE = `CREATE TABLE IF NOT EXISTS native_request_receipts (
    request_id TEXT PRIMARY KEY,
    method TEXT NOT NULL,
    reply TEXT NOT NULL,
    saved_at TEXT NOT NULL
)`;
const RECEIPT_DAYS = 30;

const recordPendingReceipt = (requestId: string, payload: string, reply: unknown) => {
    pendingReceipts.set(requestId, { fingerprint: fingerprintOf(payload), reply, generation: getPersistenceStatus().generation });
};

/**
 * Native host boot, before the journal's replay: creates the receipts table (`method` is the
 * request's fingerprint, fingerprintOf: its command and a hash of its payload; `reply` its first
 * reply as JSON) and loads it. From then on every landed request's receipt is kept on disk,
 * except for NATIVE_UNJOURNALED_COMMANDS.
 */
export async function loadNativeRequestReceipts(client: SqliteClient): Promise<number> {
    await client.run(RECEIPTS_TABLE);
    const rows = await client.all<{ request_id: string; method: string; reply: string; saved_at: string }>(
        'SELECT request_id, method, reply, saved_at FROM native_request_receipts',
    );
    durableReceipts = new Map(rows.map((row) => [row.request_id, { fingerprint: row.method, reply: JSON.parse(row.reply), savedAt: row.saved_at }]));
    pendingReceipts.clear();
    requestPayloads.clear();
    receiptedWritesRunning = 0;
    trackSaveSnapshotGenerations(true);
    return durableReceipts.size;
}

/** After the journal's boot replay: drops receipts older than 30 days. */
export async function pruneNativeRequestReceipts(client: SqliteClient, now = new Date()): Promise<number> {
    // ponytail: a fixed 30-day window; a journal entry older than that replays without its receipt (the write rules above still hold).
    const cutoff = new Date(now.getTime() - RECEIPT_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await client.run('DELETE FROM native_request_receipts WHERE saved_at < ?', [cutoff]);
    let pruned = 0;
    for (const [id, receipt] of durableReceipts ?? []) {
        if (receipt.savedAt >= cutoff) continue;
        durableReceipts!.delete(id);
        pruned += 1;
    }
    return pruned;
}

/** A new native host (createNativeHostContract): the request IDs an earlier host held in memory are forgotten. */
export const startNativeRequestSession = () => { requestPayloads.clear(); };

/** Tests only: back to receipts in memory. */
export const resetNativeRequestReceipts = () => {
    durableReceipts = null;
    pendingReceipts.clear();
    requestPayloads.clear();
    receiptedWritesRunning = 0;
    trackSaveSnapshotGenerations(false);
};

/**
 * The native host's SQLite adapter. A save of a queued snapshot also commits, in the same
 * transaction, every pending receipt whose changes that snapshot holds (landed at its
 * generation or before), and never one whose changes it lacks. While a receipt is pending
 * or a receipted write runs it offers no saveTask, so the store saves whole snapshots and
 * no later change reaches the disk before that receipt.
 */
export class NativeReceiptSqliteAdapter extends SqliteAdapter {
    private readonly receiptClient: SqliteClient;
    private readonly carried = new WeakMap<AppData, { ids: string[]; savedAt: string }>();

    constructor(client: SqliteClient, options?: SqliteAdapterOptions) {
        super(client, options);
        this.receiptClient = client;
        const saveTask = this.saveTask;
        Object.defineProperty(this, 'saveTask', {
            get: () => (pendingReceipts.size === 0 && receiptedWritesRunning === 0 ? saveTask : undefined),
        });
    }

    protected override async beforeCommit(write: { data: AppData } | { task: Task }): Promise<void> {
        // A single task's save runs only while no receipt is pending (see saveTask above).
        if (!('data' in write)) return;
        const generation = getSaveSnapshotGeneration(write.data);
        if (generation === undefined) return;
        const savedAt = new Date().toISOString();
        const ids: string[] = [];
        for (const [id, receipt] of pendingReceipts) {
            if (receipt.generation > generation) continue;
            await this.receiptClient.run(
                'INSERT INTO native_request_receipts (request_id, method, reply, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING',
                [id, receipt.fingerprint, JSON.stringify(receipt.reply ?? null), savedAt],
            );
            ids.push(id);
        }
        this.carried.set(write.data, { ids, savedAt });
    }

    override async saveData(data: AppData): Promise<void> {
        await super.saveData(data);
        // Committed: those receipts are durable. After a rollback they stay pending for the next save.
        const carried = this.carried.get(data);
        this.carried.delete(data);
        for (const id of carried?.ids ?? []) {
            const receipt = pendingReceipts.get(id);
            if (!receipt) continue;
            pendingReceipts.delete(id);
            durableReceipts?.set(id, { fingerprint: receipt.fingerprint, reply: receipt.reply, savedAt: carried!.savedAt });
        }
    }
}

const REQUEST_ID_PATTERN = /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i;

type Receipt = {
    payload: string;
    /** Set while the first call runs; concurrent duplicates join it. */
    running: Promise<NativeHostResult<unknown>> | null;
    written: boolean;
    value: unknown;
    saved: boolean;
};

export function createNativeRequestReceipts(options: {
    /** Makes every write so far durable: retries a failed save, then flushes. */
    save: () => Promise<NativeHostResult<null>>;
    /** How many requests to remember; default 50. */
    limit?: number;
}): NativeRequestReceipts {
    const limit = options.limit ?? 50;
    const receipts = new Map<string, Receipt>();

    const save = async (requestId: string, receipt: Receipt): Promise<NativeHostResult<unknown>> => {
        // A successful save stores the whole snapshot, so every write that landed before it
        // began is durable too. A write that lands while it runs waits for its own save.
        const covered = Array.from(receipts.values()).filter((entry) => entry.written);
        const saved = await options.save();
        if (!saved.ok) return saved;
        // With durable receipts, the reply waits for a commit that carries its receipt. A write
        // whose data a save inside it already committed (a store action that flushes by itself),
        // or that changed nothing, left no snapshot queued: a receipt-only commit follows.
        if (pendingReceipts.has(requestId)) {
            await useTaskStore.getState().persistSnapshot();
            const again = await options.save();
            if (!again.ok) return again;
            if (pendingReceipts.has(requestId)) return { ok: false, error: { code: 'SAVE_FAILED', message: 'The request\'s receipt was not saved' } };
        }
        for (const entry of covered) entry.saved = true;
        return { ok: true, value: receipt.value };
    };

    const makeRoom = (): boolean => {
        if (receipts.size < limit) return true;
        for (const [id, entry] of receipts) {
            if (entry.saved && !entry.running) {
                receipts.delete(id);
                requestPayloads.delete(id);
                return true;
            }
        }
        return false;
    };

    return {
        run<T>(requestId: unknown, payload: string, write: () => Promise<NativeHostResult<T> | NativeUnsavedWrite<T>>): Promise<NativeHostResult<T>> {
            if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
                return Promise.resolve({ ok: false, error: { code: 'INVALID_INPUT', message: 'A request UUID is required' } });
            }
            const known = receipts.get(requestId);
            if (known && known.payload !== payload) {
                return Promise.resolve({ ok: false, error: { code: 'INVALID_INPUT', message: 'Request ID already belongs to another action' } });
            }
            if (known) {
                if (known.running) return known.running as Promise<NativeHostResult<T>>;
                if (known.saved) return Promise.resolve({ ok: true, value: known.value as T });
                const finishing = save(requestId, known).finally(() => { known.running = null; });
                known.running = finishing;
                return finishing as Promise<NativeHostResult<T>>;
            }
            // Landed and saved before a restart (or evicted since): its first reply, and nothing runs.
            const stored = durableReceipts?.get(requestId);
            if (stored) {
                return Promise.resolve(stored.fingerprint === fingerprintOf(payload)
                    ? { ok: true, value: stored.reply as T }
                    : { ok: false, error: { code: 'INVALID_INPUT', message: 'Request ID already belongs to another action' } });
            }
            // Held by another module's action (landed, pending or running): refused.
            const owner = requestPayloads.get(requestId);
            const pending = pendingReceipts.get(requestId);
            if ((owner !== undefined && owner !== payload) || (pending && pending.fingerprint !== fingerprintOf(payload))) {
                return Promise.resolve({ ok: false, error: { code: 'INVALID_INPUT', message: 'Request ID already belongs to another action' } });
            }
            if (!makeRoom()) {
                return Promise.resolve({
                    ok: false,
                    error: { code: 'ACTION_FAILED', message: 'Earlier changes are not saved yet. Retry them first.' },
                });
            }
            const receipt: Receipt = { payload, running: null, written: false, value: undefined, saved: false };
            receipts.set(requestId, receipt);
            requestPayloads.set(requestId, payload);
            receipt.running = (async (): Promise<NativeHostResult<unknown>> => {
                let outcome: NativeHostResult<T> | NativeUnsavedWrite<T>;
                const durable = durableReceipts !== null && !NATIVE_UNJOURNALED_COMMANDS.has(commandOf(payload));
                if (durable) receiptedWritesRunning += 1;
                try {
                    try {
                        outcome = await write();
                    } catch (error) {
                        outcome = { ok: false, error: { code: 'ACTION_FAILED', message: error instanceof Error ? error.message : String(error) } };
                    }
                    if (!outcome.ok && outcome.error.code === 'SAVE_FAILED') {
                        // It landed; only its save failed. A retry saves and never writes again.
                        receipt.written = true;
                        receipt.value = 'value' in outcome ? outcome.value : undefined;
                        if (durable) recordPendingReceipt(requestId, payload, receipt.value);
                        return { ok: false, error: outcome.error };
                    }
                    if (!outcome.ok) {
                        receipts.delete(requestId);
                        requestPayloads.delete(requestId);
                        return outcome;
                    }
                    receipt.written = true;
                    receipt.value = outcome.value;
                    // Pending from here: the save below commits it with the snapshot that holds this write.
                    if (durable) recordPendingReceipt(requestId, payload, receipt.value);
                } finally {
                    if (durable) receiptedWritesRunning -= 1;
                }
                return save(requestId, receipt);
            })().finally(() => { receipt.running = null; });
            return receipt.running as Promise<NativeHostResult<T>>;
        },
    };
}
