import { afterEach, describe, expect, it } from 'vitest';
import { createNativeHostContract } from './native-host-contract';
import type { AppLockRequest } from './native-host-contract-app-lock';
import { resetNativeRequestReceipts } from './native-request-receipts';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppData, Task } from './types';

const ID = '00000000-0000-4000-8000-000000000102';
const AT = '2026-09-01T00:00:00.000Z';
const rawTask: Task = { id: 'raw', title: 'Raw', status: 'done', tags: [], contexts: [],
    focusOrder: 9, deletedAt: AT, createdAt: AT, updatedAt: AT, rev: 7 };
const initial = (): AppData => ({ tasks: [rawTask], projects: [], sections: [], areas: [], people: [],
    settings: { deviceId: 'local-device', security: { sibling: 'preserve' },
        syncPreferencesUpdatedAt: { language: AT }, calendarSystem: 'gregorian' } as AppData['settings'] });

async function open(start: AppData, fail?: () => boolean) {
    await flushPendingSave(); resetForTests(); resetNativeRequestReceipts();
    let data = structuredClone(start);
    let saves = 0;
    const adapter = { getData: async () => structuredClone(data), saveData: async (next: AppData) => {
        if (fail?.()) throw new Error('disk unavailable');
        data = structuredClone(next); saves += 1;
    } };
    setStorageAdapter(adapter);
    useTaskStore.setState({ _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, lastDataChangeAt: 0 } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true }); await flushPendingSave(); saves = 0;
    data = structuredClone(start);
    const host = createNativeHostContract();
    expect(await host.activate({ writeSafetyReady: true })).toMatchObject({ ok: true });
    await flushPendingSave(); data = structuredClone(start); saves = 0;
    return { host, data: () => data, saves: () => saves,
        changeSaved: (fn: (value: AppData) => AppData) => { data = fn(data); },
        reopen: async () => open(data, fail) };
}

async function plan(env: Awaited<ReturnType<typeof open>>, value: boolean, requestId = ID) {
    const options = await env.host.getAppLockOptions({});
    if (!options.ok) throw new Error(JSON.stringify(options));
    const request: AppLockRequest = { requestId, value, expected: options.value.expected };
    const preparation = await env.host.prepareAppLock(request);
    if (!preparation.ok || preparation.value.kind !== 'prepared') throw new Error(JSON.stringify(preparation));
    return { options: options.value, request, prepared: preparation.value.prepared,
        envelope: { request, prepared: preparation.value.prepared } };
}

afterEach(async () => { await flushPendingSave(); resetForTests(); resetNativeRequestReceipts(); });

describe('native App lock', () => {
    it('offers the shared row and a raw absent/empty/explicit witness without a sync stamp', async () => {
        const absent = initial(); delete absent.settings.security;
        const env = await open(absent);
        const options = await env.host.getAppLockOptions({});
        expect(options).toMatchObject({ ok: true, value: { expected: { groupPresent: false, present: false, value: null },
            value: false, row: { value: false, edit: { type: 'appLock', value: true } } } });
        expect(await env.host.prepareAppLock({ requestId: ID, value: false,
            expected: { groupPresent: false, present: false, value: null } }))
            .toMatchObject({ ok: true, value: { kind: 'prepared' } });
        const empty = await open(initial());
        expect(await empty.host.getAppLockOptions({})).toMatchObject({ ok: true,
            value: { expected: { groupPresent: true, present: false, value: null } } });
        const explicit = initial(); explicit.settings.security = { mobileAppLockEnabled: false };
        const same = await open(explicit);
        expect(await same.host.prepareAppLock({ requestId: ID, value: false,
            expected: { groupPresent: true, present: true, value: false } }))
            .toEqual({ ok: true, value: { kind: 'noop', result: { changed: false, value: false } } });
        expect(same.saves()).toBe(0);
    });

    it('writes only the local flag and preserves raw rows, siblings, timestamps and no deviceId change', async () => {
        const env = await open(initial());
        const { request, envelope } = await plan(env, true);
        expect(env.host.validatePreparedAppLock(envelope)).toEqual({ ok: true, value: { changed: true, value: true } });
        expect(await env.host.commitPreparedAppLock(envelope)).toEqual({ ok: true, value: { changed: true, value: true } });
        expect(env.data().tasks).toEqual(initial().tasks);
        expect(env.data().settings.security).toEqual({ sibling: 'preserve', mobileAppLockEnabled: true });
        expect(env.data().settings.syncPreferencesUpdatedAt).toEqual(initial().settings.syncPreferencesUpdatedAt);
        expect(env.data().settings.deviceId).toBe('local-device');
        expect(env.saves()).toBe(1);
        expect(env.host.probeAppLockOutcome(request)).toEqual({ ok: true, value: { changed: true, value: true } });
        expect(await env.host.commitPreparedAppLock(envelope)).toEqual({ ok: true, value: { changed: true, value: true } });
        expect(env.saves()).toBe(1);
        const cold = await env.reopen();
        expect(cold.host.probeAppLockOutcome(request)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(await cold.host.commitPreparedAppLock(envelope)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(cold.saves()).toBe(0);
    });

    it('refuses malformed saved group and flag without defaulting off or blocking other General options', async () => {
        for (const bad of [null, 'yes', [], { mobileAppLockEnabled: 'true' }]) {
            const data = initial(); data.settings.security = bad as never;
            const env = await open(data);
            expect(await env.host.getAppLockOptions({})).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(await env.host.getGeneralPreferenceOptions({})).toMatchObject({ ok: true });
        }
    });

    it('refuses a changed opening witness and never grants authorization through pure Validate', async () => {
        const env = await open(initial());
        const { request, envelope } = await plan(env, true);
        const wrong = { ...request, requestId: '00000000-0000-4000-8000-000000000103' };
        const forged = { request: wrong, prepared: { version: 1, request: wrong } };
        expect(env.host.validatePreparedAppLock(forged)).toEqual({ ok: true, value: { changed: true, value: true } });
        expect(await env.host.commitPreparedAppLock(forged)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        env.changeSaved((data) => ({ ...data, settings: { ...data.settings,
            security: { ...data.settings.security, mobileAppLockEnabled: false } } }));
        expect(await env.host.commitPreparedAppLock(envelope)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
        expect(env.data().settings.security?.mobileAppLockEnabled).toBe(false);
        expect(env.saves()).toBe(0);
    });

    it('rejects mismatched UUID payloads and malformed witnesses before a write', async () => {
        const env = await open(initial());
        const { request, envelope } = await plan(env, true);
        expect(await env.host.prepareAppLock({ ...request, value: false })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(env.host.validatePreparedAppLock({ request, prepared: { version: 1, request: { ...request, value: false } } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await env.host.prepareAppLock({ ...request, expected: { groupPresent: false, present: true, value: true } }))
            .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await env.host.commitPreparedAppLock(envelope)).toMatchObject({ ok: true });
        expect(env.host.probeAppLockOutcome({ ...request, value: false })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });
});
