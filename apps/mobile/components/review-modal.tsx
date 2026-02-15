import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import {
    createAIProvider,
    getStaleItems,
    isDueForReview,
    safeFormatDate,
    safeParseDate,
    safeParseDueDate,
    type ExternalCalendarEvent,
    type ReviewSuggestion,
    type AIProviderId,
    type Task,
    type TaskStatus,
    useTaskStore,
} from '@mindwtr/core';
import { useTheme } from '../contexts/theme-context';
import { useLanguage } from '../contexts/language-context';

import { SwipeableTaskItem } from './swipeable-task-item';
import { TaskEditModal } from './task-edit-modal';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { buildAIConfig, loadAIKey } from '../lib/ai-config';
import { logError } from '../lib/app-log';
import { fetchExternalCalendarEvents } from '../lib/external-calendar';

type ReviewStep = 'intro' | 'inbox' | 'ai' | 'calendar' | 'waiting' | 'projects' | 'someday' | 'completed';
type ExternalCalendarDaySummary = {
    dayStart: Date;
    events: ExternalCalendarEvent[];
    totalCount: number;
};
type CalendarTaskReviewEntry = {
    task: Task;
    date: Date;
    kind: 'due' | 'start';
};

interface ReviewModalProps {
    visible: boolean;
    onClose: () => void;
}

// Helper to check review time (kept for backward compatibility)
export const checkReviewTime = () => {
    return true;
};

// Get text labels based on language
const getReviewLabels = (lang: string) => {
    if (lang === 'zh') {
        return {
            weeklyReview: '周回顾',
            inbox: '收集箱',
            ai: 'AI 洞察',
            calendar: '日历',
            waiting: '等待中',
            projects: '项目',
            someday: '将来/也许',
            done: '完成!',
            timeFor: '开始周回顾!',
            timeForDesc: '花几分钟整理你的系统，确保一切都在掌控之中。',
            startReview: '开始回顾',
            inboxDesc: '清空收集箱',
            inboxGuide: '处理每一项：删除、委托、设置下一步行动，或移到将来/也许。目标是清空收集箱！',
            itemsInInbox: '条在收集箱',
            inboxEmpty: '太棒了！收集箱已清空！',
            aiDesc: 'AI 标记久未推进的任务并给出清理建议。',
            aiRun: '开始分析',
            aiRunning: '分析中…',
            aiEmpty: '没有发现过期项目。',
            aiApply: '应用所选',
            aiActionSomeday: '移至将来/也许',
            aiActionArchive: '归档',
            aiActionBreakdown: '需要拆解',
            aiActionKeep: '保留',
            loading: '加载中…',
            calendarDesc: '先查看未来 7 天的日程摘要。',
            calendarEmpty: '该时间范围没有日历事件。',
            calendarUpcoming: '未来 7 天',
            calendarTasks: '未来 7 天任务',
            calendarTasksEmpty: '未来 7 天没有已安排任务。',
            dueLabel: '截止',
            startLabel: '开始',
            allDay: '全天',
            more: '更多',
            waitingDesc: '跟进等待项目',
            waitingGuide: '检查每个等待项：是否需要跟进？已完成可以标记完成，需要再次跟进可以加注释。',
            nothingWaiting: '没有等待项目',
            projectsDesc: '检查项目状态',
            projectsGuide: '确保每个活跃项目都有明确的下一步行动。没有下一步的项目会卡住！',
            noActiveProjects: '没有活跃项目',
            somedayDesc: '重新审视将来/也许',
            somedayGuide: '有没有现在想开始的？有没有不再感兴趣的？激活它或删除它。',
            listEmpty: '列表为空',
            reviewComplete: '回顾完成!',
            completeDesc: '你的系统已经整理完毕，准备好迎接新的一周了！',
            finish: '完成',
            next: '下一步',
            back: '返回',
            hasNext: '✓ 有下一步',
            needsAction: '! 需要行动',
            activeTasks: '个活跃任务',
            moreItems: '更多项目',
        };
    }
    return {
        weeklyReview: 'Weekly Review',
        inbox: 'Inbox',
        ai: 'AI Insight',
        calendar: 'Calendar',
        waiting: 'Waiting For',
        projects: 'Projects',
        someday: 'Someday/Maybe',
        done: 'Done!',
        timeFor: 'Time for Weekly Review!',
        timeForDesc: 'Take a few minutes to get your system clean and clear.',
        startReview: 'Start Review',
        inboxDesc: 'Clear Your Inbox',
        inboxGuide: 'Process each item: delete it, delegate it, set a next action, or move to Someday. Goal: inbox zero!',
        itemsInInbox: 'items in inbox',
        inboxEmpty: 'Great job! Inbox is empty!',
        aiDesc: 'AI highlights stale tasks and cleanup suggestions.',
        aiRun: 'Run analysis',
        aiRunning: 'Analyzing...',
        aiEmpty: 'No stale items found.',
        aiApply: 'Apply selected',
        aiActionSomeday: 'Move to Someday',
        aiActionArchive: 'Archive',
        aiActionBreakdown: 'Needs breakdown',
        aiActionKeep: 'Keep',
        loading: 'Loading…',
        calendarDesc: 'Review your hard landscape first: a compact summary of the next 7 days.',
        calendarEmpty: 'No calendar events in this range.',
        calendarUpcoming: 'Next 7 days',
        calendarTasks: 'Mindwtr tasks (next 7 days)',
        calendarTasksEmpty: 'No scheduled/due tasks in this range.',
        dueLabel: 'Due',
        startLabel: 'Start',
        allDay: 'All day',
        more: 'more',
        waitingDesc: 'Follow Up on Waiting Items',
        waitingGuide: 'Check each item: need to follow up? Mark done if resolved. Add notes for context.',
        nothingWaiting: 'Nothing waiting - all clear!',
        projectsDesc: 'Review Your Projects',
        projectsGuide: 'Each active project needs a clear next action. Projects without next actions get stuck!',
        noActiveProjects: 'No active projects',
        somedayDesc: 'Revisit Someday/Maybe',
        somedayGuide: 'Anything you want to start now? Anything no longer interesting? Activate it or delete it.',
        listEmpty: 'List is empty',
        reviewComplete: 'Review Complete!',
        completeDesc: 'Your system is clean and you\'re ready for the week ahead!',
        finish: 'Finish',
        next: 'Next',
        back: 'Back',
        hasNext: '✓ Has Next',
        needsAction: '! Needs Action',
        activeTasks: 'active tasks',
        moreItems: 'more items',
    };
};

export function ReviewModal({ visible, onClose }: ReviewModalProps) {
    const { tasks, projects, areas, updateTask, deleteTask, settings, batchUpdateTasks } = useTaskStore();
    const areaById = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas]);
    const { isDark } = useTheme();
    const { language } = useLanguage();
    const [currentStep, setCurrentStep] = useState<ReviewStep>('intro');
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [expandedProject, setExpandedProject] = useState<string | null>(null);
    const [aiSuggestions, setAiSuggestions] = useState<ReviewSuggestion[]>([]);
    const [aiSelectedIds, setAiSelectedIds] = useState<Set<string>>(new Set());
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [aiRan, setAiRan] = useState(false);
    const [externalCalendarEvents, setExternalCalendarEvents] = useState<ExternalCalendarEvent[]>([]);
    const [externalCalendarLoading, setExternalCalendarLoading] = useState(false);
    const [externalCalendarError, setExternalCalendarError] = useState<string | null>(null);

    const labels = getReviewLabels(language);
    const tc = useThemeColors();
    const aiEnabled = settings?.ai?.enabled === true;
    const aiProvider = (settings?.ai?.provider ?? 'openai') as AIProviderId;

    const steps = useMemo<{ id: ReviewStep; title: string; icon: string }[]>(() => {
        const list: { id: ReviewStep; title: string; icon: string }[] = [
            { id: 'intro', title: labels.weeklyReview, icon: '🔄' },
            { id: 'inbox', title: labels.inbox, icon: '📥' },
        ];
        if (aiEnabled) {
            list.push({ id: 'ai', title: labels.ai, icon: '✨' });
        }
        list.push(
            { id: 'calendar', title: labels.calendar, icon: '📅' },
            { id: 'waiting', title: labels.waiting, icon: '⏳' },
            { id: 'projects', title: labels.projects, icon: '📂' },
            { id: 'someday', title: labels.someday, icon: '💭' },
            { id: 'completed', title: labels.done, icon: '✅' },
        );
        return list;
    }, [aiEnabled, labels]);

    const currentStepIndex = steps.findIndex(s => s.id === currentStep);
    const safeStepIndex = currentStepIndex >= 0 ? currentStepIndex : 0;
    const progress = (safeStepIndex / Math.max(1, steps.length - 1)) * 100;

    const nextStep = () => {
        if (currentStepIndex < 0) {
            setCurrentStep(steps[0].id);
            return;
        }
        if (currentStepIndex < steps.length - 1) {
            setCurrentStep(steps[currentStepIndex + 1].id);
        }
    };

    const prevStep = () => {
        if (currentStepIndex < 0) {
            setCurrentStep(steps[0].id);
            return;
        }
        if (currentStepIndex > 0) {
            setCurrentStep(steps[currentStepIndex - 1].id);
        }
    };

    const handleClose = () => {
        setCurrentStep('intro');
        onClose();
    };

    const handleTaskPress = (task: Task) => {
        setEditingTask(task);
        setShowEditModal(true);
    };

    const handleStatusChange = (taskId: string, status: string) => {
        updateTask(taskId, { status: status as TaskStatus });
    };

    const handleDelete = (taskId: string) => {
        deleteTask(taskId);
    };

    useEffect(() => {
        if (!visible) return;
        let cancelled = false;
        const loadCalendar = async () => {
            setExternalCalendarLoading(true);
            setExternalCalendarError(null);
            try {
                const now = new Date();
                const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const rangeEnd = new Date(rangeStart);
                rangeEnd.setDate(rangeEnd.getDate() + 7);
                rangeEnd.setMilliseconds(-1);
                const { events } = await fetchExternalCalendarEvents(rangeStart, rangeEnd);
                if (cancelled) return;
                setExternalCalendarEvents(events);
            } catch (error) {
                if (cancelled) return;
                setExternalCalendarError(error instanceof Error ? error.message : String(error));
                setExternalCalendarEvents([]);
            } finally {
                if (!cancelled) setExternalCalendarLoading(false);
            }
        };
        loadCalendar();
        return () => {
            cancelled = true;
        };
    }, [visible]);

    const handleFinish = async () => {
        try {
            await AsyncStorage.setItem('lastWeeklyReview', new Date().toISOString());
        } catch (e) {
            void logError(e, { scope: 'review', extra: { message: 'Failed to save review time' } });
        }
        handleClose();
    };

    const staleItems = getStaleItems(tasks, projects);
    const staleItemTitleMap = staleItems.reduce((acc, item) => {
        acc[item.id] = item.title;
        return acc;
    }, {} as Record<string, string>);

    useEffect(() => {
        if (!steps.some((step) => step.id === currentStep)) {
            setCurrentStep(steps[0].id);
        }
    }, [currentStep, steps]);

    const isActionableSuggestion = (suggestion: ReviewSuggestion) => {
        if (suggestion.id.startsWith('project:')) return false;
        return suggestion.action === 'someday' || suggestion.action === 'archive';
    };

    const toggleSuggestion = (id: string) => {
        setAiSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const runAiAnalysis = async () => {
        setAiError(null);
        setAiRan(true);
        if (!aiEnabled) {
            setAiError('AI is disabled. Enable it in Settings.');
            return;
        }
        const apiKey = await loadAIKey(aiProvider);
        if (!apiKey) {
            setAiError('Missing API key. Add it in Settings.');
            return;
        }
        if (staleItems.length === 0) {
            setAiSuggestions([]);
            setAiSelectedIds(new Set());
            return;
        }
        setAiLoading(true);
        try {
            const provider = createAIProvider(buildAIConfig(settings, apiKey));
            const response = await provider.analyzeReview({ items: staleItems });
            const suggestions = response.suggestions || [];
            setAiSuggestions(suggestions);
            const defaultSelected = new Set(
                suggestions.filter(isActionableSuggestion).map((suggestion) => suggestion.id),
            );
            setAiSelectedIds(defaultSelected);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setAiError(message || 'AI request failed.');
        } finally {
            setAiLoading(false);
        }
    };

    const applyAiSuggestions = async () => {
        const updates = aiSuggestions
            .filter((suggestion) => aiSelectedIds.has(suggestion.id))
            .filter(isActionableSuggestion)
            .map((suggestion) => {
                if (suggestion.action === 'someday') {
                    return { id: suggestion.id, updates: { status: 'someday' as TaskStatus } };
                }
                if (suggestion.action === 'archive') {
                    return { id: suggestion.id, updates: { status: 'archived' as TaskStatus, completedAt: new Date().toISOString() } };
                }
                return null;
            })
            .filter(Boolean) as { id: string; updates: Partial<Task> }[];

        if (updates.length === 0) return;
        await batchUpdateTasks(updates);
    };

    const inboxTasks = tasks.filter(t => t.status === 'inbox' && !t.deletedAt);
    const waitingTasks = tasks.filter(t => t.status === 'waiting' && !t.deletedAt);
    const somedayTasks = tasks.filter(t => t.status === 'someday' && !t.deletedAt);
    const waitingDue = waitingTasks.filter(t => isDueForReview(t.reviewAt));
    const waitingFuture = waitingTasks.filter(t => !isDueForReview(t.reviewAt));
    const orderedWaitingTasks = [...waitingDue, ...waitingFuture];
    const somedayDue = somedayTasks.filter(t => isDueForReview(t.reviewAt));
    const somedayFuture = somedayTasks.filter(t => !isDueForReview(t.reviewAt));
    const orderedSomedayTasks = [...somedayDue, ...somedayFuture];
    const activeProjects = projects.filter(p => p.status === 'active');
    const dueProjects = activeProjects.filter(p => isDueForReview(p.reviewAt));
    const futureProjects = activeProjects.filter(p => !isDueForReview(p.reviewAt));
    const orderedProjects = [...dueProjects, ...futureProjects];
    const calendarReviewItems = useMemo<CalendarTaskReviewEntry[]>(() => {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const upcomingEnd = new Date(startOfToday);
        upcomingEnd.setDate(upcomingEnd.getDate() + 7);
        const entries: CalendarTaskReviewEntry[] = [];

        tasks.forEach((task) => {
            if (task.deletedAt) return;
            if (task.status === 'done' || task.status === 'archived' || task.status === 'reference') return;
            const dueDate = safeParseDueDate(task.dueDate);
            if (dueDate) entries.push({ task, date: dueDate, kind: 'due' });
            const startTime = safeParseDate(task.startTime);
            if (startTime) entries.push({ task, date: startTime, kind: 'start' });
        });

        return entries
            .filter((entry) => entry.date >= startOfToday && entry.date < upcomingEnd)
            .sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [tasks]);

    const externalCalendarReviewItems = useMemo<ExternalCalendarDaySummary[]>(() => {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const summaries: ExternalCalendarDaySummary[] = [];
        for (let offset = 0; offset < 7; offset += 1) {
            const dayStart = new Date(startOfToday);
            dayStart.setDate(dayStart.getDate() + offset);
            const dayEnd = new Date(dayStart);
            dayEnd.setDate(dayEnd.getDate() + 1);
            const dayEvents = externalCalendarEvents
                .filter((event) => {
                    const start = safeParseDate(event.start);
                    const end = safeParseDate(event.end);
                    if (!start || !end) return false;
                    return start.getTime() < dayEnd.getTime() && end.getTime() > dayStart.getTime();
                })
                .sort((a, b) => {
                    const aStart = safeParseDate(a.start)?.getTime() ?? Number.POSITIVE_INFINITY;
                    const bStart = safeParseDate(b.start)?.getTime() ?? Number.POSITIVE_INFINITY;
                    return aStart - bStart;
                });
            if (dayEvents.length > 0) {
                summaries.push({
                    dayStart,
                    events: dayEvents.slice(0, 2),
                    totalCount: dayEvents.length,
                });
            }
        }
        return summaries;
    }, [externalCalendarEvents]);

    const renderTaskList = (taskList: Task[]) => (
        <ScrollView style={styles.taskList}>
            {taskList.map(task => (
                <SwipeableTaskItem
                    key={task.id}
                    task={task}
                    isDark={isDark}
                    tc={tc}
                    onPress={() => handleTaskPress(task)}
                    onStatusChange={(status) => handleStatusChange(task.id, status)}
                    onDelete={() => handleDelete(task.id)}
                />
            ))}
        </ScrollView>
    );

    const renderExternalCalendarList = (days: ExternalCalendarDaySummary[]) => {
        if (externalCalendarLoading) {
            return <Text style={[styles.calendarEventMeta, { color: tc.secondaryText }]}>{labels.loading}</Text>;
        }
        if (externalCalendarError) {
            return <Text style={[styles.calendarEventMeta, { color: tc.secondaryText }]}>{externalCalendarError}</Text>;
        }
        if (days.length === 0) {
            return <Text style={[styles.calendarEventMeta, { color: tc.secondaryText }]}>{labels.calendarEmpty}</Text>;
        }
        return (
            <View style={styles.calendarEventList}>
                {days.map((day) => (
                    <View key={day.dayStart.toISOString()} style={[styles.calendarDayCard, { borderColor: tc.border }]}>
                        <Text style={[styles.calendarDayTitle, { color: tc.secondaryText }]}>
                            {safeFormatDate(day.dayStart, 'EEE, MMM d')} · {day.totalCount}
                        </Text>
                        {day.events.map((event) => {
                            const start = safeParseDate(event.start);
                            const timeLabel = event.allDay || !start ? labels.allDay : safeFormatDate(start, 'HH:mm');
                            return (
                                <View key={`${event.sourceId}-${event.id}-${event.start}`} style={styles.calendarEventRow}>
                                    <Text style={[styles.calendarEventMeta, { color: tc.secondaryText }]}>
                                        {timeLabel}
                                    </Text>
                                    <Text style={[styles.calendarEventTitle, { color: tc.text }]} numberOfLines={1}>
                                        {event.title}
                                    </Text>
                                </View>
                            );
                        })}
                        {day.totalCount > day.events.length && (
                            <Text style={[styles.calendarEventMeta, { color: tc.secondaryText }]}>
                                +{day.totalCount - day.events.length} {labels.more}
                            </Text>
                        )}
                    </View>
                ))}
            </View>
        );
    };
    const renderCalendarTaskList = (items: CalendarTaskReviewEntry[]) => {
        if (items.length === 0) {
            return <Text style={[styles.calendarEventMeta, { color: tc.secondaryText }]}>{labels.calendarTasksEmpty}</Text>;
        }
        return (
            <View style={styles.calendarEventList}>
                {items.slice(0, 12).map((entry) => (
                    <View
                        key={`${entry.kind}-${entry.task.id}-${entry.date.toISOString()}`}
                        style={[styles.calendarDayCard, { borderColor: tc.border }]}
                    >
                        <Text style={[styles.calendarEventTitle, { color: tc.text }]} numberOfLines={1}>
                            {entry.task.title}
                        </Text>
                        <Text style={[styles.calendarEventMeta, { color: tc.secondaryText }]}>
                            {(entry.kind === 'due' ? labels.dueLabel : labels.startLabel)} · {safeFormatDate(entry.date, 'MMM d, HH:mm')}
                        </Text>
                    </View>
                ))}
            </View>
        );
    };

    const renderStepContent = () => {
        switch (currentStep) {
            case 'intro':
                return (
                    <View style={styles.centerContent}>
                        <Text style={styles.bigIcon}>🔄</Text>
                        <Text style={[styles.heading, { color: tc.text }]}>
                            {labels.timeFor}
                        </Text>
                        <Text style={[styles.description, { color: tc.secondaryText }]}>
                            {labels.timeForDesc}
                        </Text>
                        <TouchableOpacity style={styles.primaryButton} onPress={nextStep}>
                            <Text style={styles.primaryButtonText}>
                                {labels.startReview} →
                            </Text>
                        </TouchableOpacity>
                    </View>
                );

            case 'inbox':
                return (
                    <View style={styles.stepContent}>
                        <Text style={[styles.stepTitle, { color: tc.text }]}>
                            📥 {labels.inboxDesc}
                        </Text>
                        <View style={[styles.infoBox, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                            <Text style={[styles.infoText, { color: tc.text }]}>
                                <Text style={{ fontWeight: '700' }}>{inboxTasks.length}</Text> {labels.itemsInInbox}
                            </Text>
                            <Text style={[styles.guideText, { color: tc.secondaryText }]}>
                                {labels.inboxGuide}
                            </Text>
                        </View>
                        {inboxTasks.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Text style={styles.emptyIcon}>✅</Text>
                                <Text style={[styles.emptyText, { color: tc.secondaryText }]}>
                                    {labels.inboxEmpty}
                                </Text>
                            </View>
                        ) : (
                            renderTaskList(inboxTasks)
                        )}
                    </View>
                );

            case 'ai':
                return (
                    <View style={styles.stepContent}>
                        <Text style={[styles.stepTitle, { color: tc.text }]}>
                            ✨ {labels.ai}
                        </Text>
                        <Text style={[styles.hint, { color: tc.secondaryText }]}>
                            {labels.aiDesc}
                        </Text>
                        <TouchableOpacity
                            style={[styles.primaryButton, { backgroundColor: tc.tint, marginTop: 12 }]}
                            onPress={runAiAnalysis}
                            disabled={aiLoading}
                        >
                            <Text style={styles.primaryButtonText}>
                                {aiLoading ? labels.aiRunning : labels.aiRun}
                            </Text>
                        </TouchableOpacity>

                        {aiError && (
                            <Text style={[styles.hint, { color: '#EF4444', marginTop: 12 }]}>
                                {aiError}
                            </Text>
                        )}

                        {aiRan && !aiLoading && aiSuggestions.length === 0 && !aiError && (
                            <Text style={[styles.hint, { color: tc.secondaryText, marginTop: 12 }]}>
                                {labels.aiEmpty}
                            </Text>
                        )}

                        {aiSuggestions.length > 0 && (
                            <ScrollView style={styles.taskList}>
                                {aiSuggestions.map((suggestion) => {
                                    const actionable = isActionableSuggestion(suggestion);
                                    const label = suggestion.action === 'someday'
                                        ? labels.aiActionSomeday
                                        : suggestion.action === 'archive'
                                            ? labels.aiActionArchive
                                            : suggestion.action === 'breakdown'
                                                ? labels.aiActionBreakdown
                                                : labels.aiActionKeep;
                                    return (
                                        <TouchableOpacity
                                            key={suggestion.id}
                                            style={[styles.aiItemRow, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                                            onPress={() => actionable && toggleSuggestion(suggestion.id)}
                                            disabled={!actionable}
                                        >
                                            <View
                                                style={[
                                                    styles.aiCheckbox,
                                                    {
                                                        borderColor: tc.border,
                                                        backgroundColor: aiSelectedIds.has(suggestion.id) ? tc.tint : 'transparent',
                                                    },
                                                ]}
                                            >
                                                {aiSelectedIds.has(suggestion.id) && <Text style={styles.aiCheckboxText}>✓</Text>}
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.aiItemTitle, { color: tc.text }]}>
                                                    {staleItemTitleMap[suggestion.id] || suggestion.id}
                                                </Text>
                                                <Text style={[styles.aiItemMeta, { color: tc.secondaryText }]}>
                                                    {label} · {suggestion.reason}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}
                                <TouchableOpacity
                                    style={[styles.primaryButton, { backgroundColor: tc.tint, marginTop: 12 }]}
                                    onPress={applyAiSuggestions}
                                    disabled={aiSelectedIds.size === 0}
                                >
                                    <Text style={styles.primaryButtonText}>
                                        {labels.aiApply} ({aiSelectedIds.size})
                                    </Text>
                                </TouchableOpacity>
                            </ScrollView>
                        )}
                    </View>
                );

            case 'calendar':
                return (
                    <View style={styles.stepContent}>
                        <Text style={[styles.stepTitle, { color: tc.text }]}>
                            📅 {labels.calendar}
                        </Text>
                        <Text style={[styles.hint, { color: tc.secondaryText }]}>
                            {labels.calendarDesc}
                        </Text>
                        <View style={[styles.calendarColumn, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                            <Text style={[styles.calendarColumnTitle, { color: tc.secondaryText }]}>{labels.calendarUpcoming}</Text>
                            {renderExternalCalendarList(externalCalendarReviewItems)}
                        </View>
                        <View style={[styles.calendarColumn, { backgroundColor: tc.cardBg, borderColor: tc.border, marginTop: 12 }]}>
                            <Text style={[styles.calendarColumnTitle, { color: tc.secondaryText }]}>{labels.calendarTasks}</Text>
                            {renderCalendarTaskList(calendarReviewItems)}
                        </View>
                    </View>
                );

            case 'waiting':
                return (
                    <View style={styles.stepContent}>
                        <Text style={[styles.stepTitle, { color: tc.text }]}>
                            ⏳ {labels.waitingDesc}
                        </Text>
                        <Text style={[styles.hint, { color: tc.secondaryText }]}>
                            {labels.waitingGuide}
                        </Text>
                        {waitingTasks.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Text style={[styles.emptyText, { color: tc.secondaryText }]}>
                                    {labels.nothingWaiting}
                                </Text>
                            </View>
                        ) : (
                            renderTaskList(orderedWaitingTasks)
                        )}
                    </View>
                );

            case 'projects':
                return (
                    <View style={styles.stepContent}>
                        <Text style={[styles.stepTitle, { color: tc.text }]}>
                            📂 {labels.projectsDesc}
                        </Text>
                        <Text style={[styles.hint, { color: tc.secondaryText }]}>
                            {labels.projectsGuide}
                        </Text>
                        {activeProjects.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Text style={[styles.emptyText, { color: tc.secondaryText }]}>
                                    {labels.noActiveProjects}
                                </Text>
                            </View>
                        ) : (
                            <ScrollView style={styles.taskList}>
	                                {orderedProjects.map(project => {
                                    const projectTasks = tasks.filter(task => task.projectId === project.id && task.status !== 'done' && task.status !== 'reference' && !task.deletedAt);
                                    // A project has a next action if it has at least one task marked 'next'.
                                    const hasNextAction = projectTasks.some(task => task.status === 'next');
                                    const isExpanded = expandedProject === project.id;

                                    return (
                                        <View key={project.id}>
                                            <TouchableOpacity
                                                style={[styles.projectItem, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                                                onPress={() => setExpandedProject(isExpanded ? null : project.id)}
                                            >
                                                <View style={styles.projectHeader}>
                                                    <View style={[styles.projectDot, { backgroundColor: (project.areaId ? areaById.get(project.areaId)?.color : undefined) || tc.tint }]} />
                                                    <Text style={[styles.projectTitle, { color: tc.text }]}>{project.title}</Text>
                                                    <View style={[styles.statusBadge, { backgroundColor: hasNextAction ? '#10B98120' : '#EF444420' }]}>
                                                        <Text style={[styles.statusText, { color: hasNextAction ? '#10B981' : '#EF4444' }]}>
                                                            {hasNextAction ? labels.hasNext : labels.needsAction}
                                                        </Text>
                                                    </View>
                                                </View>
                                                <View style={styles.projectMeta}>
                                                    <Text style={[styles.taskCount, { color: tc.secondaryText }]}>
                                                        {projectTasks.length} {labels.activeTasks}
                                                    </Text>
                                                    <Text style={[styles.expandIcon, { color: tc.secondaryText }]}>
                                                        {isExpanded ? '▼' : '▶'}
                                                    </Text>
                                                </View>
                                            </TouchableOpacity>
                                            {isExpanded && projectTasks.length > 0 && (
                                                <View style={styles.projectTasks}>
                                                    {projectTasks.map(task => (
                                                        <SwipeableTaskItem
                                                            key={task.id}
                                                            task={task}
                                                            isDark={isDark}
                                                            tc={tc}
                                                            onPress={() => handleTaskPress(task)}
                                                            onStatusChange={(status) => handleStatusChange(task.id, status)}
                                                            onDelete={() => handleDelete(task.id)}
                                                        />
                                                    ))}
                                                </View>
                                            )}
                                        </View>
                                    );
                                })}
                            </ScrollView>
                        )}
                    </View>
                );

            case 'someday':
                return (
                    <View style={styles.stepContent}>
                        <Text style={[styles.stepTitle, { color: tc.text }]}>
                            💭 {labels.somedayDesc}
                        </Text>
                        <Text style={[styles.hint, { color: tc.secondaryText }]}>
                            {labels.somedayGuide}
                        </Text>
                        {somedayTasks.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Text style={[styles.emptyText, { color: tc.secondaryText }]}>
                                    {labels.listEmpty}
                                </Text>
                            </View>
                        ) : (
                            renderTaskList(orderedSomedayTasks)
                        )}
                    </View>
                );

            case 'completed':
                return (
                    <View style={styles.centerContent}>
                        <Text style={styles.bigIcon}>🎉</Text>
                        <Text style={[styles.heading, { color: tc.text }]}>
                            {labels.reviewComplete}
                        </Text>
                        <Text style={[styles.description, { color: tc.secondaryText }]}>
                            {labels.completeDesc}
                        </Text>
                        <TouchableOpacity style={styles.primaryButton} onPress={handleFinish}>
                            <Text style={styles.primaryButtonText}>
                                {labels.finish}
                            </Text>
                        </TouchableOpacity>
                    </View>
                );
        }
    };

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={handleClose}>
            <GestureHandlerRootView style={{ flex: 1 }}>
                <View style={[styles.container, { backgroundColor: tc.bg }]}>
                    {/* Header */}
                    <View style={[styles.header, { borderBottomColor: tc.border }]}>
                        <TouchableOpacity onPress={handleClose}>
                            <Text style={[styles.closeButton, { color: tc.text }]}>✕</Text>
                        </TouchableOpacity>
                        <Text style={[styles.headerTitle, { color: tc.text }]}>
                            {steps[safeStepIndex].icon} {steps[safeStepIndex].title}
                        </Text>
                        <Text style={[styles.stepIndicator, { color: tc.secondaryText }]}>
                            {safeStepIndex + 1}/{steps.length}
                        </Text>
                    </View>

                    {/* Progress bar */}
                    <View style={[styles.progressContainer, { backgroundColor: tc.border }]}>
                        <View style={[styles.progressBar, { width: `${progress}%` }]} />
                    </View>

                    {/* Content */}
                    <View style={styles.content}>
                        {renderStepContent()}
                    </View>

                    {/* Navigation */}
                    {currentStep !== 'intro' && currentStep !== 'completed' && (
                        <View style={[styles.footer, { borderTopColor: tc.border }]}>
                            <TouchableOpacity style={styles.backButton} onPress={prevStep}>
                                <Text style={[styles.backButtonText, { color: tc.secondaryText }]}>← {labels.back}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.primaryButton} onPress={nextStep}>
                                <Text style={styles.primaryButtonText}>{labels.next} →</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                {/* Task Edit Modal */}
                <TaskEditModal
                    visible={showEditModal}
                    task={editingTask}
                    onClose={() => setShowEditModal(false)}
                    onSave={(taskId, updates) => updateTask(taskId, updates)}
                    defaultTab="view"
                />
            </GestureHandlerRootView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderBottomWidth: 1,
    },
    closeButton: {
        fontSize: 20,
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
    },
    stepIndicator: {
        fontSize: 14,
    },
    progressContainer: {
        height: 4,
    },
    progressBar: {
        height: '100%',
        backgroundColor: '#3B82F6',
    },
    content: {
        flex: 1,
        padding: 20,
    },
    centerContent: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bigIcon: {
        fontSize: 64,
        marginBottom: 20,
    },
    heading: {
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 12,
        textAlign: 'center',
    },
    description: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 32,
        paddingHorizontal: 20,
    },
    primaryButton: {
        backgroundColor: '#3B82F6',
        paddingHorizontal: 32,
        paddingVertical: 14,
        borderRadius: 12,
    },
    primaryButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    stepContent: {
        flex: 1,
    },
    stepTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 12,
    },
    hint: {
        fontSize: 14,
        marginBottom: 16,
    },
    infoBox: {
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 16,
    },
    infoText: {
        fontSize: 16,
        marginBottom: 8,
    },
    guideText: {
        fontSize: 14,
        lineHeight: 20,
        marginTop: 4,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyIcon: {
        fontSize: 48,
        marginBottom: 12,
    },
    emptyText: {
        fontSize: 16,
    },
    taskList: {
        flex: 1,
    },
    aiItemRow: {
        flexDirection: 'row',
        gap: 12,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        marginBottom: 10,
    },
    aiCheckbox: {
        width: 18,
        height: 18,
        borderRadius: 4,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    aiCheckboxText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '700',
    },
    aiItemTitle: {
        fontSize: 15,
        fontWeight: '600',
    },
    aiItemMeta: {
        fontSize: 12,
        marginTop: 4,
    },
    calendarColumn: {
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        minHeight: 140,
    },
    calendarColumnTitle: {
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        marginBottom: 8,
        letterSpacing: 0.4,
    },
    calendarEventList: {
        gap: 8,
    },
    calendarDayCard: {
        borderWidth: 1,
        borderRadius: 8,
        padding: 8,
        gap: 6,
    },
    calendarDayTitle: {
        fontSize: 12,
        fontWeight: '700',
    },
    calendarEventRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    calendarEventTitle: {
        fontSize: 14,
        fontWeight: '600',
    },
    calendarEventMeta: {
        fontSize: 12,
    },
    projectItem: {
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        marginBottom: 8,
    },
    projectHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    projectDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        marginRight: 8,
    },
    projectTitle: {
        fontSize: 16,
        fontWeight: '600',
        flex: 1,
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
    },
    taskCount: {
        fontSize: 14,
        marginLeft: 20,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderTopWidth: 1,
    },
    backButton: {
        padding: 12,
    },
    backButtonText: {
        fontSize: 16,
    },
    projectMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    expandIcon: {
        fontSize: 12,
        marginLeft: 8,
    },
    projectTasks: {
        marginLeft: 12,
        marginBottom: 8,
        borderLeftWidth: 2,
        borderLeftColor: '#3B82F6',
        paddingLeft: 8,
    },
});
