import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTaskStore } from '@mindwtr/core';
import { useEffect, useRef, useState } from 'react';
import type { Task, TaskStatus } from '@mindwtr/core';
import { useTheme } from '../../contexts/theme-context';
import { useLanguage } from '../../contexts/language-context';

import { useThemeColors } from '@/hooks/use-theme-colors';
import { SwipeableTaskItem } from '../swipeable-task-item';
import { TaskEditModal } from '../task-edit-modal';



export function WaitingView() {
  const { tasks, updateTask, deleteTask, highlightTaskId, setHighlightTask } = useTaskStore();
  const { isDark } = useTheme();
  const { t } = useLanguage();
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const tc = useThemeColors();

  const waitingTasks = tasks
    .filter((t) => !t.deletedAt && t.status === 'waiting')
    .sort((a, b) => {
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const handleStatusChange = (id: string, status: TaskStatus) => {
    updateTask(id, { status });
  };

  const handleSaveTask = (taskId: string, updates: Partial<Task>) => {
    updateTask(taskId, updates);
  };

  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!highlightTaskId) return;
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightTask(null);
    }, 3500);
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, [highlightTaskId, setHighlightTask]);

  return (
    <View style={[styles.container, { backgroundColor: tc.bg }]}>
      <View style={[styles.stats, { backgroundColor: tc.cardBg, borderBottomColor: tc.border }]}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{waitingTasks.length}</Text>
          <Text style={styles.statLabel}>{t('waiting.count')}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {waitingTasks.filter((t) => t.dueDate).length}
          </Text>
          <Text style={styles.statLabel}>{t('waiting.withDeadline')}</Text>
        </View>
      </View>

      <ScrollView style={styles.taskList} showsVerticalScrollIndicator={false}>
        {waitingTasks.length > 0 ? (
          waitingTasks.map((task) => (
            <SwipeableTaskItem
              key={task.id}
              task={task}
              isDark={isDark}
              tc={tc}
              onPress={() => setEditingTask(task)}
              onStatusChange={(status) => handleStatusChange(task.id, status)}
              onDelete={() => deleteTask(task.id)}
              isHighlighted={task.id === highlightTaskId}
            />
          ))
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>⏸️</Text>
            <Text style={styles.emptyTitle}>{t('waiting.empty')}</Text>
            <Text style={styles.emptyText}>
              {t('waiting.emptyHint')}
            </Text>
          </View>
        )}
      </ScrollView>

      <TaskEditModal
        visible={editingTask !== null}
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onSave={handleSaveTask}
        defaultTab="view"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  stats: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    gap: 24,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F59E0B',
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  taskList: {
    flex: 1,
    padding: 16,
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
});
