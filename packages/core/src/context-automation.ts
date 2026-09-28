// Context automation (#1015): an automation app (Tasker, MacroDroid, a
// location or Wi-Fi trigger) tells Mindwtr a context became active, and Mindwtr
// answers with one notification listing that context's next actions.
// Deactivation does nothing yet. It arrives as a `mindwtr://` link or as the
// Android broadcast `tech.dongdongbh.mindwtr.action.ACTIVATE_CONTEXT` /
// `DEACTIVATE_CONTEXT`. Moved from React Native's
// `apps/mobile/lib/context-automation.ts` and `context-automation-handler.ts`
// so the native app answers the same way; the host keeps the receiver and
// posts the notification. Nothing here writes the store.
import { formatI18nTemplate } from './i18n';
import { matchesHierarchicalToken } from './hierarchy-utils';
import { isTaskInActiveProject } from './project-utils';
import { resolveFeatureFlags } from './resolve-feature-flags';
import { safeParseDate } from './date';
import { sortFocusNextActions } from './task-utils';
import type { AppSettings, Project, Task } from './types';

export const ANDROID_CONTEXT_ACTIVATE_ACTION = 'tech.dongdongbh.mindwtr.action.ACTIVATE_CONTEXT';
export const ANDROID_CONTEXT_DEACTIVATE_ACTION = 'tech.dongdongbh.mindwtr.action.DEACTIVATE_CONTEXT';
export const CONTEXT_AUTOMATION_NOTIFICATION_KIND = 'context-automation';

export type ContextAutomationAction = 'activate' | 'deactivate';

export type ContextAutomationPayload = {
  action: ContextAutomationAction;
  context: string;
};

export type ContextAutomationNotificationCopy = {
  title: string;
  message: string;
};

export type ContextAutomationNotificationTemplates = {
  noTasksTitle: string;
  noTasksMessage: string;
  oneTaskTitle: string;
  manyTasksTitle: string;
  moreTasksLine: string;
};

const CONTEXT_ROUTE_NAMES = new Set(['context', 'contexts']);

const trimOrUndefined = (value: string | null | undefined): string | undefined => {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : undefined;
};

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeRouteSegments = (url: URL): string[] => {
  const host = trimOrUndefined(url.hostname);
  const pathSegments = url.pathname
    .split('/')
    .map((segment) => trimOrUndefined(safeDecode(segment)))
    .filter((segment): segment is string => Boolean(segment));
  return [
    ...(host ? [safeDecode(host)] : []),
    ...pathSegments,
  ];
};

const normalizeAction = (value: string | null | undefined): ContextAutomationAction | null => {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized === 'activate' || normalized === 'active' || normalized === 'on') return 'activate';
  if (normalized === 'deactivate' || normalized === 'inactive' || normalized === 'off') return 'deactivate';
  return null;
};

const firstQueryValue = (searchParams: URLSearchParams, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = trimOrUndefined(searchParams.get(key));
    if (value) return value;
  }
  return undefined;
};

export function normalizeContextToken(value: string | null | undefined): string {
  const trimmed = trimOrUndefined(value);
  if (!trimmed) return '';
  const withoutLeadingSlashes = trimmed.replace(/^\/+/, '');
  const withoutPrefix = withoutLeadingSlashes.replace(/^[@#]+/, '').trim();
  return withoutPrefix ? `@${withoutPrefix}` : '';
}

export function parseContextAutomationUrl(rawUrl: string): ContextAutomationPayload | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if ((parsed.protocol || '').toLowerCase() !== 'mindwtr:') return null;

  const segments = normalizeRouteSegments(parsed);
  const route = String(segments[0] ?? '').toLowerCase();
  const routeAction = route === 'activate-context'
    ? 'activate'
    : route === 'deactivate-context'
      ? 'deactivate'
      : null;
  const action = routeAction
    ?? normalizeAction(firstQueryValue(parsed.searchParams, ['contextAction', 'action', 'mode']))
    ?? (CONTEXT_ROUTE_NAMES.has(route) ? normalizeAction(segments[1]) : null);
  if (!action) return null;

  const contextFromPath = (() => {
    if (route === 'activate-context' || route === 'deactivate-context') return segments.slice(1).join('/');
    if (!CONTEXT_ROUTE_NAMES.has(route)) return undefined;
    const second = segments[1];
    if (!second) return undefined;
    return normalizeAction(second) ? segments.slice(2).join('/') : segments.slice(1).join('/');
  })();
  const context = normalizeContextToken(
    firstQueryValue(parsed.searchParams, ['context', 'name', 'token'])
    ?? contextFromPath
  );
  if (!context) return null;

  return { action, context };
}

/** What the Android receiver hands on: the broadcast's `url`, or its `action` and `context` extras. */
export type ContextAutomationHeadlessTaskData = {
  action?: unknown;
  context?: unknown;
  url?: unknown;
};

const normalizeHeadlessAction = (value: unknown): ContextAutomationAction | null => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'activate' || normalized === 'active' || normalized === 'on') return 'activate';
  if (normalized === 'deactivate' || normalized === 'inactive' || normalized === 'off') return 'deactivate';
  return null;
};

const normalizeText = (value: unknown): string | null => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
};

/** A parseable `url` wins; otherwise both extras are needed. The extras' context is kept as sent. */
export const parseContextAutomationHeadlessTaskData = (
  data: ContextAutomationHeadlessTaskData | null | undefined
): ContextAutomationPayload | null => {
  if (!data) return null;

  const url = normalizeText(data.url);
  if (url) {
    const payload = parseContextAutomationUrl(url);
    if (payload) return payload;
  }

  const action = normalizeHeadlessAction(data.action);
  const context = normalizeText(data.context);
  if (!action || !context) return null;

  return { action, context };
};

const startsInFuture = (task: Pick<Task, 'startTime'>, now: Date): boolean => {
  if (!task.startTime) return false;
  const start = safeParseDate(task.startTime);
  return Boolean(start && start.getTime() > now.getTime());
};

export function selectContextNextActions(
  tasks: Task[],
  projects: Project[],
  context: string,
  now: Date = new Date(),
  settings?: { features?: AppSettings['features'] } | null,
): Task[] {
  const normalizedContext = normalizeContextToken(context);
  if (!normalizedContext) return [];

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const matchingTasks = tasks.filter((task) => {
    if (task.deletedAt || task.status !== 'next') return false;
    if (!isTaskInActiveProject(task, projectById)) return false;
    if (startsInFuture(task, now)) return false;
    return (task.contexts ?? []).some((taskContext) => {
      const normalizedTaskContext = normalizeContextToken(taskContext);
      return normalizedTaskContext ? matchesHierarchicalToken(normalizedContext, normalizedTaskContext) : false;
    });
  });

  // Every other sortFocusNextActions caller passes the flag; omitting it here
  // meant the context notification listed next actions in an order that
  // ignored priority even while the feature was on.
  return sortFocusNextActions(matchingTasks, {
    now,
    prioritizeByPriority: resolveFeatureFlags(settings).priorities,
  });
}

export function buildContextAutomationNotificationCopy(
  context: string,
  tasks: Pick<Task, 'title'>[],
  templates: Partial<ContextAutomationNotificationTemplates> = {},
): ContextAutomationNotificationCopy {
  const normalizedContext = normalizeContextToken(context);
  const count = tasks.length;
  const interpolate = (template: string) => formatI18nTemplate(template, { context: normalizedContext, count });

  if (count === 0) {
    return {
      title: interpolate(templates.noTasksTitle ?? 'No {{context}} next actions'),
      message: interpolate(templates.noTasksMessage ?? 'Mindwtr did not find any /next tasks for {{context}}.'),
    };
  }

  if (count === 1) {
    return {
      title: interpolate(templates.oneTaskTitle ?? '{{context}} next action'),
      message: tasks[0]?.title || normalizedContext,
    };
  }

  const visibleTasks = tasks.slice(0, 5);
  const hiddenCount = count - visibleTasks.length;
  const taskLines = visibleTasks.map((task) => `- ${task.title}`);
  if (hiddenCount > 0) {
    taskLines.push((templates.moreTasksLine ?? '+{{count}} more').replace(/{{count}}/g, String(hiddenCount)));
  }

  return {
    title: interpolate(templates.manyTasksTitle ?? '{{count}} {{context}} next actions'),
    message: taskLines.join('\n'),
  };
}

export type ResolveContextAutomationText = (key: string, fallback: string) => string;

export const defaultContextAutomationText: ResolveContextAutomationText = (_key, fallback) => fallback;

export type ContextAutomationNotification = ContextAutomationNotificationCopy & {
  /** The notification's data; opening it shows the context (`kind` 'context-automation'). */
  data: { kind: typeof CONTEXT_AUTOMATION_NOTIFICATION_KIND; context: string };
};

/**
 * The notification an automation trigger posts, or null: deactivation, and a
 * context with no next action, post nothing.
 */
export function buildContextAutomationNotification(
  payload: ContextAutomationPayload,
  input: {
    tasks: Task[];
    projects: Project[];
    settings?: { features?: AppSettings['features'] } | null;
    now: Date;
    resolveText: ResolveContextAutomationText;
  },
): ContextAutomationNotification | null {
  if (payload.action === 'deactivate') return null;

  const matchingTasks = selectContextNextActions(input.tasks, input.projects, payload.context, input.now, input.settings);
  if (matchingTasks.length === 0) return null;

  const { resolveText } = input;
  const copy = buildContextAutomationNotificationCopy(payload.context, matchingTasks, {
    noTasksTitle: resolveText('contextAutomation.noNextActionsTitle', 'No {{context}} next actions'),
    noTasksMessage: resolveText('contextAutomation.noNextActionsBody', 'Mindwtr did not find any /next tasks for {{context}}.'),
    oneTaskTitle: resolveText('contextAutomation.oneNextActionTitle', '{{context}} next action'),
    manyTasksTitle: resolveText('contextAutomation.manyNextActionsTitle', '{{count}} {{context}} next actions'),
    moreTasksLine: resolveText('contextAutomation.moreTasksLine', '+{{count}} more'),
  });
  // The receiver's extras keep the context as sent ('home'); the Contexts screen
  // the notification opens matches the token ('@home') only.
  return { ...copy, data: { kind: CONTEXT_AUTOMATION_NOTIFICATION_KIND, context: normalizeContextToken(payload.context) } };
}

const RECENT_CONTEXT_AUTOMATION_TTL_MS = 10_000;

// The Android receiver is open to every automation app by design, and each
// accepted trigger wakes a headless run that loads the whole store. The
// per-key dedupe below is defeated by simply varying the context, so the number
// of starts is capped per window regardless of what the payload says.
//
// Two accepted ceilings on this budget, both fine for the receiver's threat model
// (a hostile automation app on-device) but worth knowing about:
// - The counter is global, not per-source: the user's own foreground deep-link
//   path (e.g. tapping a context:// link) and the Android broadcast receiver's
//   headless wake (open to any automation app) share one throttle. A flood from
//   the receiver can exhaust the window and block the user's own foreground
//   automation for up to CONTEXT_AUTOMATION_RATE_WINDOW_MS.
// - The counter lives in memory, not persisted: a wake that follows process
//   death starts counting from zero again rather than continuing the prior window.
export const CONTEXT_AUTOMATION_RATE_WINDOW_MS = 60_000;
export const CONTEXT_AUTOMATION_MAX_STARTS_PER_WINDOW = 12;

export type ContextAutomationThrottle = {
  /** True when this trigger must be dropped: the same one ran within 10 s, or the window's starts are used up. Otherwise counts it. */
  wasRecentlyHandled(payload: ContextAutomationPayload, nowMs?: number): boolean;
};

export function createContextAutomationThrottle(): ContextAutomationThrottle {
  const recentlyHandled = new Map<string, number>();
  let starts: number[] = [];
  return {
    wasRecentlyHandled(payload, nowMs = Date.now()) {
      for (const [handledKey, handledAtMs] of recentlyHandled.entries()) {
        if (nowMs - handledAtMs > RECENT_CONTEXT_AUTOMATION_TTL_MS) {
          recentlyHandled.delete(handledKey);
        }
      }

      const key = `${payload.action}:${payload.context}`;
      const previousHandledAtMs = recentlyHandled.get(key);
      if (previousHandledAtMs !== undefined && nowMs - previousHandledAtMs <= RECENT_CONTEXT_AUTOMATION_TTL_MS) {
        return true;
      }

      starts = starts.filter((startedAtMs) => nowMs - startedAtMs <= CONTEXT_AUTOMATION_RATE_WINDOW_MS);
      if (starts.length >= CONTEXT_AUTOMATION_MAX_STARTS_PER_WINDOW) {
        return true;
      }
      starts.push(nowMs);

      recentlyHandled.set(key, nowMs);
      return false;
    },
  };
}
