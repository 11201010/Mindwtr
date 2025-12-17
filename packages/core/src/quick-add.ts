import { addDays, addMonths, addWeeks, addYears, isValid, nextDay, parseISO, set } from 'date-fns';
import type { Project, Task, TaskStatus } from './types';
import { normalizeTaskStatus } from './task-status';

export interface QuickAddResult {
    title: string;
    props: Partial<Task>;
}

const STATUS_TOKENS: Record<string, TaskStatus> = {
    inbox: 'inbox',
    next: 'next',
    waiting: 'waiting',
    someday: 'someday',
    done: 'done',
};

const DOW_MAP: Record<string, number> = {
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

function parseNaturalDate(raw: string, now: Date): Date | null {
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
    } else if (DOW_MAP[text] !== undefined) {
        base = nextDay(now, DOW_MAP[text] as any);
    } else if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
        const parsed = parseISO(text);
        if (isValid(parsed)) base = parsed;
    }

    if (!base || !isValid(base)) return null;

    if (time) {
        base = set(base, { hours: time.hour, minutes: time.minute, seconds: 0, milliseconds: 0 });
    } else if (!raw.includes('T')) {
        base = set(base, { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 });
    }

    return base;
}

function stripToken(source: string, token: string): string {
    return source.replace(token, '').replace(/\s{2,}/g, ' ').trim();
}

export function parseQuickAdd(input: string, projects?: Project[], now: Date = new Date()): QuickAddResult {
    let working = input.trim();

    const contexts = new Set<string>();
    const tags = new Set<string>();

    const contextMatches = working.match(/@[\w\-]+/g) || [];
    contextMatches.forEach((ctx) => contexts.add(ctx));
    contextMatches.forEach((ctx) => (working = stripToken(working, ctx)));

    const tagMatches = working.match(/#[\w\-]+/g) || [];
    tagMatches.forEach((tag) => tags.add(tag));
    tagMatches.forEach((tag) => (working = stripToken(working, tag)));

    // Note: /note:...
    let description: string | undefined;
    const noteMatch = working.match(/\/note:([^/]+?)(?=\s\/|$)/i);
    if (noteMatch) {
        description = noteMatch[1].trim();
        working = stripToken(working, noteMatch[0]);
    }

    // Due: /due:...
    let dueDate: string | undefined;
    const dueMatch = working.match(/\/due:([^/]+?)(?=\s\/|$)/i);
    if (dueMatch) {
        const dueText = dueMatch[1].trim();
        const parsed = parseNaturalDate(dueText, now);
        if (parsed) dueDate = parsed.toISOString();
        working = stripToken(working, dueMatch[0]);
    }

    // Status tokens like /next, /todo, etc.
    let status: TaskStatus | undefined;
    const statusMatch = working.match(/\/(inbox|todo|next|in-progress|waiting|someday|done|archived)\b/i);
    if (statusMatch) {
        const token = statusMatch[1].toLowerCase();
        status = STATUS_TOKENS[token] ?? normalizeTaskStatus(token);
        working = stripToken(working, statusMatch[0]);
    }

    // Project: +ProjectName or /project:<id>
    let projectId: string | undefined;
    const projectIdMatch = working.match(/\/project:([^\s/]+)/i);
    if (projectIdMatch) {
        projectId = projectIdMatch[1];
        working = stripToken(working, projectIdMatch[0]);
    } else {
        const plusMatch = working.match(/\+([^\s/]+)/);
        if (plusMatch) {
            const rawProject = plusMatch[1];
            if (projects && projects.length > 0) {
                const found = projects.find((p) => p.title.toLowerCase() === rawProject.toLowerCase());
                if (found) projectId = found.id;
            } else if (/^[0-9a-f-]{8,}$/i.test(rawProject)) {
                projectId = rawProject;
            }
            working = stripToken(working, plusMatch[0]);
        }
    }

    const title = working.replace(/\s{2,}/g, ' ').trim();

    const props: Partial<Task> = {};
    if (status) props.status = status;
    if (dueDate) props.dueDate = dueDate;
    if (description) props.description = description;
    if (contexts.size > 0) props.contexts = Array.from(contexts);
    if (tags.size > 0) props.tags = Array.from(tags);
    if (projectId) props.projectId = projectId;

    return { title, props };
}
