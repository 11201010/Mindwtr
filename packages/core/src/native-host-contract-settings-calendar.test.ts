import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DeviceCalendar } from './external-calendar-feeds';
import { loadTranslations } from './i18n/i18n-loader';
import { createNativeHostContract, type NativeHostResult } from './native-host-contract';
import type { NativeCalendarHost, NativeCalendarSettings, NativeCalendarSettingsEdit, NativeCalendarToast } from './native-host-contract-settings-calendar';
import { loadNativeRequestReceipts, NATIVE_UNJOURNALED_COMMANDS, NativeReceiptSqliteAdapter, resetNativeRequestReceipts } from './native-request-receipts';
import { openScratchSqlite } from './screen-parity.replay';
import { SqliteAdapter } from './sqlite-adapter';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from './store';
import type { AppSettings, Area } from './types';
import { generateUUID } from './uuid';

/**
 * The frozen React Native Calendar settings screen
 * (calendar-settings-parity.fixtures.json, captured by
 * apps/mobile/components/settings/calendar-settings-screen.parity.test.tsx),
 * replayed through the native host contract. The replay plays the native screen:
 * it keeps the screen's own state (the open cards, the open Area choice, the
 * drafts, the confirmation), reads the view, sends each control's edit, and lays
 * the view out in the order React Native draws it. The device is the harness's:
 * the same calendars, feeds, storage and recorded writes.
 */
type Device = {
    language?: string;
    storage?: Record<string, string>;
    permission?: string;
    requestAnswer?: string;
    calendars?: string[];
    failEvents?: boolean;
    picks?: ({ name: string; uri: string } | null)[];
};
type Scenario = { name: string; settings: string; device: Device; actions: [string, ...unknown[]][] };
type Fixture = {
    now: string;
    timeZone: string;
    areas: Area[];
    settings: Record<string, AppSettings>;
    calendars: Record<string, DeviceCalendar>;
    events: Record<string, unknown[]>;
    feeds: Record<string, string>;
    keys: Record<string, string>;
    scenarios: Scenario[];
    observations: Record<string, Record<string, unknown>[]>;
};
type Host = ReturnType<typeof createNativeHostContract>;

const fixture: Fixture = JSON.parse(readFileSync(new URL('./calendar-settings-parity.fixtures.json', import.meta.url), 'utf8'));

const value = <T,>(result: NativeHostResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
const normalize = (entry: unknown): unknown => JSON.parse(JSON.stringify(entry, (_key, item) => (item === undefined ? '<undefined>' : item)));

// ---------------------------------------------------------------------------
// The store: the fixture's data, with settings writes recorded as the harness records them.

const writes: unknown[][] = [];
let realUpdateSettings: ((...args: unknown[]) => Promise<unknown>) | null = null;

/** Makes the store's saves fail while true. */
let failSaves = false;

async function seed(settings: AppSettings) {
    await flushPendingSave();
    resetForTests();
    realUpdateSettings ??= useTaskStore.getState().updateSettings as never;
    const real = realUpdateSettings!;
    let data = JSON.parse(JSON.stringify({ tasks: [], projects: [], sections: [], areas: fixture.areas, people: [], settings }));
    setStorageAdapter({
        getData: async () => data,
        saveData: async (next) => {
            if (failSaves) throw new Error('disk full');
            data = JSON.parse(JSON.stringify(next));
        },
    });
    useTaskStore.setState({
        updateSettings: real,
        _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
        settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
    } as never);
    await useTaskStore.getState().fetchData({ throwOnError: true });
    await flushPendingSave();
    useTaskStore.setState({
        updateSettings: async (...args: unknown[]) => {
            writes.push(['updateSettings', ...(normalize(args) as unknown[])]);
            return real(...args);
        },
    } as never);
    writes.length = 0;
}

// ---------------------------------------------------------------------------
// The device: the harness's expo-calendar, AsyncStorage, fetch and picker.

function phone(device: Device) {
    const state = {
        storage: new Map(Object.entries(device.storage ?? {})),
        permission: device.permission ?? 'granted',
        calendars: (device.calendars ?? []).map((key) => ({ ...fixture.calendars[key], source: fixture.calendars[key].source ? { ...fixture.calendars[key].source } : undefined })) as DeviceCalendar[],
        picks: [...(device.picks ?? [])],
        nextCalendar: 0,
        calendarWrites: [] as unknown[][],
        prompts: 0,
    };
    const read = async (url: string) => {
        const feed = fixture.feeds[url];
        if (typeof feed !== 'string') throw new Error(`Unreadable ${url}`);
        return feed;
    };
    const host: NativeCalendarHost = {
        platform: { os: 'android' },
        storage: {
            getItem: async (key) => state.storage.get(key) ?? null,
            setItem: async (key, entry) => { state.storage.set(key, entry); },
            removeItem: async (key) => { state.storage.delete(key); },
        },
        fetch: (async (url: string) => {
            const entry = fixture.feeds[String(url)];
            if (entry === undefined) return { ok: false, status: 404, text: async () => '' };
            return { ok: true, status: 200, text: async () => entry };
        }) as unknown as typeof fetch,
        readLocalFile: read,
        calendars: {
            getPermissions: async () => ({ status: state.permission }),
            requestPermissions: async () => {
                state.prompts += 1;
                state.permission = device.requestAnswer ?? 'granted';
                return { status: state.permission };
            },
            getCalendars: async () => state.calendars.map((calendar) => ({ ...calendar })),
            getEvents: async (ids) => {
                if (device.failEvents) throw new Error('Calendar provider unavailable');
                return ids.flatMap((id) => (fixture.events[id] ?? []) as never[]);
            },
            getSources: async () => [],
            createCalendar: async (details) => {
                state.nextCalendar += 1;
                const id = `created-${state.nextCalendar}`;
                state.calendarWrites.push(['createCalendar', details]);
                state.calendars.push({ ...(details as DeviceCalendar), id, allowsModifications: true });
                return id;
            },
            updateCalendar: async (id, details) => {
                state.calendarWrites.push(['updateCalendar', id, details]);
                return id;
            },
            deleteCalendar: async (id) => {
                state.calendarWrites.push(['deleteCalendar', id]);
                const index = state.calendars.findIndex((calendar) => calendar.id === id);
                if (index >= 0) state.calendars.splice(index, 1);
            },
            createEvent: async (calendarId, details) => {
                state.calendarWrites.push(['createEvent', calendarId, details.title]);
                return 'event-1';
            },
            updateEvent: async (id) => { state.calendarWrites.push(['updateEvent', id]); },
            deleteEvent: async (id) => { state.calendarWrites.push(['deleteEvent', id]); },
        },
        syncEntries: {
            ensureReady: async () => undefined,
            get: async () => null,
            upsert: async () => undefined,
            delete: async () => undefined,
            getAll: async () => [],
        },
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    };
    const snapshot = () => Object.fromEntries(Object.values(fixture.keys).filter((key) => state.storage.has(key)).map((key) => [key, state.storage.get(key)]));
    return { host, state, snapshot };
}

async function openHost(host: NativeCalendarHost, language = 'en'): Promise<Host> {
    const contract = createNativeHostContract({ calendar: host });
    value(await contract.setLanguage({ storedLanguage: language, systemLocale: 'en-US' }));
    expect(await contract.activate({ writeSafetyReady: true })).toEqual({ ok: true, value: null });
    return contract;
}

const settle = async () => {
    for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPendingSave();
};

// ---------------------------------------------------------------------------
// The native screen.

type Control = { label: string; selected: boolean | null; disabled: boolean; press: () => Promise<void> };

let feedIds = 0;
const nextFeedId = () => `00000000-0000-4000-8000-${String(++feedIds).padStart(12, '0')}`;

function calendarDriver(contract: Host, device: ReturnType<typeof phone>, opening: NativeCalendarSettings & { toasts: NativeCalendarToast[] }, picks: Device['picks']) {
    const log = { toasts: [] as unknown[][], writes: 0, calendarWrites: 0, prompts: 0 };
    const screen = {
        pushOpen: false,
        deviceOpen: false,
        expanded: null as string | null,
        name: '',
        url: '',
        alert: null as null | { edit: NativeCalendarSettingsEdit; title: string; message: string; cancel: string; confirm: string },
    };
    const pending = [...(picks ?? [])];
    const addToasts = (toasts: NativeCalendarToast[]) => {
        for (const toast of toasts) log.toasts.push([toast.title, toast.message, toast.tone, toast.durationMs]);
    };
    addToasts(opening.toasts);
    let view: NativeCalendarSettings = opening;
    const refresh = () => { view = value(contract.getCalendarSettings({ draft: { name: screen.name, url: screen.url } })); };

    const send = async (edit: NativeCalendarSettingsEdit, requestId = generateUUID()) => {
        const answer = value(await contract.setCalendarSetting({ requestId, edit }));
        addToasts(answer.toasts);
        if (answer.open === 'push') screen.pushOpen = true;
        if (answer.open === 'device') screen.deviceOpen = true;
        if (answer.clearDraft) {
            screen.name = '';
            screen.url = '';
        }
    };
    const run = async (command: Promise<NativeHostResult<{ toasts: NativeCalendarToast[] }>>) => { addToasts(value(await command).toasts); };
    /** A new subscription: its own command, never journaled (its URL may carry a password). */
    const add = async (input: Parameters<Host['addCalendarFeed']>[0]) => {
        const answer = value(await contract.addCalendarFeed(input));
        addToasts(answer.toasts);
        if (answer.clearDraft) {
            screen.name = '';
            screen.url = '';
        }
    };

    /** React Native's layout, from the view and the screen state. */
    const layout = () => {
        const texts: string[] = [view.title];
        const controls: Control[] = [];
        const switches: { value: boolean; flip: () => Promise<void> }[] = [];
        const inputs: [string, string, (text: string) => void][] = [];
        let busy = 0;
        const control = (label: string, selected: boolean | null, disabled: boolean, press: () => Promise<void> | void) => {
            controls.push({ label, selected, disabled, press: async () => { await press(); } });
        };
        const header = (card: { title: string; description: string; enabled: boolean; toggle: NativeCalendarSettingsEdit }, open: boolean, toggleOpen: () => void) => {
            const chevron = open ? '▾' : '▸';
            texts.push(card.title, card.description, chevron);
            control([card.title, card.description, chevron].join('|'), null, false, toggleOpen);
            switches.push({ value: card.enabled, flip: () => send(card.toggle) });
        };
        const areas = (choice: NonNullable<NativeCalendarSettings['feeds']['items'][number]['areas']> | null) => {
            if (!choice) return;
            texts.push(choice.label);
            control(choice.label, null, false, () => { screen.expanded = screen.expanded === choice.key ? null : choice.key; });
            if (screen.expanded !== choice.key) return;
            for (const option of choice.options) {
                texts.push(option.label);
                control(option.label, option.checked, false, () => send(option.edit));
            }
        };

        header(view.push, screen.pushOpen, () => { screen.pushOpen = !screen.pushOpen; });
        if (screen.pushOpen && view.push.denied) texts.push(view.push.denied);
        const target = view.push.target;
        if (screen.pushOpen && target) {
            texts.push(target.title, target.description);
            if (target.localHint) texts.push(target.localHint);
            if (target.sharedAccountHint) texts.push(target.sharedAccountHint);
            if (target.loading) busy += 1;
            else {
                for (const option of target.options) {
                    texts.push(option.name, option.description);
                    control(option.accessibilityLabel, option.selected, false, () => send(option.edit));
                }
            }
            if (target.colors) {
                texts.push(target.colors.title, target.colors.description);
                for (const option of target.colors.options) control(option.accessibilityLabel, option.selected, false, () => send(option.edit));
            }
            texts.push(target.refresh.label, target.refresh.description);
            control(target.refresh.label, null, false, () => run(contract.refreshCalendarPushTargets()));
            texts.push(target.delete.label, target.delete.description);
            if (target.delete.busy) busy += 1;
            control(target.delete.label, null, target.delete.busy, () => {
                screen.alert = { edit: target.delete.edit, ...target.delete.confirm };
            });
        }

        header(view.device, screen.deviceOpen, () => { screen.deviceOpen = !screen.deviceOpen; });
        if (screen.deviceOpen && view.device.enabled) {
            if (view.device.access) {
                texts.push(view.device.access.text, view.device.access.grantLabel);
                control(view.device.access.grantLabel, null, false, () => run(contract.grantDeviceCalendarAccess()));
            } else if (view.device.loading) {
                busy += 1;
            } else if (view.device.empty) {
                texts.push(view.device.empty);
            } else {
                for (const calendar of view.device.calendars) {
                    texts.push(calendar.name, calendar.subtitle);
                    areas(calendar.areas);
                    switches.push({ value: calendar.selected, flip: async () => { if (calendar.edit) await send(calendar.edit); } });
                }
            }
        }

        const feeds = view.feeds;
        texts.push(feeds.title, feeds.description, feeds.guide.title);
        control(`${feeds.guide.title}. ${feeds.guide.description}`, null, false, () => undefined);
        texts.push(feeds.name.label);
        inputs.push([feeds.name.placeholder, screen.name, (text) => { screen.name = text; }]);
        texts.push(feeds.url.label);
        inputs.push([feeds.url.placeholder, screen.url, (text) => { screen.url = text; }]);
        texts.push(feeds.add.label);
        control(feeds.add.label, null, !feeds.add.enabled, () => add({ requestId: nextFeedId(), name: screen.name, url: screen.url, revision: feeds.revision }));
        texts.push(feeds.test.label);
        control(feeds.test.label, null, false, () => run(contract.testCalendarFeeds()));
        texts.push(feeds.chooseFile.label);
        control(feeds.chooseFile.label, null, false, async () => {
            const picked = pending.shift() ?? null;
            if (!picked) return;
            await add({ requestId: nextFeedId(), name: screen.name, fileName: picked.name, uri: picked.uri, revision: feeds.revision });
        });
        if (feeds.listTitle) texts.push(feeds.listTitle);
        for (const item of feeds.items) {
            texts.push(item.name, item.url);
            areas(item.areas);
            for (const color of item.colors) control(color.accessibilityLabel, color.selected, false, async () => { if (color.edit) await send(color.edit); });
            switches.push({ value: item.enabled, flip: () => send(item.toggle) });
            texts.push(item.remove.label);
            control(item.remove.label, null, false, () => send(item.remove.edit));
        }
        return { texts, controls, switches, inputs, busy };
    };

    const matches = (control: Control, label: string) => {
        const text = control.label;
        return text === label || text.split('|')[0] === label || text.startsWith(`${label}: `);
    };

    return {
        observe() {
            const drawn = layout();
            const calendarWrites = device.state.calendarWrites.slice(log.calendarWrites);
            const observation = normalize({
                texts: drawn.texts,
                controls: drawn.controls.map((entry) => [entry.label, entry.selected, entry.disabled]),
                switches: drawn.switches.map((entry) => entry.value),
                inputs: drawn.inputs.map(([placeholder, text]) => [placeholder, text]),
                busy: drawn.busy,
                alert: screen.alert ? [screen.alert.title, screen.alert.message, [[screen.alert.cancel, 'cancel'], [screen.alert.confirm, 'destructive']]] : null,
                storage: device.snapshot(),
                writes: writes.slice(log.writes),
                calendarWrites,
                prompts: device.state.prompts - log.prompts,
                toasts: log.toasts,
            });
            log.writes = writes.length;
            log.calendarWrites = device.state.calendarWrites.length;
            log.prompts = device.state.prompts;
            log.toasts = [];
            return observation;
        },
        async perform(action: [string, ...unknown[]], translate: (key: string) => string) {
            const [kind, target, extra] = action;
            const label = typeof target === 'string'
                ? target.replace(/k:([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)/g, (_match, key: string) => translate(key))
                : '';
            const drawn = layout();
            switch (kind) {
                case 'press': {
                    const found = drawn.controls.filter((entry) => matches(entry, label))[typeof extra === 'number' ? extra : 0];
                    if (!found) throw new Error(`No control ${label}`);
                    if (!found.disabled) await found.press();
                    break;
                }
                case 'switch':
                    await drawn.switches[target as number].flip();
                    break;
                case 'type':
                    drawn.inputs[target as number][2](extra as string);
                    break;
                case 'alert': {
                    const alert = screen.alert;
                    screen.alert = null;
                    if (alert && label === alert.confirm) await send(alert.edit);
                    break;
                }
                default:
                    throw new Error(`Unknown action ${kind}`);
            }
            await settle();
            refresh();
        },
    };
}

/**
 * A contract over the same store and device, as after a restart: no request receipts in
 * memory, and no screen open (the journal replays a write at boot before any screen).
 */
async function restart(device: ReturnType<typeof phone>, open = false) {
    await flushPendingSave();
    const contract = await openHost(device.host);
    if (open) value(await contract.openCalendarSettings());
    return contract;
}

const KEYS = fixture.keys;
const edit = async (contract: Host, change: NativeCalendarSettingsEdit, requestId = generateUUID()) => {
    const answer = await contract.setCalendarSetting({ requestId, edit: change });
    await settle();
    return answer;
};
/** Everything a replay could touch: the synced settings, the device keys, the device calendars. */
const everything = (device: ReturnType<typeof phone>) => normalize({
    settings: useTaskStore.getState().settings.externalCalendars ?? null,
    storage: device.snapshot(),
    calendars: device.state.calendars.map((calendar) => calendar.id),
    calendarWrites: device.state.calendarWrites.length,
    prompts: device.state.prompts,
});

describe('native host contract: Settings › Calendar', () => {
    const originalTz = process.env.TZ;
    let strings: Record<string, Record<string, string>> = {};
    beforeAll(async () => {
        process.env.TZ = fixture.timeZone;
        strings = { en: await loadTranslations('en'), zh: await loadTranslations('zh') };
    });
    afterAll(() => {
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
    });
    afterEach(async () => {
        failSaves = false;
        vi.useRealTimers();
        await flushPendingSave();
        resetForTests();
        vi.restoreAllMocks();
    });
    const freezeClock = () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(fixture.now));
    };

    it.each(fixture.scenarios.map((scenario) => [scenario.name, scenario] as const))(
        'replays the frozen React Native scenario through the contract: %s',
        async (name, scenario) => {
            freezeClock();
            feedIds = 0;
            await seed(fixture.settings[scenario.settings]);
            const device = phone(scenario.device);
            const language = scenario.device.language ?? 'en';
            const translate = (key: string) => strings[language]?.[key] || strings.en?.[key] || key;
            const contract = await openHost(device.host, language);
            const opening = value(await contract.openCalendarSettings());
            await settle();
            const driver = calendarDriver(contract, device, opening, scenario.device.picks);
            const observed = [driver.observe()];
            for (const action of scenario.actions) {
                await driver.perform(action, translate);
                observed.push(driver.observe());
            }
            value(contract.closeCalendarSettings());
            expect(observed).toEqual(fixture.observations[name]);
        },
    );
    describe('a replay after a restart writes nothing wrong', () => {
        const boot = async (device: Device, settings: AppSettings = {}) => {
            freezeClock();
            await seed(settings);
            const handset = phone(device);
            const contract = await openHost(handset.host);
            value(await contract.openCalendarSettings());
            return { handset, contract, view: () => value(contract.getCalendarSettings()) };
        };
        const replay = async (handset: ReturnType<typeof phone>, requestId: string, change: NativeCalendarSettingsEdit) => {
            const restarted = await restart(handset, true);
            const before = everything(handset);
            const answer = await edit(restarted, change, requestId);
            return { answer, before, after: everything(handset) };
        };

        it('push on: the replay prompts for nothing and makes no second Mindwtr calendar', async () => {
            const { handset, contract, view } = await boot({ calendars: ['primary'], permission: 'undetermined' });
            const requestId = generateUUID();
            const change = view().push.toggle;
            expect(value(await edit(contract, change, requestId))).toMatchObject({ changed: true, open: 'push' });
            expect(handset.state.calendarWrites).toHaveLength(1);
            const { answer, before, after } = await replay(handset, requestId, change);
            expect(value(answer)).toMatchObject({ changed: false, toasts: [] });
            expect(after).toEqual(before);
        });

        it('push off: the replay writes nothing', async () => {
            const { handset, contract, view } = await boot({ calendars: ['primary'], storage: { [KEYS.pushEnabled]: '1' } });
            const requestId = generateUUID();
            const change = view().push.toggle;
            expect(value(await edit(contract, change, requestId)).changed).toBe(true);
            const { answer, before, after } = await replay(handset, requestId, change);
            expect(value(answer).changed).toBe(false);
            expect(after).toEqual(before);
        });

        it('the push calendar: a replay after a later choice keeps the later choice', async () => {
            const { handset, contract, view } = await boot({ calendars: ['primary', 'phone'], storage: { [KEYS.pushEnabled]: '1' } });
            const pick = (id: string | null) => view().push.target!.options.find((option) => option.key === (id ?? 'mindwtr-managed'))!.edit;
            const requestId = generateUUID();
            const first = pick('g-primary');
            expect(value(await edit(contract, first, requestId)).changed).toBe(true);
            expect(value(await edit(contract, pick('local-phone'))).changed).toBe(true);
            const { answer, before, after } = await replay(handset, requestId, first);
            expect(answer).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(after).toEqual(before);
            expect(handset.state.storage.get(KEYS.pushTarget)).toBe('local-phone');
        });

        it('the Mindwtr calendar color: the replay does not recreate the calendar, and a later color stays', async () => {
            const { handset, contract, view } = await boot({ calendars: ['primary', 'managed'], storage: { [KEYS.pushEnabled]: '1', [KEYS.pushCalendar]: 'g-mindwtr' } });
            const color = (hex: string) => view().push.target!.colors!.options.find((option) => option.color === hex)!.edit;
            const requestId = generateUUID();
            const green = color('#059669');
            expect(value(await edit(contract, green, requestId)).changed).toBe(true);
            expect(handset.state.calendarWrites.map(([name]) => name)).toEqual(['deleteCalendar', 'createCalendar']);
            const { answer, before, after } = await replay(handset, requestId, green);
            expect(value(answer).changed).toBe(false);
            expect(after).toEqual(before);
            const restarted = await restart(handset, true);
            expect(value(await edit(restarted, value(restarted.getCalendarSettings()).push.target!.colors!.options.find((option) => option.color === '#DB2777')!.edit)).changed).toBe(true);
            const again = await replay(handset, requestId, green);
            expect(again.answer).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(again.after).toEqual(again.before);
        });

        it('Delete Mindwtr calendar: the replay deletes nothing, not even a Mindwtr calendar made since', async () => {
            const { handset, contract, view } = await boot({ calendars: ['primary', 'managed'], storage: { [KEYS.pushEnabled]: '1', [KEYS.pushCalendar]: 'g-mindwtr' } });
            const requestId = generateUUID();
            const change = view().push.target!.delete.edit;
            expect(value(await edit(contract, change, requestId)).changed).toBe(true);
            expect(handset.state.calendars.map((calendar) => calendar.id)).toEqual(['g-primary']);
            const done = await replay(handset, requestId, change);
            expect(value(done.answer).changed).toBe(false);
            expect(done.after).toEqual(done.before);
            // Push on again makes a new Mindwtr calendar; the old request must not delete it.
            const restarted = await restart(handset, true);
            expect(value(await edit(restarted, value(restarted.getCalendarSettings()).push.toggle)).changed).toBe(true);
            expect(handset.state.calendars.map((calendar) => calendar.id)).toEqual(['g-primary', 'created-1']);
            const later = await replay(handset, requestId, change);
            expect(later.answer).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(later.after).toEqual(later.before);
        });

        it('the device calendar choices: a replay after a later change keeps it', async () => {
            const { handset, contract, view } = await boot({ calendars: ['primary', 'phone'], storage: { [KEYS.system]: JSON.stringify({ enabled: true }) } });
            const requestId = generateUUID();
            const first = view().device.calendars[0].edit!;
            expect(value(await edit(contract, first, requestId)).changed).toBe(true);
            const replayed = await replay(handset, requestId, first);
            expect(value(replayed.answer).changed).toBe(false);
            expect(replayed.after).toEqual(replayed.before);
            const restarted = await restart(handset, true);
            expect(value(await edit(restarted, value(restarted.getCalendarSettings()).device.toggle)).changed).toBe(true);
            const later = await replay(handset, requestId, first);
            expect(later.answer).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(later.after).toEqual(later.before);
            expect(JSON.parse(handset.state.storage.get(KEYS.system)!).enabled).toBe(false);
        });

        it.each(['url', 'file'] as const)('a new subscription (%s): a retry finds the subscription it made, and never adds one removed since', async (type) => {
            const { handset, contract, view } = await boot({ calendars: [] });
            const requestId = generateUUID();
            const revision = view().feeds.revision;
            const input = type === 'url'
                ? { requestId, name: 'Team', url: 'https://example.com/team.ics', revision }
                : { requestId, name: '', fileName: 'Plan.ics', uri: 'content://downloads/7', revision };
            const addAgain = async () => {
                const restarted = await restart(handset);
                const before = everything(handset);
                const answer = await restarted.addCalendarFeed(input);
                await settle();
                return { answer, before, after: everything(handset) };
            };
            expect(value(await contract.addCalendarFeed(input)).changed).toBe(true);
            const replayed = await addAgain();
            expect(value(replayed.answer)).toMatchObject({ changed: false, clearDraft: true });
            expect(replayed.after).toEqual(replayed.before);
            expect(useTaskStore.getState().settings.externalCalendars).toEqual([
                type === 'url'
                    ? { id: requestId, name: 'Team', url: 'https://example.com/team.ics', enabled: true }
                    : { id: requestId, name: 'Plan', url: 'content://downloads/7', enabled: true },
            ]);
            const restarted = await restart(handset, true);
            expect(value(await edit(restarted, value(restarted.getCalendarSettings()).feeds.items[0].remove.edit)).changed).toBe(true);
            const removed = await addAgain();
            expect(removed.answer).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(removed.after).toEqual(removed.before);
            expect(useTaskStore.getState().settings.externalCalendars).toEqual([]);
        });

        it.each([
            ['enabled', (item: NativeCalendarSettings['feeds']['items'][number]) => item.toggle, (item: NativeCalendarSettings['feeds']['items'][number]) => item.toggle],
            ['color', (item: NativeCalendarSettings['feeds']['items'][number]) => item.colors[2].edit!, (item: NativeCalendarSettings['feeds']['items'][number]) => item.colors[3].edit!],
            ['areaIds', (item: NativeCalendarSettings['feeds']['items'][number]) => item.areas!.options[0].edit, (item: NativeCalendarSettings['feeds']['items'][number]) => item.areas!.options[1].edit],
        ] as const)('a subscription\'s %s: a replay after a later change keeps it', async (_field, first, later) => {
            const { handset, contract, view } = await boot({ calendars: [] }, fixture.settings.synced);
            const requestId = generateUUID();
            const change = first(view().feeds.items[0]);
            expect(value(await edit(contract, change, requestId)).changed).toBe(true);
            const same = await replay(handset, requestId, change);
            expect(value(same.answer).changed).toBe(false);
            expect(same.after).toEqual(same.before);
            const restarted = await restart(handset, true);
            expect(value(await edit(restarted, later(value(restarted.getCalendarSettings()).feeds.items[0]))).changed).toBe(true);
            const stale = await replay(handset, requestId, change);
            expect(stale.answer).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(stale.after).toEqual(stale.before);
        });

        it('removing a subscription: the replay finds it gone, and a stale view removes nothing', async () => {
            const { handset, contract, view } = await boot({ calendars: [] }, fixture.settings.synced);
            const requestId = generateUUID();
            const change = view().feeds.items[0].remove.edit;
            expect(value(await edit(contract, change, requestId)).changed).toBe(true);
            const replayed = await replay(handset, requestId, change);
            expect(value(replayed.answer).changed).toBe(false);
            expect(replayed.after).toEqual(replayed.before);
            expect(useTaskStore.getState().settings.externalCalendars?.map((feed) => feed.id)).toEqual(['feed-b']);
            // A view from before a later edit (here: synced from another device) removes nothing.
            const staleRemove = value(contract.getCalendarSettings()).feeds.items[0].remove.edit;
            await useTaskStore.getState().updateSettings({ externalCalendars: [{ ...fixture.settings.synced.externalCalendars![1], name: 'Renamed' }] });
            expect(await edit(contract, staleRemove)).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            expect(useTaskStore.getState().settings.externalCalendars?.map((feed) => feed.name)).toEqual(['Renamed']);
        });

        it('an exact retry after a failed save only saves', async () => {
            freezeClock();
            await seed(fixture.settings.synced);
            const handset = phone({ calendars: [] });
            const contract = await openHost(handset.host);
            value(await contract.openCalendarSettings());
            const change = value(contract.getCalendarSettings()).feeds.items[1].toggle;
            const requestId = generateUUID();
            failSaves = true;
            const first = await contract.setCalendarSetting({ requestId, edit: change });
            failSaves = false;
            expect(first).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } });
            expect(writes).toHaveLength(1);
            expect(value(await contract.setCalendarSetting({ requestId, edit: change })).changed).toBe(true);
            expect(writes).toHaveLength(1);
            expect(useTaskStore.getState().settings.externalCalendars?.[1].enabled).toBe(true);
        });
    });

    describe('a subscription URL never reaches the disk', () => {
        afterEach(() => { resetNativeRequestReceipts(); });

        it('addCalendarFeed keeps no durable receipt and no journal entry, and setCalendarSetting takes no URL', async () => {
            freezeClock();
            expect(NATIVE_UNJOURNALED_COMMANDS.has('calendarFeedAdd')).toBe(true);
            const dir = mkdtempSync(join(tmpdir(), 'mindwtr-calendar-receipts-'));
            const { client, close } = openScratchSqlite(join(dir, 'mindwtr.db'));
            try {
                await new SqliteAdapter(client).saveData({ tasks: [], projects: [], sections: [], areas: fixture.areas, people: [], settings: fixture.settings.synced });
                resetForTests();
                useTaskStore.setState({
                    _allTasks: [], _allProjects: [], _allSections: [], _allAreas: [], _allPeople: [],
                    settings: {}, error: null, persistenceFailure: null, isLoading: false, editLockCount: 0, lastDataChangeAt: 0,
                } as never);
                setStorageAdapter(new NativeReceiptSqliteAdapter(client));
                await loadNativeRequestReceipts(client);
                const handset = phone({ calendars: [] });
                const contract = createNativeHostContract({ calendar: handset.host, replayTokens: 'required' });
                value(await contract.setLanguage({ storedLanguage: 'en', systemLocale: null }));
                value(await contract.activate({ writeSafetyReady: true }));
                const view = value(await contract.openCalendarSettings());
                const url = 'https://alex:s3cret@calendar.example.com/private.ics';
                const added = generateUUID();
                expect(value(await contract.addCalendarFeed({ requestId: added, name: 'Private', url, revision: view.feeds.revision })).changed).toBe(true);
                const toggled = generateUUID();
                expect(value(await contract.setCalendarSetting({ requestId: toggled, edit: value(contract.getCalendarSettings()).feeds.items[0].toggle })).changed).toBe(true);
                await flushPendingSave();
                const receipts = await client.all<{ request_id: string; method: string; reply: string }>('SELECT request_id, method, reply FROM native_request_receipts');
                expect(receipts.map((row) => row.request_id)).toEqual([toggled]);
                expect(JSON.stringify(receipts)).not.toContain('s3cret');
                // A URL is no setCalendarSetting edit.
                for (const edit of [
                    { type: 'addFeed', name: 'Private', url, revision: view.feeds.revision },
                    { type: 'addFile', name: '', fileName: 'x.ics', uri: 'content://x', revision: view.feeds.revision },
                ]) {
                    expect(await contract.setCalendarSetting({ requestId: generateUUID(), edit: edit as never })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
                }
            } finally {
                close();
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    describe('without calendar push bound (until the push pass)', () => {
        it('shows the stored push options and refuses the push commands', async () => {
            freezeClock();
            await seed({});
            const handset = phone({ calendars: ['primary', 'managed'], storage: { [KEYS.pushEnabled]: '1', [KEYS.pushCalendar]: 'g-mindwtr' } });
            const { syncEntries: _entries, ...readOnly } = handset.host;
            const contract = await openHost({ ...readOnly, calendars: { ...handset.host.calendars, createCalendar: undefined } });
            const view = value(await contract.openCalendarSettings());
            expect(view.push.enabled).toBe(true);
            expect(view.push.target?.options.map((option) => option.name)).toEqual(['Mindwtr calendar', 'alex@gmail.com']);
            for (const change of [view.push.target!.colors!.options[1].edit, view.push.target!.delete.edit]) {
                expect(await edit(contract, change)).toMatchObject({ ok: false, error: { code: 'ACTION_FAILED' } });
            }
            // Off needs no calendar writes.
            expect(value(await edit(contract, view.push.toggle)).changed).toBe(true);
            expect(await edit(contract, value(contract.getCalendarSettings()).push.toggle)).toMatchObject({ ok: false, error: { code: 'ACTION_FAILED' } });
            expect(handset.state.calendarWrites).toEqual([]);
        });
    });

    describe('loadExternalCalendarFeed', () => {
        const range = { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' };
        it('answers the merged calendars, joins a load of the same range, and lets a newer range replace a running one', async () => {
            await seed({});
            // The fetch reads the device copy of the subscriptions (sync and the settings screen keep it).
            const handset = phone({ calendars: ['primary'], storage: {
                [KEYS.feeds]: JSON.stringify(fixture.settings.synced.externalCalendars),
                [KEYS.system]: JSON.stringify({ enabled: true }),
            } });
            let fetches = 0;
            let release: (() => void) | null = null;
            const fetchFeed = handset.host.fetch;
            handset.host.fetch = (async (...args: Parameters<typeof fetch>) => {
                fetches += 1;
                if (fetches === 1) {
                    await new Promise<void>((resolve, reject) => {
                        release = resolve;
                        args[1]?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                    });
                }
                return fetchFeed(...args);
            }) as typeof fetch;
            const contract = await openHost(handset.host);
            const first = contract.loadExternalCalendarFeed({ slot: 'calendar', ...range });
            const joined = contract.loadExternalCalendarFeed({ slot: 'calendar', ...range });
            expect(joined).toBe(first);
            await settle();
            const replacing = contract.loadExternalCalendarFeed({ slot: 'calendar', start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' });
            expect(await first).toMatchObject({ ok: false, error: { code: 'STALE_REVISION' } });
            (release as (() => void) | null)?.();
            const later = value(await replacing);
            expect(later.status).toBe('ready');
            const ready = value(await contract.loadExternalCalendarFeed({ slot: 'dailyReview', ...range, timeoutMs: 15_000 }));
            expect(ready).toMatchObject({ status: 'ready' });
            if (ready.status !== 'ready') throw new Error('not ready');
            expect(ready.calendars.map((calendar) => calendar.id)).toEqual(['feed-a', 'feed-b', 'system:g-primary']);
            expect(ready.events.map((event) => event.title)).toEqual(['Planning', 'Stand-up', 'Review', 'Offsite']);
        });

        it('answers a refresh within a second from the last load, and loads again after it', async () => {
            await seed({});
            const handset = phone({ calendars: [], storage: { [KEYS.feeds]: JSON.stringify(fixture.settings.synced.externalCalendars) } });
            let fetches = 0;
            const fetchFeed = handset.host.fetch;
            handset.host.fetch = (async (...args: Parameters<typeof fetch>) => {
                fetches += 1;
                return fetchFeed(...args);
            }) as typeof fetch;
            const contract = await openHost(handset.host);
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date(fixture.now));
            value(await contract.loadExternalCalendarFeed({ slot: 'calendar', ...range }));
            value(await contract.loadExternalCalendarFeed({ slot: 'calendar', ...range, refresh: true }));
            expect(fetches).toBe(2);
            vi.setSystemTime(new Date(Date.parse(fixture.now) + 999));
            expect(value(await contract.loadExternalCalendarFeed({ slot: 'calendar', ...range, refresh: true }))).toMatchObject({ status: 'ready' });
            expect(fetches).toBe(2);
            vi.setSystemTime(new Date(Date.parse(fixture.now) + 1_000));
            value(await contract.loadExternalCalendarFeed({ slot: 'calendar', ...range, refresh: true }));
            expect(fetches).toBe(3);
        });

        it('answers an error feed when the device calendars fail, and refuses bad input', async () => {
            await seed({});
            const handset = phone({ calendars: ['primary'], failEvents: true, storage: { [KEYS.system]: JSON.stringify({ enabled: true }) } });
            const contract = await openHost(handset.host);
            expect(value(await contract.loadExternalCalendarFeed({ slot: 'weeklyReview', ...range }))).toEqual({ status: 'error', message: 'Calendar provider unavailable' });
            expect(await contract.loadExternalCalendarFeed({ slot: 'calendar', start: range.end, end: range.start })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
            expect(await contract.loadExternalCalendarFeed({ slot: 'other' as never, ...range })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        });
    });
});
