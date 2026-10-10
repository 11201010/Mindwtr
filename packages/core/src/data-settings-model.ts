/**
 * Settings › Data's Diagnostics card as React Native draws it (apps/mobile/components/settings/
 * sync-settings-sections.tsx SyncDiagnosticsCard; its actions in use-sync-settings-backup-actions.ts):
 * the analytics opt-out (builds with the heartbeat only), the Debug logging switch, then, while
 * logging is on, Share log and Clear log. Its Encryption block comes with sync and is not here yet. The Backup and Import folds
 * (SyncBackupSection) use RN's own keys: `tr('settings.syncMobile.…')` for Restore and the imports, `settings.saveToSyncFolder`
 * under Export backup, and RN's import guide link.
 */
import { isDiagnosticsLoggingEnabled } from './diagnostics-log';
import { getDocsGuideUrl } from './docs-guidance';
import { createSyncSettingsTranslator } from './sync-settings-model';
import type { AppSettings } from './types';

type Translate = (key: string) => string;

/** RN's result toast durations (use-sync-settings-backup-actions.ts), by the operation core's backup reply names. */
export const DATA_TRANSFER_TOAST_MS = { replace: 5000, merge: 5600, todoist: 5600, ticktick: 6200, dgt: 6200, omnifocus: 6200, csv: 6200 } as const;

export type DataSettingsEdit = { type: 'debugLogging'; value: boolean } | { type: 'analyticsOptOut'; value: boolean };

export type DataSettingsModel = {
    title: string;
    backup: {
        /** RN's folded card heading: `title` over `foldDescription`, chevron up while open. */
        title: string; foldDescription: string; exportLabel: string; description: string; failed: string;
        /** The failure toast's title RN shows for every export failure. */
        errorTitle: string;
        csvLabel: string; csvDescription: string; csvFailed: string;
        csvImportLabel: string; csvImportDescription: string;
        restoreFileLabel: string; restoreFileDescription: string;
        todoistImportLabel: string; todoistImportDescription: string;
        ticktickImportLabel: string; ticktickImportDescription: string;
        dgtImportLabel: string; dgtImportDescription: string;
        omnifocusImportLabel: string; omnifocusImportDescription: string;
        tasknotesLabel: string; tasknotesDescription: string; tasknotesFailed: string;
        mergeLabel: string; mergeDescription: string; mergeFailed: string; snapshotsLabel: string; restoreLabel: string;
        /** RN's toast titles when Restore backup or a snapshot restore fails. */
        restoreFailed: string;
    };
    /** RN's second folded card: the import guide link, then one row per importer. */
    importData: { title: string; description: string; guide: { title: string; description: string; url: string } };
    diagnostics: {
        title: string;
        /**
         * RN's analytics switch, on while the user opted out of the heartbeat; null in a build without one. Turning it on asks
         * `confirm` first (its cancel keeps the heartbeat).
         */
        analytics: {
            label: string; description: string; value: boolean; edit: DataSettingsEdit;
            confirm: { title: string; message: string; keepLabel: string; disableLabel: string };
        } | null;
        debugLogging: { label: string; description: string; value: boolean; edit: DataSettingsEdit };
        shareLog: { label: string; description: string } | null;
        clearLog: { label: string } | null;
        /** RN's toasts after Share and Clear, each titled `toastTitle`. */
        toastTitle: string;
        logMissing: string;
        shareUnavailable: string;
        logCleared: string;
        logClearFailed: string;
    };
};

/** `analyticsAvailable`: the build sends the heartbeat (isMobileAnalyticsHeartbeatConfigured). */
export function buildDataSettingsModel(settings: AppSettings, t: Translate, analyticsAvailable = false, language = 'en'): DataSettingsModel {
    const on = isDiagnosticsLoggingEnabled(settings);
    const optedOut = analyticsAvailable && !isAnalyticsHeartbeatEnabled(settings);
    const tr = createSyncSettingsTranslator(t);
    return {
        title: t('settings.data'),
        backup: {
            title: t('settings.backup'),
            foldDescription: t('settings.backupDesc'),
            exportLabel: t('settings.exportBackup'),
            description: t('settings.saveToSyncFolder'),
            failed: t('settings.backupMobile.failedToExportBackup'),
            errorTitle: tr('settings.syncMobile.error'),
            csvLabel: t('settings.exportCsv'),
            csvDescription: t('settings.exportCsvDesc'),
            csvFailed: t('settings.exportCsvFailed'),
            csvImportLabel: tr('settings.syncMobile.importFromMindwtrCsv'),
            csvImportDescription: tr('settings.syncMobile.importMindwtrCsvFileIntoMindwtrAreasProjectsAndTasks'),
            restoreFileLabel: tr('settings.syncMobile.restoreBackup'),
            restoreFileDescription: tr('settings.syncMobile.replaceLocalDataFromABackupJsonFile'),
            todoistImportLabel: tr('settings.syncMobile.importFromTodoist'),
            todoistImportDescription: tr('settings.syncMobile.importTodoistCsvOrZipExportsIntoMindwtrProjects'),
            ticktickImportLabel: tr('settings.syncMobile.importFromTicktick'),
            ticktickImportDescription: tr('settings.syncMobile.importTicktickCsvOrZipBackupsIntoMindwtrAreas'),
            dgtImportLabel: tr('settings.syncMobile.importFromDgtGtd'),
            dgtImportDescription: tr('settings.syncMobile.importDgtGtdJsonOrZipExportsIntoMindwtrAreas'),
            omnifocusImportLabel: tr('settings.syncMobile.importFromOmnifocus'),
            omnifocusImportDescription: tr('settings.syncMobile.importOmnifocusCsvJsonOrZipExportsIntoMindwtrProjects'),
            tasknotesLabel: t('settings.exportTaskNotes'),
            tasknotesDescription: t('settings.exportTaskNotesDesc'),
            tasknotesFailed: t('settings.exportTaskNotesFailed'),
            mergeLabel: t('settings.mergeBackup'),
            mergeDescription: t('settings.mergeBackupDesc'),
            mergeFailed: t('settings.mergeBackupFailed'),
            snapshotsLabel: t('settings.recoverySnapshots'),
            restoreLabel: t('settings.recoverySnapshotsRestore'),
            restoreFailed: t('settings.backupMobile.restoreFailed'),
        },
        importData: {
            title: t('settings.importData'),
            description: t('settings.importDataDesc'),
            guide: { title: t('settings.importSetupGuideTitle'), description: t('settings.importSetupGuideDesc'), url: getDocsGuideUrl('import/', language) },
        },
        diagnostics: {
            title: t('settings.diagnostics'),
            analytics: analyticsAvailable ? {
                label: t('settings.analyticsHeartbeat'),
                description: t('settings.analyticsHeartbeatDesc'),
                value: optedOut,
                edit: { type: 'analyticsOptOut', value: !optedOut },
                confirm: {
                    title: t('settings.analyticsHeartbeatDisableTitle'),
                    message: t('settings.analyticsHeartbeatDisableDesc'),
                    keepLabel: t('settings.analyticsHeartbeatKeepEnabled'),
                    disableLabel: t('settings.analyticsHeartbeatDisableConfirm'),
                },
            } : null,
            debugLogging: {
                label: t('settings.debugLogging'),
                description: t('settings.debugLoggingDesc'),
                value: on,
                edit: { type: 'debugLogging', value: !on },
            },
            shareLog: on ? { label: t('settings.shareLog'), description: t('settings.logFile') } : null,
            clearLog: on ? { label: t('settings.clearLog') } : null,
            toastTitle: t('settings.debugLogging'),
            logMissing: t('settings.logMissing'),
            shareUnavailable: t('settings.shareUnavailable'),
            logCleared: t('settings.logCleared'),
            logClearFailed: t('settings.logClearFailed'),
        },
    };
}

/** RN's: the heartbeat is on unless the user turned it off. */
export const isAnalyticsHeartbeatEnabled = (settings: AppSettings): boolean => settings.analytics?.heartbeatEnabled !== false;

export const isDataSettingStored = (settings: AppSettings, edit: DataSettingsEdit): boolean => (
    edit.type === 'analyticsOptOut'
        ? !isAnalyticsHeartbeatEnabled(settings) === edit.value
        : isDiagnosticsLoggingEnabled(settings) === edit.value
);

/**
 * RN's toggleDebugLogging (the switch's value, the other diagnostics fields kept) and its analytics switch (heartbeatEnabled
 * set to the opposite of the opt-out, the other analytics fields kept).
 */
export const buildDataSettingsUpdate = (settings: AppSettings, edit: DataSettingsEdit): Partial<AppSettings> => (
    edit.type === 'analyticsOptOut'
        ? { analytics: { ...(settings.analytics ?? {}), heartbeatEnabled: !edit.value } }
        : { diagnostics: { ...(settings.diagnostics ?? {}), loggingEnabled: edit.value } }
);
