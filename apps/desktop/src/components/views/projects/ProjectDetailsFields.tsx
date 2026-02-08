import type { Project } from '@mindwtr/core';
import { CalendarClock, FolderOpenDot, ListOrdered, Plus, Settings2, Signal, Tags } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { TaskInput } from '../../Task/TaskInput';

type ProjectDetailsFieldsProps = {
    project: Project;
    selectedAreaId: string;
    sortedAreas: { id: string; name: string }[];
    noAreaId: string;
    t: (key: string) => string;
    tagDraft: string;
    onTagDraftChange: (value: string) => void;
    onCommitTags: () => void;
    onNewArea: () => void;
    onManageAreas: () => void;
    onAreaChange: (value: string) => void;
    isSequential: boolean;
    onToggleSequential: () => void;
    status: Project['status'];
    onChangeStatus: (status: Project['status']) => void;
    reviewAtValue: string;
    onReviewAtChange: (value: string) => void;
    projectTaskTitle: string;
    onProjectTaskTitleChange: (value: string) => void;
    onSubmitProjectTask: (value: string) => Promise<void> | void;
    projects: Project[];
    contexts: string[];
    onCreateProject: (title: string) => Promise<string | null>;
};

export function ProjectDetailsFields({
    project,
    selectedAreaId,
    sortedAreas,
    noAreaId,
    t,
    tagDraft,
    onTagDraftChange,
    onCommitTags,
    onNewArea,
    onManageAreas,
    onAreaChange,
    isSequential,
    onToggleSequential,
    status,
    onChangeStatus,
    reviewAtValue,
    onReviewAtChange,
    projectTaskTitle,
    onProjectTaskTitleChange,
    onSubmitProjectTask,
    projects,
    contexts,
    onCreateProject,
}: ProjectDetailsFieldsProps) {
    const sequenceModeLabel = t('projects.sequenceMode');
    const resolvedSequenceModeLabel = sequenceModeLabel === 'projects.sequenceMode' ? 'Flow Mode' : sequenceModeLabel;

    return (
        <>
            <div className="mb-6 rounded-xl border border-border bg-card/70 p-3 sm:p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-12">
                    <div className="space-y-2 min-w-0 2xl:col-span-2">
                        <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5 truncate">
                            <Signal className="h-3.5 w-3.5" />
                            {t('projects.statusLabel')}
                        </label>
                        <select
                            value={status}
                            onChange={(e) => onChangeStatus(e.target.value as Project['status'])}
                            className="h-9 w-full text-sm bg-muted/40 border border-border rounded-md px-2 text-foreground hover:bg-muted/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            disabled={status === 'archived'}
                        >
                            <option value="active">{t('status.active')}</option>
                            <option value="waiting">{t('status.waiting')}</option>
                            <option value="someday">{t('status.someday')}</option>
                        </select>
                    </div>

                    <div className="space-y-2 min-w-0 2xl:col-span-2">
                        <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5 truncate">
                            <ListOrdered className="h-3.5 w-3.5" />
                            {resolvedSequenceModeLabel}
                        </label>
                        <button
                            type="button"
                            onClick={onToggleSequential}
                            className={cn(
                                'h-9 w-full px-2 rounded-md border text-sm flex items-center justify-center gap-2 transition-colors',
                                isSequential
                                    ? 'bg-primary text-primary-foreground border-primary/50'
                                    : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted/60 hover:text-foreground'
                            )}
                            title={isSequential ? t('projects.sequentialTooltip') : t('projects.parallelTooltip')}
                            aria-label={isSequential ? t('projects.sequential') : t('projects.parallel')}
                        >
                            <ListOrdered className="h-4 w-4" />
                            <span>{isSequential ? t('projects.sequential') : t('projects.parallel')}</span>
                        </button>
                    </div>

                    <div className="space-y-2 min-w-0 md:col-span-2 2xl:col-span-4">
                        <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5 truncate">
                            <FolderOpenDot className="h-3.5 w-3.5" />
                            {t('projects.areaLabel')}
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                            <select
                                key={`${project.id}-area`}
                                value={selectedAreaId}
                                onChange={(e) => onAreaChange(e.target.value)}
                                className="h-9 flex-1 min-w-0 text-sm bg-muted/40 border border-border rounded-md px-2 text-foreground hover:bg-muted/60 transition-colors"
                            >
                                <option value={noAreaId}>{t('projects.noArea')}</option>
                                {sortedAreas.map((area) => (
                                    <option key={area.id} value={area.id}>
                                        {area.name}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={onNewArea}
                                className="h-9 w-9 rounded-md border border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors inline-flex items-center justify-center"
                                title={t('projects.create')}
                                aria-label={t('projects.create')}
                            >
                                <Plus className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                onClick={onManageAreas}
                                className="h-9 w-9 rounded-md border border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors inline-flex items-center justify-center"
                                title={t('projects.manageAreas')}
                                aria-label={t('projects.manageAreas')}
                            >
                                <Settings2 className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2 min-w-0 md:col-span-2 2xl:col-span-2">
                        <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5 truncate">
                            <Tags className="h-3.5 w-3.5" />
                            {t('taskEdit.tagsLabel')}
                        </label>
                        <input
                            key={`${project.id}-tags`}
                            type="text"
                            value={tagDraft}
                            onChange={(e) => onTagDraftChange(e.target.value)}
                            onBlur={onCommitTags}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    onCommitTags();
                                    e.currentTarget.blur();
                                }
                            }}
                            placeholder="#feature, #client"
                            className="h-9 w-full text-sm bg-muted/40 border border-border rounded-md px-2 text-foreground hover:bg-muted/60 transition-colors"
                        />
                    </div>

                    <div className="space-y-2 min-w-0 2xl:col-span-2">
                        <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5 truncate">
                            <CalendarClock className="h-3.5 w-3.5" />
                            {t('projects.reviewAt')}
                        </label>
                        <input
                            key={`${project.id}-review`}
                            type="datetime-local"
                            defaultValue={reviewAtValue}
                            onBlur={(e) => onReviewAtChange(e.target.value)}
                            className="h-9 w-full text-sm bg-muted/40 border border-border rounded-md px-2 text-foreground hover:bg-muted/60 transition-colors"
                        />
                    </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                    {t('projects.reviewAtHint')}
                </p>
            </div>

            <div className="mb-6 rounded-xl border border-border bg-card/50 p-3">
                <form
                    onSubmit={async (e) => {
                        e.preventDefault();
                        if (!projectTaskTitle.trim()) return;
                        await onSubmitProjectTask(projectTaskTitle);
                    }}
                    className="flex gap-2"
                >
                    <TaskInput
                        value={projectTaskTitle}
                        projects={projects}
                        contexts={contexts}
                        onCreateProject={onCreateProject}
                        onChange={(next) => onProjectTaskTitleChange(next)}
                        placeholder={t('projects.addTaskPlaceholder')}
                        containerClassName="flex-1"
                        className="h-9 w-full bg-card border border-border rounded-md px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <button
                        type="submit"
                        className="h-9 bg-primary text-primary-foreground px-4 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
                    >
                        {t('projects.addTask')}
                    </button>
                </form>
            </div>
        </>
    );
}
