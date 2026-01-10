import React from 'react';
import { DndContext, DragOverlay, useDraggable, useDroppable, DragEndEvent, DragStartEvent, closestCorners } from '@dnd-kit/core';
import { TaskItem } from '../TaskItem';
import { useTaskStore, Task, TaskStatus, sortTasksBy } from '@mindwtr/core';
import type { TaskSortBy } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { Filter } from 'lucide-react';
import { useUiStore } from '../../store/ui-store';

const getColumns = (t: (key: string) => string): { id: TaskStatus; label: string }[] => [
    { id: 'inbox', label: t('list.inbox') || 'Inbox' },
    { id: 'next', label: t('list.next') },
    { id: 'waiting', label: t('list.waiting') },
    { id: 'someday', label: t('list.someday') },
    { id: 'done', label: t('list.done') },
];

const STATUS_BORDER: Record<TaskStatus, string> = {
    inbox: 'border-t-[hsl(var(--status-inbox))]',
    next: 'border-t-[hsl(var(--status-next))]',
    waiting: 'border-t-[hsl(var(--status-waiting))]',
    someday: 'border-t-[hsl(var(--status-someday))]',
    done: 'border-t-[hsl(var(--status-done))]',
};

function DroppableColumn({
    id,
    label,
    tasks,
    emptyState,
    onQuickAdd,
}: {
    id: TaskStatus;
    label: string;
    tasks: Task[];
    emptyState: { title: string; body: string; action: string };
    onQuickAdd: (status: TaskStatus) => void;
}) {
    const { setNodeRef } = useDroppable({ id });

    return (
        <div
            ref={setNodeRef}
            className={`flex flex-col h-full min-w-[240px] flex-1 bg-muted/30 rounded-lg p-4 border border-border/50 border-t-4 ${STATUS_BORDER[id]}`}
        >
            <h3 className="font-semibold mb-4 flex items-center justify-between">
                {label}
                <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{tasks.length}</span>
            </h3>
            <div
                className="flex-1 space-y-3 overflow-y-auto min-h-[100px] focus:outline-none focus:ring-2 focus:ring-primary/50 rounded-md px-1"
                tabIndex={0}
                role="list"
                aria-label={`${label} tasks list`}
            >
                {tasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center text-xs text-muted-foreground py-6 px-2 gap-2">
                        <div className="text-sm font-medium text-foreground">{emptyState.title}</div>
                        <div>{emptyState.body}</div>
                        <button
                            type="button"
                            onClick={() => onQuickAdd(id)}
                            className="mt-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                            {emptyState.action}
                        </button>
                    </div>
                ) : (
                    tasks.map((task) => (
                        <DraggableTask key={task.id} task={task} />
                    ))
                )}
            </div>
        </div>
    );
}

function DraggableTask({ task }: { task: Task }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: task.id,
        data: { task },
    });

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    } : undefined;

    if (isDragging) {
        return (
            <div ref={setNodeRef} style={style} className="opacity-50">
                <TaskItem task={task} readOnly={task.status === 'done'} />
            </div>
        );
    }

    return (
        <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="touch-none">
            <TaskItem task={task} readOnly={task.status === 'done'} />
        </div>
    );
}

export function BoardView() {
    const { tasks, moveTask, settings, projects, areas } = useTaskStore();
    const { t } = useLanguage();
    const sortBy = (settings?.taskSortBy ?? 'default') as TaskSortBy;

    const [activeTask, setActiveTask] = React.useState<Task | null>(null);
    const boardFilters = useUiStore((state) => state.boardFilters);
    const setBoardFilters = useUiStore((state) => state.setBoardFilters);
    const COLUMNS = getColumns(t);
    const NO_PROJECT_FILTER = '__no_project__';
    const hasProjectFilters = boardFilters.selectedProjectIds.length > 0;
    const showFiltersPanel = boardFilters.open || hasProjectFilters;
    const areaById = React.useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas]);
    const sortedProjects = React.useMemo(
        () => projects.filter(p => !p.deletedAt).sort((a, b) => a.title.localeCompare(b.title)),
        [projects]
    );
    const toggleProjectFilter = (projectId: string) => {
        setBoardFilters({
            selectedProjectIds: boardFilters.selectedProjectIds.includes(projectId)
                ? boardFilters.selectedProjectIds.filter((item) => item !== projectId)
                : [...boardFilters.selectedProjectIds, projectId],
        });
    };
    const clearProjectFilters = () => {
        setBoardFilters({ selectedProjectIds: [] });
    };

    const handleDragStart = (event: DragStartEvent) => {
        setActiveTask(event.active.data.current?.task || null);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            // If dropped over a column (which has an ID matching a TaskStatus)
            const status = over.id as TaskStatus;
            if (COLUMNS.some(c => c.id === status)) {
                moveTask(active.id as string, status);
            }
        }

        setActiveTask(null);
    };

    // Sort tasks for consistency, filter out deleted
    const sortedTasks = sortTasksBy(tasks.filter(t => !t.deletedAt), sortBy);
    const filteredTasks = React.useMemo(() => {
        if (!hasProjectFilters) return sortedTasks;
            return sortedTasks.filter((task) => {
            const projectKey = task.projectId ?? NO_PROJECT_FILTER;
            return boardFilters.selectedProjectIds.includes(projectKey);
        });
    }, [hasProjectFilters, sortedTasks, boardFilters.selectedProjectIds]);

    const resolveText = React.useCallback((key: string, fallback: string) => {
        const value = t(key);
        return value === key ? fallback : value;
    }, [t]);

    const openQuickAdd = (status: TaskStatus) => {
        window.dispatchEvent(new CustomEvent('mindwtr:quick-add', {
            detail: { initialProps: { status } },
        }));
    };

    const getEmptyState = (status: TaskStatus) => {
        switch (status) {
            case 'inbox':
                return {
                    title: t('list.inbox') || 'Inbox',
                    body: resolveText('inbox.emptyAddHint', 'Inbox is clear. Capture something new.'),
                    action: t('common.add') || 'Add',
                };
            case 'next':
                return {
                    title: t('list.next') || 'Next Actions',
                    body: resolveText('list.noTasks', 'No next actions yet.'),
                    action: t('common.add') || 'Add',
                };
            case 'waiting':
                return {
                    title: resolveText('waiting.empty', t('list.waiting') || 'Waiting'),
                    body: resolveText('waiting.emptyHint', 'Track delegated or pending items.'),
                    action: t('common.add') || 'Add',
                };
            case 'someday':
                return {
                    title: resolveText('someday.empty', t('list.someday') || 'Someday'),
                    body: resolveText('someday.emptyHint', 'Store ideas for later.'),
                    action: t('common.add') || 'Add',
                };
            case 'done':
                return {
                    title: t('list.done') || 'Done',
                    body: resolveText('list.noTasks', 'Completed tasks appear here.'),
                    action: t('common.add') || 'Add',
                };
            default:
                return {
                    title: t('list.inbox') || 'Inbox',
                    body: resolveText('list.noTasks', 'No tasks yet.'),
                    action: t('common.add') || 'Add',
                };
        }
    };

    return (
        <div className="h-full overflow-x-auto overflow-y-hidden">
            <div className="px-4 pb-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-bold tracking-tight">{t('board.title')}</h2>
                        <span className="text-xs text-muted-foreground">
                            {filteredTasks.length} {t('common.tasks')}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {hasProjectFilters && (
                            <button
                                type="button"
                                onClick={clearProjectFilters}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                {t('filters.clear')}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setBoardFilters({ open: !boardFilters.open })}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {showFiltersPanel ? t('filters.hide') : t('filters.show')}
                        </button>
                    </div>
                </div>

                {showFiltersPanel && (
                    <div className="mt-3 bg-card border border-border rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                            <Filter className="w-4 h-4" />
                            {t('filters.projects')}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => toggleProjectFilter(NO_PROJECT_FILTER)}
                                aria-pressed={selectedProjectIds.includes(NO_PROJECT_FILTER)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                    selectedProjectIds.includes(NO_PROJECT_FILTER)
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted hover:bg-muted/80 text-muted-foreground"
                                }`}
                            >
                                {t('taskEdit.noProjectOption')}
                            </button>
                            {sortedProjects.map((project) => {
                                const isActive = selectedProjectIds.includes(project.id);
                                const projectColor = project.areaId ? areaById.get(project.areaId)?.color : undefined;
                                return (
                                    <button
                                        key={project.id}
                                        type="button"
                                        onClick={() => toggleProjectFilter(project.id)}
                                        aria-pressed={isActive}
                                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-2 ${
                                            isActive
                                                ? "bg-primary text-primary-foreground"
                                                : "bg-muted hover:bg-muted/80 text-muted-foreground"
                                        }`}
                                    >
                                        <span
                                            className="w-2 h-2 rounded-full"
                                            style={{ backgroundColor: projectColor || "#6B7280" }}
                                        />
                                        <span className="truncate max-w-[140px]">{project.title}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex gap-4 h-full min-w-full pb-4 px-4">
                <DndContext
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    collisionDetection={closestCorners}
                >
                    {COLUMNS.map((col) => (
                        <DroppableColumn
                            key={col.id}
                            id={col.id}
                            label={col.label}
                            tasks={filteredTasks.filter(t => t.status === col.id)}
                            emptyState={getEmptyState(col.id)}
                            onQuickAdd={openQuickAdd}
                        />
                    ))}

                    <DragOverlay>
                        {activeTask ? (
                            <div className="w-80 rotate-3 cursor-grabbing">
                                <TaskItem task={activeTask} />
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            </div>
        </div>
    );
}
