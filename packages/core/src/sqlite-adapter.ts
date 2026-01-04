import type { AppData, Area, Project, Task } from './types';
import { SQLITE_SCHEMA } from './sqlite-schema';

export interface SqliteClient {
    run(sql: string, params?: unknown[]): Promise<void>;
    all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
    get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
    exec?(sql: string): Promise<void>;
}

const toJson = (value: unknown) => (value === undefined ? null : JSON.stringify(value));
const fromJson = <T>(value: unknown, fallback: T): T => {
    if (value === null || value === undefined || value === '') return fallback;
    try {
        return JSON.parse(String(value)) as T;
    } catch {
        return fallback;
    }
};

const toBool = (value?: boolean) => (value ? 1 : 0);
const fromBool = (value: unknown) => Boolean(value);

export class SqliteAdapter {
    private client: SqliteClient;

    constructor(client: SqliteClient) {
        this.client = client;
    }

    async ensureSchema() {
        if (this.client.exec) {
            await this.client.exec(SQLITE_SCHEMA);
        } else {
            await this.client.run(SQLITE_SCHEMA);
        }
    }

    async getData(): Promise<AppData> {
        await this.ensureSchema();
        const tasksRows = await this.client.all<Record<string, unknown>>('SELECT * FROM tasks');
        const projectsRows = await this.client.all<Record<string, unknown>>('SELECT * FROM projects');
        const areasRows = await this.client.all<Record<string, unknown>>('SELECT * FROM areas');
        const settingsRow = await this.client.get<Record<string, unknown>>('SELECT data FROM settings WHERE id = 1');

        const tasks: Task[] = tasksRows.map((row) => ({
            id: String(row.id),
            title: String(row.title ?? ''),
            status: row.status as Task['status'],
            priority: row.priority as Task['priority'] | undefined,
            taskMode: row.taskMode as Task['taskMode'] | undefined,
            startTime: row.startTime as string | undefined,
            dueDate: row.dueDate as string | undefined,
            recurrence: fromJson<Task['recurrence']>(row.recurrence, undefined),
            pushCount: row.pushCount === null || row.pushCount === undefined ? undefined : Number(row.pushCount),
            tags: fromJson<string[]>(row.tags, []),
            contexts: fromJson<string[]>(row.contexts, []),
            checklist: fromJson<Task['checklist']>(row.checklist, undefined),
            description: row.description as string | undefined,
            attachments: fromJson<Task['attachments']>(row.attachments, undefined),
            location: row.location as string | undefined,
            projectId: row.projectId as string | undefined,
            isFocusedToday: fromBool(row.isFocusedToday),
            timeEstimate: row.timeEstimate as Task['timeEstimate'] | undefined,
            reviewAt: row.reviewAt as string | undefined,
            completedAt: row.completedAt as string | undefined,
            createdAt: String(row.createdAt ?? ''),
            updatedAt: String(row.updatedAt ?? ''),
            deletedAt: row.deletedAt as string | undefined,
        }));

        const projects: Project[] = projectsRows.map((row) => ({
            id: String(row.id),
            title: String(row.title ?? ''),
            status: row.status as Project['status'],
            color: String(row.color ?? '#6B7280'),
            tagIds: fromJson<string[]>(row.tagIds, []),
            isSequential: fromBool(row.isSequential),
            isFocused: fromBool(row.isFocused),
            supportNotes: row.supportNotes as string | undefined,
            attachments: fromJson<Project['attachments']>(row.attachments, undefined),
            reviewAt: row.reviewAt as string | undefined,
            areaId: row.areaId as string | undefined,
            areaTitle: row.areaTitle as string | undefined,
            createdAt: String(row.createdAt ?? ''),
            updatedAt: String(row.updatedAt ?? ''),
            deletedAt: row.deletedAt as string | undefined,
        }));

        const areas: Area[] = areasRows.map((row) => ({
            id: String(row.id),
            name: String(row.name ?? ''),
            color: row.color as string | undefined,
            icon: row.icon as string | undefined,
            order: Number(row.orderNum ?? 0),
            createdAt: row.createdAt as string | undefined,
            updatedAt: row.updatedAt as string | undefined,
        }));

        const settings = settingsRow?.data ? fromJson<AppData['settings']>(settingsRow.data, {}) : {};

        return { tasks, projects, areas, settings };
    }

    async saveData(data: AppData): Promise<void> {
        await this.ensureSchema();
        await this.client.run('BEGIN IMMEDIATE');
        try {
            await this.client.run('DELETE FROM tasks');
            await this.client.run('DELETE FROM projects');
            await this.client.run('DELETE FROM areas');
            await this.client.run('DELETE FROM settings');

            for (const task of data.tasks) {
                await this.client.run(
                    `INSERT INTO tasks (
                        id, title, status, priority, taskMode, startTime, dueDate, recurrence, pushCount,
                        tags, contexts, checklist, description, attachments, location, projectId,
                        isFocusedToday, timeEstimate, reviewAt, completedAt, createdAt, updatedAt, deletedAt
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        task.id,
                        task.title,
                        task.status,
                        task.priority ?? null,
                        task.taskMode ?? null,
                        task.startTime ?? null,
                        task.dueDate ?? null,
                        toJson(task.recurrence),
                        task.pushCount ?? null,
                        toJson(task.tags ?? []),
                        toJson(task.contexts ?? []),
                        toJson(task.checklist),
                        task.description ?? null,
                        toJson(task.attachments),
                        task.location ?? null,
                        task.projectId ?? null,
                        toBool(task.isFocusedToday),
                        task.timeEstimate ?? null,
                        task.reviewAt ?? null,
                        task.completedAt ?? null,
                        task.createdAt,
                        task.updatedAt,
                        task.deletedAt ?? null,
                    ]
                );
            }

            for (const project of data.projects) {
                await this.client.run(
                    `INSERT INTO projects (
                        id, title, status, color, tagIds, isSequential, isFocused, supportNotes, attachments,
                        reviewAt, areaId, areaTitle, createdAt, updatedAt, deletedAt
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        project.id,
                        project.title,
                        project.status,
                        project.color,
                        toJson(project.tagIds ?? []),
                        toBool(project.isSequential),
                        toBool(project.isFocused),
                        project.supportNotes ?? null,
                        toJson(project.attachments),
                        project.reviewAt ?? null,
                        project.areaId ?? null,
                        project.areaTitle ?? null,
                        project.createdAt,
                        project.updatedAt,
                        project.deletedAt ?? null,
                    ]
                );
            }

            for (const area of data.areas) {
                await this.client.run(
                    `INSERT INTO areas (
                        id, name, color, icon, orderNum, createdAt, updatedAt
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        area.id,
                        area.name,
                        area.color ?? null,
                        area.icon ?? null,
                        area.order,
                        area.createdAt ?? null,
                        area.updatedAt ?? null,
                    ]
                );
            }

            await this.client.run('INSERT INTO settings (id, data) VALUES (1, ?)', [
                toJson(data.settings ?? {}),
            ]);

            await this.client.run('COMMIT');
        } catch (error) {
            await this.client.run('ROLLBACK');
            throw error;
        }
    }
}
