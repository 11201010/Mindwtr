import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusControlsWrites, loadFocusControlsFixture, seedFocusControlsStore } from './focus-controls.replay';
import { createNativeHostContract } from './native-host-contract';
import { resetNativeRequestReceipts } from './native-request-receipts';
import { flushPendingSave, resetForTests, useTaskStore } from './store';
import { generateUUID } from './uuid';

const fixture = loadFocusControlsFixture();
const base = fixture.scenarios.find((entry) => entry.settings === 'base' && !entry.taskIds)!;
type Host = ReturnType<typeof createNativeHostContract>;
type Request = Parameters<Host['orderSomedaySectionChecked']>[0];
const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
const a = { id: 'none', title: 'Alpha', order: 10, extra: { untouched: true } };
const b = { id: 'bravo', title: 'Bravo', order: 30 };
const c = { id: 'charlie', title: 'Charlie', order: 80 };
const raw = [null, 7, { id: 'future', title: '', order: 9 }, a, b, c];

describe('native checked Someday section order', () => {
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
    const request = (host: Host, id: string, offset: -1 | 1): Request => ({
        requestId: generateUUID(), id, offset, expected: value(host.getSomedaySectionOrderOptions({ id, offset })).expected,
    });

    it('renumbers all visible rows with the shared move, preserving raw order, hidden data and tasks', async () => {
        const host = await open();
        setRaw(raw, 'before');
        const input = request(host, 'bravo', -1);
        expect(value(host.validateSomedaySectionOrderWrite(input))).toEqual({ id: 'bravo', changed: true });
        const before = useTaskStore.getState();
        expect(value(await host.orderSomedaySectionChecked(input))).toEqual({ id: 'bravo', changed: true });
        const after = useTaskStore.getState();
        expect(after.settings.gtd?.viewSections?.someday).toEqual([
            ...raw.slice(0, 3), { ...a, order: 1 }, { ...b, order: 0 }, { ...c, order: 2 },
        ]);
        expect(after._allTasks).toEqual(before._allTasks);
        expect(after._allProjects).toEqual(before._allProjects);
        expect({ ...after.settings.gtd, viewSections: undefined }).toEqual({ ...before.settings.gtd, viewSections: undefined });
        expect(focusControlsWrites()).toHaveLength(1);
        expect(host.probeSomedaySectionOrderOutcome(input)).toEqual({ ok: true, value: { id: 'bravo', changed: true } });
    });

    it('uses the shared title tie break and default order while retaining raw array order', async () => {
        const host = await open();
        setRaw([{ id: c.id, title: c.title }, { ...b, order: 3 }, { ...a, order: 3 }]);
        const input = request(host, 'bravo', 1);
        expect(value(await host.orderSomedaySectionChecked(input))).toEqual({ id: 'bravo', changed: true });
        expect(useTaskStore.getState().settings.gtd?.viewSections?.someday).toEqual([
            { ...c, order: 1 }, { ...b, order: 2 }, { ...a, order: 0 },
        ]);
    });

    it('refuses boundaries and every visible ID duplicated anywhere in the raw array', async () => {
        const host = await open();
        setRaw(raw);
        for (const [id, offset] of [['none', -1], ['charlie', 1]] as const) {
            expect(host.getSomedaySectionOrderOptions({ id, offset })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(host.validateSomedaySectionOrderWrite({ requestId: generateUUID(), id, offset,
                expected: { sections: raw, updatedAt: null } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        for (const duplicate of [{ id: 'charlie', title: '', order: 3 }, { ...c, title: 'Zulu', order: 90 },
            { id: 'none', title: '', order: 3 }]) {
            const sections = [...raw, duplicate];
            setRaw(sections);
            expect(host.getSomedaySectionOrderOptions({ id: 'bravo', offset: -1 }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(host.validateSomedaySectionOrderWrite({ requestId: generateUUID(), id: 'bravo', offset: -1,
                expected: { sections, updatedAt: null } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        expect(focusControlsWrites()).toEqual([]);
    });

    it('rejects malformed or oversized live settings and unsupported visible IDs', async () => {
        const host = await open();
        for (const sections of [null, { someday: raw }, [...raw, { id: 'x'.repeat(501), title: 'Too long', order: 100 }],
            [...raw, { id: '\ud800', title: 'Invalid Unicode', order: 100 }],
            [...raw, { id: 'large', title: 'Large', order: 100, future: '🌊'.repeat(300_000) }]]) {
            setRaw(sections);
            expect(host.getSomedaySectionOrderOptions({ id: 'bravo', offset: -1 }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        setRaw(raw, 7);
        expect(host.getSomedaySectionOrderOptions({ id: 'bravo', offset: -1 }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('requires an exact raw array and GTD stamp; later reversal or recreation cannot replay', async () => {
        const host = await open();
        setRaw(raw, 'before');
        const input = request(host, 'bravo', -1);
        for (const [sections, stamp] of [
            [[...raw.slice(0, 4), { ...b, title: 'Renamed' }, c], 'before'],
            [[...raw.slice(0, 2), { id: 'future', title: '', order: 10 }, ...raw.slice(3)], 'before'],
            [raw, 'after'],
            [[...raw.slice(0, 4), { ...b, title: 'Recreated' }, c], 'after'],
        ] as const) {
            setRaw(sections, stamp);
            expect(await host.orderSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        expect(focusControlsWrites()).toEqual([]);
        setRaw(raw, 'before');
        expect(value(await host.orderSomedaySectionChecked(input))).toEqual({ id: 'bravo', changed: true });
        setRaw(raw, 'later');
        expect(host.probeSomedaySectionOrderOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await host.orderSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
    });

    it('retains the original UUID and args through a failed save, retries and contract recreation', async () => {
        let failSave = false;
        const host = await open(async () => { if (failSave) throw new Error('disk unavailable'); });
        setRaw(raw);
        const input = request(host, 'bravo', -1);
        const bytes = JSON.stringify(input);
        failSave = true;
        expect(await host.orderSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(focusControlsWrites()).toHaveLength(1);
        expect(await host.orderSomedaySectionChecked({ ...input, offset: 1 }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        failSave = false;
        expect(value(await host.orderSomedaySectionChecked(JSON.parse(bytes)))).toEqual({ id: 'bravo', changed: true });
        expect(value(await host.orderSomedaySectionChecked(JSON.parse(bytes)))).toEqual({ id: 'bravo', changed: true });
        expect(focusControlsWrites()).toHaveLength(1);
        const restarted = createNativeHostContract();
        await restarted.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' });
        await restarted.activate({ writeSafetyReady: true });
        focusControlsWrites().length = 0;
        expect(value(await restarted.orderSomedaySectionChecked(JSON.parse(bytes)))).toEqual({ id: 'bravo', changed: true });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('applies a frozen request after contract recreation and accepts only its exact post-image', async () => {
        const host = await open();
        setRaw(raw, 'before');
        await useTaskStore.getState().persistSnapshot();
        await flushPendingSave();
        const input = request(host, 'bravo', -1);
        const restarted = createNativeHostContract();
        await restarted.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' });
        await restarted.activate({ writeSafetyReady: true });
        expect(value(restarted.getSomedaySectionOrderOptions({ id: 'bravo', offset: -1 })).expected).toEqual(input.expected);
        expect(value(await restarted.orderSomedaySectionChecked(input))).toEqual({ id: 'bravo', changed: true });
        expect(focusControlsWrites()).toHaveLength(1);
        const post = useTaskStore.getState().settings.gtd?.viewSections?.someday;
        setRaw([...post!], 'other-actor');
        expect(value(restarted.probeSomedaySectionOrderOutcome(input))).toEqual({ id: 'bravo', changed: true });
        setRaw(raw, 'later-reversal');
        expect(restarted.probeSomedaySectionOrderOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await restarted.orderSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        setRaw([...raw.slice(0, 4), { ...b, title: 'Recreated', order: 0 }, { ...c, order: 2 }], 'later-recreation');
        expect(restarted.probeSomedaySectionOrderOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(focusControlsWrites()).toHaveLength(1);
    });

    it('validates cold requests before readiness and detaches live options', async () => {
        const cold = createNativeHostContract();
        const input: Request = { requestId: generateUUID(), id: 'bravo', offset: -1,
            expected: { sections: raw, updatedAt: null } };
        expect(value(cold.validateSomedaySectionOrderWrite(input))).toEqual({ id: 'bravo', changed: true });
        for (const bad of [
            { ...input, extra: true }, { ...input, requestId: input.requestId.toUpperCase() },
            { ...input, id: '' }, { ...input, id: 'a'.repeat(501) }, { ...input, id: '\ud800' },
            { ...input, offset: 0 }, { ...input, offset: 2 }, { ...input, expected: { sections: null, updatedAt: null } },
            { ...input, expected: { sections: raw, updatedAt: 7 } },
            { ...input, expected: { sections: [...raw, { id: 'none', title: '', order: 4 }], updatedAt: null } },
            { ...input, expected: { sections: [...raw, { id: 'future-visible', title: 'Other', order: 4,
                extra: '🌊'.repeat(300_000) }], updatedAt: null } },
            { ...input, expected: { sections: [...raw, { id: 'other', title: 'Other', constructor: 'unsafe' }], updatedAt: null } },
        ]) expect(cold.validateSomedaySectionOrderWrite(bad)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await cold.orderSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        const host = await open();
        setRaw(raw);
        const options = value(host.getSomedaySectionOrderOptions({ id: 'bravo', offset: -1 }));
        options.expected.sections[3] = { id: 'none', title: 'Tampered', order: 10 };
        expect(useTaskStore.getState().settings.gtd?.viewSections?.someday?.[3]?.title).toBe('Alpha');
    });
});
