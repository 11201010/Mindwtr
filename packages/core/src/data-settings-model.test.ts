import { describe, expect, it } from 'vitest';
import { buildDataSettingsModel } from './data-settings-model';
import { getDocsGuideUrl } from './docs-guidance';
import { getTranslator } from './i18n';
import { createSyncSettingsTranslator } from './sync-settings-model';

/** RN's SyncBackupSection (sync-settings-sections.tsx) and its screen's import guide, key for key. */
describe('Settings › Data model: RN\'s Backup and Import folds', () => {
    it.each(['en', 'ar', 'de', 'zh-Hans'] as const)('reads every text through RN\'s own key (%s)', (language) => {
        const t = getTranslator(language);
        const tr = createSyncSettingsTranslator(t);
        const { backup, importData } = buildDataSettingsModel({}, t, false, language);
        expect(backup).toMatchObject({
            title: t('settings.backup'),
            foldDescription: t('settings.backupDesc'),
            exportLabel: t('settings.exportBackup'),
            description: t('settings.saveToSyncFolder'),
            csvLabel: t('settings.exportCsv'),
            csvDescription: t('settings.exportCsvDesc'),
            tasknotesLabel: t('settings.exportTaskNotes'),
            tasknotesDescription: t('settings.exportTaskNotesDesc'),
            restoreFileLabel: tr('settings.syncMobile.restoreBackup'),
            restoreFileDescription: tr('settings.syncMobile.replaceLocalDataFromABackupJsonFile'),
            mergeLabel: t('settings.mergeBackup'),
            mergeDescription: t('settings.mergeBackupDesc'),
            todoistImportLabel: tr('settings.syncMobile.importFromTodoist'),
            ticktickImportDescription: tr('settings.syncMobile.importTicktickCsvOrZipBackupsIntoMindwtrAreas'),
            csvImportLabel: tr('settings.syncMobile.importFromMindwtrCsv'),
            errorTitle: tr('settings.syncMobile.error'),
            restoreFailed: t('settings.backupMobile.restoreFailed'),
        });
        expect(importData).toEqual({
            title: t('settings.importData'),
            description: t('settings.importDataDesc'),
            guide: { title: t('settings.importSetupGuideTitle'), description: t('settings.importSetupGuideDesc'), url: getDocsGuideUrl('import/', language) },
        });
    });

    it('differs from the keys RN does not use where their words differ', () => {
        const t = getTranslator('de');
        const { backup } = buildDataSettingsModel({}, t, false, 'de');
        expect(backup.restoreFileDescription).not.toBe(t('settings.restoreBackupDesc'));
        expect(backup.description).not.toBe(t('settings.exportBackupDesc'));
    });

    it('gives the import guide the localized docs path', () => {
        expect(buildDataSettingsModel({}, getTranslator('zh-Hans'), false, 'zh-Hans').importData.guide.url).toBe(getDocsGuideUrl('import/', 'zh-Hans'));
        expect(getDocsGuideUrl('import/', 'zh-Hans')).not.toBe(getDocsGuideUrl('import/', 'en'));
    });
});
