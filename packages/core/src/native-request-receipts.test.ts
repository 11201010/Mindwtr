import { describe, expect, it, vi } from 'vitest';
import type { NativeHostResult } from './native-host-contract';
import { createNativeRequestReceipts } from './native-request-receipts';
import { generateUUID } from './uuid';

const ok = <T,>(value: T): NativeHostResult<T> => ({ ok: true, value });
const saveFailed: NativeHostResult<never> = { ok: false, error: { code: 'SAVE_FAILED', message: 'disk unavailable' } };

/** A save that fails while `failing` is set, and can be held open. */
function createSave() {
    const state = { failing: false, calls: 0, hold: null as Promise<void> | null };
    const save = vi.fn(async (): Promise<NativeHostResult<null>> => {
        state.calls += 1;
        if (state.hold) await state.hold;
        return state.failing ? saveFailed : ok(null);
    });
    return { state, save };
}

describe('native request receipts', () => {
    it('runs concurrent duplicates once and gives both the same result', async () => {
        const { save } = createSave();
        const receipts = createNativeRequestReceipts({ save });
        const write = vi.fn(async () => ok('written'));
        const id = generateUUID();
        const [first, second] = await Promise.all([receipts.run(id, 'a', write), receipts.run(id, 'a', write)]);
        expect(first).toEqual(ok('written'));
        expect(second).toEqual(first);
        expect(write).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('refuses another payload under the same request ID, while running and after', async () => {
        const { save } = createSave();
        const receipts = createNativeRequestReceipts({ save });
        const write = vi.fn(async () => ok(1));
        const id = generateUUID();
        const running = receipts.run(id, 'a', write);
        expect(await receipts.run(id, 'b', write)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        await running;
        expect(await receipts.run(id, 'b', write)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await receipts.run('not-a-uuid', 'a', write)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(write).toHaveBeenCalledTimes(1);
    });

    it('lets a write that did not land run again', async () => {
        const { save } = createSave();
        const receipts = createNativeRequestReceipts({ save });
        const id = generateUUID();
        const refused: NativeHostResult<number> = { ok: false, error: { code: 'ACTION_FAILED', message: 'no' } };
        expect(await receipts.run(id, 'a', async () => refused)).toEqual(refused);
        expect(await receipts.run(id, 'a', async () => ok(2))).toEqual(ok(2));
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('finishes a failed save on retry without writing again, and answers a lost reply without saving', async () => {
        const { state, save } = createSave();
        const receipts = createNativeRequestReceipts({ save });
        const write = vi.fn(async () => ok('purged'));
        const id = generateUUID();
        state.failing = true;
        expect(await receipts.run(id, 'a', write)).toEqual(saveFailed);
        state.failing = false;
        expect(await receipts.run(id, 'a', write)).toEqual(ok('purged'));
        expect(await receipts.run(id, 'a', write)).toEqual(ok('purged'));
        expect(write).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('never evicts an unsaved write: a full bound refuses new requests until a retry saves them', async () => {
        const { state, save } = createSave();
        const receipts = createNativeRequestReceipts({ save, limit: 3 });
        const ids = [generateUUID(), generateUUID(), generateUUID(), generateUUID()];
        const writes = ids.map((_, index) => vi.fn(async () => ok(index)));
        state.failing = true;
        for (const index of [0, 1, 2]) expect(await receipts.run(ids[index], 'x', writes[index])).toEqual(saveFailed);
        expect(await receipts.run(ids[3], 'x', writes[3])).toEqual({
            ok: false, error: { code: 'ACTION_FAILED', message: 'Earlier changes are not saved yet. Retry them first.' },
        });
        expect(writes[3]).not.toHaveBeenCalled();
        // Storage recovers: the first write's retry saves every earlier write.
        state.failing = false;
        expect(await receipts.run(ids[0], 'x', writes[0])).toEqual(ok(0));
        expect(await receipts.run(ids[3], 'x', writes[3])).toEqual(ok(3));
        // The saved entry that made room is gone; the others still answer without writing.
        expect(await receipts.run(ids[2], 'x', writes[2])).toEqual(ok(2));
        expect(writes.map((write) => write.mock.calls.length)).toEqual([1, 1, 1, 1]);
    });

    it('evicts only saved writes', async () => {
        const { state, save } = createSave();
        const receipts = createNativeRequestReceipts({ save, limit: 2 });
        const [saved, unsaved, next] = [generateUUID(), generateUUID(), generateUUID()];
        const write = vi.fn(async () => ok('w'));
        expect(await receipts.run(saved, 'x', write)).toEqual(ok('w'));
        state.failing = true;
        expect(await receipts.run(unsaved, 'x', write)).toEqual(saveFailed);
        expect(await receipts.run(next, 'x', write)).toEqual(saveFailed);
        state.failing = false;
        // The unsaved write kept its receipt: its retry saves and does not write again.
        expect(await receipts.run(unsaved, 'x', write)).toEqual(ok('w'));
        expect(write).toHaveBeenCalledTimes(3);
    });

    it('does not count a write that landed during another request\'s save as saved', async () => {
        const { state, save } = createSave();
        const receipts = createNativeRequestReceipts({ save });
        const [first, second] = [generateUUID(), generateUUID()];
        let release!: () => void;
        state.hold = new Promise<void>((resolve) => { release = resolve; });
        const firstRun = receipts.run(first, 'x', async () => ok(1));
        await vi.waitFor(() => expect(state.calls).toBe(1));
        state.hold = null;
        state.failing = true;
        // The second write lands while the first save is still running, and its own save fails.
        expect(await receipts.run(second, 'x', async () => ok(2))).toEqual(saveFailed);
        state.failing = false;
        release();
        expect(await firstRun).toEqual(ok(1));
        // So its retry still saves.
        const calls = state.calls;
        expect(await receipts.run(second, 'x', async () => ok(99))).toEqual(ok(2));
        expect(state.calls).toBe(calls + 1);
    });
});
