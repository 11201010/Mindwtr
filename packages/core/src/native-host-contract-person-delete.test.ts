import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersonDeleteMethods, type NativePersonDeleteRequest } from './native-host-contract-person-delete';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import { personPersistedSnapshot } from './store-projects/people-actions';
import { nextRevision } from './store-helpers';
import { TASK_SYNC_SCHEMA_FIXTURE } from './task-sync-schema';
import type { AppData, Person } from './types';

const requestId = '00000000-0000-4000-8000-000000000393';
const now = '2026-09-29T15:00:00.000Z';
const person = (overrides: Partial<Person> = {}): Person => ({ id: 'legacy-person', name: 'Alex 世界',
    note: 'Keep note', referenceLink: 'obsidian://keep', rev: 5, revBy: 'previous-device',
    createdAt: '2026-09-29T15:00:00Z', updatedAt: 'legacy updated stamp', ...overrides });
const request = (expected = person(), overrides: Partial<NativePersonDeleteRequest> = {}): NativePersonDeleteRequest => ({
    requestId, personId: expected.id, expected, ...overrides,
});
async function open(initial: Partial<AppData> = {}, fail?: () => boolean) {
    await flushPendingSave();
    resetForTests();
    let data: AppData = { tasks: [], projects: [], sections: [], areas: [], people: [person()],
        settings: { deviceId: 'person-device' }, ...structuredClone(initial) };
    let saves = 0;
    setStorageAdapter({ getData: async () => data, saveData: async (next) => {
        if (fail?.()) throw new Error('disk unavailable');
        data = structuredClone(next);
        saves++;
    } });
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    await flushPendingSave();
    saves = 0;
    const methods = createPersonDeleteMethods({ readiness: () => ({ ok: true, value: null }), t: () => (key) => key,
        save: async () => {
            try { await flushPendingSave(); return { ok: true as const, value: null }; }
            catch { return { ok: false as const, error: { code: 'SAVE_FAILED' as const, message: 'disk unavailable' } }; }
        } });
    return { methods, data: () => data, saves: () => saves };
}
const freeze = (methods: ReturnType<typeof createPersonDeleteMethods>, input = request()) => {
    const plan = methods.preparePersonDelete(input);
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    return structuredClone({ request: input, prepared: plan.value.prepared });
};
afterEach(async () => { await flushPendingSave(); resetForTests(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('prepared native Person delete', () => {
    it('returns a detached canonical full-row confirmation without writes or initialization; Cancel has no effect', async () => {
        const { methods, data, saves } = await open();
        useTaskStore.setState({ settings: {} });
        const before = structuredClone(data());
        const options = methods.getPersonDeleteOptions({ personId: person().id });
        expect(options).toMatchObject({ ok: true, value: { personId: person().id, name: person().name,
            expected: person(), confirm: { message: 'Delete "Alex 世界"?' } } });
        if (!options.ok) throw new Error('options failed');
        options.value.expected.note = 'Detached edit';
        expect(useTaskStore.getState()._allPeople[0].note).toBe('Keep note');
        expect(useTaskStore.getState().settings).toEqual({});
        expect(saves()).toBe(0);
        expect(data()).toEqual(before);
    });

    it('deletes only the pinned Person and matches RN revision policy while preserving every Task and other row', async () => {
        const target = person();
        const other = person({ id: 'other-person', name: 'Other', rev: 7 });
        const tasks = ['live', 'deleted', 'context', 'other'].map((id, index) => ({ ...TASK_SYNC_SCHEMA_FIXTURE,
            id, assignedTo: index === 3 ? 'Other' : target.name, contexts: ['@Alex 世界'],
            ...(index === 1 ? { deletedAt: now } : {}) }));
        const rn = await open({ people: [target, other], tasks });
        const rnTasks = structuredClone(useTaskStore.getState()._allTasks);
        vi.useFakeTimers(); vi.setSystemTime(new Date(now));
        expect(await useTaskStore.getState().deletePerson(target.id)).toEqual({ success: true });
        await flushPendingSave();
        expect(useTaskStore.getState()._allPeople).toEqual([{ ...target, deletedAt: now, updatedAt: now, rev: 6, revBy: 'person-device' }, other]);
        expect(rn.data().tasks).toEqual(rnTasks);
        vi.useRealTimers();
        const cold = await open({ people: [target, other], tasks });
        const before = structuredClone(cold.data());
        const taskRows = useTaskStore.getState()._allTasks;
        const frozen = freeze(cold.methods);
        expect(cold.methods.validatePreparedPersonDelete(frozen)).toEqual({ ok: true, value: { personId: target.id } });
        expect(await cold.methods.commitPreparedPersonDelete(frozen)).toEqual({ ok: true, value: { personId: target.id } });
        expect(useTaskStore.getState()._allTasks).toBe(taskRows);
        expect(cold.data()).toEqual({ ...before, people: [frozen.prepared.effect.person.after, other] });
        expect(cold.methods.probePersonDeleteOutcome(frozen.request)).toEqual({ ok: true, value: { personId: target.id } });
    });

    it('missing and already-deleted rows refuse options/prepare and preserve RN errors without a write', async () => {
        const deleted = person({ deletedAt: now, updatedAt: now });
        const { methods, saves } = await open({ people: [deleted] });
        const before = structuredClone(useTaskStore.getState()._allPeople);
        for (const personId of ['missing', deleted.id]) {
            expect(methods.getPersonDeleteOptions({ personId })).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(methods.preparePersonDelete(request(person({ id: personId })))).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(await useTaskStore.getState().deletePerson(personId)).toEqual({ success: false, error: 'Person not found' });
        }
        expect(useTaskStore.getState()._allPeople).toEqual(before);
        expect(saves()).toBe(0);
    });

    it('accepts large legacy name/note/link and raw timestamps without trimming or editor caps', async () => {
        const target = person({ name: 'A'.repeat(501), note: 'n'.repeat(10_001), referenceLink: 'x'.repeat(2_001) });
        const { methods, data } = await open({ people: [target] });
        const options = methods.getPersonDeleteOptions({ personId: target.id });
        expect(options).toMatchObject({ ok: true, value: { expected: target } });
        if (!options.ok) throw new Error('options failed');
        const frozen = freeze(methods, request(options.value.expected));
        expect(await methods.commitPreparedPersonDelete(frozen)).toMatchObject({ ok: true });
        expect(data().people?.[0]).toEqual({ ...target, deletedAt: frozen.prepared.updateAt, updatedAt: frozen.prepared.updateAt,
            rev: 6, revBy: 'person-device' });
    });

    it('canonicalizes SQLite optional NULLs and unknown fields in options while never mutating the source', async () => {
        const { methods, saves } = await open();
        const current = { ...person(), note: null, referenceLink: null, extra: 'not a persisted Person column' };
        useTaskStore.setState({ _allPeople: [current as unknown as Person] });
        const options = methods.getPersonDeleteOptions({ personId: current.id });
        if (!options.ok) throw new Error('options failed');
        expect(Object.keys(options.value.expected).sort()).toEqual(['createdAt', 'id', 'name', 'rev', 'revBy', 'updatedAt']);
        expect(options.value.expected).toEqual(personPersistedSnapshot(current as unknown as Person));
        expect(useTaskStore.getState()._allPeople[0]).toEqual(current);
        expect(saves()).toBe(0);
    });

    it('pins the complete confirmation and refuses name/metadata/revision/deletion changes at prepare and commit', async () => {
        const { methods, saves } = await open();
        const frozen = freeze(methods);
        for (const row of [person({ name: 'Renamed' }), person({ note: 'Changed' }), person({ referenceLink: 'new://link' }),
            person({ createdAt: 'other timestamp' }), person({ rev: 6 }), person({ deletedAt: now }), null]) {
            useTaskStore.setState({ _allPeople: row ? [row] : [] });
            expect(methods.preparePersonDelete(frozen.request)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(await methods.commitPreparedPersonDelete(frozen)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        const other = person({ id: 'other', name: 'Unrelated', note: 'Changed elsewhere', rev: 9 });
        useTaskStore.setState({ _allPeople: [other, person()] });
        expect(await methods.commitPreparedPersonDelete(frozen)).toMatchObject({ ok: true });
        expect(useTaskStore.getState()._allPeople[0]).toEqual(other);
        expect(saves()).toBe(1);
    });

    it('freezes genuine device initialization and preserves unrelated settings on cold replay', async () => {
        const writer = await open();
        useTaskStore.setState({ settings: { theme: 'dark' } });
        const frozen = freeze(writer.methods);
        expect(frozen.prepared.deviceIdBefore).toBeNull();
        expect(frozen.prepared.deviceIdToInitialize).toMatch(/^[0-9a-f-]{36}$/);
        expect(useTaskStore.getState().settings).toEqual({ theme: 'dark' });
        const cold = await open();
        useTaskStore.setState({ settings: { theme: 'dark', timeFormat: '24h' } });
        expect(cold.methods.validatePreparedPersonDelete(frozen)).toMatchObject({ ok: true });
        expect(await cold.methods.commitPreparedPersonDelete(frozen)).toMatchObject({ ok: true });
        expect(cold.data().settings).toEqual({ theme: 'dark', timeFormat: '24h', deviceId: frozen.prepared.deviceIdToInitialize });
        const replay = await open(cold.data());
        const before = replay.saves();
        expect(await replay.methods.commitPreparedPersonDelete(frozen)).toMatchObject({ ok: true });
        expect(replay.saves()).toBe(before);
    });

    it('observes a single compatible tombstone read-only and refuses missing/live/renamed/restored/further revisions', async () => {
        const { methods, saves } = await open();
        const input = request();
        const compatible = person({ deletedAt: now, updatedAt: now, rev: nextRevision(input.expected.rev), revBy: 'different-device' });
        useTaskStore.setState({ _allPeople: [compatible] });
        expect(methods.probePersonDeleteOutcome(input)).toEqual({ ok: true, value: { personId: input.personId } });
        const incompatible = [null, person(), { ...compatible, name: 'Renamed' }, { ...compatible, note: 'Changed' },
            { ...compatible, referenceLink: 'changed://link' }, { ...compatible, createdAt: 'other stamp' },
            { ...compatible, deletedAt: undefined, rev: 7 }, { ...compatible, rev: 7 }, { ...compatible, revBy: '' },
            { ...compatible, deletedAt: 'not ISO' }, { ...compatible, updatedAt: '2026-09-30T15:00:00.000Z' }];
        for (const current of incompatible) {
            useTaskStore.setState({ _allPeople: current ? [current] : [] });
            expect(methods.probePersonDeleteOutcome(input)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        }
        expect(saves()).toBe(0);
    });

    it('failed saves retain one frozen revision and cold replay refuses intervening rename/delete/restore', async () => {
        let failSave = false;
        const writer = await open({}, () => failSave);
        const frozen = freeze(writer.methods);
        const persistedBefore = structuredClone(writer.data());
        failSave = true;
        for (let retry = 0; retry < 2; retry++) {
            expect(await writer.methods.commitPreparedPersonDelete(frozen)).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
            expect(writer.data()).toEqual(persistedBefore);
            expect(useTaskStore.getState()._allPeople[0]).toEqual(frozen.prepared.effect.person.after);
        }
        failSave = false;
        expect(await writer.methods.commitPreparedPersonDelete(frozen)).toMatchObject({ ok: true });
        expect(writer.data().people?.[0]).toEqual(frozen.prepared.effect.person.after);
        const cold = await open(persistedBefore);
        expect(cold.methods.validatePreparedPersonDelete(frozen)).toMatchObject({ ok: true });
        expect(await cold.methods.commitPreparedPersonDelete(frozen)).toMatchObject({ ok: true });
        const saved = structuredClone(cold.data());
        const replay = await open(saved);
        const count = replay.saves();
        expect(await replay.methods.commitPreparedPersonDelete(frozen)).toMatchObject({ ok: true });
        expect(replay.saves()).toBe(count);
        for (const changed of [{ ...frozen.prepared.effect.person.after, name: 'Renamed', rev: 7 },
            { ...frozen.prepared.effect.person.after, deletedAt: '2026-09-30T15:00:00.000Z', updatedAt: '2026-09-30T15:00:00.000Z', rev: 7 },
            { ...frozen.prepared.effect.person.after, deletedAt: undefined, rev: 7 }]) {
            const intervened = await open({ ...saved, people: [changed] });
            const before = intervened.saves();
            expect(await intervened.methods.commitPreparedPersonDelete(frozen)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(intervened.saves()).toBe(before);
            expect(intervened.data().people).toEqual([changed]);
        }
    }, 20_000);

    it('pure cold validator rejects forged effects, scope, result, request and device metadata before writes', async () => {
        const { methods, saves } = await open();
        const frozen = freeze(methods);
        for (const corrupt of [
            (item: typeof frozen) => { item.prepared.effect.person.after.name = 'Forged'; },
            (item: typeof frozen) => { item.prepared.effect.person.after.note = 'Forged'; },
            (item: typeof frozen) => { item.prepared.effect.person.after.referenceLink = 'forged://link'; },
            (item: typeof frozen) => { item.prepared.effect.person.after.rev = 8; },
            (item: typeof frozen) => { item.prepared.effect.person.after.deletedAt = '2026-09-30T15:00:00.000Z'; },
            (item: typeof frozen) => { item.prepared.effect.person.before.note = 'Forged'; },
            (item: typeof frozen) => { item.prepared.scope.person.name = 'Forged'; },
            (item: typeof frozen) => { item.prepared.result.personId = 'wrong'; },
            (item: typeof frozen) => { item.prepared.updateAt = 'legacy stamp'; },
            (item: typeof frozen) => { item.prepared.deviceIdToInitialize = requestId; },
            (item: typeof frozen) => { Object.assign(item.prepared.effect, { tasks: [] }); },
            (item: typeof frozen) => { Object.assign(item.request, { extra: true }); },
        ]) {
            const forged = structuredClone(frozen);
            corrupt(forged);
            expect(methods.validatePreparedPersonDelete(forged)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(await methods.commitPreparedPersonDelete(forged)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        expect(saves()).toBe(0);
    });

    it('rejects noncanonical fields, UUIDs, unknown keys/prototypes, nonfinite and oversized UTF-8 input', async () => {
        const { methods, saves } = await open();
        for (const input of [request(person(), { requestId: 'INVALID' }), request(person(), { personId: 'wrong' }),
            request({ ...person(), note: null } as unknown as Person), request(person({ deletedAt: now })),
            request(person({ rev: Number.NaN })), request(person({ revBy: '' })), request(person({ createdAt: '  ' })),
            request({ ...person(), extra: true } as Person), request(person({ note: '漢'.repeat(700_000) })),
            { ...request(), extra: true }, Object.assign(Object.create({ inherited: true }), request())]) {
            expect(methods.preparePersonDelete(input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(methods.probePersonDeleteOutcome(input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        const oversized = person({ note: '漢'.repeat(180_000) });
        useTaskStore.setState({ _allPeople: [oversized] });
        expect(methods.preparePersonDelete(request(oversized))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        for (const input of [{ personId: '' }, { personId: 'x'.repeat(501) }, { personId: person().id, extra: true }]) {
            expect(methods.getPersonDeleteOptions(input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        }
        expect(saves()).toBe(0);
    });
});
