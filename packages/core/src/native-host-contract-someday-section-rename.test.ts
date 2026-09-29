import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusControlsWrites, loadFocusControlsFixture, seedFocusControlsStore } from './focus-controls.replay';
import { createNativeHostContract } from './native-host-contract';
import { loadNativeRequestReceipts, resetNativeRequestReceipts } from './native-request-receipts';
import { flushPendingSave, resetForTests, useTaskStore } from './store';
import { generateUUID } from './uuid';

const fixture = loadFocusControlsFixture();
const base = fixture.scenarios.find((entry) => entry.settings === 'base' && !entry.taskIds)!;
type Host = ReturnType<typeof createNativeHostContract>;
type Request = Parameters<Host['renameSomedaySectionChecked']>[0];
const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

describe('native checked Someday section rename', () => {
    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        resetNativeRequestReceipts();
        vi.restoreAllMocks();
    });

    const open = async (saveData?: (data: unknown) => Promise<void>): Promise<Host> => {
        await seedFocusControlsStore(fixture, base, { saveData });
        const host = createNativeHostContract();
        expect(await host.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' })).toMatchObject({ ok: true });
        expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
        focusControlsWrites().length = 0;
        return host;
    };
    const setRaw = (sections: unknown, stamp: unknown = undefined) => useTaskStore.setState((state) => {
        const stamps = { ...state.settings.syncPreferencesUpdatedAt };
        if (stamp === undefined) delete stamps.gtd;
        else stamps.gtd = stamp as string;
        return { settings: { ...state.settings, gtd: { ...state.settings.gtd,
            viewSections: { ...state.settings.gtd?.viewSections, someday: sections } },
            syncPreferencesUpdatedAt: stamps } as typeof state.settings };
    });
    const request = (host: Host, id: string, title: string): Request => ({
        requestId: generateUUID(), id, title, expected: value(host.getSomedaySectionRenameOptions({ id })).expected,
    });

    it('renames only the unique literal none row while retaining hidden rows, unknown fields and task data', async () => {
        const host = await open();
        const raw = [
            { id: 'none', title: 'Imported', order: 1, future: { empty: '' } },
            { kind: 'future', empty: '' },
            { id: 'other', title: 'Other', order: 0 },
        ];
        setRaw(raw, '2026-09-29T00:00:00.000Z');
        const options = value(host.getSomedaySectionRenameOptions({ id: 'none' }));
        expect(options).toMatchObject({ id: 'none', title: 'Imported', expected: { sections: raw, updatedAt: '2026-09-29T00:00:00.000Z' } });
        const input = { requestId: generateUUID(), id: 'none', title: '  IMPORTED 🌊  ', expected: options.expected };
        expect(value(host.validateSomedaySectionRenameWrite(input))).toEqual({ id: 'none', changed: true });
        const before = useTaskStore.getState();
        expect(value(await host.renameSomedaySectionChecked(input))).toEqual({ id: 'none', changed: true });
        const after = useTaskStore.getState();
        expect(after.settings.gtd?.viewSections?.someday).toEqual([
            { ...raw[0], title: 'IMPORTED 🌊' }, raw[1], raw[2],
        ]);
        expect(after._allTasks).toEqual(before._allTasks);
        expect(after._allProjects).toEqual(before._allProjects);
        expect({ ...after.settings.gtd, viewSections: undefined }).toEqual({ ...before.settings.gtd, viewSections: undefined });
        expect(focusControlsWrites()).toHaveLength(1);
        expect(host.probeSomedaySectionRenameOutcome(input)).toEqual({ ok: true, value: { id: 'none', changed: true } });
    });

    it('preserves null and primitive future entries before the target during write, no-op and cold probe', async () => {
        const host = await open();
        const raw = [null, 7, 'future', { id: 'none', title: 'Old', order: 0 }];
        setRaw(raw);
        const input = request(host, 'none', 'New');
        expect(value(await host.renameSomedaySectionChecked(input))).toEqual({ id: 'none', changed: true });
        expect(useTaskStore.getState().settings.gtd?.viewSections?.someday).toEqual([
            null, 7, 'future', { id: 'none', title: 'New', order: 0 },
        ]);
        const noOp = request(host, 'none', ' New ');
        expect(value(await host.renameSomedaySectionChecked(noOp))).toEqual({ id: 'none', changed: false });
        const restarted = createNativeHostContract();
        await restarted.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' });
        await restarted.activate({ writeSafetyReady: true });
        expect(restarted.probeSomedaySectionRenameOutcome(input)).toEqual({ ok: true, value: { id: 'none', changed: true } });
        expect(focusControlsWrites()).toHaveLength(1);
    });

    it('allows duplicate titles and a case-only change, but does not write an exact-title no-op', async () => {
        const host = await open();
        setRaw([{ id: 'a', title: 'Ideas', order: 0 }, { id: 'b', title: 'Later', order: 1 }]);
        const duplicateTitle = request(host, 'a', ' Later ');
        expect(value(await host.renameSomedaySectionChecked(duplicateTitle))).toEqual({ id: 'a', changed: true });
        expect(useTaskStore.getState().settings.gtd?.viewSections?.someday?.map((row) => row.title)).toEqual(['Later', 'Later']);
        const caseOnly = request(host, 'a', 'LATER');
        expect(value(await host.renameSomedaySectionChecked(caseOnly))).toEqual({ id: 'a', changed: true });
        focusControlsWrites().length = 0;
        const noOp = request(host, 'a', '  LATER  ');
        expect(value(host.validateSomedaySectionRenameWrite(noOp))).toEqual({ id: 'a', changed: false });
        expect(value(await host.renameSomedaySectionChecked(noOp))).toEqual({ id: 'a', changed: false });
        expect(focusControlsWrites()).toEqual([]);
        setRaw([{ id: 'a', title: 'Changed', order: 0 }, { id: 'b', title: 'Later', order: 1 }], 'later');
        expect(await host.renameSomedaySectionChecked(noOp)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('refuses a no-op or probe whose UUID already belongs to a changed rename or different method', async () => {
        const host = await open();
        setRaw([{ id: 'a', title: 'Old', order: 0 }]);
        const changed = request(host, 'a', 'New');
        expect(value(await host.renameSomedaySectionChecked(changed))).toEqual({ id: 'a', changed: true });
        const noOp = { ...request(host, 'a', ' New '), requestId: changed.requestId };
        expect(value(host.validateSomedaySectionRenameWrite(noOp))).toEqual({ id: 'a', changed: false });
        expect(host.probeSomedaySectionRenameOutcome(noOp)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.renameSomedaySectionChecked(noOp)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(focusControlsWrites()).toHaveLength(1);

        const created = value(host.getSomedaySectionCreateOptions({}));
        const otherId = generateUUID();
        expect(value(await host.createSomedaySectionChecked({ requestId: otherId, title: 'Other', expected: created.expected })))
            .toEqual({ id: otherId, existing: false });
        const otherNoOp = { ...request(host, 'a', 'New'), requestId: otherId };
        expect(host.probeSomedaySectionRenameOutcome(otherNoOp)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.renameSomedaySectionChecked(otherNoOp)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(focusControlsWrites()).toHaveLength(2);
    });

    it('refuses an owned no-op UUID after durable receipt reload and contract recreation', async () => {
        const host = await open();
        setRaw([{ id: 'a', title: 'Old', order: 0 }]);
        const changed = request(host, 'a', 'New');
        expect(value(await host.renameSomedaySectionChecked(changed))).toEqual({ id: 'a', changed: true });
        const noOp = { ...request(host, 'a', 'New'), requestId: changed.requestId };
        const client = {
            run: vi.fn(async () => undefined),
            all: vi.fn(async () => [{ request_id: changed.requestId, method: 'stored-changed-write',
                reply: JSON.stringify({ id: 'a', changed: true }), saved_at: '2026-09-29T00:00:00.000Z' }]),
        } as unknown as Parameters<typeof loadNativeRequestReceipts>[0];
        await loadNativeRequestReceipts(client);
        const restarted = createNativeHostContract();
        await restarted.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' });
        await restarted.activate({ writeSafetyReady: true });
        expect(restarted.probeSomedaySectionRenameOutcome(noOp)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await restarted.renameSomedaySectionChecked(noOp)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(focusControlsWrites()).toHaveLength(1);
    });

    it('rejects duplicate raw target IDs even when one matching row is hidden', async () => {
        const host = await open();
        setRaw([{ id: 'a', title: 'Ideas', order: 0 }, { id: 'a', title: '', order: 1 }]);
        expect(host.getSomedaySectionRenameOptions({ id: 'a' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const bad: Request = { requestId: generateUUID(), id: 'a', title: 'New',
            expected: { sections: [{ id: 'a', title: 'Ideas', order: 0 }, { id: 'a', title: '', order: 1 }], updatedAt: null } };
        expect(host.validateSomedaySectionRenameWrite(bad)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        setRaw([{ id: 'a', title: 'Ideas', order: 0 }]);
        const input = request(host, 'a', 'New');
        setRaw([{ id: 'a', title: 'Ideas', order: 0 }, { id: 'a', title: '', order: 1 }], 'later');
        expect(host.probeSomedaySectionRenameOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await host.renameSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('checks the full frozen array and GTD stamp before the first write', async () => {
        const host = await open();
        const raw = [{ id: 'a', title: 'Ideas', order: 0 }, { kind: 'future', value: 'before' }];
        setRaw(raw, 'before');
        const input = request(host, 'a', 'New');
        setRaw([{ ...raw[0] }, { kind: 'future', value: 'after' }], 'before');
        expect(await host.renameSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        setRaw(raw, 'after');
        expect(await host.renameSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('keeps one write across a failed save, two exact retries and contract recreation', async () => {
        let failSave = false;
        const host = await open(async () => { if (failSave) throw new Error('disk unavailable'); });
        setRaw([{ id: 'a', title: 'Ideas', order: 0 }]);
        const input = request(host, 'a', 'New');
        const bytes = JSON.stringify(input);
        failSave = true;
        expect(await host.renameSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(focusControlsWrites()).toHaveLength(1);
        expect(await host.renameSomedaySectionChecked({ ...input, title: 'Different' }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        failSave = false;
        expect(value(await host.renameSomedaySectionChecked(JSON.parse(bytes)))).toEqual({ id: 'a', changed: true });
        expect(value(await host.renameSomedaySectionChecked(JSON.parse(bytes)))).toEqual({ id: 'a', changed: true });
        expect(focusControlsWrites()).toHaveLength(1);
        const restarted = createNativeHostContract();
        await restarted.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' });
        await restarted.activate({ writeSafetyReady: true });
        focusControlsWrites().length = 0;
        expect(value(await restarted.renameSomedaySectionChecked(JSON.parse(bytes)))).toEqual({ id: 'a', changed: true });
        expect(restarted.probeSomedaySectionRenameOutcome(input)).toMatchObject({ ok: true });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('applies a cold first attempt once, then refuses a later rename or delete', async () => {
        const host = await open();
        setRaw([{ id: 'a', title: 'Ideas', order: 0 }]);
        await useTaskStore.getState().persistSnapshot();
        await flushPendingSave();
        const input = request(host, 'a', 'New');
        const restarted = createNativeHostContract();
        await restarted.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' });
        await restarted.activate({ writeSafetyReady: true });
        expect(value(restarted.getSomedaySectionRenameOptions({ id: 'a' })).expected).toEqual(input.expected);
        expect(value(await restarted.renameSomedaySectionChecked(input))).toEqual({ id: 'a', changed: true });
        expect(focusControlsWrites()).toHaveLength(1);
        for (const sections of [
            [{ id: 'a', title: 'Later', order: 0 }],
            [],
            [{ id: 'a', title: 'New', order: 0 }, { id: 'a', title: '', order: 1 }],
        ]) {
            setRaw(sections, 'later');
            expect(restarted.probeSomedaySectionRenameOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(await restarted.renameSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        expect(focusControlsWrites()).toHaveLength(1);
    });

    it('validates exact bounded cold requests without store readiness or caller mutation', async () => {
        const host = createNativeHostContract();
        const input: Request = { requestId: generateUUID(), id: 'none', title: 'New',
            expected: { sections: [{ id: 'none', title: 'Old', order: 0 }], updatedAt: null } };
        expect(value(host.validateSomedaySectionRenameWrite(input))).toEqual({ id: 'none', changed: true });
        for (const bad of [
            { ...input, extra: true }, { ...input, requestId: input.requestId.toUpperCase() },
            { ...input, id: '' }, { ...input, id: 'a'.repeat(501) }, { ...input, id: 'a\0b' },
            { ...input, title: ' ' }, { ...input, title: 'a'.repeat(201) }, { ...input, title: 'a\0b' },
            { ...input, title: '\ud800' }, { ...input, expected: { sections: null, updatedAt: null } },
            { ...input, expected: { sections: input.expected.sections, updatedAt: 7 } },
            { ...input, expected: { sections: [{ id: 'other', title: 'Old', order: 0 }], updatedAt: null } },
            { ...input, expected: { sections: [{ id: 'none', title: 'Old', order: 0, future: '🌊'.repeat(300_000) }], updatedAt: null } },
            { ...input, expected: { sections: [{ id: 'none', title: 'Old', order: 0, constructor: 'unsafe' }], updatedAt: null } },
        ]) expect(host.validateSomedaySectionRenameWrite(bad)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.renameSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        const ready = await open();
        setRaw([{ id: 'none', title: 'Old', order: 0 }]);
        const options = value(ready.getSomedaySectionRenameOptions({ id: 'none' }));
        options.expected.sections[0] = { id: 'none', title: 'Tampered', order: 0 };
        expect(useTaskStore.getState().settings.gtd?.viewSections?.someday?.[0]?.title).toBe('Old');
        setRaw(null);
        expect(ready.getSomedaySectionRenameOptions({ id: 'none' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });
});
