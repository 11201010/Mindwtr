import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { resolveI18nText, useTaskStore } from '@mindwtr/core';

import { runAppleRemindersAutoImport } from '@/lib/apple-reminders-import';
import { logError, logInfo } from '@/lib/app-log';
import { createMobileRecoverySnapshot } from '@/lib/data-transfer';

type ToastOptions = {
    title: string;
    message: string;
    tone: 'warning' | 'error' | 'success' | 'info';
    durationMs?: number;
};

// A foreground burst (unlock, switcher, share sheet) can fire several 'active'
// events in a row; reading the Reminders store each time is wasted work.
const MIN_RUN_GAP_MS = 30_000;

// Runs the opted-in Apple Reminders import on startup and every foreground
// (#1238). iOS gives no background access to Reminders, so this is the only
// moment the app can look. Silent unless something was imported.
export function useRootLayoutAppleRemindersAutoImport({
    dataReady,
    disabled = false,
    showToast,
    t,
}: {
    dataReady: boolean;
    disabled?: boolean;
    showToast: (options: ToastOptions) => void;
    t: (key: string) => string;
}) {
    const runningRef = useRef(false);
    const lastRunAtRef = useRef(0);
    const enabledRef = useRef(dataReady && !disabled);
    enabledRef.current = dataReady && !disabled;
    const showToastRef = useRef(showToast);
    showToastRef.current = showToast;
    const tRef = useRef(t);
    tRef.current = t;

    const run = useCallback(async () => {
        if (!enabledRef.current || runningRef.current) return;
        if (Date.now() - lastRunAtRef.current < MIN_RUN_GAP_MS) return;
        runningRef.current = true;
        lastRunAtRef.current = Date.now();
        try {
            const result = await runAppleRemindersAutoImport({
                addTask: useTaskStore.getState().addTask,
                createRecoverySnapshot: createMobileRecoverySnapshot,
            });
            if (!result || !enabledRef.current) return;
            void logInfo('Apple Reminders auto-import ran', {
                scope: 'import',
                extra: {
                    releaseCheck: 'v1.3.2/apple-reminders-auto-import',
                    imported: result.importedCount,
                    skipped: result.skippedDuplicateCount + result.skippedCompletedCount + result.skippedEmptyTitleCount,
                    deleted: result.deletedCount,
                    failed: result.failedCount + result.deleteFailedCount,
                },
            });
            if (result.importedCount > 0) {
                showToastRef.current({
                    title: resolveI18nText(tRef.current, 'settings.appleRemindersImport.appleReminders'),
                    message: resolveI18nText(tRef.current, 'settings.appleRemindersImport.importedCount', {
                        values: { taskCount: result.importedCount },
                    }),
                    tone: 'success',
                    durationMs: 4200,
                });
            }
        } catch (error) {
            // Never surface a toast here: the user did not ask for anything
            // on this foreground, and the settings button reports errors.
            void logError(error, { scope: 'import', extra: { message: 'Apple Reminders auto-import failed' } });
        } finally {
            runningRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (!dataReady || disabled) return;
        void run();
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') void run();
        });
        return () => subscription.remove();
    }, [dataReady, disabled, run]);
}
