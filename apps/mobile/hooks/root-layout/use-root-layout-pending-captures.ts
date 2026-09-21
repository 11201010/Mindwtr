import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useTaskStore } from '@mindwtr/core';

import { logError, logInfo } from '@/lib/app-log';
import { drainPendingCapturesFromStore } from '@/lib/pending-capture-drain';
import { flushPendingTaskActionSave } from '@/lib/pending-capture-persistence';
import { ingestIosWidgetCompletions } from '@/lib/ios-widget-completions';
import { updateMobileWidgetFromStore } from '@/lib/widget-service';
import { getNextPendingCompletionAt } from '../../modules/ios-widget';
import { mobilePomodoroController } from '@/lib/pomodoro-controller';
import { transcribePendingAudio } from '@/lib/watch-audio';

// Drains background captures and iOS widget actions through the normal store
// on startup and every foreground. Widget actions awaiting the undo grace
// deadline also get one foreground timer; failed claimed actions do not poll.
export function useRootLayoutPendingCaptures({ dataReady, disabled = false }: { dataReady: boolean; disabled?: boolean }) {
    const runningRef = useRef(false);
    const pendingRef = useRef(false);
    const activeRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const enabledRef = useRef(dataReady && !disabled);
    enabledRef.current = dataReady && !disabled;

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const drainQueue = useCallback(async () => {
        if (!enabledRef.current) return;
        clearTimer();
        pendingRef.current = true;
        if (runningRef.current) return;
        runningRef.current = true;
        try {
            do {
                pendingRef.current = false;
                const ingested = await drainPendingCapturesFromStore({
                    transcribeAudio: transcribePendingAudio,
                    applyPomodoroCommand: (command) => {
                        const pomodoroSettings = useTaskStore.getState().settings.gtd?.pomodoro;
                        return mobilePomodoroController.applyWatchCommand(command, {
                            autoStartBreaks: pomodoroSettings?.autoStartBreaks === true,
                            autoStartFocus: pomodoroSettings?.autoStartFocus === true,
                        }, {
                            linkTaskEnabled: pomodoroSettings?.linkTask === true,
                        });
                    },
                });
                // Startup/foreground refreshes can run before a slow queue
                // import finishes. Publish again after its durable store writes,
                // without requiring a manual refresh or another app opening.
                if (ingested > 0 && enabledRef.current) {
                    try {
                        if (await updateMobileWidgetFromStore()) {
                            void logInfo('Widgets refreshed after pending capture import', {
                                scope: 'widget',
                                extra: { releaseCheck: 'v1.3.1/pending-capture-widget-refresh', count: ingested },
                            });
                        }
                    } catch (error) {
                        // The capture is already persisted; a display refresh
                        // failure must not replay it or block other queue work.
                        void logError(error, { scope: 'widget', extra: { message: 'Post-import widget refresh failed' } });
                    }
                }
                if (enabledRef.current) {
                    const { updateTask, tasks } = useTaskStore.getState();
                    await ingestIosWidgetCompletions({
                        updateTask,
                        tasks,
                        getTasks: () => useTaskStore.getState()._allTasks,
                        flushPendingSave: flushPendingTaskActionSave,
                        refreshWidgets: updateMobileWidgetFromStore,
                    });
                }
            } while (pendingRef.current && enabledRef.current);
            // A launch during the three-second undo grace period should drain
            // once it expires, without polling or relying on a widget timer.
            if (activeRef.current && enabledRef.current) {
                const nextAt = await getNextPendingCompletionAt();
                if (activeRef.current && enabledRef.current && nextAt !== null) {
                    timerRef.current = setTimeout(() => {
                        timerRef.current = null;
                        void drainQueue();
                    }, Math.max(0, Math.min(nextAt - Date.now(), 2_147_483_647)));
                }
            }
        } catch (error) {
            void logError(error, { scope: 'shortcuts', extra: { message: 'Pending capture ingest failed' } });
        } finally {
            runningRef.current = false;
            if (pendingRef.current && enabledRef.current) void drainQueue();
        }
    }, [clearTimer]);

    useEffect(() => {
        if (!dataReady || disabled) return;
        activeRef.current = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
        void drainQueue();
        const subscription = AppState.addEventListener('change', (state) => {
            activeRef.current = state === 'active';
            clearTimer();
            if (state === 'active') void drainQueue();
        });
        return () => {
            activeRef.current = false;
            clearTimer();
            subscription.remove();
        };
    }, [dataReady, disabled, drainQueue, clearTimer]);

    return drainQueue;
}
