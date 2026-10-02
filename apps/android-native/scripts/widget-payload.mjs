// RN's home-screen widget payload as the device checks read it from the app's files (RN's WidgetPayloadStore: SharedPreferences
// `mindwtr_widget`, key `payload`), the inputs the app logged with its last publication (bundle/host-widgets.ts), and core's own
// Android publication for a pulled copy of the app's database (host-side core with bun), to compare them. Used by
// check-widgets-device.mjs and check-upgrade-device.mjs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const coreSrc = resolve(import.meta.dirname, '../../../packages/core/src');
export const WIDGET_PREFS = 'shared_prefs/mindwtr_widget.xml';
export const PUBLISHED = 'Native Android widget payload published';
export const REFRESHED = 'Native Android widgets refreshed';

const unescapeXml = (text) => text.replace(/&(#x?[0-9a-fA-F]+|quot|apos|lt|gt|amp);/g, (_, entity) => ({ quot: '"', apos: '\'', lt: '<', gt: '>', amp: '&' })[entity]
    ?? String.fromCodePoint(entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))));

/** A SharedPreferences file's text ("" for none): its entries as `type:name`, sorted, and its `payload` string (null for none). */
export const widgetPrefs = (xml) => {
    const raw = /<string name="payload">([\s\S]*?)<\/string>/.exec(xml)?.[1];
    return {
        entries: [...xml.matchAll(/<(\w+) name="([^"]+)"/g)].map(([, type, name]) => `${type}:${name}`).sort(),
        payload: raw === undefined ? null : unescapeXml(raw),
    };
};

/** Lines of [logText] that hold every one of [needles]. */
export const count = (logText, ...needles) => logText.split('\n').filter((line) => needles.every((needle) => line.includes(needle))).length;

/** The last publication's logged context (`{ items, language, scheme, locale, lists }`) in logcat text [logText]; null for none. */
export const publicationContext = (logText) => {
    // Core's logger puts the context in as a JSON string: drop its escapes.
    const line = logText.replace(/\\/g, '').split('\n').filter((text) => text.includes(PUBLISHED)).pop();
    const context = line && /"context":"(\{.*?\})"/.exec(line)?.[1];
    return context ? JSON.parse(context) : null;
};

/**
 * Core's own Android publication on the database copy [db] (host-side core with bun, in time zone [zone]): the payload RN's
 * widget service would hand setPayload for that data, [language] and the logged [context]'s inputs. [out] is a scratch file
 * (core's own log lines go to the console). Activating the copy may write to it: pass a copy no other check reads.
 */
export const corePublication = ({ db, language, context, zone, out }) => {
    const inputs = { systemColorScheme: context.scheme, systemLocale: context.locale, listSelections: context.lists };
    execFileSync('bun', ['-e', `
    import { Database } from 'bun:sqlite';
    import { SqliteAdapter, buildAndroidWidgetPublication, createNativeHostContract, getFocusWidgetFilter, setStorageAdapter, useTaskStore } from '${coreSrc}/index.ts';
    const db = new Database(process.env.CHECK_DB);
    setStorageAdapter(new SqliteAdapter({
        run: async (sql, params = []) => { db.query(sql).run(...params); },
        all: async (sql, params = []) => db.query(sql).all(...params),
        get: async (sql, params = []) => db.query(sql).get(...params) ?? undefined,
        exec: async (sql) => { db.exec(sql); },
    }));
    const ready = await createNativeHostContract().activate({ writeSafetyReady: true });
    if (!ready.ok) throw new Error(ready.error.message);
    const state = useTaskStore.getState();
    const data = { tasks: state._allTasks, projects: state._allProjects, sections: state._allSections, areas: state._allAreas, settings: state.settings ?? {} };
    // The Focus screen's filter as a new process has it (the app starts on the Inbox and never opened Focus).
    const inputs = { ...JSON.parse(process.env.CHECK_INPUTS), focusFilter: getFocusWidgetFilter() };
    await Bun.write(process.env.CHECK_OUT, JSON.stringify(buildAndroidWidgetPublication(data, process.env.CHECK_LANGUAGE, inputs)));
    process.exit(0);
`], { encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, TZ: zone, CHECK_DB: db, CHECK_LANGUAGE: language, CHECK_INPUTS: JSON.stringify(inputs), CHECK_OUT: out } });
    return readFileSync(out, 'utf8');
};

/** Equal payloads, or the first differing field (a path) with both values. */
export const firstDifference = (actual, expected, path = '') => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) return null;
    if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
        for (const name of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
            const found = firstDifference(actual[name], expected[name], `${path}.${name}`);
            if (found) return found;
        }
    }
    return `${path || '(root)'}: app ${JSON.stringify(actual)?.slice(0, 200)} vs core ${JSON.stringify(expected)?.slice(0, 200)}`;
};
