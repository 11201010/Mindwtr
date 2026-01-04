import type { AppData } from './types';
import { SqliteAdapter } from './sqlite-adapter';

export async function migrateJsonToSqlite(jsonPath: string, dbPath: string): Promise<void> {
    const { readFile } = await import('fs/promises');
    const data = JSON.parse(await readFile(jsonPath, 'utf8')) as AppData;

    const sqlite = await import('bun:sqlite');
    const db = new sqlite.Database(dbPath);

    const client = {
        run: async (sql: string, params: unknown[] = []) => {
            db.run(sql, params);
        },
        all: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
            return db.query(sql).all(params) as T[];
        },
        get: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
            return db.query(sql).get(params) as T | undefined;
        },
        exec: async (sql: string) => {
            db.exec(sql);
        },
    };

    const adapter = new SqliteAdapter(client);
    await adapter.saveData(data);
    db.close();
}
