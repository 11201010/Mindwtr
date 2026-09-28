/**
 * The capture confirmation screen as one module: React Native's capture modal
 * (apps/mobile/app/capture-modal.tsx), the screen that capture links, shares,
 * assistant notes, a widget's or tile's quick capture (`capture-quick`) and
 * in-app openers show. It reads the route params each entry hands the screen,
 * builds what Save writes (one task, or one per line), the copilot chips, and
 * what the screen does after a save or on close. React Native keeps React
 * state, the keyboard, navigation, the AI request, the check that shared files
 * sit in its attachments folder, and logging; the native host contract serves
 * the same screen (native-host-contract-capture-modal.ts).
 *
 * The caller parses: React Native passes its own parseQuickAdd result for the
 * text, built with the screen's one parse-options bag, so the preview chips and
 * the save read the same parse.
 */
import {
    planCaptureTask,
    prepareCaptureTask,
    type CaptureAssemblyInput,
    type CaptureTransactionActions,
    type CaptureTransactionOptions,
} from './capture';
import type { TranslateFn } from './i18n';
import { isSelectableProjectForTaskAssignment } from './project-utils';
import type { QuickAddResult } from './quick-add';
import { isSandboxMode } from './sandbox';
import type { StoreActionResult } from './store-types';
import { sanitizeAttachmentUriForSyncMerge } from './sync-normalization';
import type { Attachment, Project, Task, TimeEstimate } from './types';

export type CaptureModalParam = string | string[] | undefined;

/** The screen's route params: what each entry hands it. */
export type CaptureModalParams = {
    /** Preset task props as URI-encoded JSON (description, tags, contexts, status, projectId, areaId, shared files). */
    initialProps?: CaptureModalParam;
    initialValue?: CaptureModalParam;
    /** 'system' when a widget, tile, shortcut or notification opened the screen (#1169); 'share' for an iOS share. */
    origin?: CaptureModalParam;
    /** A capture link's project: an id or a title. */
    project?: CaptureModalParam;
    /** The app path to go to when nothing sits behind the screen. */
    returnTo?: CaptureModalParam;
    text?: CaptureModalParam;
    title?: CaptureModalParam;
};

const URL_INITIAL_TASK_STATUSES = new Set<Task['status']>(['inbox', 'next', 'waiting', 'someday', 'reference']);
const MAX_INITIAL_ATTACHMENTS = 6;

const firstSearchParam = (value: CaptureModalParam): string => {
    if (Array.isArray(value)) return value[0] ?? '';
    return typeof value === 'string' ? value : '';
};

const decodeSearchParam = (value: CaptureModalParam): string => {
    const raw = firstSearchParam(value);
    if (!raw) return '';
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
};

/** The `returnTo` param when it is an app path: no scheme, no protocol-relative host, no control characters. */
export const sanitizeCaptureReturnToParam = (value: CaptureModalParam): string | null => {
    const decoded = decodeSearchParam(value).trim();
    if (!decoded || !decoded.startsWith('/') || decoded.startsWith('//')) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001F\u007F]/.test(decoded)) return null;
    return decoded;
};

const parseInitialPropsJson = (value: CaptureModalParam): Record<string, unknown> => {
    const decoded = decodeSearchParam(value);
    if (!decoded) return {};
    try {
        const parsed = JSON.parse(decoded);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return parsed as Record<string, unknown>;
    } catch {
        return {};
    }
};

const normalizeInitialTokenList = (value: unknown, prefix?: '@' | '#'): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const seen = new Set<string>();
    const next: string[] = [];
    value.forEach((item) => {
        if (typeof item !== 'string') return;
        const trimmed = item.trim();
        if (!trimmed) return;
        const normalized = prefix && !trimmed.startsWith(prefix) ? `${prefix}${trimmed}` : trimmed;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        next.push(normalized);
    });
    return next.length > 0 ? next : undefined;
};

// Share-intent file captures arrive as attachment records in the route's
// initialProps (the share handler already copied the bytes into the managed
// attachments dir). Route params are attacker-reachable via deep links, so
// only structurally valid file records survive here; capture request assembly
// additionally drops any uri outside the managed attachments dir.
const sanitizeInitialAttachments = (value: unknown): Attachment[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const next: Attachment[] = [];
    for (const item of value) {
        if (next.length >= MAX_INITIAL_ATTACHMENTS) break;
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        if (record.kind !== 'file') continue;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const uri = sanitizeAttachmentUriForSyncMerge(record.uri) ?? '';
        if (!id || !uri) continue;
        const now = new Date().toISOString();
        const createdAt = typeof record.createdAt === 'string' && record.createdAt ? record.createdAt : now;
        const attachment: Attachment = {
            id,
            kind: 'file',
            title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : 'Attachment',
            uri,
            createdAt,
            updatedAt: typeof record.updatedAt === 'string' && record.updatedAt ? record.updatedAt : createdAt,
            localStatus: 'available',
        };
        if (typeof record.mimeType === 'string' && record.mimeType.trim()) {
            attachment.mimeType = record.mimeType.trim();
        }
        if (typeof record.size === 'number' && Number.isFinite(record.size)) {
            attachment.size = record.size;
        }
        next.push(attachment);
    }
    return next.length > 0 ? next : undefined;
};

/**
 * The preset props the `initialProps` param carries, as far as the screen
 * trusts them: shared files (not in sandbox mode), a non-blank description,
 * tags and contexts (prefixed, without repeats), a capture status, a project
 * that takes tasks, else a live area.
 */
export function readCaptureModalInitialProps(
    value: CaptureModalParam,
    projects: readonly Project[],
    areas: ReadonlyArray<{ id: string; deletedAt?: string | null }>,
): Partial<Task> {
    const parsed = parseInitialPropsJson(value);
    const next: Partial<Task> = {};

    const attachments = isSandboxMode() ? undefined : sanitizeInitialAttachments(parsed.attachments);
    if (attachments) next.attachments = attachments;

    if (typeof parsed.description === 'string' && parsed.description.trim()) {
        next.description = parsed.description;
    }

    const tags = normalizeInitialTokenList(parsed.tags, '#');
    if (tags) next.tags = tags;

    const contexts = normalizeInitialTokenList(parsed.contexts, '@');
    if (contexts) next.contexts = contexts;

    const status = typeof parsed.status === 'string' ? parsed.status.trim().toLowerCase() : '';
    if (URL_INITIAL_TASK_STATUSES.has(status as Task['status'])) {
        next.status = status as Task['status'];
    }

    const projectId = typeof parsed.projectId === 'string' ? parsed.projectId.trim() : '';
    if (projectId && projects.some((project) => project.id === projectId && isSelectableProjectForTaskAssignment(project))) {
        next.projectId = projectId;
    }

    const areaId = typeof parsed.areaId === 'string' ? parsed.areaId.trim() : '';
    if (!next.projectId && areaId && areas.some((area) => area.id === areaId && !area.deletedAt)) {
        next.areaId = areaId;
    }

    return next;
}

/** The title field's first text: `initialValue`, else `text`, else `title`. */
export const readCaptureModalInitialText = (params: CaptureModalParams): string => (
    decodeSearchParam(params.initialValue)
    || decodeSearchParam(params.text)
    || decodeSearchParam(params.title)
);

/** A capture link's project param (an id or a title), trimmed. */
export const readCaptureModalProjectParam = (params: CaptureModalParams): string => decodeSearchParam(params.project).trim();

/** Who opened the screen: a system entry point (widget, tile, shortcut, notification), an iOS share, or neither. */
export const readCaptureModalOrigin = (params: CaptureModalParams): 'system' | 'share' | null => {
    const origin = firstSearchParam(params.origin);
    return origin === 'system' || origin === 'share' ? origin : null;
};

// ---------------------------------------------------------------------------
// The copilot

/** What the AI suggested for the title. */
export type CaptureModalCopilotSuggestion = { context?: string; timeEstimate?: TimeEstimate; tags?: string[] };
/** The suggested parts the user applied; they are added to the saved task. */
export type CaptureModalCopilotApplied = { context?: string; timeEstimate?: TimeEstimate; tags: string[] };
/** One separately applicable piece of a suggestion. */
export type CaptureModalCopilotPart = { kind: 'context' | 'timeEstimate' | 'tag'; value: string };

/** Whether the screen asks the AI about this title: AI on, a key when one is required, and 4 characters or more. */
export function shouldRequestCaptureModalCopilot(input: { aiEnabled: boolean; keyRequired: boolean; hasKey: boolean; title: string }): boolean {
    if (!input.aiEnabled || (input.keyRequired && !input.hasKey)) return false;
    return input.title.length >= 4;
}

/** The AI's answer as the screen keeps it: null when it holds nothing the screen can show. */
export function keepCaptureModalCopilotSuggestion<T extends CaptureModalCopilotSuggestion>(suggestion: T, timeEstimatesEnabled: boolean): T | null {
    if (!suggestion.context && (!timeEstimatesEnabled || !suggestion.timeEstimate) && !suggestion.tags?.length) return null;
    return suggestion;
}

/** The suggestion's parts not applied yet, in the order the chips show them. */
export function getCaptureModalCopilotParts(
    suggestion: CaptureModalCopilotSuggestion | null,
    applied: CaptureModalCopilotApplied,
    timeEstimatesEnabled: boolean,
): CaptureModalCopilotPart[] {
    if (!suggestion) return [];
    const parts: CaptureModalCopilotPart[] = [];
    if (suggestion.context && suggestion.context !== applied.context) {
        parts.push({ kind: 'context', value: suggestion.context });
    }
    if (timeEstimatesEnabled && suggestion.timeEstimate && suggestion.timeEstimate !== applied.timeEstimate) {
        parts.push({ kind: 'timeEstimate', value: suggestion.timeEstimate });
    }
    for (const tag of suggestion.tags ?? []) {
        if (!applied.tags.includes(tag)) parts.push({ kind: 'tag', value: tag });
    }
    return parts;
}

/** Apply chips (one, or all with "Apply all"). An estimate applies only while time estimates are on. */
export function applyCaptureModalCopilotParts(
    applied: CaptureModalCopilotApplied,
    parts: readonly CaptureModalCopilotPart[],
    timeEstimatesEnabled: boolean,
): CaptureModalCopilotApplied {
    const context = parts.find((part) => part.kind === 'context')?.value;
    const estimate = parts.find((part) => part.kind === 'timeEstimate')?.value;
    const tags = parts.filter((part) => part.kind === 'tag').map((part) => part.value);
    return {
        context: context || applied.context,
        timeEstimate: estimate && timeEstimatesEnabled ? estimate as TimeEstimate : applied.timeEstimate,
        tags: tags.length ? Array.from(new Set([...applied.tags, ...tags])) : applied.tags,
    };
}

/** The "Applied …" line under the chips, or null when nothing was applied. */
export function formatCaptureModalCopilotApplied(
    t: TranslateFn,
    applied: CaptureModalCopilotApplied,
    timeEstimatesEnabled: boolean,
): string | null {
    if (!applied.context && !applied.timeEstimate && applied.tags.length === 0) return null;
    return `${t('copilot.applied')} ${applied.context ? `${applied.context} ` : ''}`
        + `${timeEstimatesEnabled && applied.timeEstimate ? applied.timeEstimate : ''}`
        + `${applied.tags.length ? applied.tags.join(' ') : ''}`;
}

// ---------------------------------------------------------------------------
// Saving

/**
 * The capture transaction's input for one text (the whole field, or one line).
 * A capture link's `project` param is a best-effort fallback, not a typed
 * +Project token: with no project parsed from the text, a project with that id
 * or title (any case) is used when it takes tasks, skipped when it does not,
 * and created when none matches. The description field, which starts with the
 * entry's description, is the saved description; a /note: token in the text
 * follows it. Applied copilot parts are added.
 */
export function buildCaptureModalRequest(input: {
    /** parseQuickAdd(text, projects, now, areas, the screen's parse options). */
    parsed: QuickAddResult;
    text: string;
    projects: readonly Project[];
    /** readCaptureModalInitialProps, its files limited to the ones the app manages. */
    initialProps: Partial<Task>;
    /** readCaptureModalProjectParam. */
    projectParam: string;
    /** resolveDefaultNewTaskAreaId. */
    defaultAreaId: string | undefined;
    description: string;
    copilot: CaptureModalCopilotApplied;
    timeEstimatesEnabled: boolean;
}): { input: CaptureAssemblyInput; options: CaptureTransactionOptions } {
    const { parsed, copilot } = input;
    // The description field shows the entry's description and owns it: what it holds is saved.
    const { description: _shown, ...surfaceProps } = input.initialProps;
    let fallbackProjectTitleToCreate: string | undefined;
    if (!parsed.props.projectId && !parsed.projectTitle && input.projectParam) {
        const ref = input.projectParam.toLowerCase();
        const match = input.projects.find((project) => (
            project.id === input.projectParam || project.title.toLowerCase() === ref
        ));
        if (!match) {
            fallbackProjectTitleToCreate = input.projectParam;
        } else if (isSelectableProjectForTaskAssignment(match)) {
            surfaceProps.projectId = match.id;
        }
    }
    return {
        input: {
            parsed: fallbackProjectTitleToCreate ? { ...parsed, projectTitle: fallbackProjectTitleToCreate } : parsed,
            rawInput: input.text,
            projects: input.projects,
            initialProps: surfaceProps,
            selectedAreaId: input.defaultAreaId,
            starNewTask: false,
        },
        options: {
            transformProps: (props) => {
                const taskProps = { ...props };
                const description = input.description.trim();
                const parsedDescription = typeof taskProps.description === 'string' ? taskProps.description.trim() : '';
                if (description) {
                    taskProps.description = parsedDescription && parsedDescription !== description
                        ? `${description}\n${parsedDescription}`
                        : description;
                }
                if (copilot.context) {
                    taskProps.contexts = Array.from(new Set([...(taskProps.contexts ?? []), copilot.context]));
                }
                if (input.timeEstimatesEnabled && copilot.timeEstimate && !taskProps.timeEstimate) {
                    taskProps.timeEstimate = copilot.timeEstimate;
                }
                if (copilot.tags.length) {
                    taskProps.tags = Array.from(new Set([...(taskProps.tags ?? []), ...copilot.tags]));
                }
                return taskProps;
            },
        },
    };
}

type CaptureModalRequest = ReturnType<typeof buildCaptureModalRequest>;

export type CaptureModalLinesOutcome =
    | { kind: 'saved'; count: number }
    /** A line's date command could not be read: warn with these; nothing more is written. */
    | { kind: 'refused'; invalidDateCommands: string[] }
    /**
     * Nothing was written: a line gave no request ('validation-rejected'), a line
     * could not be prepared ('prepare-failed'), or the store refused the batch
     * ('transaction-rejected').
     */
    | { kind: 'failed'; stage: 'validation-rejected' | 'prepare-failed' | 'transaction-rejected' };

/**
 * Create one task per line in one store write, as "Create tasks" does. Each
 * line's request sees the projects earlier lines created. Shared files stay on
 * the first task only: the records share ids, so copies would alias one file.
 * Throws when a store action or `buildRequest` throws; `onWrite` runs just
 * before the batch write, so the caller can tell a throw there apart.
 */
export async function saveCaptureModalLines(input: {
    lines: readonly string[];
    projects: readonly Project[];
    buildRequest: (line: string, projects: readonly Project[]) => Promise<CaptureModalRequest | null>;
    actions: Pick<CaptureTransactionActions, 'addProject'> & {
        addTasks: (items: { title: string; initialProps: Partial<Task>; captureId?: string }[]) => Promise<StoreActionResult>;
    };
    /** One capture UUID per line, for exact retries. */
    captureIds?: readonly string[];
    onWrite?: () => void;
}): Promise<CaptureModalLinesOutcome> {
    const items: { title: string; initialProps: Partial<Task>; captureId?: string }[] = [];
    let projects = input.projects;
    for (const line of input.lines) {
        const request = await input.buildRequest(line, projects);
        if (!request) return { kind: 'failed', stage: 'validation-rejected' };
        const prepared = await prepareCaptureTask(request.input, input.actions, request.options);
        if (!prepared.success && prepared.reason === 'invalid-date-command') {
            return { kind: 'refused', invalidDateCommands: prepared.invalidDateCommands };
        }
        if (!prepared.success) return { kind: 'failed', stage: 'prepare-failed' };
        const captureId = input.captureIds?.[items.length];
        items.push({ title: prepared.title, initialProps: prepared.props, ...(captureId ? { captureId } : {}) });
        if (prepared.createdProject) projects = [...projects, prepared.createdProject];
    }
    items.forEach((item, index) => {
        if (index > 0) delete item.initialProps.attachments;
    });
    input.onWrite?.();
    const result = await input.actions.addTasks(items);
    if (result && typeof result === 'object' && result.success === false) return { kind: 'failed', stage: 'transaction-rejected' };
    return { kind: 'saved', count: items.length };
}

/** What a request would write, without writing (the project it would create included). */
export const planCaptureModalRequest = (request: CaptureModalRequest) => planCaptureTask(request.input, request.options);

// ---------------------------------------------------------------------------
// Leaving the screen

/** Where closing goes: back to the screen behind, else the safe `returnTo`, else the Inbox. */
export const getCaptureModalCloseTarget = (canGoBack: boolean, returnTo: string | null): 'back' | string => (
    canGoBack ? 'back' : returnTo ?? '/inbox'
);

/**
 * The project a project screen's + button opened the screen from: the inverse
 * of React Native's buildProjectQuickCaptureReturnTo (projects-screen.utils.ts).
 */
export const getProjectQuickCaptureReturnToProjectId = (returnTo: string | null | undefined): string | null => {
    if (!returnTo) return null;
    const match = returnTo.match(/^\/projects-screen\?projectId=([^&]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
};

/** What the screen does after a save. */
export type CaptureModalAfterSave =
    /**
     * Close (getCaptureModalCloseTarget). A system entry point's capture then puts
     * the app behind the screen the user came from (#1169).
     */
    | { kind: 'close'; returnToPreviousApp: boolean }
    /**
     * Save and edit from a project's own + button, the task still in that
     * project: leave the editor request for the project screen, then close
     * without leaving the app. Opening the project again would stack a
     * duplicate of it (#938).
     */
    | { kind: 'openInProject'; taskId: string; projectId: string }
    /** Save and edit: replace the screen with the task's editor, so backing out never reopens the saved text (#1029). */
    | { kind: 'open'; taskId: string; projectId: string | undefined };

export function resolveCaptureModalAfterSave(input: {
    openAfterSave: boolean;
    taskId: string | undefined;
    projectId: string | undefined;
    returnTo: string | null;
    origin: 'system' | 'share' | null;
}): CaptureModalAfterSave {
    if (input.openAfterSave && input.taskId) {
        const projectId = getProjectQuickCaptureReturnToProjectId(input.returnTo);
        return projectId && input.projectId === projectId
            ? { kind: 'openInProject', taskId: input.taskId, projectId }
            : { kind: 'open', taskId: input.taskId, projectId: input.projectId };
    }
    return { kind: 'close', returnToPreviousApp: input.origin === 'system' };
}

/** The question before creating one task per line: the capture popup's own. */
export { getQuickCaptureBulkConfirm as getCaptureModalBulkConfirm } from './quick-capture-model';
