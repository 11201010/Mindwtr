import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { ReviewHeader } from './review/ReviewHeader';
import { DailyReviewGuideModal } from './review/DailyReviewModal';
import { WeeklyReviewGuideModal } from './review/WeeklyReviewModal';

import { sortTasksBy, useTaskStore, type Project, type Task, type TaskStatus, type TaskSortBy } from '@mindwtr/core';

import { TaskItem } from '../TaskItem';
import { cn } from '../../lib/utils';
import { PromptModal } from '../PromptModal';
import { useLanguage } from '../../contexts/language-context';

export function ReviewView() {
    const { tasks, projects, settings, batchMoveTasks, batchDeleteTasks, batchUpdateTasks } = useTaskStore();
    const { t } = useLanguage();
    const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all');
    const [selectionMode, setSelectionMode] = useState(false);
    const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
    const [tagPromptOpen, setTagPromptOpen] = useState(false);
    const [tagPromptIds, setTagPromptIds] = useState<string[]>([]);
    const [showGuide, setShowGuide] = useState(false);
    const [showDailyGuide, setShowDailyGuide] = useState(false);
    const [moveToStatus, setMoveToStatus] = useState<TaskStatus | ''>('');

    const sortBy = (settings?.taskSortBy ?? 'default') as TaskSortBy;

    const projectMap = useMemo(() => {
        return projects.reduce((acc, project) => {
            acc[project.id] = project;
            return acc;
        }, {} as Record<string, Project>);
    }, [projects]);

    const tasksById = useMemo(() => {
        return tasks.reduce((acc, task) => {
            acc[task.id] = task;
            return acc;
        }, {} as Record<string, Task>);
    }, [tasks]);

    const activeTasks = useMemo(() => {
        return tasks.filter((t) => !t.deletedAt);
    }, [tasks]);

    const statusOptions: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'done'];

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = { all: activeTasks.length };
        for (const status of statusOptions) {
            counts[status] = activeTasks.filter((t) => t.status === status).length;
        }
        return counts;
    }, [activeTasks]);

    const filteredTasks = useMemo(() => {
        const list = filterStatus === 'all' ? activeTasks : activeTasks.filter((t) => t.status === filterStatus);
        return sortTasksBy(list, sortBy);
    }, [activeTasks, filterStatus, sortBy]);

    const selectedIdsArray = useMemo(() => Array.from(multiSelectedIds), [multiSelectedIds]);

    const bulkStatuses: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'done'];

    const exitSelectionMode = useCallback(() => {
        setSelectionMode(false);
        setMultiSelectedIds(new Set());
    }, []);

    useEffect(() => {
        exitSelectionMode();
    }, [filterStatus, exitSelectionMode]);

    const toggleMultiSelect = useCallback((taskId: string) => {
        if (!selectionMode) setSelectionMode(true);
        setMultiSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(taskId)) next.delete(taskId);
            else next.add(taskId);
            return next;
        });
    }, [selectionMode]);

    const handleBatchMove = useCallback(async (newStatus: TaskStatus) => {
        if (selectedIdsArray.length === 0) return;
        await batchMoveTasks(selectedIdsArray, newStatus);
        setMoveToStatus('');
        exitSelectionMode();
    }, [batchMoveTasks, selectedIdsArray, exitSelectionMode]);

    const handleBatchDelete = useCallback(async () => {
        if (selectedIdsArray.length === 0) return;
        await batchDeleteTasks(selectedIdsArray);
        exitSelectionMode();
    }, [batchDeleteTasks, selectedIdsArray, exitSelectionMode]);

    const handleBatchAddTag = useCallback(async () => {
        if (selectedIdsArray.length === 0) return;
        setTagPromptIds(selectedIdsArray);
        setTagPromptOpen(true);
    }, [batchUpdateTasks, selectedIdsArray, tasksById, t, exitSelectionMode]);

    return (
        <ErrorBoundary>
            <div className="space-y-6">
                <ReviewHeader
                    title={t('review.title')}
                    taskCountLabel={`${filteredTasks.length} ${t('common.tasks')}`}
                    selectionMode={selectionMode}
                    onToggleSelection={() => {
                        if (selectionMode) exitSelectionMode();
                        else setSelectionMode(true);
                    }}
                    onShowDailyGuide={() => setShowDailyGuide(true)}
                    onShowGuide={() => setShowGuide(true)}
                    labels={{
                        select: t('bulk.select'),
                        exitSelect: t('bulk.exitSelect'),
                        dailyReview: t('dailyReview.title'),
                        weeklyReview: t('review.openGuide'),
                    }}
                />

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <button
                    onClick={() => setFilterStatus('all')}
                    className={cn(
                        "px-3 py-1.5 text-sm rounded-full border transition-colors whitespace-nowrap shrink-0",
                        filterStatus === 'all'
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                    )}
                >
                    {t('common.all')} ({statusCounts.all})
                </button>
                {statusOptions.map((status) => (
                    <button
                        key={status}
                        onClick={() => setFilterStatus(status)}
                        className={cn(
                            "px-3 py-1.5 text-sm rounded-full border transition-colors whitespace-nowrap shrink-0",
                            filterStatus === status
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                        )}
                    >
                        {t(`status.${status}`)} ({statusCounts[status]})
                    </button>
                ))}
            </div>

            {selectionMode && selectedIdsArray.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 bg-card border border-border rounded-lg p-3">
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">
                            {selectedIdsArray.length} {t('bulk.selected')}
                        </span>
                        <div className="flex items-center gap-2">
                            <label htmlFor="review-bulk-move" className="text-xs text-muted-foreground">
                                {t('bulk.moveTo')}
                            </label>
                            <select
                                id="review-bulk-move"
                                value={moveToStatus}
                                onChange={async (e) => {
                                    const nextStatus = e.target.value as TaskStatus;
                                    setMoveToStatus(nextStatus);
                                    await handleBatchMove(nextStatus);
                                }}
                                className="text-xs bg-muted/50 text-foreground border border-border rounded px-2 py-1 hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                            >
                                <option value="" disabled>
                                    {t('bulk.moveTo')}
                                </option>
                                {bulkStatuses.map((status) => (
                                    <option key={status} value={status}>
                                        {t(`status.${status}`)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleBatchAddTag}
                            className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors"
                        >
                            {t('bulk.addTag')}
                        </button>
                        <button
                            onClick={handleBatchDelete}
                            className="text-xs px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                        >
                            {t('bulk.delete')}
                        </button>
                    </div>
                </div>
            )}

            <div className="space-y-3">
                {filteredTasks.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                        <p>{t('review.noTasks')}</p>
                    </div>
                ) : (
                    filteredTasks.map((task) => (
                        <TaskItem
                            key={task.id}
                            task={task}
                            project={task.projectId ? projectMap[task.projectId] : undefined}
                            selectionMode={selectionMode}
                            isMultiSelected={multiSelectedIds.has(task.id)}
                            onToggleSelect={() => toggleMultiSelect(task.id)}
                        />
                    ))
                )}
            </div>

            {showGuide && (
                <WeeklyReviewGuideModal onClose={() => setShowGuide(false)} />
            )}

            {showDailyGuide && (
                <DailyReviewGuideModal onClose={() => setShowDailyGuide(false)} />
            )}
        </div>
        <PromptModal
            isOpen={tagPromptOpen}
            title={t('bulk.addTag')}
            description={t('bulk.addTag')}
            placeholder="#tag"
            defaultValue=""
            confirmLabel={t('common.save')}
            cancelLabel={t('common.cancel')}
            onCancel={() => setTagPromptOpen(false)}
            onConfirm={async (value) => {
                const input = value.trim();
                if (!input) return;
                const tag = input.startsWith('#') ? input : `#${input}`;
                await batchUpdateTasks(tagPromptIds.map((id) => {
                    const task = tasksById[id];
                    const existingTags = task?.tags || [];
                    const nextTags = Array.from(new Set([...existingTags, tag]));
                    return { id, updates: { tags: nextTags } };
                }));
                setTagPromptOpen(false);
                exitSelectionMode();
            }}
        />
        </ErrorBoundary>
    );
}
