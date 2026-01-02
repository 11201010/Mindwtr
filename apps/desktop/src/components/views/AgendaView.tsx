import { useMemo, useState } from 'react';
import { useTaskStore, Task, TaskPriority, TimeEstimate, PRESET_CONTEXTS, PRESET_TAGS, matchesHierarchicalToken, getTaskAgeLabel, getTaskStaleness, type TaskStatus, safeFormatDate, safeParseDate, isDueForReview } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { cn } from '../../lib/utils';
import { Clock, Star, Calendar, AlertCircle, ArrowRight, Filter, type LucideIcon } from 'lucide-react';

export function AgendaView() {
    const { tasks, updateTask } = useTaskStore();
    const { t, language } = useLanguage();
    const [selectedTokens, setSelectedTokens] = useState<string[]>([]);
    const [selectedPriorities, setSelectedPriorities] = useState<TaskPriority[]>([]);
    const [selectedTimeEstimates, setSelectedTimeEstimates] = useState<TimeEstimate[]>([]);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [top3Only, setTop3Only] = useState(false);

    // Filter active tasks
    const activeTasks = useMemo(() =>
        tasks.filter(t => !t.deletedAt && t.status !== 'done'),
        [tasks]
    );
    const allTokens = useMemo(() => {
        const taskTokens = activeTasks.flatMap(t => [...(t.contexts || []), ...(t.tags || [])]);
        return Array.from(new Set([...PRESET_CONTEXTS, ...PRESET_TAGS, ...taskTokens])).sort();
    }, [activeTasks]);
    const priorityOptions: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
    const timeEstimateOptions: TimeEstimate[] = ['5min', '10min', '15min', '30min', '1hr', '2hr', '3hr', '4hr', '4hr+'];
    const formatEstimate = (estimate: TimeEstimate) => {
        if (estimate.endsWith('min')) return estimate.replace('min', 'm');
        if (estimate.endsWith('hr+')) return estimate.replace('hr+', 'h+');
        if (estimate.endsWith('hr')) return estimate.replace('hr', 'h');
        return estimate;
    };
    const filteredActiveTasks = useMemo(() => {
        return activeTasks.filter((task) => {
            const taskTokens = [...(task.contexts || []), ...(task.tags || [])];
            if (selectedTokens.length > 0) {
                const matchesAll = selectedTokens.every((token) =>
                    taskTokens.some((taskToken) => matchesHierarchicalToken(token, taskToken))
                );
                if (!matchesAll) return false;
            }
            if (selectedPriorities.length > 0 && (!task.priority || !selectedPriorities.includes(task.priority))) return false;
            if (selectedTimeEstimates.length > 0 && (!task.timeEstimate || !selectedTimeEstimates.includes(task.timeEstimate))) return false;
            return true;
        });
    }, [activeTasks, selectedTokens, selectedPriorities, selectedTimeEstimates]);
    const hasFilters = selectedTokens.length > 0 || selectedPriorities.length > 0 || selectedTimeEstimates.length > 0;
    const showFiltersPanel = filtersOpen || hasFilters;
    const toggleTokenFilter = (token: string) => {
        setSelectedTokens((prev) =>
            prev.includes(token) ? prev.filter((item) => item !== token) : [...prev, token]
        );
    };
    const togglePriorityFilter = (priority: TaskPriority) => {
        setSelectedPriorities((prev) =>
            prev.includes(priority) ? prev.filter((item) => item !== priority) : [...prev, priority]
        );
    };
    const toggleTimeFilter = (estimate: TimeEstimate) => {
        setSelectedTimeEstimates((prev) =>
            prev.includes(estimate) ? prev.filter((item) => item !== estimate) : [...prev, estimate]
        );
    };
    const clearFilters = () => {
        setSelectedTokens([]);
        setSelectedPriorities([]);
        setSelectedTimeEstimates([]);
    };
    const getPriorityBadge = (priority: TaskPriority) => {
        switch (priority) {
            case 'low':
                return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
            case 'medium':
                return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
            case 'high':
                return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
            case 'urgent':
                return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
            default:
                return 'bg-muted text-muted-foreground';
        }
    };

    // Today's Focus: tasks marked as isFocusedToday (max 3)
    const focusedTasks = useMemo(() =>
        filteredActiveTasks.filter(t => t.isFocusedToday).slice(0, 3),
        [filteredActiveTasks]
    );

    // Categorize tasks
    const sections = useMemo(() => {
        const now = new Date();
        const todayStr = now.toDateString();

        const overdue = filteredActiveTasks.filter(t => {
            if (!t.dueDate) return false;
            const dueDate = safeParseDate(t.dueDate);
            return dueDate && dueDate < now && !t.isFocusedToday;
        });
        const dueToday = filteredActiveTasks.filter(t => {
            if (!t.dueDate) return false;
            const dueDate = safeParseDate(t.dueDate);
            return dueDate && dueDate.toDateString() === todayStr &&
                !t.isFocusedToday;
        });
        const nextActions = filteredActiveTasks.filter(t =>
            t.status === 'next' && !t.isFocusedToday
        ).slice(0, 5);

        const reviewDue = filteredActiveTasks.filter(t =>
            (t.status === 'waiting' || t.status === 'someday') &&
            isDueForReview(t.reviewAt, now) &&
            !t.isFocusedToday
        );

        return { overdue, dueToday, nextActions, reviewDue };
    }, [filteredActiveTasks]);
    const focusedCount = focusedTasks.length;
    const top3Candidates = useMemo(() => {
        const byId = new Map<string, Task>();
        [...sections.overdue, ...sections.dueToday, ...sections.nextActions, ...sections.reviewDue].forEach((task) => {
            byId.set(task.id, task);
        });
        return Array.from(byId.values());
    }, [sections]);
    const top3Tasks = useMemo(() => {
        const priorityRank: Record<TaskPriority, number> = {
            low: 1,
            medium: 2,
            high: 3,
            urgent: 4,
        };
        const parseDue = (value?: string) => {
            if (!value) return Number.POSITIVE_INFINITY;
            const parsed = safeParseDate(value);
            return parsed ? parsed.getTime() : Number.POSITIVE_INFINITY;
        };
        const sorted = [...top3Candidates].sort((a, b) => {
            const priorityDiff = (priorityRank[b.priority as TaskPriority] || 0) - (priorityRank[a.priority as TaskPriority] || 0);
            if (priorityDiff !== 0) return priorityDiff;
            const dueDiff = parseDue(a.dueDate) - parseDue(b.dueDate);
            if (dueDiff !== 0) return dueDiff;
            const aCreated = safeParseDate(a.createdAt)?.getTime() ?? 0;
            const bCreated = safeParseDate(b.createdAt)?.getTime() ?? 0;
            return aCreated - bCreated;
        });
        return sorted.slice(0, 3);
    }, [top3Candidates]);
    const remainingCount = Math.max(top3Candidates.length - top3Tasks.length, 0);

    const handleToggleFocus = (taskId: string) => {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        if (task.isFocusedToday) {
            updateTask(taskId, { isFocusedToday: false });
        } else if (focusedCount < 3) {
            updateTask(taskId, { isFocusedToday: true });
        }
    };

    const handleStatusChange = (taskId: string, status: string) => {
        updateTask(taskId, { status: status as TaskStatus });
    };

    const TaskCard = ({ task, showFocusToggle = true }: { task: Task; showFocusToggle?: boolean }) => {
        const canFocus = task.isFocusedToday || focusedCount < 3;
        const ageLabel = getTaskAgeLabel(task.createdAt, language);
        const staleness = getTaskStaleness(task.createdAt);
        const focusTextClass = task.isFocusedToday ? "text-slate-100" : "text-foreground";
        const focusMutedClass = task.isFocusedToday ? "text-slate-300" : "text-muted-foreground";

        return (
            <div className={cn(
                "bg-card border rounded-lg p-4 hover:shadow-md transition-all",
                task.isFocusedToday && "border-yellow-500 bg-slate-900/90 text-slate-100"
            )}>
                <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            {task.isFocusedToday && <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />}
                            <span className={cn(
                                "font-medium truncate",
                                focusTextClass,
                                task.status === 'done' && "line-through text-muted-foreground"
                            )}>
                                {task.title}
                            </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
                            {task.status && (
                                <span className={cn(
                                    "px-2 py-0.5 rounded-full text-white",
                                    task.status === 'inbox' && "bg-slate-500",
                                    task.status === 'next' && "bg-blue-500",
                                    task.status === 'waiting' && "bg-orange-500",
                                    task.status === 'someday' && "bg-purple-500",
                                    task.status === 'done' && "bg-green-600"
                                )}>
                                    {t(`status.${task.status}`)}
                                </span>
                            )}

                            {task.priority && (
                                <span className={cn(
                                    "px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide",
                                    getPriorityBadge(task.priority)
                                )}>
                                    {t(`priority.${task.priority}`)}
                                </span>
                            )}

                            {task.dueDate && (
                                <span className={cn("flex items-center gap-1", focusMutedClass)}>
                                    <Calendar className="w-3 h-3" />
                                    {safeFormatDate(task.dueDate, 'P')}
                                </span>
                            )}

                            {task.timeEstimate && (
                                <span className={cn("flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full", focusMutedClass)}>
                                    <Clock className="w-3 h-3" />
                                    {formatEstimate(task.timeEstimate)}
                                </span>
                            )}

                            {ageLabel && task.status !== 'done' && (
                                <span className={cn(
                                    "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]",
                                    staleness === 'fresh' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
                                    staleness === 'aging' && 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
                                    staleness === 'stale' && 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
                                    staleness === 'very-stale' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                )}>
                                    <Clock className="w-3 h-3" />
                                    {ageLabel}
                                </span>
                            )}

                            {task.contexts?.slice(0, 2).map(ctx => (
                                <span key={ctx} className={focusMutedClass}>{ctx}</span>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {showFocusToggle && (
                            <button
                                onClick={() => handleToggleFocus(task.id)}
                                disabled={!canFocus && !task.isFocusedToday}
                                className={cn(
                                    "p-1.5 rounded-full transition-colors",
                                    task.isFocusedToday
                                        ? "text-yellow-500 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
                                        : canFocus
                                            ? "text-muted-foreground hover:text-yellow-500 hover:bg-muted"
                                            : "text-muted-foreground/30 cursor-not-allowed"
                                )}
                                title={
                                    task.isFocusedToday
                                        ? t('agenda.removeFromFocus')
                                        : focusedCount >= 3
                                            ? t('agenda.maxFocusItems')
                                            : t('agenda.addToFocus')
                                }
                            >
                                <Star className={cn("w-4 h-4", task.isFocusedToday && "fill-current")} />
                            </button>
                        )}

                        <select
                            value={task.status}
                            onChange={(e) => handleStatusChange(task.id, e.target.value)}
                            className="text-xs px-2 py-1 rounded bg-muted/50 text-foreground border border-border hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                            <option value="inbox">{t('status.inbox')}</option>
                            <option value="next">{t('status.next')}</option>
                            <option value="waiting">{t('status.waiting')}</option>
                            <option value="someday">{t('status.someday')}</option>
                            <option value="done">{t('status.done')}</option>
                        </select>
                    </div>
                </div>
            </div>
        );
    };

    const Section = ({ title, icon: Icon, tasks, color }: {
        title: string;
        icon: LucideIcon;
        tasks: Task[];
        color: string;
    }) => {
        if (tasks.length === 0) return null;

        return (
            <div className="space-y-3">
                <h3 className={cn("font-semibold flex items-center gap-2", color)}>
                    <Icon className="w-5 h-5" />
                    {title}
                    <span className="text-muted-foreground font-normal">({tasks.length})</span>
                </h3>
                <div className="space-y-2">
                    {tasks.map(task => (
                        <TaskCard key={task.id} task={task} />
                    ))}
                </div>
            </div>
        );
    };

    const totalActive = activeTasks.length;
    const visibleActive = filteredActiveTasks.length;

    return (
        <div className="space-y-6 max-w-4xl">
            <header>
                <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Calendar className="w-8 h-8" />
                    {t('agenda.title')}
                </h2>
                <p className="text-muted-foreground">
                    {hasFilters ? `${visibleActive} / ${totalActive}` : totalActive} {t('agenda.active')}
                </p>
                <button
                    type="button"
                    onClick={() => setTop3Only((prev) => !prev)}
                    className={cn(
                        "mt-3 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border transition-colors",
                        top3Only
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                    )}
                >
                    {t('agenda.top3Only')}
                </button>
            </header>

            <div className="bg-card border border-border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Filter className="w-4 h-4" />
                        {t('filters.label')}
                    </div>
                    <div className="flex items-center gap-2">
                        {hasFilters && (
                            <button
                                type="button"
                                onClick={clearFilters}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                {t('filters.clear')}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setFiltersOpen((prev) => !prev)}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {showFiltersPanel ? t('filters.hide') : t('filters.show')}
                        </button>
                    </div>
                </div>
                {showFiltersPanel && (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <div className="text-xs text-muted-foreground uppercase tracking-wide">{t('filters.contexts')}</div>
                            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                                {allTokens.map((token) => {
                                    const isActive = selectedTokens.includes(token);
                                    return (
                                        <button
                                            key={token}
                                            type="button"
                                            onClick={() => toggleTokenFilter(token)}
                                            aria-pressed={isActive}
                                            className={cn(
                                                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                                                isActive
                                                    ? "bg-primary text-primary-foreground"
                                                    : "bg-muted hover:bg-muted/80 text-muted-foreground"
                                            )}
                                        >
                                            {token}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <div className="text-xs text-muted-foreground uppercase tracking-wide">{t('filters.priority')}</div>
                            <div className="flex flex-wrap gap-2">
                                {priorityOptions.map((priority) => {
                                    const isActive = selectedPriorities.includes(priority);
                                    return (
                                        <button
                                            key={priority}
                                            type="button"
                                            onClick={() => togglePriorityFilter(priority)}
                                            aria-pressed={isActive}
                                            className={cn(
                                                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                                                isActive
                                                    ? "bg-primary text-primary-foreground"
                                                    : "bg-muted hover:bg-muted/80 text-muted-foreground"
                                            )}
                                        >
                                            {t(`priority.${priority}`)}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <div className="text-xs text-muted-foreground uppercase tracking-wide">{t('filters.timeEstimate')}</div>
                            <div className="flex flex-wrap gap-2">
                                {timeEstimateOptions.map((estimate) => {
                                    const isActive = selectedTimeEstimates.includes(estimate);
                                    return (
                                        <button
                                            key={estimate}
                                            type="button"
                                            onClick={() => toggleTimeFilter(estimate)}
                                            aria-pressed={isActive}
                                            className={cn(
                                                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                                                isActive
                                                    ? "bg-primary text-primary-foreground"
                                                    : "bg-muted hover:bg-muted/80 text-muted-foreground"
                                            )}
                                        >
                                            {formatEstimate(estimate)}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {top3Only ? (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <h3 className="font-semibold">{t('agenda.top3Title')}</h3>
                        {top3Tasks.length > 0 ? (
                            <div className="space-y-2">
                                {top3Tasks.map(task => (
                                    <TaskCard key={task.id} task={task} showFocusToggle={false} />
                                ))}
                            </div>
                        ) : (
                            <p className="text-muted-foreground text-sm">{t('agenda.noTasks')}</p>
                        )}
                    </div>
                    {remainingCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setTop3Only(false)}
                            className="text-xs px-3 py-2 rounded bg-muted/50 text-muted-foreground hover:bg-muted transition-colors"
                        >
                            {t('agenda.showMore').replace('{{count}}', `${remainingCount}`)}
                        </button>
                    )}
                </div>
            ) : (
                <>
                    {/* Today's Focus Section */}
                    <div className="bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-950/60 dark:to-orange-950/40 border border-yellow-200 dark:border-yellow-700 rounded-xl p-6">
                        <h3 className="font-bold text-lg flex items-center gap-2 mb-4 text-slate-900 dark:text-slate-900">
                            <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                            {t('agenda.todaysFocus')}
                            <span className="text-sm font-normal text-slate-600">
                                ({focusedCount}/3)
                            </span>
                        </h3>

                        {focusedTasks.length > 0 ? (
                            <div className="space-y-2">
                                {focusedTasks.map(task => (
                                    <TaskCard key={task.id} task={task} showFocusToggle={true} />
                                ))}
                            </div>
                        ) : (
                            <p className="text-muted-foreground text-center py-4">
                                ⭐ {t('agenda.focusHint')}
                            </p>
                        )}
                    </div>

                    {/* Other Sections */}
                    <div className="space-y-6">
                        <Section
                            title={t('agenda.overdue')}
                            icon={AlertCircle}
                            tasks={sections.overdue}
                            color="text-red-600"
                        />

                        <Section
                            title={t('agenda.dueToday')}
                            icon={Calendar}
                            tasks={sections.dueToday}
                            color="text-yellow-600"
                        />

                        <Section
                            title={t('agenda.nextActions')}
                            icon={ArrowRight}
                            tasks={sections.nextActions}
                            color="text-blue-600"
                        />

                        <Section
                            title={t('agenda.reviewDue') || 'Review Due'}
                            icon={Clock}
                            tasks={sections.reviewDue}
                            color="text-purple-600"
                        />
                    </div>
                </>
            )}

            {visibleActive === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                    <p className="text-4xl mb-4">✨</p>
                    <p className="text-lg font-medium">{t('agenda.allClear')}</p>
                    <p>{hasFilters ? t('filters.noMatch') : t('agenda.noTasks')}</p>
                </div>
            )}
        </div>
    );
}
