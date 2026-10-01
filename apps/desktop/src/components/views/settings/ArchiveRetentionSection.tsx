import { useEffect, useState } from 'react';
import { getArchiveRetentionPreview, isArchiveRetentionDays, useTaskStore } from '@mindwtr/core';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import type { SettingsSyncLabels } from './sync/types';

export function ArchiveRetentionSection({ t }: { t: SettingsSyncLabels }) {
    const days = useTaskStore((state) => {
        const value = state.settings.gtd?.archiveRetentionDays;
        return isArchiveRetentionDays(value) ? value : 0;
    });
    const [draft, setDraft] = useState(days > 0 ? String(days) : '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const { requestConfirmation, confirmModal } = useConfirmDialog();

    useEffect(() => setDraft(days > 0 ? String(days) : ''), [days]);

    const save = async (nextDays: number) => {
        if (busy || nextDays === days) return;
        setError('');
        if (nextDays > 0 && (days === 0 || nextDays < days)) {
            const state = useTaskStore.getState();
            const data = { tasks: state._allTasks, projects: state._allProjects, sections: state._allSections };
            const preview = getArchiveRetentionPreview(data, nextDays);
            const taskTitles = new Map(data.tasks.map((task) => [task.id, task.title]));
            const projectTitles = new Map(data.projects.map((project) => [project.id, project.title]));
            const sectionTitles = new Map(data.sections.map((section) => [section.id, section.title]));
            const candidates = [
                ...preview.projectIds.map((id) => `${t.projects}: ${projectTitles.get(id) ?? id}`),
                ...preview.sectionIds.map((id) => `${t.archiveRetentionSection}: ${sectionTitles.get(id) ?? id}`),
                ...preview.taskIds.map((id) => `${t.tasks}: ${taskTitles.get(id) ?? id}`),
            ];
            const description = [
                t.archiveRetentionConfirmDescription.replace('{days}', String(nextDays)),
                t.archiveRetentionCounts
                    .replace('{tasks}', String(preview.taskIds.length))
                    .replace('{projects}', String(preview.projectIds.length))
                    .replace('{sections}', String(preview.sectionIds.length)),
                t.archiveRetentionLegacyCount.replace('{count}', String(preview.legacyTaskIds.length + preview.legacyProjectIds.length)),
                candidates.length ? `${t.archiveRetentionCandidates}\n${candidates.join('\n')}` : t.archiveRetentionNoCandidates,
            ].join('\n\n');
            if (!await requestConfirmation({
                title: t.archiveRetentionConfirmTitle,
                description,
                confirmLabel: t.archiveRetentionConfirmAction,
                cancelLabel: t.cancel,
            })) return;
        }
        setBusy(true);
        try {
            const result = await useTaskStore.getState().setArchiveRetentionDays(nextDays);
            if (!result.success) setError(t.archiveRetentionSaveFailed);
        } catch {
            setError(t.archiveRetentionSaveFailed);
        } finally {
            setBusy(false);
        }
    };

    const valid = /^[1-9]\d*$/.test(draft) && Number.isSafeInteger(Number(draft)) && Number(draft) <= 36500;
    return (
        <section className="space-y-3">
            <h2 data-settings-key="archiveRetention" className="text-lg font-semibold">{t.archiveRetention}</h2>
            <div className="bg-card border border-border rounded-lg p-6 space-y-3 text-sm">
                <p className="text-muted-foreground">{t.archiveRetentionDesc}</p>
                <p className="text-muted-foreground">{t.archiveRetentionSafety}</p>
                <p>{t.archiveRetentionCurrent}: {days > 0 ? t.archiveRetentionDays.replace('{days}', String(days)) : t.archiveRetentionNever}</p>
                <div className="flex flex-wrap items-end gap-2">
                    <label className="space-y-1">
                        <span className="block">{t.archiveRetentionDaysLabel}</span>
                        <input
                            type="number"
                            min="1"
                            max="36500"
                            step="1"
                            inputMode="numeric"
                            value={draft}
                            onChange={(event) => { setDraft(event.target.value); setError(''); }}
                            className="w-28 rounded-md border border-border bg-background px-2 py-1.5"
                        />
                    </label>
                    <button type="button" disabled={!valid || busy || Number(draft) === days} onClick={() => void save(Number(draft))} className="rounded-md bg-muted px-3 py-1.5 disabled:opacity-50">
                        {t.archiveRetentionSave}
                    </button>
                    <button type="button" disabled={days === 0 || busy} onClick={() => void save(0)} className="rounded-md bg-muted px-3 py-1.5 disabled:opacity-50">
                        {t.archiveRetentionNever}
                    </button>
                </div>
                {draft && !valid && <p role="alert" className="text-destructive">{t.archiveRetentionInvalid}</p>}
                {error && <p role="alert" className="text-destructive">{error}</p>}
            </div>
            {confirmModal}
        </section>
    );
}
