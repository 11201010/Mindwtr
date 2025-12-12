import { View, Text, ScrollView, Pressable, StyleSheet, TouchableOpacity, Modal, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useTaskStore, sortTasksBy, type Task, type TaskStatus, type TaskSortBy } from '@mindwtr/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from '../../../contexts/theme-context';
import { useLanguage } from '../../../contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { ReviewModal } from '../../../components/review-modal';

import { TaskEditModal } from '@/components/task-edit-modal';
import { SwipeableTaskItem } from '@/components/swipeable-task-item';

const STATUS_OPTIONS: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'done'];

export default function ReviewScreen() {
  const router = useRouter();
  const { tasks, updateTask, deleteTask, batchMoveTasks, batchDeleteTasks, batchUpdateTasks, settings } = useTaskStore();
  const { isDark } = useTheme();
  const { t } = useLanguage();
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [moveModalVisible, setMoveModalVisible] = useState(false);

  const tc = useThemeColors();

  const tasksById = useMemo(() => {
    return tasks.reduce((acc, task) => {
      acc[task.id] = task;
      return acc;
    }, {} as Record<string, Task>);
  }, [tasks]);

  const selectedIdsArray = useMemo(() => Array.from(multiSelectedIds), [multiSelectedIds]);
  const hasSelection = selectedIdsArray.length > 0;

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setMultiSelectedIds(new Set());
  }, []);

  useEffect(() => {
    exitSelectionMode();
  }, [filterStatus, exitSelectionMode]);

  const toggleMultiSelect = useCallback((taskId: string) => {
    if (!selectionMode) setSelectionMode(true);
    setMultiSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, [selectionMode]);

  const handleBatchMove = useCallback(async (newStatus: TaskStatus) => {
    if (!hasSelection) return;
    await batchMoveTasks(selectedIdsArray, newStatus);
    exitSelectionMode();
  }, [batchMoveTasks, selectedIdsArray, hasSelection, exitSelectionMode]);

  const handleBatchDelete = useCallback(async () => {
    if (!hasSelection) return;
    await batchDeleteTasks(selectedIdsArray);
    exitSelectionMode();
  }, [batchDeleteTasks, selectedIdsArray, hasSelection, exitSelectionMode]);

  const handleBatchAddTag = useCallback(async () => {
    const input = tagInput.trim();
    if (!hasSelection || !input) return;
    const tag = input.startsWith('#') ? input : `#${input}`;
    await batchUpdateTasks(selectedIdsArray.map((id) => {
      const task = tasksById[id];
      const existingTags = task?.tags || [];
      const nextTags = Array.from(new Set([...existingTags, tag]));
      return { id, updates: { tags: nextTags } };
    }));
    setTagInput('');
    setTagModalVisible(false);
    exitSelectionMode();
  }, [batchUpdateTasks, selectedIdsArray, tasksById, tagInput, hasSelection, exitSelectionMode]);

  const bulkStatuses: TaskStatus[] = ['inbox', 'todo', 'next', 'in-progress', 'waiting', 'someday', 'done', 'archived'];

  // Filter out archived and deleted tasks first, then apply status filter
  const activeTasks = tasks.filter((t) => t.status !== 'archived' && !t.deletedAt);
  const filteredTasks = activeTasks.filter((task) =>
    filterStatus === 'all' ? true : task.status === filterStatus
  );

  const sortBy = (settings?.taskSortBy ?? 'default') as TaskSortBy;
  const sortedTasks = sortTasksBy(filteredTasks, sortBy);

  return (
    <View style={[styles.container, { backgroundColor: tc.bg }]}>
      <View style={[styles.header, { backgroundColor: tc.cardBg, borderBottomColor: tc.border }]}>
        <View>
          <Text style={[styles.title, { color: tc.text }]}>{t('review.title')}</Text>
          <Text style={[styles.count, { color: tc.secondaryText }]}>{filteredTasks.length} {t('common.tasks')}</Text>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={[
              styles.selectButton,
              { borderColor: tc.border, backgroundColor: selectionMode ? tc.filterBg : 'transparent' }
            ]}
            onPress={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
          >
            <Text style={[styles.selectButtonText, { color: tc.text }]}>
              {selectionMode ? t('bulk.exitSelect') : t('bulk.select')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.weeklyReviewButton}
            onPress={() => setShowReviewModal(true)}
          >
            <Text style={styles.weeklyReviewButtonText}>{t('review.openGuide')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal style={[styles.filterBar, { backgroundColor: tc.cardBg, borderBottomColor: tc.border }]} showsHorizontalScrollIndicator={false}>
        <Pressable
          style={[styles.filterButton, { backgroundColor: tc.filterBg }, filterStatus === 'all' && styles.filterButtonActive]}
          onPress={() => setFilterStatus('all')}
        >
          <Text style={[styles.filterText, { color: tc.secondaryText }, filterStatus === 'all' && styles.filterTextActive]}>
            {t('common.all')} ({activeTasks.length})
          </Text>
        </Pressable>
        {STATUS_OPTIONS.map((status) => (
          <Pressable
            key={status}
            style={[styles.filterButton, { backgroundColor: tc.filterBg }, filterStatus === status && styles.filterButtonActive]}
            onPress={() => setFilterStatus(status)}
          >
            <Text style={[styles.filterText, { color: tc.secondaryText }, filterStatus === status && styles.filterTextActive]}>
              {t(`status.${status}`)} ({activeTasks.filter((t) => t.status === status).length})
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {selectionMode && (
        <View style={[styles.bulkBar, { backgroundColor: tc.cardBg, borderBottomColor: tc.border }]}>
          <Text style={[styles.bulkCount, { color: tc.secondaryText }]}>
            {selectedIdsArray.length} {t('bulk.selected')}
          </Text>
          <View style={styles.bulkActions}>
            <TouchableOpacity
              onPress={() => setMoveModalVisible(true)}
              disabled={!hasSelection}
              style={[styles.bulkActionButton, { backgroundColor: tc.filterBg, opacity: hasSelection ? 1 : 0.5 }]}
            >
              <Text style={[styles.bulkActionText, { color: tc.text }]}>{t('bulk.moveTo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setTagModalVisible(true)}
              disabled={!hasSelection}
              style={[styles.bulkActionButton, { backgroundColor: tc.filterBg, opacity: hasSelection ? 1 : 0.5 }]}
            >
              <Text style={[styles.bulkActionText, { color: tc.text }]}>{t('bulk.addTag')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleBatchDelete}
              disabled={!hasSelection}
              style={[styles.bulkActionButton, { backgroundColor: tc.filterBg, opacity: hasSelection ? 1 : 0.5 }]}
            >
              <Text style={[styles.bulkActionText, { color: tc.text }]}>{t('bulk.delete')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView style={styles.taskList}>
        {sortedTasks.map((task) => (
          <SwipeableTaskItem
            key={task.id}
            task={task}
            isDark={isDark}
            tc={tc}
            onPress={() => {
              setEditingTask(task);
              setIsModalVisible(true);
            }}
            selectionMode={selectionMode}
            isMultiSelected={multiSelectedIds.has(task.id)}
            onToggleSelect={() => toggleMultiSelect(task.id)}
            onStatusChange={(status) => updateTask(task.id, { status: status as TaskStatus })}
            onDelete={() => deleteTask(task.id)}
          />
        ))}
        {sortedTasks.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: tc.secondaryText }]}>{t('review.noTasks')}</Text>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={moveModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMoveModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setMoveModalVisible(false)}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: tc.cardBg }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: tc.text }]}>{t('bulk.moveTo')}</Text>
            <View style={styles.moveOptions}>
              {bulkStatuses.map((status) => (
                <TouchableOpacity
                  key={status}
                  onPress={async () => {
                    setMoveModalVisible(false);
                    await handleBatchMove(status);
                  }}
                  disabled={!hasSelection}
                  style={[
                    styles.moveOptionButton,
                    { backgroundColor: tc.filterBg, borderColor: tc.border, opacity: hasSelection ? 1 : 0.5 },
                  ]}
                >
                  <Text style={[styles.moveOptionText, { color: tc.text }]}>{t(`status.${status}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => setMoveModalVisible(false)}
                style={styles.modalButton}
              >
                <Text style={[styles.modalButtonText, { color: tc.secondaryText }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={tagModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTagModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setTagModalVisible(false)}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: tc.cardBg }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: tc.text }]}>{t('bulk.addTag')}</Text>
            <TextInput
              value={tagInput}
              onChangeText={setTagInput}
              placeholder="#tag"
              placeholderTextColor={tc.secondaryText}
              style={[styles.modalInput, { backgroundColor: tc.filterBg, color: tc.text, borderColor: tc.border }]}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => {
                  setTagModalVisible(false);
                  setTagInput('');
                }}
                style={styles.modalButton}
              >
                <Text style={[styles.modalButtonText, { color: tc.secondaryText }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleBatchAddTag}
                disabled={!tagInput.trim()}
                style={[styles.modalButton, !tagInput.trim() && styles.modalButtonDisabled]}
              >
                <Text style={[styles.modalButtonText, { color: tc.tint }]}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <TaskEditModal
        visible={isModalVisible}
        task={editingTask}
        onClose={() => setIsModalVisible(false)}
        onSave={(taskId, updates) => updateTask(taskId, updates)}
        onFocusMode={(taskId) => {
          setIsModalVisible(false);
          router.push(`/check-focus?id=${taskId}`);
        }}
      />

      <ReviewModal
        visible={showReviewModal}
        onClose={() => setShowReviewModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  count: {
    fontSize: 14,
  },
  filterBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    maxHeight: 60,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  filterButtonActive: {
    backgroundColor: '#3B82F6',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '500',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  taskList: {
    flex: 1,
    padding: 16,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
  },
  weeklyReviewButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  weeklyReviewButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectButton: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  selectButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  bulkBar: {
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  bulkCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  bulkMoveRow: {
    gap: 6,
    paddingVertical: 2,
  },
  bulkMoveButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  bulkMoveText: {
    fontSize: 12,
    fontWeight: '500',
  },
  bulkActions: {
    flexDirection: 'row',
    gap: 8,
  },
  bulkActionButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  bulkActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  moveOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  moveOptionButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  moveOptionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalButtonDisabled: {
    opacity: 0.5,
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
