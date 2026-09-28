import {
  buildContextAutomationNotification,
  createContextAutomationThrottle,
  defaultContextAutomationText,
  useTaskStore,
  type ContextAutomationPayload,
  type ContextAutomationThrottle,
  type ResolveContextAutomationText,
} from '@mindwtr/core';

import { sendMobileImmediateNotification } from './notification-service';

// The throttle's rules and its accepted ceilings live in core (context-automation.ts).
export {
  CONTEXT_AUTOMATION_MAX_STARTS_PER_WINDOW,
  CONTEXT_AUTOMATION_RATE_WINDOW_MS,
  defaultContextAutomationText,
} from '@mindwtr/core';
export type { ResolveContextAutomationText } from '@mindwtr/core';

// One throttle for the foreground link and the headless wake, made on first use:
// tests replace @mindwtr/core as a whole.
let throttle: ContextAutomationThrottle | null = null;

export function __resetContextAutomationDedupeForTests(): void {
  throttle = null;
}

export function wasContextAutomationRecentlyHandled(payload: ContextAutomationPayload, nowMs = Date.now()): boolean {
  throttle ??= createContextAutomationThrottle();
  return throttle.wasRecentlyHandled(payload, nowMs);
}

export async function handleContextAutomationPayload(
  payload: ContextAutomationPayload,
  resolveText: ResolveContextAutomationText = defaultContextAutomationText
): Promise<void> {
  const state = useTaskStore.getState();
  const notification = buildContextAutomationNotification(payload, {
    tasks: state.tasks ?? [],
    projects: state.projects ?? [],
    settings: state.settings,
    now: new Date(),
    resolveText,
  });
  if (!notification) return;

  await sendMobileImmediateNotification(notification.title, notification.message, notification.data);
}
