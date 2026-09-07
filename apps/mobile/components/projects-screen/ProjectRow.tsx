import React, { useRef } from 'react';
import { Alert, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { tFallback, type Project } from '@mindwtr/core';
import * as Haptics from 'expo-haptics';
import { Copy, Trash2, AlertTriangle } from 'lucide-react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { FocusStarIcon } from '@/components/FocusStarIcon';
import { projectsScreenStyles as styles } from '@/components/projects-screen/projects-screen.styles';
import type { ProjectTaskSummary } from './project-list-model';

type ThemeColors = {
    cardBg: string;
    secondaryText: string;
    text: string;
    tint: string;
};

type StatusPalette = Record<Project['status'], { text: string; bg: string; border: string }>;

type ProjectRowProps = {
    project: Project;
    taskSummary?: ProjectTaskSummary;
    tc: ThemeColors;
    focusedCount: number;
    statusPalette: StatusPalette;
    t: (key: string) => string;
    onDeleteProject: (projectId: string) => void;
    onDuplicateProject: (projectId: string) => void;
    onOpenProject: (project: Project) => void;
    onToggleProjectFocus: (projectId: string) => void;
};

const ROW_ACTION_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;
const PROJECT_SWIPE_FRICTION = 1.25;
const PROJECT_SWIPE_OPEN_THRESHOLD = 72;
const PROJECT_SWIPE_DRAG_OFFSET = 28;

function getStatusLabel(project: Project, t: (key: string) => string) {
    if (project.status === 'active') return t('status.active');
    if (project.status === 'waiting') return t('status.waiting');
    if (project.status === 'someday') return t('status.someday');
    return project.cancelledAt
        ? tFallback(t, 'projects.cancelled', 'Cancelled')
        : tFallback(t, 'list.done', 'Completed');
}

export function ProjectRow({
    project,
    taskSummary,
    tc,
    focusedCount,
    statusPalette,
    t,
    onDeleteProject,
    onDuplicateProject,
    onOpenProject,
    onToggleProjectFocus,
}: ProjectRowProps) {
    const nextAction = taskSummary?.nextAction;
    const taskCount = taskSummary?.activeTaskCount ?? 0;
    const taskCountLabel = `${taskCount} ${t('common.tasks')}`;
    const showFocusedWarning = project.isFocused && !nextAction && taskCount > 0;
    const swipeableRef = useRef<Swipeable>(null);

    const handleDuplicate = () => {
        swipeableRef.current?.close();
        void Haptics.selectionAsync().catch(() => {});
        onDuplicateProject(project.id);
    };

    const confirmDelete = () => {
        swipeableRef.current?.close();
        void Haptics.selectionAsync().catch(() => {});
        Alert.alert(
            t('projects.title'),
            t('projects.deleteConfirm'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('common.delete'),
                    style: 'destructive',
                    onPress: () => {
                        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
                        onDeleteProject(project.id);
                    },
                },
            ],
        );
    };

    const renderLeftActions = () => (
        <Pressable
            testID={`project-row-duplicate-${project.id}`}
            onPress={handleDuplicate}
            style={[styles.projectSwipeAction, styles.projectSwipeDuplicateAction]}
            accessibilityRole="button"
            accessibilityLabel={t('projects.duplicate')}
        >
            <Copy size={20} color="#FFFFFF" />
            <Text style={styles.projectSwipeActionText}>{t('projects.duplicate')}</Text>
        </Pressable>
    );

    const renderRightActions = () => (
        <Pressable
            testID={`project-row-delete-${project.id}`}
            onPress={confirmDelete}
            style={[styles.projectSwipeAction, styles.projectSwipeDeleteAction]}
            accessibilityRole="button"
            accessibilityLabel={t('common.delete')}
        >
            <Trash2 size={20} color="#FFFFFF" />
            <Text style={styles.projectSwipeActionText}>{t('common.delete')}</Text>
        </Pressable>
    );

    const rowContent = (
        <View
            style={[
                styles.projectItem,
                { backgroundColor: tc.cardBg },
                project.isFocused && { borderColor: '#F59E0B', borderWidth: 1 },
            ]}
        >
            <TouchableOpacity
                testID={`project-row-focus-${project.id}`}
                onPress={() => {
                    void Haptics.selectionAsync().catch(() => {});
                    onToggleProjectFocus(project.id);
                }}
                style={styles.focusButton}
                disabled={!project.isFocused && focusedCount >= 5}
                accessibilityRole="button"
                accessibilityLabel={project.isFocused ? 'Unfocus project' : 'Focus project'}
                accessibilityState={{ selected: project.isFocused, disabled: !project.isFocused && focusedCount >= 5 }}
                hitSlop={ROW_ACTION_HIT_SLOP}
            >
                <FocusStarIcon
                    focused={project.isFocused === true}
                    inactiveColor={tc.secondaryText}
                    disabled={!project.isFocused && focusedCount >= 5}
                />
            </TouchableOpacity>
            <TouchableOpacity
                style={styles.projectTouchArea}
                onPress={() => onOpenProject(project)}
            >
                <View style={styles.projectContent}>
                    <View style={styles.projectTitleRow}>
                        <View style={styles.projectTitleContent}>
                            <Text style={[styles.projectTitle, { color: tc.text }]} numberOfLines={1}>
                                {project.title}
                            </Text>
                            {project.tagIds?.length ? (
                                <View style={styles.projectTagDots}>
                                    {project.tagIds.slice(0, 4).map((tag) => (
                                        <View
                                            key={tag}
                                            style={[styles.projectTagDot, { backgroundColor: tc.secondaryText }]}
                                        />
                                    ))}
                                </View>
                            ) : null}
                        </View>
                        <View
                            accessible
                            accessibilityLabel={taskCountLabel}
                            style={[
                                styles.projectTaskCountBadge,
                                {
                                    backgroundColor: `${tc.secondaryText}20`,
                                    borderColor: `${tc.secondaryText}40`,
                                },
                            ]}
                        >
                            <Text style={[styles.projectTaskCountText, { color: tc.secondaryText }]}>
                                {taskCount}
                            </Text>
                        </View>
                    </View>
                    {nextAction ? (
                        <Text style={[styles.projectMeta, { color: tc.secondaryText }]} numberOfLines={1}>
                            ↳ {nextAction.title}
                        </Text>
                    ) : showFocusedWarning ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={12} color="#F59E0B" strokeWidth={2.5} />
                            <Text style={[styles.projectMeta, { color: '#F59E0B' }]}>{t('projects.noNextAction')}</Text>
                        </View>
                    ) : (
                        <Text
                            style={[
                                styles.projectMeta,
                                { color: statusPalette[project.status]?.text ?? tc.secondaryText },
                            ]}
                        >
                            {getStatusLabel(project, t)}
                        </Text>
                    )}
                </View>
            </TouchableOpacity>
        </View>
    );

    return (
        <Swipeable
            ref={swipeableRef}
            renderLeftActions={renderLeftActions}
            renderRightActions={renderRightActions}
            friction={PROJECT_SWIPE_FRICTION}
            leftThreshold={PROJECT_SWIPE_OPEN_THRESHOLD}
            rightThreshold={PROJECT_SWIPE_OPEN_THRESHOLD}
            dragOffsetFromLeftEdge={PROJECT_SWIPE_DRAG_OFFSET}
            dragOffsetFromRightEdge={PROJECT_SWIPE_DRAG_OFFSET}
            overshootLeft={false}
            overshootRight={false}
        >
            {rowContent}
        </Swipeable>
    );
}
