import { addDays, addMonths, addWeeks, addYears, isValid, nextDay, parseISO, set } from 'date-fns';
import type { Area, Project, Task, TaskStatus } from './types';
import { normalizeTaskStatus } from './task-status';

export interface QuickAddResult {
    title: string;
    props: Partial<Task>;
    projectTitle?: string;
    invalidDateCommands?: string[];
}

const STATUS_TOKENS: Record<string, TaskStatus> = {
    inbox: 'inbox',
    next: 'next',
    waiting: 'waiting',
    someday: 'someday',
    reference: 'reference',
    done: 'done',
};

type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DOW_MAP: Partial<Record<string, DayOfWeek>> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
};

const ESCAPE_SENTINEL = '__MW_ESC__';
const QUICK_ADD_ESCAPE_CHARS = new Set(['@', '#', '+', '/', '!']);

function protectEscapes(input: string): string {
    let result = '';
    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        if (ch === '\\' && i + 1 < input.length) {
            const next = input[i + 1];
            if (QUICK_ADD_ESCAPE_CHARS.has(next)) {
                result += `${ESCAPE_SENTINEL}${next.charCodeAt(0)}__`;
                i += 1;
                continue;
            }
        }
        result += ch;
    }
    return result;
}

function restoreEscapes(input: string): string {
    return input.replace(new RegExp(`${ESCAPE_SENTINEL}(\\d+)__`, 'g'), (_, code) =>
        String.fromCharCode(Number(code)),
    );
}

function parseTime(text: string): { hour: number; minute: number; rest: string } | null {
    const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    const ampm = match[3]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    const rest = text.replace(match[0], '').trim();
    return { hour, minute, rest };
}

type DateDefaultTimeMode = 'now' | 'startOfDay';

function parseNaturalDate(raw: string, now: Date, defaultTimeMode: DateDefaultTimeMode = 'now'): Date | null {
    let text = raw.trim().toLowerCase();
    const time = parseTime(text);
    if (time) text = time.rest;

    let base: Date | null = null;

    if (text === 'today' || text === '') {
        base = now;
    } else if (text === 'tomorrow') {
        base = addDays(now, 1);
    } else if (text.startsWith('in ')) {
        const inMatch = text.match(/^in\s+(\d+)\s*(day|days|week|weeks|month|months|year|years)$/);
        if (inMatch) {
            const count = Number(inMatch[1]);
            const unit = inMatch[2];
            if (unit.startsWith('day')) base = addDays(now, count);
            else if (unit.startsWith('week')) base = addWeeks(now, count);
            else if (unit.startsWith('month')) base = addMonths(now, count);
            else if (unit.startsWith('year')) base = addYears(now, count);
        }
    } else if (text === 'next week') {
        base = addWeeks(now, 1);
    } else if (text === 'next month') {
        base = addMonths(now, 1);
    } else if (text === 'next year') {
        base = addYears(now, 1);
    } else {
        const dow = DOW_MAP[text];
        if (dow !== undefined) {
            base = nextDay(now, dow);
        } else if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
            const parsed = parseISO(text);
            if (isValid(parsed)) base = parsed;
        }
    }

    if (!base || !isValid(base)) return null;

    if (time) {
        base = set(base, { hours: time.hour, minutes: time.minute, seconds: 0, milliseconds: 0 });
    } else if (!raw.includes('T')) {
        const fallbackHour = defaultTimeMode === 'startOfDay' ? 0 : now.getHours();
        const fallbackMinute = defaultTimeMode === 'startOfDay' ? 0 : now.getMinutes();
        base = set(base, { hours: fallbackHour, minutes: fallbackMinute, seconds: 0, milliseconds: 0 });
    }

    return base;
}

function stripToken(source: string, token: string): string {
    return source.replace(token, '').replace(/\s{2,}/g, ' ').trim();
}

function parseDateCommand(
    command: 'start' | 'due' | 'review',
    working: string,
    now: Date,
): { value?: string; working: string; invalidCommand?: string } {
    const match = working.match(new RegExp(`\\/${command}:([^/]+?)(?=\\s\\/|$)`, 'i'));
    if (!match) return { working };

    const dateText = match[1].trim();
    const defaultTimeMode: DateDefaultTimeMode = command === 'due' ? 'now' : 'startOfDay';
    const parsed = parseNaturalDate(dateText, now, defaultTimeMode);
    if (!parsed) {
        return {
            working,
            invalidCommand: `/${command}:${dateText}`,
        };
    }
    const nextWorking = stripToken(working, match[0]);
    return {
        value: parsed.toISOString(),
        working: nextWorking,
    };
}

export function parseQuickAdd(input: string, projects?: Project[], now: Date = new Date(), areas?: Area[]): QuickAddResult {
    let working = protectEscapes(input.trim());

    const contexts = new Set<string>();
    const tags = new Set<string>();

    const contextMatches = working.match(/@[\p{L}\p{N}_-]+/gu) || [];
    contextMatches.forEach((ctx) => contexts.add(ctx));
    contextMatches.forEach((ctx) => (working = stripToken(working, ctx)));

    const tagMatches = working.match(/#[\p{L}\p{N}_-]+/gu) || [];
    tagMatches.forEach((tag) => tags.add(tag));
    tagMatches.forEach((tag) => (working = stripToken(working, tag)));

    // Area: /area:<id|name> or !Area Name
    let areaId: string | undefined;
    const areaIdMatch = working.match(/\/area:([^\s/]+)/i);
    if (areaIdMatch) {
        const token = restoreEscapes(areaIdMatch[1] ?? '').trim();
        if (token) {
            const matched =
                areas?.find((area) => area.id === token)
                ?? areas?.find((area) => area.name.toLowerCase() === token.toLowerCase());
            if (matched) {
                areaId = matched.id;
            } else if (!areas || areas.length === 0) {
                if (/^[0-9a-f-]{8,}$/i.test(token)) {
                    areaId = token;
                }
            }
        }
        if (areaId) {
            working = stripToken(working, areaIdMatch[0]);
        }
    } else {
        const areaMatch = working.match(/(?:^|\s)!([^\s/]+(?:\s+(?![@#+/!])[^/\s]+)*)/);
        if (areaMatch) {
            const rawArea = restoreEscapes((areaMatch[1] || '').replace(/\s+/g, ' ').trim());
            if (rawArea) {
                if (areas && areas.length > 0) {
                    const found = areas.find((area) => area.name.toLowerCase() === rawArea.toLowerCase());
                    if (found) areaId = found.id;
                } else if (/^[0-9a-f-]{8,}$/i.test(rawArea)) {
                    areaId = rawArea;
                }
            }
            working = stripToken(working, areaMatch[0]);
        }
    }

    // Note: /note:...
    let description: string | undefined;
    const noteMatch = working.match(/\/note:([^/]+?)(?=\s\/|$)/i);
    if (noteMatch) {
        description = restoreEscapes(noteMatch[1].trim());
        working = stripToken(working, noteMatch[0]);
    }

    // Date commands: /start:..., /due:..., /review:...
    const invalidDateCommands: string[] = [];

    const startResult = parseDateCommand('start', working, now);
    let startTime = startResult.value;
    if (startResult.invalidCommand) invalidDateCommands.push(startResult.invalidCommand);
    working = startResult.working;

    const dueResult = parseDateCommand('due', working, now);
    let dueDate = dueResult.value;
    if (dueResult.invalidCommand) invalidDateCommands.push(dueResult.invalidCommand);
    working = dueResult.working;

    const reviewResult = parseDateCommand('review', working, now);
    let reviewAt = reviewResult.value;
    if (reviewResult.invalidCommand) invalidDateCommands.push(reviewResult.invalidCommand);
    working = reviewResult.working;

    // Status tokens like /next, /waiting, etc.
    let status: TaskStatus | undefined;
    const statusMatch = working.match(/\/(inbox|next|in-progress|waiting|someday|done|archived)\b/i);
    if (statusMatch) {
        const token = statusMatch[1].toLowerCase();
        status = STATUS_TOKENS[token] ?? normalizeTaskStatus(token);
        working = stripToken(working, statusMatch[0]);
    }

    // Project: +ProjectName or /project:<id>
    let projectId: string | undefined;
    let projectTitle: string | undefined;
    const projectIdMatch = working.match(/\/project:([^\s/]+)/i);
    if (projectIdMatch) {
        const token = projectIdMatch[1];
        if (token) {
            projectId = token;
        }
        working = stripToken(working, projectIdMatch[0]);
    } else {
        const plusMatch = working.match(/(?:^|\s)\+([^\s/]+(?:\s+(?![@#+/])[^/\s]+)*)/);
        if (plusMatch) {
            const rawProject = restoreEscapes((plusMatch[1] || '').replace(/\s+/g, ' ').trim());
            if (!rawProject) {
                working = stripToken(working, plusMatch[0]);
                const title = restoreEscapes(working.replace(/\s{2,}/g, ' ').trim());
                return { title, props: {} };
            }
            if (projects && projects.length > 0) {
                const found = projects.find((p) => p.title.toLowerCase() === rawProject.toLowerCase());
                if (found) projectId = found.id;
            } else if (/^[0-9a-f-]{8,}$/i.test(rawProject)) {
                projectId = rawProject;
            }
            if (!projectId) {
                projectTitle = rawProject;
            }
            working = stripToken(working, plusMatch[0]);
        }
    }

    const title = restoreEscapes(working.replace(/\s{2,}/g, ' ').trim());

    const props: Partial<Task> = {};
    if (status) props.status = status;
    if (startTime) props.startTime = startTime;
    if (dueDate) props.dueDate = dueDate;
    if (reviewAt) props.reviewAt = reviewAt;
    if (description) props.description = description;
    if (contexts.size > 0) props.contexts = Array.from(contexts);
    if (tags.size > 0) props.tags = Array.from(tags);
    if (projectId) props.projectId = projectId;
    if (areaId) props.areaId = areaId;

    return { title, props, projectTitle, invalidDateCommands: invalidDateCommands.length > 0 ? invalidDateCommands : undefined };
}
