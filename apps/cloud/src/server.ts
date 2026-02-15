#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, realpathSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, resolve, sep } from 'path';
import {
    applyTaskUpdates,
    generateUUID,
    mergeAppData,
    parseQuickAdd,
    searchAll,
    type AppData,
    type Task,
    type TaskStatus,
} from '@mindwtr/core';

type Flags = Record<string, string | boolean>;

type RateLimitState = {
    count: number;
    resetAt: number;
};

type LogLevel = 'info' | 'warn' | 'error';
type LogEntry = {
    ts: string;
    level: LogLevel;
    scope: 'cloud';
    message: string;
    context?: Record<string, unknown>;
};

const writeLog = (entry: LogEntry) => {
    const line = `${JSON.stringify(entry)}\n`;
    if (entry.level === 'error') {
        process.stderr.write(line);
    } else {
        process.stdout.write(line);
    }
};

const logInfo = (message: string, context?: Record<string, unknown>) => {
    writeLog({ ts: new Date().toISOString(), level: 'info', scope: 'cloud', message, context });
};

const logWarn = (message: string, context?: Record<string, unknown>) => {
    writeLog({ ts: new Date().toISOString(), level: 'warn', scope: 'cloud', message, context });
};

const logError = (message: string, error?: unknown) => {
    const context: Record<string, unknown> = {};
    if (error instanceof Error) {
        context.error = error.message;
        if (error.stack) context.stack = error.stack;
    } else if (error !== undefined) {
        context.error = String(error);
    }
    writeLog({ ts: new Date().toISOString(), level: 'error', scope: 'cloud', message, context: Object.keys(context).length ? context : undefined });
};

const configuredCorsOrigin = (process.env.MINDWTR_CLOUD_CORS_ORIGIN || '').trim();
if (configuredCorsOrigin === '*') {
    throw new Error('MINDWTR_CLOUD_CORS_ORIGIN cannot be "*" in production. Set an explicit origin.');
}
const corsOrigin = configuredCorsOrigin || 'http://localhost:5173';
const maxTaskTitleLengthValue = Number(process.env.MINDWTR_CLOUD_MAX_TASK_TITLE_LENGTH || 500);
const MAX_TASK_TITLE_LENGTH = Number.isFinite(maxTaskTitleLengthValue) && maxTaskTitleLengthValue > 0
    ? Math.floor(maxTaskTitleLengthValue)
    : 500;
const maxItemsPerCollectionValue = Number(process.env.MINDWTR_CLOUD_MAX_ITEMS_PER_COLLECTION || 50_000);
const MAX_ITEMS_PER_COLLECTION = Number.isFinite(maxItemsPerCollectionValue) && maxItemsPerCollectionValue > 0
    ? Math.floor(maxItemsPerCollectionValue)
    : 50_000;
const ATTACHMENT_PATH_ALLOWLIST = /^[a-zA-Z0-9._/-]+$/;

function isPathWithinRoot(pathValue: string, rootPath: string): boolean {
    return pathValue === rootPath || pathValue.startsWith(`${rootPath}${sep}`);
}

function normalizeAttachmentRelativePath(rawPath: string): string | null {
    let decoded = '';
    try {
        decoded = decodeURIComponent(rawPath);
    } catch {
        return null;
    }
    if (!decoded || !ATTACHMENT_PATH_ALLOWLIST.test(decoded)) {
        return null;
    }
    const normalized = decoded.replace(/^\/+|\/+$/g, '');
    if (!normalized) return null;
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    if (segments.some((segment) => segment === '.' || segment === '..')) {
        return null;
    }
    return segments.join('/');
}

function resolveAttachmentPath(dataDir: string, key: string, rawPath: string): { rootRealPath: string; filePath: string } | null {
    const relativePath = normalizeAttachmentRelativePath(rawPath);
    if (!relativePath) return null;
    const rootDir = resolve(join(dataDir, key, 'attachments'));
    mkdirSync(rootDir, { recursive: true });
    const rootRealPath = realpathSync(rootDir);
    const filePath = resolve(join(rootRealPath, relativePath));
    if (!isPathWithinRoot(filePath, rootRealPath)) return null;
    return { rootRealPath, filePath };
}

const shutdown = (signal: string) => {
    logInfo(`received ${signal}, shutting down`);
    process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function parseArgs(argv: string[]) {
    const flags: Flags = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg || !arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            flags[key] = next;
            i += 1;
        } else {
            flags[key] = true;
        }
    }
    return flags;
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Access-Control-Allow-Origin', corsOrigin);
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'GET,PUT,POST,PATCH,DELETE,OPTIONS');
    return new Response(JSON.stringify(body, null, 2), { ...init, headers });
}

function errorResponse(message: string, status = 400) {
    return jsonResponse({ error: message }, { status });
}

function getToken(req: Request): string | null {
    const auth = req.headers.get('authorization') || '';
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
}

function tokenToKey(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function parseAllowedAuthTokens(rawValue?: string): Set<string> | null {
    const tokens = String(rawValue || '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    return tokens.length > 0 ? new Set(tokens) : null;
}

function resolveAllowedAuthTokensFromEnv(env: Record<string, string | undefined>): Set<string> | null {
    const values = [
        env.MINDWTR_CLOUD_AUTH_TOKENS,
        env.MINDWTR_CLOUD_TOKEN, // legacy name kept for backward compatibility
    ]
        .map((value) => String(value || '').trim())
        .filter((value) => value.length > 0);
    if (values.length === 0) return null;
    return parseAllowedAuthTokens(values.join(','));
}

function isAuthorizedToken(token: string, allowedTokens: Set<string> | null): boolean {
    if (!allowedTokens) return true;
    return allowedTokens.has(token);
}

function toRateLimitRoute(pathname: string): string {
    if (/^\/v1\/attachments\/.+/.test(pathname)) {
        return '/v1/attachments/:path';
    }
    if (/^\/v1\/tasks\/[^/]+\/(complete|archive)$/.test(pathname)) {
        return '/v1/tasks/:id/:action';
    }
    if (/^\/v1\/tasks\/[^/]+$/.test(pathname)) {
        return '/v1/tasks/:id';
    }
    return pathname;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidIsoTimestamp(value: unknown): boolean {
    if (typeof value !== 'string' || value.trim().length === 0) return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed);
}

function validateAppData(value: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
    if (!isRecord(value)) return { ok: false, error: 'Invalid data: expected an object' };
    const tasks = value.tasks;
    const projects = value.projects;
    const sections = value.sections;
    const settings = value.settings;
    const areas = value.areas;

    if (!Array.isArray(tasks)) return { ok: false, error: 'Invalid data: tasks must be an array' };
    if (!Array.isArray(projects)) return { ok: false, error: 'Invalid data: projects must be an array' };
    if (sections !== undefined && !Array.isArray(sections)) return { ok: false, error: 'Invalid data: sections must be an array' };
    if (areas !== undefined && !Array.isArray(areas)) return { ok: false, error: 'Invalid data: areas must be an array' };
    if (settings !== undefined && !isRecord(settings)) return { ok: false, error: 'Invalid data: settings must be an object' };
    if (tasks.length > MAX_ITEMS_PER_COLLECTION) return { ok: false, error: `Invalid data: tasks exceeds limit (${MAX_ITEMS_PER_COLLECTION})` };
    if (projects.length > MAX_ITEMS_PER_COLLECTION) return { ok: false, error: `Invalid data: projects exceeds limit (${MAX_ITEMS_PER_COLLECTION})` };
    if (Array.isArray(sections) && sections.length > MAX_ITEMS_PER_COLLECTION) {
        return { ok: false, error: `Invalid data: sections exceeds limit (${MAX_ITEMS_PER_COLLECTION})` };
    }
    if (Array.isArray(areas) && areas.length > MAX_ITEMS_PER_COLLECTION) {
        return { ok: false, error: `Invalid data: areas exceeds limit (${MAX_ITEMS_PER_COLLECTION})` };
    }

    for (const task of tasks) {
        if (!isRecord(task) || typeof task.id !== 'string' || typeof task.title !== 'string') {
            return { ok: false, error: 'Invalid data: each task must be an object with string id and title' };
        }
        if (task.id.trim().length === 0 || task.title.trim().length === 0) {
            return { ok: false, error: 'Invalid data: each task must include non-empty id and title' };
        }
        if (typeof task.status !== 'string' || !['inbox', 'next', 'waiting', 'someday', 'reference', 'done', 'archived'].includes(task.status)) {
            return { ok: false, error: 'Invalid data: task status must be a valid value' };
        }
        if (!isValidIsoTimestamp(task.createdAt) || !isValidIsoTimestamp(task.updatedAt)) {
            return { ok: false, error: 'Invalid data: task createdAt/updatedAt must be valid ISO timestamps' };
        }
        if (task.deletedAt !== undefined && !isValidIsoTimestamp(task.deletedAt)) {
            return { ok: false, error: 'Invalid data: task deletedAt must be a valid ISO timestamp when present' };
        }
    }

    for (const project of projects) {
        if (!isRecord(project) || typeof project.id !== 'string' || typeof project.title !== 'string') {
            return { ok: false, error: 'Invalid data: each project must be an object with string id and title' };
        }
        if (project.id.trim().length === 0 || project.title.trim().length === 0) {
            return { ok: false, error: 'Invalid data: each project must include non-empty id and title' };
        }
        if (typeof project.status !== 'string' || !['active', 'someday', 'waiting', 'archived'].includes(project.status)) {
            return { ok: false, error: 'Invalid data: project status must be a valid value' };
        }
        if (!isValidIsoTimestamp(project.createdAt) || !isValidIsoTimestamp(project.updatedAt)) {
            return { ok: false, error: 'Invalid data: project createdAt/updatedAt must be valid ISO timestamps' };
        }
        if (project.deletedAt !== undefined && !isValidIsoTimestamp(project.deletedAt)) {
            return { ok: false, error: 'Invalid data: project deletedAt must be a valid ISO timestamp when present' };
        }
    }

    if (Array.isArray(sections)) {
        for (const section of sections) {
            if (!isRecord(section) || typeof section.id !== 'string' || typeof section.projectId !== 'string' || typeof section.title !== 'string') {
                return { ok: false, error: 'Invalid data: each section must be an object with string id, projectId, and title' };
            }
            if (!isValidIsoTimestamp(section.createdAt) || !isValidIsoTimestamp(section.updatedAt)) {
                return { ok: false, error: 'Invalid data: section createdAt/updatedAt must be valid ISO timestamps' };
            }
            if (section.deletedAt !== undefined && !isValidIsoTimestamp(section.deletedAt)) {
                return { ok: false, error: 'Invalid data: section deletedAt must be a valid ISO timestamp when present' };
            }
        }
    }

    if (Array.isArray(areas)) {
        for (const area of areas) {
            if (!isRecord(area) || typeof area.id !== 'string' || typeof area.name !== 'string') {
                return { ok: false, error: 'Invalid data: each area must be an object with string id and name' };
            }
            if (area.createdAt !== undefined && !isValidIsoTimestamp(area.createdAt)) {
                return { ok: false, error: 'Invalid data: area createdAt must be a valid ISO timestamp when present' };
            }
            if (area.updatedAt !== undefined && !isValidIsoTimestamp(area.updatedAt)) {
                return { ok: false, error: 'Invalid data: area updatedAt must be a valid ISO timestamp when present' };
            }
            if (area.deletedAt !== undefined && !isValidIsoTimestamp(area.deletedAt)) {
                return { ok: false, error: 'Invalid data: area deletedAt must be a valid ISO timestamp when present' };
            }
        }
    }

    return { ok: true, data: value };
}

const DEFAULT_DATA: AppData = { tasks: [], projects: [], sections: [], areas: [], settings: {} };

function loadAppData(filePath: string): AppData {
    const raw = readData(filePath);
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_DATA };
    const record = raw as Record<string, unknown>;
    return {
        tasks: Array.isArray(record.tasks) ? (record.tasks as Task[]) : [],
        projects: Array.isArray(record.projects) ? (record.projects as any) : [],
        sections: Array.isArray(record.sections) ? (record.sections as any) : [],
        areas: Array.isArray(record.areas) ? (record.areas as any) : [],
        settings: typeof record.settings === 'object' && record.settings ? (record.settings as any) : {},
    };
}

function asStatus(value: unknown): TaskStatus | null {
    if (typeof value !== 'string') return null;
    const allowed: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'reference', 'done', 'archived'];
    return allowed.includes(value as TaskStatus) ? (value as TaskStatus) : null;
}

function pickTaskList(
    data: AppData,
    opts: { includeDeleted: boolean; includeCompleted: boolean; status?: TaskStatus | null; query?: string }
): Task[] {
    let tasks = data.tasks;
    if (!opts.includeDeleted) tasks = tasks.filter((t) => !t.deletedAt);
    if (!opts.includeCompleted) tasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'archived');
    if (opts.status) tasks = tasks.filter((t) => t.status === opts.status);
    if (opts.query && opts.query.trim()) {
        tasks = searchAll(tasks, data.projects.filter((p) => !p.deletedAt), opts.query).tasks;
    }
    return tasks;
}

function readData(filePath: string): any | null {
    try {
        const raw = readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeData(filePath: string, data: unknown) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function ensureWritableDir(dirPath: string): boolean {
    try {
        mkdirSync(dirPath, { recursive: true });
        const testPath = join(dirPath, '.mindwtr_write_test');
        writeFileSync(testPath, 'ok');
        unlinkSync(testPath);
        return true;
    } catch (error) {
        logError(`cloud data dir is not writable: ${dirPath}`, error);
        logError('ensure the volume is writable by the container user (uid 1000)');
        return false;
    }
}

async function readJsonBody(req: Request, maxBodyBytes: number, encoder: TextEncoder): Promise<any> {
    const contentLength = Number(req.headers.get('content-length') || '0');
    if (contentLength && contentLength > maxBodyBytes) {
        return { __mindwtrError: { message: 'Payload too large', status: 413 } };
    }
    const text = await req.text();
    if (!text.trim()) return null;
    if (encoder.encode(text).length > maxBodyBytes) {
        return { __mindwtrError: { message: 'Payload too large', status: 413 } };
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

export const __cloudTestUtils = {
    parseArgs,
    getToken,
    tokenToKey,
    parseAllowedAuthTokens,
    resolveAllowedAuthTokensFromEnv,
    isAuthorizedToken,
    toRateLimitRoute,
    validateAppData,
    asStatus,
    pickTaskList,
    readJsonBody,
    normalizeAttachmentRelativePath,
    isPathWithinRoot,
};

type CloudServerOptions = {
    port?: number;
    host?: string;
    dataDir?: string;
    windowMs?: number;
    maxPerWindow?: number;
    maxAttachmentPerWindow?: number;
    maxBodyBytes?: number;
    maxAttachmentBytes?: number;
    allowedAuthTokens?: Set<string> | null;
};

type CloudServerHandle = {
    stop: () => void;
    port: number;
};

export async function startCloudServer(options: CloudServerOptions = {}): Promise<CloudServerHandle> {
    const flags = parseArgs(process.argv.slice(2));
    const port = Number(options.port ?? flags.port ?? process.env.PORT ?? 8787);
    const host = String(options.host ?? flags.host ?? process.env.HOST ?? '0.0.0.0');
    const dataDir = String(options.dataDir ?? process.env.MINDWTR_CLOUD_DATA_DIR ?? join(process.cwd(), 'data'));

    const rateLimits = new Map<string, RateLimitState>();
    const windowMs = Number(options.windowMs ?? process.env.MINDWTR_CLOUD_RATE_WINDOW_MS ?? 60_000);
    const maxPerWindow = Number(options.maxPerWindow ?? process.env.MINDWTR_CLOUD_RATE_MAX ?? 120);
    const maxAttachmentPerWindow = Number(
        options.maxAttachmentPerWindow ?? process.env.MINDWTR_CLOUD_ATTACHMENT_RATE_MAX ?? maxPerWindow
    );
    const maxBodyBytes = Number(options.maxBodyBytes ?? process.env.MINDWTR_CLOUD_MAX_BODY_BYTES ?? 2_000_000);
    const maxAttachmentBytes = Number(
        options.maxAttachmentBytes ?? process.env.MINDWTR_CLOUD_MAX_ATTACHMENT_BYTES ?? 50_000_000
    );
    const allowedAuthTokens = options.allowedAuthTokens ?? resolveAllowedAuthTokensFromEnv(process.env);
    const encoder = new TextEncoder();
    const writeLocks = new Map<string, Promise<void>>();
    const withWriteLock = async <T>(key: string, fn: () => Promise<T>) => {
        const current = writeLocks.get(key) ?? Promise.resolve();
        const run = current.then(() => fn(), () => fn());
        writeLocks.set(key, run.then(() => undefined, () => undefined));
        return run;
    };
    const rateLimitCleanupMs = Number(process.env.MINDWTR_CLOUD_RATE_CLEANUP_MS || 60_000);
    const cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, state] of rateLimits.entries()) {
            if (now > state.resetAt) {
                rateLimits.delete(key);
            }
        }
    }, rateLimitCleanupMs);
    if (typeof cleanupTimer.unref === 'function') {
        cleanupTimer.unref();
    }

    logInfo(`dataDir: ${dataDir}`);
    const usingLegacyTokenVar = options.allowedAuthTokens === undefined
        && !String(process.env.MINDWTR_CLOUD_AUTH_TOKENS || '').trim()
        && String(process.env.MINDWTR_CLOUD_TOKEN || '').trim().length > 0;
    if (usingLegacyTokenVar) {
        logWarn('MINDWTR_CLOUD_TOKEN is deprecated; use MINDWTR_CLOUD_AUTH_TOKENS instead');
    }
    if (allowedAuthTokens) {
        logInfo('token auth allowlist enabled', { allowedTokens: String(allowedAuthTokens.size) });
    } else {
        logInfo('token namespace mode enabled (no auth allowlist)', {
            hint: 'set MINDWTR_CLOUD_AUTH_TOKENS to enforce bearer authentication (or legacy MINDWTR_CLOUD_TOKEN)',
        });
    }
    if (!ensureWritableDir(dataDir)) {
        throw new Error(`Cloud data directory is not writable: ${dataDir}`);
    }
    logInfo(`listening on http://${host}:${port}`);

    const server = Bun.serve({
        hostname: host,
        port,
        async fetch(req) {
            try {
                if (req.method === 'OPTIONS') return jsonResponse({ ok: true });

                const url = new URL(req.url);
                const pathname = url.pathname.replace(/\/+$/, '') || '/';

            if (req.method === 'GET' && pathname === '/health') {
                return jsonResponse({ ok: true });
            }

            if (
                pathname === '/v1/tasks' ||
                pathname === '/v1/projects' ||
                pathname === '/v1/search' ||
                pathname.startsWith('/v1/tasks/')
            ) {
                const token = getToken(req);
                if (!token) return errorResponse('Unauthorized', 401);
                if (!isAuthorizedToken(token, allowedAuthTokens)) return errorResponse('Unauthorized', 401);
                const key = tokenToKey(token);
                const routeKey = toRateLimitRoute(pathname);
                const rateKey = `${key}:${req.method}:${routeKey}`;
                const now = Date.now();
                const state = rateLimits.get(rateKey);
                if (state && now < state.resetAt) {
                    state.count += 1;
                    if (state.count > maxPerWindow) {
                        const retryAfter = Math.ceil((state.resetAt - now) / 1000);
                        return jsonResponse(
                            { error: 'Rate limit exceeded', retryAfterSeconds: retryAfter },
                            { status: 429, headers: { 'Retry-After': String(retryAfter) } },
                        );
                    }
                } else {
                    rateLimits.set(rateKey, { count: 1, resetAt: now + windowMs });
                }
                const filePath = join(dataDir, `${key}.json`);

                if (req.method === 'GET' && pathname === '/v1/tasks') {
                    const query = url.searchParams.get('query') || '';
                    const includeAll = url.searchParams.get('all') === '1';
                    const includeDeleted = url.searchParams.get('deleted') === '1';
                    const rawStatus = url.searchParams.get('status');
                    const status = asStatus(rawStatus);
                    if (rawStatus !== null && status === null) {
                        return errorResponse('Invalid task status');
                    }
                    const data = loadAppData(filePath);
                    const tasks = pickTaskList(data, {
                        includeDeleted,
                        includeCompleted: includeAll,
                        status,
                        query,
                    });
                    return jsonResponse({ tasks });
                }

                if (req.method === 'POST' && pathname === '/v1/tasks') {
                    const body = await readJsonBody(req, maxBodyBytes, encoder);
                    if (body && typeof body === 'object' && '__mindwtrError' in body) {
                        const err = (body as any).__mindwtrError;
                        return errorResponse(String(err?.message || 'Payload too large'), Number(err?.status) || 413);
                    }
                    if (!body || typeof body !== 'object') return errorResponse('Invalid JSON body');

                    return await withWriteLock(key, async () => {
                        const data = loadAppData(filePath);
                        const nowIso = new Date().toISOString();

                        const input = typeof (body as any).input === 'string' ? String((body as any).input) : '';
                        const rawTitle = typeof (body as any).title === 'string' ? String((body as any).title) : '';
                        const initialProps = typeof (body as any).props === 'object' && (body as any).props ? (body as any).props : {};

                        const parsed = input ? parseQuickAdd(input, data.projects, new Date(nowIso), data.areas) : { title: rawTitle, props: {} };
                        const title = (parsed.title || rawTitle || input).trim();
                        if (!title) return errorResponse('Missing task title');
                        if (title.length > MAX_TASK_TITLE_LENGTH) {
                            return errorResponse(`Task title too long (max ${MAX_TASK_TITLE_LENGTH} characters)`, 400);
                        }

                        const props: Partial<Task> = {
                            ...parsed.props,
                            ...initialProps,
                        };

                        const rawStatus = (props as any).status;
                        const parsedStatus = asStatus(rawStatus);
                        if (rawStatus !== undefined && parsedStatus === null) {
                            return errorResponse('Invalid task status', 400);
                        }
                        const status = parsedStatus || 'inbox';
                        const tags = Array.isArray((props as any).tags) ? (props as any).tags : [];
                        const contexts = Array.isArray((props as any).contexts) ? (props as any).contexts : [];
                        const {
                            id: _id,
                            title: _title,
                            createdAt: _createdAt,
                            updatedAt: _updatedAt,
                            status: _status,
                            tags: _tags,
                            contexts: _contexts,
                            ...restProps
                        } = props as any;
                        const task: Task = {
                            id: generateUUID(),
                            title,
                            ...restProps,
                            status,
                            tags,
                            contexts,
                            createdAt: nowIso,
                            updatedAt: nowIso,
                        } as Task;

                        data.tasks.push(task);
                        writeData(filePath, data);
                        return jsonResponse({ task }, { status: 201 });
                    });
                }

                const actionMatch = pathname.match(/^\/v1\/tasks\/([^/]+)\/(complete|archive)$/);
                if (actionMatch && req.method === 'POST') {
                    const taskId = decodeURIComponent(actionMatch[1]);
                    const action = actionMatch[2];
                    const status: TaskStatus = action === 'archive' ? 'archived' : 'done';

                    return await withWriteLock(key, async () => {
                        const data = loadAppData(filePath);
                        const idx = data.tasks.findIndex((t) => t.id === taskId);
                        if (idx < 0) return errorResponse('Task not found', 404);

                        const nowIso = new Date().toISOString();
                        const existing = data.tasks[idx];
                        const { updatedTask, nextRecurringTask } = applyTaskUpdates(existing, { status }, nowIso);
                        data.tasks[idx] = updatedTask;
                        if (nextRecurringTask) data.tasks.push(nextRecurringTask);
                        writeData(filePath, data);
                        return jsonResponse({ task: updatedTask });
                    });
                }

                const taskMatch = pathname.match(/^\/v1\/tasks\/([^/]+)$/);
                if (taskMatch) {
                    const taskId = decodeURIComponent(taskMatch[1]);

                    if (req.method === 'GET') {
                        const data = loadAppData(filePath);
                        const task = data.tasks.find((t) => t.id === taskId);
                        if (!task) return errorResponse('Task not found', 404);
                        return jsonResponse({ task });
                    }

                    if (req.method === 'PATCH') {
                        const body = await readJsonBody(req, maxBodyBytes, encoder);
                        if (body && typeof body === 'object' && '__mindwtrError' in body) {
                            const err = (body as any).__mindwtrError;
                            return errorResponse(String(err?.message || 'Payload too large'), Number(err?.status) || 413);
                        }
                        if (!body || typeof body !== 'object') return errorResponse('Invalid JSON body');

                        return await withWriteLock(key, async () => {
                            const data = loadAppData(filePath);
                            const idx = data.tasks.findIndex((t) => t.id === taskId);
                            if (idx < 0) return errorResponse('Task not found', 404);

                            const nowIso = new Date().toISOString();
                            const existing = data.tasks[idx];
                            const updates = body as Partial<Task>;
                            const { updatedTask, nextRecurringTask } = applyTaskUpdates(existing, updates, nowIso);

                            data.tasks[idx] = updatedTask;
                            if (nextRecurringTask) data.tasks.push(nextRecurringTask);
                            writeData(filePath, data);
                            return jsonResponse({ task: updatedTask });
                        });
                    }

                    if (req.method === 'DELETE') {
                        return await withWriteLock(key, async () => {
                            const data = loadAppData(filePath);
                            const idx = data.tasks.findIndex((t) => t.id === taskId);
                            if (idx < 0) return errorResponse('Task not found', 404);

                            const nowIso = new Date().toISOString();
                            const existing = data.tasks[idx];
                            data.tasks[idx] = { ...existing, deletedAt: nowIso, updatedAt: nowIso };
                            writeData(filePath, data);
                            return jsonResponse({ ok: true });
                        });
                    }
                }

                if (req.method === 'GET' && pathname === '/v1/projects') {
                    const data = loadAppData(filePath);
                    const projects = data.projects.filter((p: any) => !p.deletedAt);
                    return jsonResponse({ projects });
                }

                if (req.method === 'GET' && pathname === '/v1/search') {
                    const query = url.searchParams.get('query') || '';
                    const data = loadAppData(filePath);
                    const tasks = data.tasks.filter((t) => !t.deletedAt);
                    const projects = data.projects.filter((p: any) => !p.deletedAt);
                    const results = searchAll(tasks, projects, query);
                    return jsonResponse(results);
                }

                if (pathname.startsWith('/v1/tasks') || pathname === '/v1/projects' || pathname === '/v1/search') {
                    return errorResponse('Method not allowed', 405);
                }
            }

            if (pathname === '/v1/data') {
                const token = getToken(req);
                if (!token) return errorResponse('Unauthorized', 401);
                if (!isAuthorizedToken(token, allowedAuthTokens)) return errorResponse('Unauthorized', 401);
                const key = tokenToKey(token);
                const now = Date.now();
                const state = rateLimits.get(key);
                if (state && now < state.resetAt) {
                    state.count += 1;
                    if (state.count > maxPerWindow) {
                        const retryAfter = Math.ceil((state.resetAt - now) / 1000);
                        return jsonResponse(
                            { error: 'Rate limit exceeded', retryAfterSeconds: retryAfter },
                            { status: 429, headers: { 'Retry-After': String(retryAfter) } },
                        );
                    }
                } else {
                    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
                }
                const filePath = join(dataDir, `${key}.json`);

                if (req.method === 'GET') {
                    if (!existsSync(filePath)) {
                        const emptyData: AppData = { tasks: [], projects: [], sections: [], areas: [], settings: {} };
                        await withWriteLock(key, async () => {
                            if (!existsSync(filePath)) writeData(filePath, emptyData);
                        });
                        return jsonResponse(emptyData);
                    }
                    const data = readData(filePath);
                    if (!data) return errorResponse('Failed to read data', 500);
                    const validated = validateAppData(data);
                    if (!validated.ok) return errorResponse(validated.error, 500);
                    return jsonResponse(validated.data);
                }

                if (req.method === 'PUT') {
                    const body = await readJsonBody(req, maxBodyBytes, encoder);
                    if (body && typeof body === 'object' && '__mindwtrError' in body) {
                        const err = (body as any).__mindwtrError;
                        return errorResponse(String(err?.message || 'Payload too large'), Number(err?.status) || 413);
                    }
                    if (!body) return errorResponse('Missing body');
                    if (typeof body !== 'object') return errorResponse('Invalid JSON body');
                    const validated = validateAppData(body);
                    if (!validated.ok) return errorResponse(validated.error, 400);
                    return await withWriteLock(key, async () => {
                        const existingData = loadAppData(filePath);
                        const incomingData = validated.data as AppData;
                        const mergedData = mergeAppData(existingData, incomingData);
                        writeData(filePath, mergedData);
                        return jsonResponse({ ok: true });
                    });
                }
            }

            if (pathname.startsWith('/v1/attachments/')) {
                const token = getToken(req);
                if (!token) return errorResponse('Unauthorized', 401);
                if (!isAuthorizedToken(token, allowedAuthTokens)) return errorResponse('Unauthorized', 401);
                const key = tokenToKey(token);
                const now = Date.now();
                const attachmentRateKey = `${key}:${req.method}:${toRateLimitRoute(pathname)}`;
                const state = rateLimits.get(attachmentRateKey);
                if (state && now < state.resetAt) {
                    state.count += 1;
                    if (state.count > maxAttachmentPerWindow) {
                        const retryAfter = Math.ceil((state.resetAt - now) / 1000);
                        return jsonResponse(
                            { error: 'Rate limit exceeded', retryAfterSeconds: retryAfter },
                            { status: 429, headers: { 'Retry-After': String(retryAfter) } },
                        );
                    }
                } else {
                    rateLimits.set(attachmentRateKey, { count: 1, resetAt: now + windowMs });
                }

                const resolvedAttachmentPath = resolveAttachmentPath(dataDir, key, pathname.slice('/v1/attachments/'.length));
                if (!resolvedAttachmentPath) {
                    return errorResponse('Invalid attachment path', 400);
                }
                const { rootRealPath, filePath } = resolvedAttachmentPath;

                if (req.method === 'GET') {
                    if (!existsSync(filePath)) return errorResponse('Not found', 404);
                    try {
                        const realFilePath = realpathSync(filePath);
                        if (!isPathWithinRoot(realFilePath, rootRealPath)) {
                            return errorResponse('Invalid attachment path', 400);
                        }
                        const file = readFileSync(realFilePath);
                        const headers = new Headers();
                        headers.set('Access-Control-Allow-Origin', corsOrigin);
                        headers.set('Content-Type', 'application/octet-stream');
                        return new Response(file, { status: 200, headers });
                    } catch {
                        return errorResponse('Failed to read attachment', 500);
                    }
                }

                if (req.method === 'PUT') {
                    const contentLength = Number(req.headers.get('content-length') || '0');
                    if (contentLength && contentLength > maxAttachmentBytes) {
                        return errorResponse('Payload too large', 413);
                    }
                    const body = new Uint8Array(await req.arrayBuffer());
                    if (body.length > maxAttachmentBytes) {
                        return errorResponse('Payload too large', 413);
                    }
                    mkdirSync(dirname(filePath), { recursive: true });
                    const parentRealPath = realpathSync(dirname(filePath));
                    if (!isPathWithinRoot(parentRealPath, rootRealPath)) {
                        return errorResponse('Invalid attachment path', 400);
                    }
                    if (existsSync(filePath)) {
                        const realFilePath = realpathSync(filePath);
                        if (!isPathWithinRoot(realFilePath, rootRealPath)) {
                            return errorResponse('Invalid attachment path', 400);
                        }
                    }
                    writeFileSync(filePath, body);
                    return jsonResponse({ ok: true });
                }

                if (req.method === 'DELETE') {
                    if (!existsSync(filePath)) {
                        return jsonResponse({ ok: true });
                    }
                    try {
                        const realFilePath = realpathSync(filePath);
                        if (!isPathWithinRoot(realFilePath, rootRealPath)) {
                            return errorResponse('Invalid attachment path', 400);
                        }
                        unlinkSync(realFilePath);
                        return jsonResponse({ ok: true });
                    } catch {
                        return errorResponse('Failed to delete attachment', 500);
                    }
                }

                return errorResponse('Method not allowed', 405);
            }

                return errorResponse('Not found', 404);
            } catch (error) {
                if (error && typeof error === 'object' && 'code' in error) {
                    const code = (error as any).code;
                    if (code === 'EACCES') {
                        logError('permission denied writing cloud data', error);
                        return errorResponse('Cloud data directory is not writable. Check volume permissions.', 500);
                    }
                }
                logError('request failed', error);
                return errorResponse('Internal server error', 500);
            }
        },
    });

    return {
        port: server.port,
        stop: () => {
            clearInterval(cleanupTimer);
            try {
                (server as { stop?: (closeIdleConnections?: boolean) => void }).stop?.(true);
            } catch {
                // Ignore stop errors during teardown.
            }
        },
    };
}

const isMainModule = typeof Bun !== 'undefined' && (import.meta as ImportMeta & { main?: boolean }).main === true;
if (isMainModule) {
    startCloudServer().catch((err) => {
        logError('Failed to start server', err);
        process.exit(1);
    });
}
