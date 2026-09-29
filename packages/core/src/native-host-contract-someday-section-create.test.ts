import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusControlsWrites, loadFocusControlsFixture, seedFocusControlsStore } from './focus-controls.replay';
import { createNativeHostContract } from './native-host-contract';
import { flushPendingSave, resetForTests, useTaskStore } from './store';
import { generateUUID } from './uuid';

const fixture = loadFocusControlsFixture();
const base = fixture.scenarios.find((entry) => entry.settings === 'base' && !entry.taskIds)!;
type Host = ReturnType<typeof createNativeHostContract>;
type Request = Parameters<Host['createSomedaySectionChecked']>[0];
const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

describe('native checked Someday section creation', () => {
    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
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
    const request = (host: Host, title: string): Request => ({
        requestId: generateUUID(), title, expected: value(host.getSomedaySectionCreateOptions({})).expected,
    });
    const setRaw = (sections: unknown, stamp: unknown = undefined) => useTaskStore.setState((state) => {
        const stamps = { ...state.settings.syncPreferencesUpdatedAt };
        if (stamp === undefined) delete stamps.gtd;
        else stamps.gtd = stamp as string;
        const settings = { ...state.settings, gtd: { ...state.settings.gtd,
            viewSections: { ...state.settings.gtd?.viewSections, someday: sections } },
            syncPreferencesUpdatedAt: stamps };
        return { settings: settings as typeof state.settings };
    });

    it('creates the trimmed row while retaining hidden, future and duplicate entries in raw order', async () => {
        const host = await open();
        const raw = [
            { id: 'a', title: 'Ideas', order: 7, future: { visible: false } },
            { hidden: 'newer-client' },
            { id: 'b', title: 'ideas', order: -1 },
            { id: 'c', title: 'Other', order: 2 },
        ];
        setRaw(raw, '2026-09-29T00:00:00.000Z');
        const input = request(host, '  Voyage 🌊  ');
        const before = useTaskStore.getState();
        const otherGtd = { ...before.settings.gtd, viewSections: undefined };
        expect(value(await host.createSomedaySectionChecked(input))).toEqual({ id: input.requestId, existing: false });
        const after = useTaskStore.getState();
        expect(after.settings.gtd?.viewSections?.someday).toEqual([...raw,
            { id: input.requestId, title: 'Voyage 🌊', order: 8 }]);
        expect({ ...after.settings.gtd, viewSections: undefined }).toEqual(otherGtd);
        expect(after._allTasks).toEqual(before._allTasks);
        expect(after._allProjects).toEqual(before._allProjects);
        expect(focusControlsWrites()).toHaveLength(1);
        expect(focusControlsWrites()[0]).toMatchObject(['updateSettings', { gtd: { viewSections: {
            someday: [...raw, { id: '<new>', title: 'Voyage 🌊', order: 8 }],
        } } }]);
        expect(host.probeSomedaySectionCreateOutcome(input)).toEqual({ ok: true,
            value: { id: input.requestId, existing: false } });
    });

    it('returns the frozen existing title without any write and refuses a renamed target', async () => {
        const host = await open();
        setRaw([{ id: 'a', title: 'Ideas', order: 3 }, { id: 'b', title: 'ideas', order: 1 }]);
        const input = request(host, '  IDEAS ');
        expect(value(host.validateSomedaySectionCreateWrite(input))).toEqual({ id: 'b', existing: true });
        expect(value(await host.createSomedaySectionChecked(input))).toEqual({ id: 'b', existing: true });
        expect(focusControlsWrites()).toEqual([]);
        setRaw([{ id: 'a', title: 'Ideas', order: 3 }, { id: 'b', title: 'Renamed', order: 1 }], 'later');
        const restarted = createNativeHostContract();
        await restarted.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' });
        await restarted.activate({ writeSafetyReady: true });
        expect(restarted.probeSomedaySectionCreateOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await restarted.createSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('refuses an ambiguous frozen existing ID or a duplicate target ID added later', async () => {
        const host = await open();
        setRaw([{ id: 'same', title: 'Other', order: 0 }, { id: 'same', title: 'Ideas', order: 1 }]);
        const ambiguous = request(host, 'Ideas');
        expect(host.validateSomedaySectionCreateWrite(ambiguous)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.createSomedaySectionChecked(ambiguous)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        setRaw([{ id: 'same', title: 'Ideas', order: 1 }]);
        const input = request(host, 'Ideas');
        setRaw([{ id: 'same', title: 'Other', order: 0 }, { id: 'same', title: 'Ideas', order: 1 }], 'later');
        expect(host.probeSomedaySectionCreateOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await host.createSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('retries a failed save once and replays after recreation despite unrelated edits', async () => {
        let failSave = false;
        const host = await open(async () => { if (failSave) throw new Error('disk unavailable'); });
        const input = request(host, 'Ideas');
        failSave = true;
        const [first, duplicate] = await Promise.all([host.createSomedaySectionChecked(input), host.createSomedaySectionChecked(input)]);
        expect(first).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(duplicate).toEqual(first);
        expect(focusControlsWrites()).toHaveLength(1);
        expect(await host.createSomedaySectionChecked({ ...input, title: 'Different' }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        failSave = false;
        expect(value(await host.createSomedaySectionChecked(input))).toEqual({ id: input.requestId, existing: false });
        expect(focusControlsWrites()).toHaveLength(1);
        await useTaskStore.getState().updateSettings({ gtd: { ...useTaskStore.getState().settings.gtd, focusGroupBy: 'context' } });
        await flushPendingSave();
        const restarted = createNativeHostContract();
        await restarted.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' });
        await restarted.activate({ writeSafetyReady: true });
        focusControlsWrites().length = 0;
        expect(value(await restarted.createSomedaySectionChecked(input))).toEqual({ id: input.requestId, existing: false });
        expect(restarted.probeSomedaySectionCreateOutcome(input)).toMatchObject({ ok: true });
        expect(useTaskStore.getState().settings.gtd?.focusGroupBy).toBe('context');
        expect(focusControlsWrites()).toEqual([]);
    });

    it('refuses rename, delete, replacement, UUID collision and ABA after the original target changes', async () => {
        const host = await open();
        const input = request(host, 'New');
        for (const row of [
            { id: input.requestId, title: 'Renamed', order: 0 },
            undefined,
            { id: input.requestId, title: 'New', order: 9 },
        ]) {
            setRaw(row ? [row] : [], 'later');
            expect(host.probeSomedaySectionCreateOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(await host.createSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        setRaw([], 'later');
        expect(await host.createSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(focusControlsWrites()).toEqual([]);
        const collision = { ...input, expected: { sections: [{ id: input.requestId, title: 'Other', order: 0 }], updatedAt: null } };
        expect(host.validateSomedaySectionCreateWrite(collision)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('uses the GTD stamp to refuse a restored pre-write list', async () => {
        const host = await open();
        const raw = [{ id: 'older', title: 'Older', order: 0 }];
        setRaw(raw, 'before');
        const input = request(host, 'New');
        setRaw([...raw, { id: 'intervening', title: 'Intervening', order: 1 }], 'during');
        setRaw(raw, 'after');
        expect(await host.createSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('does not claim a saved receipt after the created row is renamed or deleted', async () => {
        const host = await open();
        const input = request(host, 'New');
        expect(value(await host.createSomedaySectionChecked(input))).toEqual({ id: input.requestId, existing: false });
        await useTaskStore.getState().updateSettings({ gtd: { ...useTaskStore.getState().settings.gtd,
            viewSections: { ...useTaskStore.getState().settings.gtd?.viewSections,
                someday: [{ id: input.requestId, title: 'Renamed', order: 0 }] } } });
        await flushPendingSave();
        focusControlsWrites().length = 0;
        expect(await host.createSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        const restarted = createNativeHostContract();
        await restarted.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' });
        await restarted.activate({ writeSafetyReady: true });
        expect(await restarted.createSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        await useTaskStore.getState().updateSettings({ gtd: { ...useTaskStore.getState().settings.gtd,
            viewSections: { ...useTaskStore.getState().settings.gtd?.viewSections, someday: [] } } });
        await flushPendingSave();
        focusControlsWrites().length = 0;
        expect(await restarted.createSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('validates cold, exact, bounded input and rejects unsupported stored data', async () => {
        const host = createNativeHostContract();
        const input: Request = { requestId: generateUUID(), title: '🌊 Ideas', expected: { sections: null, updatedAt: null } };
        expect(value(host.validateSomedaySectionCreateWrite(input))).toEqual({ id: input.requestId, existing: false });
        for (const bad of [
            { ...input, extra: true }, { ...input, extra: undefined },
            { ...input, requestId: input.requestId.toUpperCase() },
            { ...input, requestId: 'bad' }, { ...input, title: ' ' }, { ...input, title: 'a'.repeat(201) },
            { ...input, title: 'a\0b' }, { ...input, title: '\ud800' },
            { ...input, expected: { sections: null, updatedAt: null, extra: true } },
            { ...input, expected: { sections: {}, updatedAt: null } },
            { ...input, expected: { sections: null, updatedAt: 7 } },
            { ...input, expected: { sections: [{ note: '🌊'.repeat(300_000) }], updatedAt: null } },
            { ...input, expected: { sections: [{ constructor: 'unsafe' }], updatedAt: null } },
        ]) expect(host.validateSomedaySectionCreateWrite(bad)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.createSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        const ready = await open();
        setRaw(null);
        expect(ready.getSomedaySectionCreateOptions({})).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        setRaw({ nope: true });
        expect(ready.getSomedaySectionCreateOptions({})).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });
});
