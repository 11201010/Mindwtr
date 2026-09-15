import React from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ClipboardCheck, X } from 'lucide-react-native';
import { tFallback, type TaskStatus } from '@mindwtr/core';

import { styles } from './task-list.styles';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';

export const BULK_MOVE_STATUS_ORDER: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'done', 'reference'];

export function getBulkMoveStatusOptions(currentStatus?: TaskStatus | 'all'): TaskStatus[] {
  if (!currentStatus || currentStatus === 'all') return BULK_MOVE_STATUS_ORDER;
  if (currentStatus === 'done') {
    return [...BULK_MOVE_STATUS_ORDER.filter((status) => status !== currentStatus), 'archived'];
  }
  return BULK_MOVE_STATUS_ORDER.filter((status) => status !== currentStatus);
}

type ThemeColors = {
  border: string;
  cardBg: string;
  filterBg: string;
  onTint: string;
  secondaryText: string;
  text: string;
  tint: string;
};

export type TaskListBulkBarProps = {
  bulkActionLabel: string;
  bulkActionLoading: boolean;
  handleBatchDelete: () => void;
  handleBatchMove: (status: TaskStatus) => void;
  hasSelection: boolean;
  onExitSelectionMode: () => void;
  onOpenOrganize?: () => void;
  onMoveToSection?: () => void;
  onToggleRangeSelectMode: () => void;
  onOpenTagModal: () => void;
  onOpenRemoveTagPicker?: () => void;
  canRemoveTags?: boolean;
  rangeSelectMode: boolean;
  selectedCount: number;
  statusOptions?: readonly TaskStatus[];
  t: (key: string) => string;
  themeColors: ThemeColors;
};

export function TaskListBulkBar({
  bulkActionLabel,
  bulkActionLoading,
  handleBatchDelete,
  handleBatchMove,
  hasSelection,
  onExitSelectionMode,
  onOpenOrganize,
  onMoveToSection,
  onToggleRangeSelectMode,
  onOpenTagModal,
  onOpenRemoveTagPicker,
  canRemoveTags = false,
  rangeSelectMode,
  selectedCount,
  statusOptions,
  t,
  themeColors,
}: TaskListBulkBarProps) {
  const filledButton = useFilledButtonColors();
  const rangeLabel = rangeSelectMode
    ? tFallback(t, 'bulk.selectRangeActive', 'Pick end')
    : tFallback(t, 'bulk.selectRange', 'Range');
  const canSelectRange = hasSelection && !bulkActionLoading;
  const moveStatusOptions = statusOptions ?? BULK_MOVE_STATUS_ORDER;
  const deleteLabel = tFallback(t, 'common.delete', 'Delete');

  return (
    <View style={[styles.bulkBar, { backgroundColor: themeColors.cardBg, borderBottomColor: themeColors.border }]}>
      <View style={styles.bulkStatusRow}>
        <Text style={[styles.bulkCount, { color: themeColors.secondaryText }]}>
          {selectedCount} {t('bulk.selected')}
        </Text>
        <View style={styles.bulkStatusActions}>
          {bulkActionLoading && (
            <View style={styles.bulkLoadingRow}>
              <ActivityIndicator size="small" color={themeColors.tint} />
              <Text style={[styles.bulkLoadingText, { color: themeColors.secondaryText }]}>
                {bulkActionLabel || t('common.loading')}
              </Text>
            </View>
          )}
          <TouchableOpacity
            onPress={onExitSelectionMode}
            disabled={bulkActionLoading}
            style={[
              styles.bulkExitButton,
              { backgroundColor: themeColors.filterBg, opacity: bulkActionLoading ? 0.5 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={tFallback(t, 'bulk.exitSelect', 'Done')}
          >
            <X size={16} color={themeColors.secondaryText} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bulkMoveRow}>
        {moveStatusOptions.map((status) => (
          <TouchableOpacity
            key={status}
            onPress={() => handleBatchMove(status)}
            disabled={!hasSelection || bulkActionLoading}
            style={[styles.bulkMoveButton, { backgroundColor: themeColors.filterBg, opacity: hasSelection && !bulkActionLoading ? 1 : 0.5 }]}
            accessibilityRole="button"
            accessibilityLabel={`${t('bulk.moveTo')} ${t(`status.${status}`)}`}
          >
            <Text style={[styles.bulkMoveText, { color: themeColors.text }]}>{t(`status.${status}`)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.bulkActions}>
        {onMoveToSection ? (
          <TouchableOpacity
            onPress={onMoveToSection}
            disabled={!hasSelection || bulkActionLoading}
            style={[styles.bulkActionButton, { backgroundColor: themeColors.filterBg, opacity: hasSelection && !bulkActionLoading ? 1 : 0.5 }]}
            accessibilityRole="button"
            accessibilityLabel={tFallback(t, 'viewSections.moveToSection', 'Move to section…')}
          >
            <Text style={[styles.bulkActionText, { color: themeColors.text }]}>
              {tFallback(t, 'viewSections.moveToSection', 'Move to section…')}
            </Text>
          </TouchableOpacity>
        ) : null}
        {onOpenOrganize ? (
          <TouchableOpacity
            onPress={onOpenOrganize}
            disabled={!hasSelection || bulkActionLoading}
            style={[styles.bulkActionButton, { backgroundColor: filledButton.backgroundColor, opacity: hasSelection && !bulkActionLoading ? 1 : 0.5 }]}
            accessibilityRole="button"
            accessibilityLabel={tFallback(t, 'bulk.organize', 'Bulk organize')}
          >
            <ClipboardCheck size={14} color={filledButton.textColor ?? themeColors.onTint} />
            <Text style={[styles.bulkActionText, { color: filledButton.textColor ?? themeColors.onTint }]}>
              {tFallback(t, 'bulk.organize', 'Bulk organize')}
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={onToggleRangeSelectMode}
          disabled={!canSelectRange}
          style={[
            styles.bulkActionButton,
            {
              backgroundColor: rangeSelectMode ? themeColors.tint : themeColors.filterBg,
              opacity: canSelectRange ? 1 : 0.5,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={rangeLabel}
          accessibilityState={{ disabled: !canSelectRange, selected: rangeSelectMode }}
          testID="task-list-range-select-toggle"
        >
          <Text style={[styles.bulkActionText, { color: rangeSelectMode ? themeColors.onTint : themeColors.text }]}>
            {rangeLabel}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onOpenTagModal}
          disabled={!hasSelection || bulkActionLoading}
          style={[styles.bulkActionButton, { backgroundColor: themeColors.filterBg, opacity: hasSelection && !bulkActionLoading ? 1 : 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel={t('bulk.addTag')}
        >
          <Text style={[styles.bulkActionText, { color: themeColors.text }]}>{t('bulk.addTag')}</Text>
        </TouchableOpacity>
        {onOpenRemoveTagPicker ? (
          <TouchableOpacity
            onPress={onOpenRemoveTagPicker}
            disabled={!hasSelection || bulkActionLoading || !canRemoveTags}
            style={[
              styles.bulkActionButton,
              {
                backgroundColor: themeColors.filterBg,
                opacity: hasSelection && !bulkActionLoading && canRemoveTags ? 1 : 0.5,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={tFallback(t, 'bulk.removeTag', 'Remove tag')}
          >
            <Text style={[styles.bulkActionText, { color: themeColors.text }]}>
              {tFallback(t, 'bulk.removeTag', 'Remove tag')}
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={handleBatchDelete}
          disabled={!hasSelection || bulkActionLoading}
          style={[styles.bulkActionButton, { backgroundColor: themeColors.filterBg, opacity: hasSelection && !bulkActionLoading ? 1 : 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
        >
          <Text style={[styles.bulkActionText, { color: themeColors.text }]}>{deleteLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
