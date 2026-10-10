import { describe, expect, it } from 'vitest';
import { buildBackupPreviewSummary, buildTodoistPreviewSummary, buildTodoistResultMessage } from './data-transfer-messages';
import { getTranslator, resolveI18nText } from './i18n';

const t = getTranslator('en');
const tr = (key: string, values?: Record<string, string | number>) => resolveI18nText(t, key, { values });

// RN meant a blank line between a summary and its project list or warnings (it pushes '' there), but filter(Boolean) dropped it.
describe('Data transfer messages: the blank line before a list', () => {
    it('keeps the blank line before the project list and before the warnings', () => {
        const preview = buildTodoistPreviewSummary({ taskCount: 3, projectCount: 1, sectionCount: 0, checklistItemCount: 0,
            projects: [{ name: 'Home', taskCount: 3 }], warnings: ['Skipped 2 rows without a title.'] }, tr);
        expect(preview.split('\n')).toEqual([tr('settings.backupMobile.importTodoistTasksFromProjects', { taskCount: 3, projectCount: 1 }), '', '• Home: 3', '', expect.any(String)]);
        const result = buildTodoistResultMessage({ importedTaskCount: 3, importedProjectCount: 1, importedChecklistItemCount: 0, warnings: ['x'] }, 'data.snapshot.json', tr);
        expect(result.split('\n')[2]).toBe('');
        const backup = buildBackupPreviewSummary({ metadata: { taskCount: 1, projectCount: 0 }, warnings: ['Skipped 2 rows without a title.'] }, 'Effect.', tr);
        expect(backup.split('\n')[2]).toBe('');
    });

    it('adds no blank line when nothing follows', () => {
        const preview = buildTodoistPreviewSummary({ taskCount: 3, projectCount: 0, sectionCount: 0, checklistItemCount: 0, projects: [], warnings: [] }, tr);
        expect(preview).not.toContain('\n\n');
        expect(preview.endsWith('\n')).toBe(false);
    });
});
