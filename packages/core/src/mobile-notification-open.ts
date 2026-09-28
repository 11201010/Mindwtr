/**
 * What a tap on a mobile reminder notification, or on one of its buttons, opens or does.
 * Moved from React Native's hooks/root-layout/use-root-layout-notification-open-handler.ts
 * so the native app routes taps by the same rules.
 *
 * - Dismiss and Snooze open nothing: the notification layer handles them (Snooze is a new
 *   alarm of its own, see buildReminderSnooze).
 * - Done completes the task and opens nothing. It applies once per notification: the
 *   route's `actionKey` names the tap, and an actionable task is the only one it changes.
 * - Otherwise: a task or project review reminder opens Review; a task opens its editor
 *   from Focus; a project opens Projects; a context automation opens its context; a daily
 *   digest opens Daily Review; the weekly review opens Weekly Review.
 */
import { isTaskActionable } from './task-status';
import type { Task } from './types';

export type NotificationOpenPayload = {
    notificationId?: string;
    actionIdentifier?: string;
    taskId?: string;
    projectId?: string;
    context?: string;
    kind?: string;
};

export type NotificationOpenRoute =
    | { type: 'none' }
    | { type: 'complete'; taskId: string; actionKey: string }
    | { type: 'review'; openToken: string; taskId?: string; projectId?: string }
    | { type: 'task'; taskId: string; openToken: string }
    | { type: 'project'; projectId: string }
    | { type: 'contexts'; token: string }
    | { type: 'daily-review'; openToken: string }
    | { type: 'weekly-review'; openToken: string };

/** What Done writes. */
export const REMINDER_COMPLETE_UPDATE = { status: 'done', isFocusedToday: false } as const;

export type ReminderCompletionBlocker = 'task-not-found' | 'task-deleted' | 'not-actionable';

/** Why Done leaves this task alone, or null when it completes it. */
export function getReminderCompletionBlocker(task: Pick<Task, 'status' | 'deletedAt'> | undefined): ReminderCompletionBlocker | null {
    if (!task) return 'task-not-found';
    if (task.deletedAt) return 'task-deleted';
    if (!isTaskActionable(task)) return 'not-actionable';
    return null;
}

function isReviewReminderKind(kind: string | undefined): boolean {
    return kind === 'task-review' || kind === 'project-review';
}

function isWeeklyReviewOpen(kind: string | undefined, notificationId: string): boolean {
    return kind === 'weekly-review' || notificationId === 'digest:weekly-review';
}

function isDailyReviewOpen(kind: string | undefined, notificationId: string): boolean {
    return kind === 'daily-digest' || notificationId === 'digest:morning' || notificationId === 'digest:evening';
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * The route for one notification tap. Fields that are not text are ignored. `now` stamps
 * open tokens when the payload has no notification ID; `nextTaskOpenSequence` numbers task
 * opens, so the same notification reopens the editor every time.
 */
export function resolveNotificationOpenRoute(
    payload: unknown,
    clock: { now: () => number; nextTaskOpenSequence: () => number },
): NotificationOpenRoute {
    const fields = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const rawNotificationId = text(fields.notificationId);
    const notificationId = rawNotificationId === undefined ? undefined : rawNotificationId.trim();
    const openToken = notificationId || String(clock.now());
    const actionIdentifier = text(fields.actionIdentifier);
    const taskId = text(fields.taskId);
    const projectId = text(fields.projectId);
    const context = text(fields.context);
    const kind = text(fields.kind);
    const normalizedAction = String(actionIdentifier || '').trim().toLowerCase();
    if (normalizedAction === 'dismiss' || normalizedAction === 'dismiss_action' || normalizedAction === 'snooze' || normalizedAction === 'snooze_action') {
        return { type: 'none' };
    }
    if ((normalizedAction === 'complete' || normalizedAction === 'complete_action') && taskId) {
        return { type: 'complete', taskId, actionKey: `${openToken}:${taskId}:complete` };
    }
    if (isReviewReminderKind(kind)) {
        return {
            type: 'review',
            openToken,
            ...(taskId ? { taskId } : {}),
            ...(projectId ? { projectId } : {}),
        };
    }
    if (taskId) {
        const sequence = clock.nextTaskOpenSequence();
        return { type: 'task', taskId, openToken: `${notificationId || 'notification'}:${clock.now()}:${sequence}` };
    }
    if (projectId) return { type: 'project', projectId };
    if (kind === 'context-automation' && context) return { type: 'contexts', token: context };
    if (isDailyReviewOpen(kind, openToken)) return { type: 'daily-review', openToken };
    if (isWeeklyReviewOpen(kind, openToken)) return { type: 'weekly-review', openToken };
    return { type: 'none' };
}
