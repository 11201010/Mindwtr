import { isSandboxMode } from '@mindwtr/core';
import { Platform } from 'react-native';

import { acknowledgePendingCompletion, claimPendingCompletions } from '../modules/ios-widget';
import { logError, logInfo } from './app-log';
import { applyPendingCompletion } from './pending-captures';
import { buildWidgetCompletionToken } from './widget-completion-token';

type CompletionDeps = Parameters<typeof applyPendingCompletion>[1] & {
    flushPendingSave: () => Promise<void>;
    refreshWidgets: () => Promise<boolean>;
};

// The extension only owns an App Group outbox. The app claims it durably, then
// applies the normal store command (including recurrence), flushes storage and
// publishes a fresh read-only snapshot before removing the pending overlay.
export async function ingestIosWidgetCompletions(deps: CompletionDeps): Promise<number> {
    if (Platform.OS !== 'ios' || isSandboxMode()) return 0;
    const pending = await claimPendingCompletions();
    let count = 0;
    for (const completion of pending) {
        if (isSandboxMode()) break;
        try {
            const task = (deps.getTasks?.() ?? deps.tasks).find(({ id }) => id === completion.taskId);
            const stale = task && !task.deletedAt && !task.purgedAt
                && task.status !== 'done' && task.status !== 'archived'
                && buildWidgetCompletionToken(task) !== completion.token;
            // The action carries the tap time; a garbage or future value is
            // dropped here so the store falls back to "now".
            const tappedAt = completion.createdAt > 0 && completion.createdAt <= Date.now()
                ? new Date(completion.createdAt).toISOString()
                : undefined;
            const outcome = stale ? 'stale' : await applyPendingCompletion({
                kind: 'complete', id: completion.id, taskId: completion.taskId,
                ...(tappedAt ? { completedAt: tappedAt } : {}),
            }, deps);
            if (!outcome) continue;
            if (isSandboxMode()) break;
            // A retry may see an already-completed in-memory task after a failed
            // save. Still flush before acknowledging; never re-run recurrence.
            await deps.flushPendingSave();
            if (isSandboxMode()) break;
            if (!await deps.refreshWidgets()) continue;
            if (isSandboxMode()) break;
            await acknowledgePendingCompletion(completion.id);
            count += 1;
            void logInfo('iOS widget completion ingested', {
                scope: 'widget',
                extra: { releaseCheck: 'v1.3.0/ios-widget-checkoff', outcome },
            });
        } catch (error) {
            // Keep the claimed record for a later lifecycle retry. Do not let a
            // failed action discard this row or prevent independent rows draining.
            void logError(error, { scope: 'widget', extra: { message: 'iOS widget completion ingest failed' } });
        }
    }
    if (count > 0) {
        void logInfo('iOS widget parity completions ingested', {
            scope: 'widget',
            extra: {
                releaseCheck: 'v1.3.1/ios-widget-parity',
                count: String(count),
            },
        });
    }
    return count;
}
