import type { NativeHostResult } from './native-host-contract';
import { useTaskStore } from './store';
import type { StoreActionResult } from './store-types';

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
 * again, so every write must be target-state: a replay of a request that already
 * landed writes nothing.
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
