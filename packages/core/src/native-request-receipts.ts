import type { NativeHostResult } from './native-host-contract';

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
 * A write that fails before it lands (its result is not ok) leaves no receipt,
 * so the same request can run again.
 */
export type NativeRequestReceipts = {
    run<T>(requestId: unknown, payload: string, write: () => Promise<NativeHostResult<T>>): Promise<NativeHostResult<T>>;
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
        run<T>(requestId: unknown, payload: string, write: () => Promise<NativeHostResult<T>>): Promise<NativeHostResult<T>> {
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
                let outcome: NativeHostResult<T>;
                try {
                    outcome = await write();
                } catch (error) {
                    outcome = { ok: false, error: { code: 'ACTION_FAILED', message: error instanceof Error ? error.message : String(error) } };
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
