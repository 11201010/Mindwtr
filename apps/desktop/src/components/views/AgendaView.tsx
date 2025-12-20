import { useMemo } from 'react';
import { useTaskStore, Task, getTaskAgeLabel, getTaskStaleness, type TaskStatus, safeFormatDate, safeParseDate, isDueForReview } from '@mindwtr/core';
import { useLanguage } from '../../contexts/language-context';
import { cn } from '../../lib/utils';
import { Clock, Star, Calendar, AlertCircle, ArrowRight, type LucideIcon } from 'lucide-react';

export function AgendaView() {
    const { tasks, updateTask } = useTaskStore();
    const { t, language } = useLanguage();

    // Filter active tasks
    const activeTasks = useMemo(() =>
        tasks.filter(t => !t.deletedAt && t.status !== 'done'),
        [tasks]
    );

    // Today's Focus: tasks marked as isFocusedToday (max 3)
    const focusedTasks = useMemo(() =>
        activeTasks.filter(t => t.isFocusedToday).slice(0, 3),
        [activeTasks]
    );

    const focusedCount = focusedTasks.length;

    // Categorize tasks
    const sections = useMemo(() => {
        const now = new Date();
        const todayStr = now.toDateString();

        const overdue = activeTasks.filter(t => {
            if (!t.dueDate) return false;
            const dueDate = safeParseDate(t.dueDate);
            return dueDate && dueDate < now && !t.isFocusedToday;
        });
        const dueToday = activeTasks.filter(t => {
            if (!t.dueDate) return false;
            const dueDate = safeParseDate(t.dueDate);
            return dueDate && dueDate.toDateString() === todayStr &&
                !t.isFocusedToday;
        });
        const nextActions = activeTasks.filter(t =>
            t.status === 'next' && !t.isFocusedToday
        ).slice(0, 5);

        const reviewDue = activeTasks.filter(t =>
            (t.status === 'waiting' || t.status === 'someday') &&
            isDueForReview(t.reviewAt, now) &&
            !t.isFocusedToday
        );

        return { overdue, dueToday, nextActions, reviewDue };
    }, [activeTasks]);

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

                            {task.dueDate && (
                                <span className={cn("flex items-center gap-1", focusMutedClass)}>
                                    <Calendar className="w-3 h-3" />
                                    {safeFormatDate(task.dueDate, 'P')}
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

    return (
        <div className="space-y-6 max-w-4xl">
            <header>
                <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Calendar className="w-8 h-8" />
                    {t('agenda.title')}
                </h2>
                <p className="text-muted-foreground">
                    {totalActive} {t('agenda.active')}
                </p>
            </header>

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

            {totalActive === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                    <p className="text-4xl mb-4">✨</p>
                    <p className="text-lg font-medium">{t('agenda.allClear')}</p>
                    <p>{t('agenda.noTasks')}</p>
                </div>
            )}
        </div>
    );
}
