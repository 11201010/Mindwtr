import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openScratchSqlite } from './screen-parity.replay';
import { SqliteAdapter, rawReadTaskSnapshot } from './sqlite-adapter';
import { sanitizeAppDataForStorage } from './store-helpers';
import type { AppData } from './types';
const AT = '2026-10-03T13:00:00.000Z';
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const open = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-adapter-')); directories.push(dir);
    const sql = openScratchSqlite(join(dir, 'raw.sqlite')); const adapter = new SqliteAdapter(sql.client);
    const data: AppData = { tasks: [{ id: 'source', title: 'Source', status: 'reference', tags: [], contexts: [], createdAt: AT, updatedAt: AT, rev: 2 },
        { id: 'sibling', title: 'Sibling', status: 'reference', tags: [], contexts: [], createdAt: AT, updatedAt: AT, rev: 2 }],
        projects: [{ id: 'parent', title: 'Parent', status: 'active', tagIds: [], color: '#000000', order: 0, createdAt: AT, updatedAt: AT }],
        sections: [{ id: 'section', projectId: 'parent', title: 'Section', order: 0, createdAt: AT, updatedAt: AT }],
        areas: [{ id: 'area', name: 'Area', order: 0, createdAt: AT, updatedAt: AT }],
        people: [{ id: 'person', name: 'Person', createdAt: AT, updatedAt: AT }], settings: { deviceId: 'device-a' } };
    await adapter.saveData(data);
    const attachment = '[ {"uri":"file:///old.txt", "title":"Old", "kind":"file", "id":"attachment", "createdAt":"2026-10-03T13:00:00.000Z"} ]';
    await sql.client.run('UPDATE tasks SET attachments=?,pushCount=NULL,focusOrder=2,tags=? WHERE id=?', [attachment, '[ "#a", "#b" ]', 'sibling']);
    await sql.client.run('UPDATE projects SET attachments=?,tagIds=? WHERE id=?', [attachment, '[ "tag-a" ]', 'parent']);
    await sql.client.run('UPDATE sections SET orderNum=NULL WHERE id=?', ['section']);
    await sql.client.run('UPDATE areas SET updatedAt=? WHERE id=?', ['', 'area']);
    await sql.client.run('UPDATE people SET updatedAt=? WHERE id=?', ['', 'person']);
    await sql.client.run('INSERT INTO saved_filters (id,name,view,criteria,createdAt,updatedAt) VALUES (?,?,?,?,?,?)', ['filter', 'Filter', 'tasks', '{ "tags" : ["#a"] }', AT, AT]);
    await sql.client.run('UPDATE settings SET data=? WHERE id=1', ['{ "deviceId": "device-a", "gtd": {"focusTaskLimit":3}, "theme":"dark" }']);
    return { sql, adapter };
};
const tableNames = ['tasks', 'projects', 'sections', 'areas', 'people', 'settings', 'saved_filters', 'schema_migrations', 'calendar_sync'];
const raw = async (sql: Awaited<ReturnType<typeof open>>['sql']) => Object.fromEntries(await Promise.all(tableNames.map(async table => [table,
    { schema: await sql.client.all(`PRAGMA table_info(${table})`), rows: await sql.client.all(`SELECT rowid AS evidenceRowid,* FROM ${table} ORDER BY rowid`) }])));
describe('raw-read snapshots preserve original SQLite cells without changing normal codecs', () => {
    it('keeps all nine tables and exact JSON encoding of unmodified raw entities/settings/filter rows', async () => {
        const { sql, adapter } = await open();
        try { const before = await raw(sql); const data = await adapter.getData({ rawTasks: true }); await adapter.saveData(data);
            expect(await raw(sql)).toEqual(before);
        } finally { sql.close(); }
    });
    it('serializes a changed clone normally while leaving every unrelated raw cell exact', async () => {
        const { sql, adapter } = await open();
        try { const before = await raw(sql); const data = await adapter.getData({ rawTasks: true });
            data.tasks = data.tasks.map(task => task.id === 'source' ? { ...task, title: 'Changed', rev: 3 } : task);
            await adapter.saveData(data); const after = await raw(sql);
            (after.tasks.rows as Array<Record<string, unknown>>).find(row => row.id === 'source')!.title = 'Source';
            (after.tasks.rows as Array<Record<string, unknown>>).find(row => row.id === 'source')!.rev = 2;
            expect(after).toEqual(before);
        } finally { sql.close(); }
    });
    it.each(['task-title', 'task-attachment', 'project-attachment', 'settings', 'filter'] as const)('does not hide in-place mutation of a raw-read object: %s', async mutation => {
        const { sql, adapter } = await open();
        try { const data = await adapter.getData({ rawTasks: true });
            if (mutation === 'task-title') data.tasks[1].title = 'Edited';
            if (mutation === 'task-attachment') data.tasks[1].attachments![0].title = 'Edited attachment';
            if (mutation === 'project-attachment') data.projects[0].attachments![0].title = 'Edited project attachment';
            if (mutation === 'settings') data.settings.gtd!.focusTaskLimit = 7;
            if (mutation === 'filter') data.settings.savedFilters![0].criteria.tags = ['#changed'];
            await adapter.saveData(data); const loaded = await adapter.getData();
            if (mutation === 'task-title') expect(loaded.tasks[1].title).toBe('Edited');
            if (mutation === 'task-attachment') expect(loaded.tasks[1].attachments![0].title).toBe('Edited attachment');
            if (mutation === 'project-attachment') expect(loaded.projects[0].attachments![0].title).toBe('Edited project attachment');
            if (mutation === 'settings') expect(loaded.settings.gtd!.focusTaskLimit).toBe(7);
            if (mutation === 'filter') expect(loaded.settings.savedFilters![0].criteria.tags).toEqual(['#changed']);
        } finally { sql.close(); }
    });
    it('retains normal-load default serialization rather than treating absence and empty timestamp as equivalent', async () => {
        const { sql, adapter } = await open();
        try { const data = await adapter.getData(); expect(data.tasks[1].attachments![0].updatedAt).toBe('');
            await adapter.saveData(data); const sibling = await sql.client.get<{ attachments: string; pushCount: number }>('SELECT attachments,pushCount FROM tasks WHERE id=?', ['sibling']);
            expect(JSON.parse(sibling!.attachments)[0]).toHaveProperty('updatedAt', ''); expect(sibling!.pushCount).toBeNull();
        } finally { sql.close(); }
    });
    it('the scoped raw snapshot exposes actual JSON member presence without changing old raw DTOs', async () => {
        const { sql, adapter } = await open(); try { const data = await adapter.getData({ rawTasks: true }); const sibling = data.tasks[1];
            expect(sibling.attachments![0]).toHaveProperty('updatedAt', '');
            const snapshot = rawReadTaskSnapshot(sibling)!; expect(snapshot.attachments![0]).not.toHaveProperty('updatedAt');
            snapshot.title = 'Detached'; expect(sibling.title).toBe('Sibling');
            sibling.title = 'Mutated public raw read'; expect(rawReadTaskSnapshot(sibling)?.title).toBe('Mutated public raw read');
        } finally { sql.close(); }
    });
    it('retains exact unchanged raw settings/filter cells through the real sanitizer clone', async () => {
        const { sql, adapter } = await open();
        try { const before = await raw(sql); const data = await adapter.getData({ rawTasks: true });
            const sanitized = sanitizeAppDataForStorage(data);
            expect(sanitized.settings).not.toBe(data.settings); expect(sanitized.settings.savedFilters![0]).not.toBe(data.settings.savedFilters![0]);
            await adapter.saveData(sanitized); expect(await raw(sql)).toEqual(before);
        } finally { sql.close(); }
    });
    it('never restores stripped secrets from original settings JSON and still preserves unchanged raw filter cells', async () => {
        const { sql, adapter } = await open();
        try {
            await sql.client.run('UPDATE settings SET data=? WHERE id=1', ['{ "deviceId":"device-a", "ai": {"apiKey":"private-sentinel","provider":"openai"} }']);
            const filters = await sql.client.all('SELECT rowid AS evidenceRowid,* FROM saved_filters');
            const data = await adapter.getData({ rawTasks: true }); const sanitized = sanitizeAppDataForStorage(data);
            expect(sanitized.settings.ai?.apiKey).toBeUndefined(); await adapter.saveData(sanitized);
            const settings = await sql.client.get<{ data: string }>('SELECT data FROM settings WHERE id=1');
            expect(settings!.data).not.toContain('private-sentinel'); expect(JSON.parse(settings!.data).ai.apiKey).toBeUndefined();
            expect(await sql.client.all('SELECT rowid AS evidenceRowid,* FROM saved_filters')).toEqual(filters);
        } finally { sql.close(); }
    });
    it('does not carry stale raw settings/filter bytes after a nested mutation before sanitization', async () => {
        const { sql, adapter } = await open();
        try { const data = await adapter.getData({ rawTasks: true }); data.settings.gtd!.focusTaskLimit = 7;
            data.settings.savedFilters![0].criteria.tags = ['#changed'];
            await adapter.saveData(sanitizeAppDataForStorage(data)); const loaded = await adapter.getData();
            expect(loaded.settings.gtd!.focusTaskLimit).toBe(7); expect(loaded.settings.savedFilters![0].criteria.tags).toEqual(['#changed']);
        } finally { sql.close(); }
    });
    it.each([{}, null, [null, 7, 'legacy', {}, { id: 'plain-filter', criteria: {} }]])(
        'keeps default sanitizer behavior for malformed savedFilters without raw provenance: %j', savedFilters => {
            const data = { tasks: [], projects: [], sections: [], areas: [], people: [],
                settings: { theme: 'dark', savedFilters, ai: { apiKey: 'strip-sentinel', provider: 'openai' } } } as unknown as AppData;
            const sanitized = sanitizeAppDataForStorage(data);
            expect(sanitized.settings.savedFilters).toEqual(savedFilters);
            expect(sanitized.settings.ai?.apiKey).toBeUndefined();
            expect(sanitized.settings).not.toBe(data.settings);
        });

});
