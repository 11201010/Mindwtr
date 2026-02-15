import { Archive as ArchiveIcon, Copy, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import type { Project } from '@mindwtr/core';

type ProjectProgress = {
    total: number;
    doneCount: number;
    remainingCount: number;
};

type ProjectDetailsHeaderProps = {
    project: Project;
    projectColor: string;
    editTitle: string;
    onEditTitleChange: (value: string) => void;
    onCommitTitle: () => void;
    onResetTitle: () => void;
    onDuplicate: () => void;
    onArchive: () => Promise<void> | void;
    onReactivate: () => void;
    onDelete: () => Promise<void> | void;
    isDeleting?: boolean;
    projectProgress?: ProjectProgress | null;
    t: (key: string) => string;
};

export function ProjectDetailsHeader({
    project,
    projectColor,
    editTitle,
    onEditTitleChange,
    onCommitTitle,
    onResetTitle,
    onDuplicate,
    onArchive,
    onReactivate,
    onDelete,
    isDeleting = false,
    projectProgress,
    t,
}: ProjectDetailsHeaderProps) {
    const completedRatio = projectProgress && projectProgress.total > 0
        ? Math.round((projectProgress.doneCount / projectProgress.total) * 100)
        : 0;

    return (
        <header className="mb-4 rounded-xl border border-border/70 bg-background/40 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                    <span
                        className="w-3 h-3 rounded-full border border-border"
                        style={{ backgroundColor: projectColor }}
                        aria-hidden="true"
                    />
                    <div className="flex flex-col min-w-0 flex-1 gap-2">
                        <input
                            value={editTitle}
                            onChange={(e) => onEditTitleChange(e.target.value)}
                            onBlur={onCommitTitle}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    (e.currentTarget as HTMLInputElement).blur();
                                } else if (e.key === 'Escape') {
                                    onResetTitle();
                                    (e.currentTarget as HTMLInputElement).blur();
                                }
                            }}
                            className="text-2xl font-bold truncate bg-transparent border-b border-transparent focus:border-border focus:outline-none w-full"
                            aria-label={t('projects.title')}
                        />
                        {projectProgress ? (
                            <div className="space-y-1.5">
                                <div className="text-xs text-muted-foreground">
                                    {projectProgress.total > 0
                                        ? `${projectProgress.doneCount}/${projectProgress.total} ${t('status.done')} • ${projectProgress.remainingCount} ${t('process.remaining')}`
                                        : t('projects.noActiveTasks')}
                                </div>
                                {projectProgress.total > 0 && (
                                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                        <div
                                            className="h-full rounded-full bg-primary transition-[width] duration-300"
                                            style={{ width: `${completedRatio}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                        ) : null}
                        {project.tagIds && project.tagIds.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                                {project.tagIds.map((tag) => (
                                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-muted/30 text-muted-foreground">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                    <button
                        type="button"
                        onClick={onDuplicate}
                        className="inline-flex items-center gap-1 px-3 h-8 rounded-md text-xs font-medium bg-muted/60 hover:bg-muted text-muted-foreground transition-colors whitespace-nowrap"
                    >
                        <Copy className="w-4 h-4" />
                        {t('projects.duplicate')}
                    </button>
                    {project.status === 'archived' ? (
                        <button
                            type="button"
                            onClick={onReactivate}
                            className="inline-flex items-center gap-1 px-3 h-8 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors whitespace-nowrap"
                        >
                            <RotateCcw className="w-4 h-4" />
                            {t('projects.reactivate')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={onArchive}
                            className="inline-flex items-center gap-1 px-3 h-8 rounded-md text-xs font-medium bg-muted/60 hover:bg-muted text-muted-foreground transition-colors whitespace-nowrap"
                        >
                            <ArchiveIcon className="w-4 h-4" />
                            {t('projects.archive')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onDelete}
                        className="text-destructive hover:bg-destructive/10 h-8 w-8 rounded-md transition-colors flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                        title={t('common.delete')}
                        aria-label={t('common.delete')}
                        disabled={isDeleting}
                        aria-busy={isDeleting}
                    >
                        {isDeleting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Trash2 className="w-4 h-4" />
                        )}
                    </button>
                </div>
            </div>
        </header>
    );
}
