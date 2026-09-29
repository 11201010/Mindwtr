import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusControlsWrites, loadFocusControlsFixture, seedFocusControlsStore } from './focus-controls.replay';
import { createNativeHostContract } from './native-host-contract';
import { resetNativeRequestReceipts } from './native-request-receipts';
import { flushPendingSave, resetForTests, useTaskStore } from './store';
import type { Task } from './types';
import { generateUUID } from './uuid';
import { groupTasksByViewSection } from './view-sections';

const fixture = loadFocusControlsFixture();
const base = fixture.scenarios.find((entry) => entry.settings === 'base' && !entry.taskIds)!;
type Host = ReturnType<typeof createNativeHostContract>;
type Request = Parameters<Host['deleteSomedaySectionChecked']>[0];
const value = <T,>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

describe('native checked Someday section delete', () => {
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
    const request = (host: Host, id: string): Request => ({
        requestId: generateUUID(), id, expected: value(host.getSomedaySectionDeleteOptions({ id })).expected,
    });

    it('deletes only the imported none definition and keeps unknown rows, tasks and other settings', async () => {
        const host = await open();
        const raw = [null, 7, 'future', { kind: 'future', empty: '' },
            { id: 'none', title: 'Imported', order: 1, extra: { empty: '' } },
            { id: 'other', title: 'Other', order: 0 }];
        setRaw(raw, '2026-09-29T00:00:00.000Z');
        const options = value(host.getSomedaySectionDeleteOptions({ id: 'none' }));
        expect(options).toMatchObject({ id: 'none', title: 'Imported',
            expected: { sections: raw, updatedAt: '2026-09-29T00:00:00.000Z' },
            text: { title: expect.any(String), message: expect.stringContaining('Imported'),
                cancelLabel: expect.any(String), confirmLabel: expect.any(String) } });
        const input: Request = { requestId: generateUUID(), id: 'none', expected: options.expected };
        expect(value(host.validateSomedaySectionDeleteWrite(input))).toEqual({ id: 'none', changed: true });
        const before = useTaskStore.getState();
        expect(value(await host.deleteSomedaySectionChecked(input))).toEqual({ id: 'none', changed: true });
        const after = useTaskStore.getState();
        expect(after.settings.gtd?.viewSections?.someday).toEqual([...raw.slice(0, 4), raw[5]]);
        expect(after._allTasks).toEqual(before._allTasks);
        expect(after._allProjects).toEqual(before._allProjects);
        expect({ ...after.settings.gtd, viewSections: undefined }).toEqual({ ...before.settings.gtd, viewSections: undefined });
        expect(focusControlsWrites()).toHaveLength(1);
        expect(host.probeSomedaySectionDeleteOutcome(input)).toEqual({ ok: true, value: { id: 'none', changed: true } });
        const assigned = { id: 'assigned', viewSectionIds: { someday: 'none' } } as Task;
        expect(groupTasksByViewSection([assigned], 'someday', after.settings.gtd?.viewSections?.someday, 'No section'))
            .toEqual([{ id: 'view-section:someday:', title: 'No section', tasks: [assigned], muted: true }]);
    });

    it('refuses missing, hidden and ambiguous targets before confirmation or write', async () => {
        const host = await open();
        for (const sections of [[], [{ id: 'a', title: '', order: 0 }],
            [{ id: 'a', title: 'Visible', order: 0 }, { id: 'a', title: '', order: 1 }]]) {
            setRaw(sections);
            expect(host.getSomedaySectionDeleteOptions({ id: 'a' }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(host.validateSomedaySectionDeleteWrite({ requestId: generateUUID(), id: 'a',
                expected: { sections, updatedAt: null } }))
                .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        setRaw([{ id: 'a', title: 'Visible', order: 0 }]);
        const input = request(host, 'a');
        setRaw([{ id: 'a', title: 'Visible', order: 0 }, { id: 'a', title: '', order: 1 }]);
        expect(host.probeSomedaySectionDeleteOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await host.deleteSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('requires exact original array and GTD stamp before first deletion', async () => {
        const host = await open();
        const raw = [{ id: 'a', title: 'Old', order: 0 }, { kind: 'future', value: 1 }];
        setRaw(raw, 'before');
        const input = request(host, 'a');
        for (const [sections, stamp] of [
            [[{ id: 'a', title: 'Renamed', order: 0 }, raw[1]], 'before'],
            [[raw[0], { kind: 'future', value: 2 }], 'before'],
            [raw, 'after'],
            [[{ id: 'a', title: 'Recreated', order: 0 }, raw[1]], 'after'],
        ] as const) {
            setRaw(sections, stamp);
            expect(await host.deleteSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        expect(focusControlsWrites()).toEqual([]);
    });

    it('recognizes only the exact post-image, never mere absence or a recreated ID', async () => {
        const host = await open();
        const raw = [null, { id: 'a', title: 'Old', order: 0 }, { id: 'b', title: 'Other', order: 1 }];
        setRaw(raw);
        const input = request(host, 'a');
        setRaw([raw[0], raw[2]], 'other-actor');
        expect(value(host.probeSomedaySectionDeleteOutcome(input))).toEqual({ id: 'a', changed: true });
        expect(value(await host.deleteSomedaySectionChecked(input))).toEqual({ id: 'a', changed: true });
        expect(focusControlsWrites()).toEqual([]);
        for (const sections of [[raw[2]], [raw[0], { ...raw[2], title: 'Changed' }],
            [raw[0], raw[2], { id: 'a', title: 'Recreated', order: 2 }]]) {
            setRaw(sections, 'later');
            expect(host.probeSomedaySectionDeleteOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(await host.deleteSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        expect(focusControlsWrites()).toEqual([]);
    });

    it('retains the exact request across a failed save, two retries and contract recreation', async () => {
        let failSave = false;
        const host = await open(async () => { if (failSave) throw new Error('disk unavailable'); });
        setRaw([{ id: 'a', title: 'Old', order: 0 }]);
        const input = request(host, 'a');
        const bytes = JSON.stringify(input);
        failSave = true;
        expect(await host.deleteSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
        expect(focusControlsWrites()).toHaveLength(1);
        expect(await host.deleteSomedaySectionChecked({ ...input, id: 'b' }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        failSave = false;
        expect(value(await host.deleteSomedaySectionChecked(JSON.parse(bytes)))).toEqual({ id: 'a', changed: true });
        expect(value(await host.deleteSomedaySectionChecked(JSON.parse(bytes)))).toEqual({ id: 'a', changed: true });
        expect(focusControlsWrites()).toHaveLength(1);
        const restarted = createNativeHostContract();
        await restarted.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' });
        await restarted.activate({ writeSafetyReady: true });
        focusControlsWrites().length = 0;
        expect(value(await restarted.deleteSomedaySectionChecked(JSON.parse(bytes)))).toEqual({ id: 'a', changed: true });
        expect(restarted.probeSomedaySectionDeleteOutcome(input)).toMatchObject({ ok: true });
        expect(focusControlsWrites()).toEqual([]);
    });

    it('applies a frozen request after cold contract recreation and refuses later same-ID content', async () => {
        const host = await open();
        setRaw([{ id: 'a', title: 'Old', order: 0 }, { id: 'b', title: 'Other', order: 1 }]);
        await useTaskStore.getState().persistSnapshot();
        await flushPendingSave();
        const input = request(host, 'a');
        const restarted = createNativeHostContract();
        await restarted.setLanguage({ storedLanguage: 'en', systemLocale: 'en-US' });
        await restarted.activate({ writeSafetyReady: true });
        expect(value(restarted.getSomedaySectionDeleteOptions({ id: 'a' })).expected).toEqual(input.expected);
        expect(value(await restarted.deleteSomedaySectionChecked(input))).toEqual({ id: 'a', changed: true });
        expect(focusControlsWrites()).toHaveLength(1);
        setRaw([{ id: 'b', title: 'Other', order: 1 }, { id: 'a', title: 'Recreated', order: 2 }], 'later');
        expect(restarted.probeSomedaySectionDeleteOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await restarted.deleteSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(focusControlsWrites()).toHaveLength(1);
    });

    it('refuses a live UUID owned by another payload or method without a write', async () => {
        const host = await open();
        setRaw([{ id: 'a', title: 'Old', order: 0 }, { id: 'b', title: 'Other', order: 1 }]);
        const input = request(host, 'a');
        expect(value(await host.deleteSomedaySectionChecked(input))).toEqual({ id: 'a', changed: true });
        const other = { ...request(host, 'b'), requestId: input.requestId };
        expect(host.probeSomedaySectionDeleteOutcome(other)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.deleteSomedaySectionChecked(other)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(focusControlsWrites()).toHaveLength(1);
        const create = value(host.getSomedaySectionCreateOptions({}));
        const cross = { requestId: generateUUID(), title: 'Third', expected: create.expected };
        expect(value(await host.createSomedaySectionChecked(cross))).toMatchObject({ existing: false });
        const crossDelete = { ...input, requestId: cross.requestId };
        expect(host.probeSomedaySectionDeleteOutcome(crossDelete)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.deleteSomedaySectionChecked(crossDelete)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(focusControlsWrites()).toHaveLength(2);
    });

    it('validates exact bounded cold requests before store readiness and detaches options', async () => {
        const host = createNativeHostContract();
        const input: Request = { requestId: generateUUID(), id: 'none',
            expected: { sections: [null, { id: 'none', title: 'Imported', order: 0 }], updatedAt: null } };
        expect(value(host.validateSomedaySectionDeleteWrite(input))).toEqual({ id: 'none', changed: true });
        for (const bad of [
            { ...input, extra: true }, { ...input, requestId: input.requestId.toUpperCase() },
            { ...input, id: '' }, { ...input, id: 'a'.repeat(501) }, { ...input, id: 'a\0b' },
            { ...input, id: '\ud800' }, { ...input, expected: { sections: null, updatedAt: null } },
            { ...input, expected: { sections: input.expected.sections, updatedAt: 7 } },
            { ...input, expected: { sections: [{ id: 'none', title: '', order: 0 }], updatedAt: null } },
            { ...input, expected: { sections: [{ id: 'none', title: 'Old', order: 0 },
                { id: 'none', title: '', order: 1 }], updatedAt: null } },
            { ...input, expected: { sections: [{ id: 'none', title: 'Old', order: 0,
                future: '🌊'.repeat(300_000) }], updatedAt: null } },
            { ...input, expected: { sections: [{ id: 'none', title: 'Old', order: 0,
                constructor: 'unsafe' }], updatedAt: null } },
        ]) expect(host.validateSomedaySectionDeleteWrite(bad)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await host.deleteSomedaySectionChecked(input)).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
        const ready = await open();
        setRaw([{ id: 'none', title: 'Old', order: 0 }]);
        const options = value(ready.getSomedaySectionDeleteOptions({ id: 'none' }));
        options.expected.sections[0] = { id: 'none', title: 'Tampered', order: 0 };
        expect(useTaskStore.getState().settings.gtd?.viewSections?.someday?.[0]?.title).toBe('Old');
    });
});
