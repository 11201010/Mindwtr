declare module 'bun:sqlite' {
    export class Database {
        constructor(path: string);
        run(sql: string, params?: unknown[]): void;
        exec(sql: string): void;
        query(sql: string): {
            all(params?: unknown[]): unknown[];
            get(params?: unknown[]): unknown | undefined;
        };
        close(): void;
    }
}
