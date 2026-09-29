/**
 * The AI actions' request and apply rules, shared by React Native's hooks and the native host
 * contract: the task editor's copilot, Clarify and Break down, Process Inbox's Clarify, and the
 * Weekly Review's analysis. Each action builds the provider's input here. An answer becomes a
 * dialog whose buttons say what they change; the screen applies that through its normal edits
 * (the editor's draft, the Process Inbox draft) and saves through its normal store commands.
 */
import type {
    BreakdownInput,
    BreakdownResponse,
    ClarifyInput,
    ClarifyResponse,
    ClarifySuggestion,
    ReviewAnalysisResponse,
    ReviewSnapshotItem,
} from './ai/types';
import {
    formatCaptureModalCopilotApplied,
    getCaptureModalCopilotParts,
    keepCaptureModalCopilotSuggestion,
    type CaptureModalCopilotPart,
} from './capture-modal-model';
import { formatAIErrorAlertBody } from './ai/utils';
import { filterReviewSuggestions, isActionableReviewSuggestion, type TitledReviewSuggestion } from './review-views-model';
import { redactSyncText } from './sync-settings-model';
import type { TaskDraft } from './task-draft';
import { getUsedTaskTokens } from './task-token-usage';
import type { AppSettings, ChecklistItem, Project, Task, TimeEstimate } from './types';

type Translate = (key: string) => string;

// ---------------------------------------------------------------------------
// Failures.

const urlPassword = (url: string | undefined): string | null => {
    if (!url) return null;
    try {
        return decodeURIComponent(new URL(url).password) || null;
    } catch {
        return null;
    }
};

/**
 * A failed AI request's error with its text redacted, for the log and the screen: the log
 * sanitizer, no URL credentials, and neither the API key nor the custom endpoint's password
 * (a provider or a local server may echo them back).
 */
export function redactAIError(error: unknown, apiKey: string, settings: AppSettings | undefined): Error {
    const secrets = [apiKey, urlPassword(settings?.ai?.baseUrl)];
    const redacted = new Error(redactSyncText(error instanceof Error ? error.message : String(error), secrets));
    redacted.name = error instanceof Error ? redactSyncText(error.name, secrets) : 'Error';
    return redacted;
}

/** A failed AI request's alert: the generic line, then the redacted detail. */
export const getAIErrorAlert = (error: unknown, t: Translate, apiKey: string, settings: AppSettings | undefined): { title: string; message: string } => ({
    title: t('ai.errorTitle'),
    message: formatAIErrorAlertBody(t('ai.errorBody'), redactAIError(error, apiKey, settings)),
});

// ---------------------------------------------------------------------------
// The editor's copilot.

/** The editor asks the copilot once typing pauses this long. */
export const TASK_COPILOT_DELAY_MS = 800;

/** One separately applicable piece of a copilot suggestion. */
export type TaskCopilotPart = CaptureModalCopilotPart;

/** The text the copilot reads: the title and notes, or null under 4 characters. */
export function getTaskCopilotText(title: string, description: string): string | null {
    const text = [String(title ?? '').trim(), String(description ?? '').trim()].filter(Boolean).join('\n');
    return text.length < 4 ? null : text;
}

// The editor's chips follow the capture screen's rules (#1022): one home for both.
/** The AI's answer as the editor keeps it: null when it holds nothing the chips can show. */
export const keepTaskCopilotSuggestion = keepCaptureModalCopilotSuggestion;
/** The suggestion's parts not applied yet, in chip order. */
export const getTaskCopilotParts = getCaptureModalCopilotParts;
/** The "Applied …" line under the chips (each part spaced), or null when nothing was applied. */
export const formatTaskCopilotApplied = formatCaptureModalCopilotApplied;

const splitDraftTokens = (value: string | undefined) => (
    (value ?? '').split(',').map((token) => token.trim()).filter(Boolean)
);

/**
 * Chips applied to the editor's draft, all at once (applying several tags one at a time would
 * each re-read the same draft and drop all but the last). `patch` holds the draft fields they
 * change; `context`, `tags` and `timeEstimate` are the applied parts (an estimate only while
 * time estimates are on).
 */
export function applyTaskCopilotParts(
    draft: { contexts?: string; tags?: string },
    parts: readonly TaskCopilotPart[],
    timeEstimatesEnabled: boolean,
): { context?: string; tags: string[]; timeEstimate?: TimeEstimate; patch: Partial<Pick<TaskDraft, 'contexts' | 'tags' | 'timeEstimate'>> } {
    const context = parts.find((part) => part.kind === 'context')?.value;
    const estimate = parts.find((part) => part.kind === 'timeEstimate')?.value;
    const tags = parts.filter((part) => part.kind === 'tag').map((part) => part.value);
    const patch: Partial<Pick<TaskDraft, 'contexts' | 'tags' | 'timeEstimate'>> = {};
    if (context) patch.contexts = Array.from(new Set([...splitDraftTokens(draft.contexts), context])).join(', ');
    if (tags.length) patch.tags = Array.from(new Set([...splitDraftTokens(draft.tags), ...tags])).join(', ');
    const timeEstimate = estimate && timeEstimatesEnabled ? estimate as TimeEstimate : undefined;
    if (timeEstimate) patch.timeEstimate = timeEstimate;
    return { ...(context ? { context } : {}), tags, ...(timeEstimate ? { timeEstimate } : {}), patch };
}

// ---------------------------------------------------------------------------
// Project context, Clarify and Break down.

export type TaskAIProjectContext = { projectTitle: string; projectTasks: string[] };

/** The project an editor task is in (`projectId`, the draft's or the saved one), as Clarify and Break down tell the AI. */
export function getTaskAIProjectContext(input: {
    projectId: string | undefined;
    projects: readonly Pick<Project, 'id' | 'title'>[];
    tasks: readonly Task[];
    taskId: string | undefined;
}): TaskAIProjectContext | null {
    if (!input.projectId) return null;
    const project = input.projects.find((item) => item.id === input.projectId);
    const projectTasks = input.tasks
        .filter((item) => item.projectId === input.projectId && item.id !== input.taskId && !item.deletedAt)
        .map((item) => `${item.title}${item.status ? ` (${item.status})` : ''}`)
        .filter(Boolean)
        .slice(0, 20);
    return {
        projectTitle: project?.title || '',
        projectTasks,
    };
}

/**
 * The editor's Clarify question: the title, every context in use and the task's own, its dates
 * (`merged`, the task with the draft applied; a date the draft cleared falls back to the saved
 * one), and its project.
 */
export function buildTaskClarifyInput(input: {
    title: string;
    tasks: Task[];
    task: Pick<Task, 'startTime' | 'dueDate' | 'reviewAt'>;
    merged: Partial<Pick<Task, 'contexts' | 'startTime' | 'dueDate' | 'reviewAt'>>;
    projectContext: TaskAIProjectContext | null | undefined;
}): ClarifyInput {
    const contexts = Array.from(new Set([
        ...getUsedTaskTokens(input.tasks, (item) => item.contexts, { prefix: '@' }),
        ...(input.merged.contexts ?? []),
    ]));
    return {
        title: input.title,
        contexts,
        startTime: input.merged.startTime ?? input.task.startTime,
        dueDate: input.merged.dueDate ?? input.task.dueDate,
        reviewAt: input.merged.reviewAt ?? input.task.reviewAt,
        ...(input.projectContext ?? {}),
    };
}

/** Process Inbox's Clarify question: the title as edited (else the task's) and the contexts on offer. */
export function buildInboxClarifyInput(input: {
    title: string;
    task: Pick<Task, 'title' | 'contexts'>;
    contextPool: readonly string[];
    selectedContexts: readonly string[];
}): ClarifyInput {
    return {
        title: input.title || input.task.title,
        contexts: Array.from(new Set([...input.contextPool, ...input.selectedContexts, ...(input.task.contexts ?? [])])),
    };
}

/** A Clarify dialog button: a new title, the whole suggestion, or Cancel. */
export type AIClarifyChoice = {
    label: string;
    variant?: 'primary' | 'secondary';
    apply: { type: 'title'; title: string } | { type: 'suggestion'; suggestion: ClarifySuggestion } | { type: 'cancel' };
};

/** Clarify's answer as a dialog: up to three rewrites, the suggestion when it has a title, then Cancel. */
export function getAIClarifyDialog(response: ClarifyResponse, t: Translate): { title: string; choices: AIClarifyChoice[] } {
    const choices: AIClarifyChoice[] = response.options.slice(0, 3).map((option) => ({
        label: option.label,
        apply: { type: 'title', title: option.action },
    }));
    if (response.suggestedAction?.title) {
        choices.push({ label: t('ai.applySuggestion'), variant: 'primary', apply: { type: 'suggestion', suggestion: response.suggestedAction } });
    }
    choices.push({ label: t('common.cancel'), variant: 'secondary', apply: { type: 'cancel' } });
    return { title: response.question || t('taskEdit.aiClarify'), choices };
}

/**
 * The editor's "Use suggestion": the title, the estimate, and the context added to the draft's
 * (`title` is set on the title field; `patch` holds the other draft fields, in React Native's order).
 */
export function getTaskClarifySuggestionEdit(
    draftContexts: string | undefined,
    suggested: Pick<ClarifySuggestion, 'title' | 'context' | 'timeEstimate'>,
): { title?: string; patch: Partial<Pick<TaskDraft, 'timeEstimate' | 'contexts'>> } {
    const patch: Partial<Pick<TaskDraft, 'timeEstimate' | 'contexts'>> = {};
    if (suggested.timeEstimate) patch.timeEstimate = suggested.timeEstimate;
    if (suggested.context) patch.contexts = Array.from(new Set([...splitDraftTokens(draftContexts), suggested.context])).join(', ');
    return { ...(suggested.title ? { title: suggested.title } : {}), patch };
}

/** The editor's Break down question: the title, the notes and the project. */
export function buildTaskBreakdownInput(input: { title: string; description: string; projectContext: TaskAIProjectContext | null | undefined }): BreakdownInput {
    return {
        title: input.title,
        description: String(input.description ?? ''),
        ...(input.projectContext ?? {}),
    };
}

/** Break down's answer: at most eight non-blank steps, trimmed. */
export const getTaskBreakdownSteps = (response: BreakdownResponse): string[] => (
    response.steps.map((step) => step.trim()).filter(Boolean).slice(0, 8)
);

/** The steps' dialog: numbered steps, Cancel, and "Add steps". */
export function getTaskBreakdownDialog(steps: readonly string[], t: Translate): {
    title: string;
    message: string;
    cancel: { label: string; variant: 'secondary' };
    add: { label: string; variant: 'primary' };
} {
    return {
        title: t('ai.breakdownTitle'),
        message: steps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
        cancel: { label: t('common.cancel'), variant: 'secondary' },
        add: { label: t('ai.addSteps'), variant: 'primary' },
    };
}

/** "Add steps": the checklist with each step appended as an open item. */
export const appendTaskBreakdownSteps = (checklist: readonly ChecklistItem[], steps: readonly string[], newId: () => string): ChecklistItem[] => [
    ...checklist,
    ...steps.map((step) => ({ id: newId(), title: step, isCompleted: false })),
];

// ---------------------------------------------------------------------------
// The Weekly Review's analysis.

/** The analysis's error line: the redacted detail, or the generic line when the failure says nothing. */
export const getWeeklyReviewAnalysisError = (error: unknown, t: Translate, apiKey: string, settings: AppSettings | undefined): string => (
    redactAIError(error, apiKey, settings).message || t('ai.errorBody')
);

/** The analysis shown: suggestions for items the review offered (as applied), the actionable ones chosen. */
export function readWeeklyReviewAnalysis(response: ReviewAnalysisResponse, staleItems: readonly ReviewSnapshotItem[]): {
    suggestions: TitledReviewSuggestion[];
    selectedIds: string[];
} {
    // Filter here, not in the apply path, so what is displayed and what can be written never diverge.
    const suggestions = filterReviewSuggestions(response.suggestions || [], staleItems);
    return {
        suggestions,
        selectedIds: suggestions.filter(isActionableReviewSuggestion).map((suggestion) => suggestion.id),
    };
}
