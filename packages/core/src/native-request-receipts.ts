import type { NativeHostResult } from './native-host-contract';
import { useTaskStore } from './store';
import type { StoreActionResult } from './store-types';
import type { Task } from './types';

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
 * Receipts live in memory. They cover the window in which a save is owed. After
 * a durable acknowledgment, a restart or an eviction, a replay runs the write
 * again (the native app journals every write and replays it after process death),
 * so every write must be safe to run again after a later change:
 *
 * - target-state: a replay of a request that already landed writes nothing;
 * - compare-and-set: a write to existing rows carries the revision the view showed
 *   for each (revisionOf) and refuses rows changed since (refuseStale), so a
 *   replay never undoes a later change;
 * - a create names its row by the request UUID, so a replay finds the row it made.
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

/** A revision as a command carries it: the non-empty text a view gave. */
export const isRevision = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;

/** Whether `value` holds a revision for each of `ids`, and for nothing else. */
export const isRevisions = (value: unknown, ids: readonly string[]): value is NativeRevisions => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === ids.length && ids.every((id) => isRevision((value as Record<string, unknown>)[id]))
);

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
    return rows.some((row, index) => !row || revisionOf(row) !== revisions[index])
        ? { ok: false, error: { code: 'STALE_REVISION', message } }
        : null;
}

/** refuseStale for tasks by ID, against `revisions` (a view's `taskRevisions`). */
export function refuseStaleTasks(ids: readonly string[], revisions: NativeRevisions): NativeHostResult<never> | null {
    const { _tasksById } = useTaskStore.getState();
    return refuseStale(ids.map((id) => _tasksById.get(id)), ids.map((id) => revisions[id]), 'A task changed since the view showed it; read the view again');
}

/** refuseStale for projects by ID, in Trash too. */
export function refuseStaleProjects(ids: readonly string[], revisions: NativeRevisions): NativeHostResult<never> | null {
    const byId = new Map(useTaskStore.getState()._allProjects.map((project) => [project.id, project]));
    return refuseStale(ids.map((id) => byId.get(id)), ids.map((id) => revisions[id]), 'A project changed since the view showed it; read the view again');
}

/** These tasks' revisions now, by ID: what an Undo carries after its write. */
export const taskRevisionsOf = (ids: readonly string[]): NativeRevisions => {
    const { _tasksById } = useTaskStore.getState();
    return Object.fromEntries(ids.flatMap((id) => {
        const task = _tasksById.get(id);
        return task ? [[id, taskRevisionOf(task)]] : [];
    }));
};

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

    const save = async (receipt: Receipt): Promise<NativeHostResult<unknown>> => {
        // A successful save stores the whole snapshot, so every write that landed before it
        // began is durable too. A write that lands while it runs waits for its own save.
        const covered = Array.from(receipts.values()).filter((entry) => entry.written);
        const saved = await options.save();
        if (!saved.ok) return saved;
        for (const entry of covered) entry.saved = true;
        return { ok: true, value: receipt.value };
    };

    const makeRoom = (): boolean => {
        if (receipts.size < limit) return true;
        for (const [id, entry] of receipts) {
            if (entry.saved && !entry.running) {
                receipts.delete(id);
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
                const finishing = save(known).finally(() => { known.running = null; });
                known.running = finishing;
                return finishing as Promise<NativeHostResult<T>>;
            }
            if (!makeRoom()) {
                return Promise.resolve({
                    ok: false,
                    error: { code: 'ACTION_FAILED', message: 'Earlier changes are not saved yet. Retry them first.' },
                });
            }
            const receipt: Receipt = { payload, running: null, written: false, value: undefined, saved: false };
            receipts.set(requestId, receipt);
            receipt.running = (async (): Promise<NativeHostResult<unknown>> => {
                let outcome: NativeHostResult<T> | NativeUnsavedWrite<T>;
                try {
                    outcome = await write();
                } catch (error) {
                    outcome = { ok: false, error: { code: 'ACTION_FAILED', message: error instanceof Error ? error.message : String(error) } };
                }
                if (!outcome.ok && outcome.error.code === 'SAVE_FAILED') {
                    // It landed; only its save failed. A retry saves and never writes again.
                    receipt.written = true;
                    receipt.value = 'value' in outcome ? outcome.value : undefined;
                    return { ok: false, error: outcome.error };
                }
                if (!outcome.ok) {
                    receipts.delete(requestId);
                    return outcome;
                }
                receipt.written = true;
                receipt.value = outcome.value;
                return save(receipt);
            })().finally(() => { receipt.running = null; });
            return receipt.running as Promise<NativeHostResult<T>>;
        },
    };
}
