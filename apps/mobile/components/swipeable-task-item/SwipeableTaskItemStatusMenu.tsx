import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { TaskStatus, tFallback } from '@mindwtr/core';
import type { ThemeColors } from '../../hooks/use-theme-colors';
import { useStatusColors } from '../../hooks/use-status-colors';
import { styles } from './swipeable-task-item.styles';

interface SwipeableTaskItemStatusMenuProps {
    /** Long-press on the Done option completes the task with a picked timestamp. */
    onBackdatedComplete?: () => void;
    onClose: () => void;
    onStatusChange: (status: TaskStatus) => void;
    onMoveToSection?: () => void;
    onMoveToDestination?: () => void;
    taskStatus: TaskStatus;
    tc: ThemeColors;
    t: (key: string) => string;
    visible: boolean;
}

const QUICK_STATUS_OPTIONS: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'done', 'reference'];

export function SwipeableTaskItemStatusMenu({
    onBackdatedComplete,
    onClose,
    onStatusChange,
    onMoveToSection,
    onMoveToDestination,
    taskStatus,
    tc,
    t,
    visible,
}: SwipeableTaskItemStatusMenuProps) {
    const statusColors = useStatusColors();
    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            accessibilityViewIsModal
        >
            <Pressable style={styles.modalOverlay} onPress={onClose}>
                <View style={[styles.menuContainer, { backgroundColor: tc.cardBg }]}>
                    <Text style={[styles.menuTitle, { color: tc.text }]} accessibilityRole="header">
                        {t('taskStatus.changeStatus')}
                    </Text>
                    <View style={styles.menuGrid}>
                        {QUICK_STATUS_OPTIONS.map((status) => {
                            const colors = statusColors[status];
                            return (
                                <Pressable
                                    key={status}
                                    style={[
                                        styles.menuItem,
                                        taskStatus === status && { backgroundColor: colors.bg },
                                        { borderColor: colors.text },
                                    ]}
                                    onPress={() => {
                                        onStatusChange(status);
                                        onClose();
                                    }}
                                    onLongPress={status === 'done' && onBackdatedComplete ? () => {
                                        onBackdatedComplete();
                                        onClose();
                                    } : undefined}
                                    accessibilityRole="button"
                                    accessibilityLabel={t(`status.${status}`)}
                                    accessibilityHint={status === 'done' && onBackdatedComplete
                                        ? tFallback(t, 'task.completeBackdateHintMobile', 'Long-press to complete with a different time')
                                        : undefined}
                                    accessibilityState={{ selected: taskStatus === status }}
                                >
                                    <View style={[styles.menuDot, { backgroundColor: colors.text }]} />
                                    <Text style={[styles.menuText, { color: tc.text }]}>{t(`status.${status}`)}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                    {onMoveToDestination ? (
                        <Pressable
                            style={[styles.menuItem, { borderColor: tc.border }]}
                            onPress={() => {
                                onMoveToDestination();
                                onClose();
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={tFallback(t, 'task.moveTo', 'Move to…')}
                        >
                            <Text style={[styles.menuText, { color: tc.text }]}>
                                {tFallback(t, 'task.moveTo', 'Move to…')}
                            </Text>
                        </Pressable>
                    ) : null}
                    {onMoveToSection ? (
                        <Pressable
                            style={[styles.menuItem, { borderColor: tc.border }]}
                            onPress={() => {
                                onMoveToSection();
                                onClose();
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={tFallback(t, 'viewSections.moveToSection', 'Move to section…')}
                        >
                            <Text style={[styles.menuText, { color: tc.text }]}>
                                {tFallback(t, 'viewSections.moveToSection', 'Move to section…')}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            </Pressable>
        </Modal>
    );
}
