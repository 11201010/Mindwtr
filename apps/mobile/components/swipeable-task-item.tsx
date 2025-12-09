import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import type { Task } from '@focus-gtd/core';
import { useRef } from 'react';

function getStatusColor(status: string): string {
    const colors: Record<string, string> = {
        inbox: '#6B7280',
        next: '#3B82F6',
        waiting: '#F59E0B',
        someday: '#8B5CF6',
        done: '#10B981',
        'in-progress': '#F59E0B',
        archived: '#9CA3AF',
    };
    return colors[status] || '#6B7280';
}

export interface SwipeableTaskItemProps {
    task: Task;
    isDark: boolean;
    /** Theme colors object with cardBg, text, secondaryText */
    tc: {
        cardBg: string;
        text: string;
        secondaryText: string;
    };
    onPress: () => void;
    onStatusChange: (status: string) => void;
    onDelete: () => void;
    /** Hide context tags (useful when viewing a specific context) */
    hideContexts?: boolean;
}

/**
 * A swipeable task item with context-aware left swipe actions:
 * - Done tasks: swipe to Archive
 * - Next/Todo tasks: swipe to Start (in-progress)
 * - In-progress tasks: swipe to Done
 * - Other: swipe to Done (default)
 * 
 * Right swipe always shows Delete action.
 */
export function SwipeableTaskItem({
    task,
    isDark,
    tc,
    onPress,
    onStatusChange,
    onDelete,
    hideContexts = false
}: SwipeableTaskItemProps) {
    const swipeableRef = useRef<Swipeable>(null);

    // Status-aware left swipe action
    const getLeftAction = () => {
        if (task.status === 'done') {
            return { label: '📦 Archive', color: '#6B7280', action: 'archived' };
        } else if (task.status === 'next' || task.status === 'todo') {
            return { label: '▶️ Start', color: '#F59E0B', action: 'in-progress' };
        } else if (task.status === 'in-progress') {
            return { label: '✓ Done', color: '#10B981', action: 'done' };
        } else if (task.status === 'waiting' || task.status === 'someday') {
            return { label: '▶️ Next', color: '#3B82F6', action: 'next' };
        } else {
            return { label: '✓ Done', color: '#10B981', action: 'done' };
        }
    };

    const leftAction = getLeftAction();

    const renderLeftActions = () => (
        <Pressable
            style={[styles.swipeActionLeft, { backgroundColor: leftAction.color }]}
            onPress={() => {
                swipeableRef.current?.close();
                onStatusChange(leftAction.action);
            }}
        >
            <Text style={styles.swipeActionText}>{leftAction.label}</Text>
        </Pressable>
    );

    const renderRightActions = () => (
        <Pressable
            style={styles.swipeActionRight}
            onPress={() => {
                swipeableRef.current?.close();
                onDelete();
            }}
        >
            <Text style={styles.swipeActionText}>🗑️ Delete</Text>
        </Pressable>
    );

    return (
        <Swipeable
            ref={swipeableRef}
            renderLeftActions={renderLeftActions}
            renderRightActions={renderRightActions}
            overshootLeft={false}
            overshootRight={false}
        >
            <Pressable style={[styles.taskItem, { backgroundColor: tc.cardBg }]} onPress={onPress}>
                <View style={styles.taskContent}>
                    <Text style={[styles.taskTitle, { color: tc.text }]} numberOfLines={2}>
                        {task.title}
                    </Text>
                    {task.description && (
                        <Text style={[styles.taskDescription, { color: tc.secondaryText }]} numberOfLines={1}>
                            {task.description}
                        </Text>
                    )}
                    {task.dueDate && (
                        <Text style={styles.taskDueDate}>
                            Due: {new Date(task.dueDate).toLocaleDateString()}
                        </Text>
                    )}
                    {!hideContexts && task.contexts && task.contexts.length > 0 && (
                        <View style={styles.contextsRow}>
                            {task.contexts.map((ctx, idx) => (
                                <Text key={idx} style={styles.contextTag}>
                                    {ctx}
                                </Text>
                            ))}
                        </View>
                    )}
                </View>
                <View style={[styles.statusIndicator, { backgroundColor: getStatusColor(task.status) }]} />
            </Pressable>
        </Swipeable>
    );
}

const styles = StyleSheet.create({
    taskItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    taskContent: {
        flex: 1,
    },
    taskTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    taskDescription: {
        fontSize: 14,
        marginBottom: 4,
    },
    taskDueDate: {
        fontSize: 12,
        color: '#EF4444',
        marginTop: 4,
    },
    contextsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: 8,
    },
    contextTag: {
        fontSize: 11,
        color: '#3B82F6',
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    statusIndicator: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginLeft: 12,
    },
    swipeActionLeft: {
        backgroundColor: '#10B981',
        justifyContent: 'center',
        alignItems: 'center',
        width: 100,
        borderRadius: 12,
        marginBottom: 12,
        marginRight: 8,
    },
    swipeActionRight: {
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        width: 100,
        borderRadius: 12,
        marginBottom: 12,
        marginLeft: 8,
    },
    swipeActionText: {
        color: '#FFFFFF',
        fontWeight: '600',
        fontSize: 14,
    },
});
