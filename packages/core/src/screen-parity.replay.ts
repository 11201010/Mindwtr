/**
 * Test support only (imported by the Mind Sweep, saved search and Focus checklist
 * tests; not exported). Loads a frozen React Native screen fixture, seeds the store
 * as the mobile harness does, records the store calls the harness records, and opens
 * a native host over that store.
 */
import { readFileSync } from 'node:fs';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppSettings, Area, Project, Task } from './types';

export const loadScreenFixture = <T,>(name: string): T => JSON.parse(
    readFileSync(new URL(`./${name}-parity.fixtures.json`, import.meta.url), 'utf8'),
) as T;

export const normalize = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, entry) => (
    entry === undefined ? '<undefined>' : entry
)));

export const value = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};

let requestCount = 0;
/** A fresh request UUID. */
export const requestId = () => `00000000-0000-4000-8000-${String(++requestCount).padStart(12, '0')}`;

type StoreFn = (...args: unknown[]) => Promise<unknown>;
const realActions = new Map<string, StoreFn>();

/**
 * Seeds the store with `data` through a storage adapter (`saveData` can fail a save),
 * then opens a native host over it. Each store action named in `record` is logged to
 * `log` as [name, ...its first `record[name]` arguments] (all of them when null),
 * after `intercept` had its say: an intercept that returns a promise answers the call
 * instead of the store.
 */
export async function openScreenHost(input: {
    data: { tasks?: Task[]; projects?: Project[]; areas?: Area[]; settings?: AppSettings };
    record: Record<string, number | null>;
    log: unknown[][];
    saveData?: (data: unknown) => Promise<void>;
    intercept?: (name: string, args: unknown[]) => Promise<unknown> | undefined;
}) {
    await flushPendingSave();
    resetForTests();
    const initial = useTaskStore.getState() as unknown as Record<string, StoreFn>;
    for (const name of Object.keys(input.record)) if (!realActions.has(name)) realActions.set(name, initial[name]);
    let stored = JSON.parse(JSON.stringify({
        tasks: input.data.tasks ?? [], projects: input.data.projects ?? [], sections: [], areas: input.data.areas ?? [], people: [],
        settings: input.data.settings ?? {},
    }));
    setStorageAdapter({
        getData: async () => JSON.parse(JSON.stringify(stored)),
        saveData: async (next) => {
            await input.saveData?.(next);
            stored = JSON.parse(JSON.stringify(next));
        },
    });
    useTaskStore.setState({
        ...Object.fromEntries(Object.keys(input.record).map((name) => [name, realActions.get(name)])),
        _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
    } as never);
    const host = createNativeHostContract();
    value(await host.setLanguage({ storedLanguage: 'en', systemLocale: null }));
    value(await host.activate({ writeSafetyReady: true }));
    useTaskStore.setState(Object.fromEntries(Object.entries(input.record).map(([name, count]) => [name, async (...args: unknown[]) => {
        input.log.push([name, ...(normalize(count === null ? args : args.slice(0, count)) as unknown[])]);
        const answer = input.intercept?.(name, args);
        return answer ?? realActions.get(name)!(...args);
    }])) as never);
    return host;
}
export type ScreenHost = Awaited<ReturnType<typeof openScreenHost>>;

/** A new host over the same store and storage, as after a restart: it holds no request receipts. */
export async function restartScreenHost() {
    await flushPendingSave();
    const host = createNativeHostContract();
    value(await host.setLanguage({ storedLanguage: 'en', systemLocale: null }));
    value(await host.activate({ writeSafetyReady: true }));
    return host;
}
