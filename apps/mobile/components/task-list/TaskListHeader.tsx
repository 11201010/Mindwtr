import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ArrowUpDown, Folder, SlidersHorizontal, X } from 'lucide-react-native';

import { ListOverflowMenu } from '@/components/list-overflow-menu';
import { styles } from './task-list.styles';

type ThemeColors = {
  border: string;
  cardBg: string;
  danger: string;
  filterBg: string;
  onTint: string;
  secondaryText: string;
  text: string;
  tint: string;
};

export type TaskListActiveFilterChip = {
  id: string;
  label: string;
  /** Excluded (subtracting) token — struck through and danger-colored. */
  excluded?: boolean;
  onPress: () => void;
};

type TaskListHeaderProps = {
  activeFilterChips: TaskListActiveFilterChip[];
  count: number;
  /** Inbox-only: keep Sort, Group, and Filters as direct compact controls. */
  directControls?: boolean;
  headerAccessory?: React.ReactNode;
  filterActiveCount: number;
  groupByLabel?: string;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onOpenFilters: () => void;
  onOpenGroup?: () => void;
  onOpenSort: () => void;
  renderOverflowOnly?: boolean;
  showHeader: boolean;
  showFilterButton?: boolean;
  showOverflow?: boolean;
  showSort: boolean;
  sortByLabel: string;
  t: (key: string) => string;
  themeColors: ThemeColors;
  title: string;
};

export function TaskListHeader({
  activeFilterChips,
  count,
  directControls = false,
  headerAccessory,
  filterActiveCount,
  groupByLabel,
  hasActiveFilters,
  onClearFilters,
  onOpenFilters,
  onOpenGroup,
  onOpenSort,
  renderOverflowOnly = false,
  showHeader,
  showFilterButton = true,
  showOverflow = true,
  showSort,
  sortByLabel,
  t,
  themeColors,
  title,
}: TaskListHeaderProps) {
  const filtersLabel = t('filters.label') === 'filters.label' ? 'Filters' : t('filters.label');
  const groupLabel = t('list.groupBy') === 'list.groupBy' ? 'Group' : t('list.groupBy');
  const allLabel = t('common.all') === 'common.all' ? 'All' : t('common.all');
  const moreOptionsLabel = t('taskEdit.moreOptions') === 'taskEdit.moreOptions' ? 'More options' : t('taskEdit.moreOptions');
  const backLabel = t('common.back') === 'common.back' ? 'Back' : t('common.back');
  const closeLabel = t('common.close') === 'common.close' ? 'Close' : t('common.close');
  const clearLabel = t('filters.clear') === 'filters.clear' ? t('common.clear') : t('filters.clear');
  const removeFilterLabel = t('filters.remove') === 'filters.remove' ? 'Remove filter' : t('filters.remove');
  const excludedStateLabel = t('filters.excluded') === 'filters.excluded' ? 'Excluded' : t('filters.excluded');
  const activeFiltersLabel = `${filtersLabel} · ${filterActiveCount}`;
  const activeFilterControl = !directControls && showFilterButton && hasActiveFilters ? (
    <TouchableOpacity
      onPress={onOpenFilters}
      style={[
        styles.activeFiltersButton,
        { borderColor: themeColors.tint, backgroundColor: themeColors.filterBg },
      ]}
      accessibilityRole="button"
      accessibilityLabel={activeFiltersLabel}
      accessibilityState={{ selected: true }}
      hitSlop={8}
    >
      <SlidersHorizontal size={16} color={themeColors.tint} strokeWidth={2} />
      <Text style={[styles.activeFiltersButtonText, { color: themeColors.tint }]}>{activeFiltersLabel}</Text>
    </TouchableOpacity>
  ) : null;
  const directControlGroup = directControls ? (
    <View style={styles.headerAccessoryControls}>
      {showSort ? (
        <TouchableOpacity
          accessibilityLabel={`${t('sort.label')}: ${sortByLabel}`}
          accessibilityRole="button"
          onPress={onOpenSort}
          style={styles.directControlButton}
        >
          <View style={[styles.directControlVisual, { borderColor: themeColors.border, backgroundColor: themeColors.filterBg }]}>
            <ArrowUpDown size={16} color={themeColors.secondaryText} strokeWidth={2} />
          </View>
        </TouchableOpacity>
      ) : null}
      {onOpenGroup ? (
        <TouchableOpacity
          accessibilityLabel={`${groupLabel}: ${groupByLabel ?? allLabel}`}
          accessibilityRole="button"
          onPress={onOpenGroup}
          style={styles.directControlButton}
        >
          <View style={[styles.directControlVisual, { borderColor: themeColors.border, backgroundColor: themeColors.filterBg }]}>
            <Folder size={16} color={themeColors.secondaryText} strokeWidth={2} />
          </View>
        </TouchableOpacity>
      ) : null}
      {showFilterButton ? (
        <TouchableOpacity
          accessibilityLabel={`${filtersLabel}: ${hasActiveFilters ? filterActiveCount : allLabel}`}
          accessibilityRole="button"
          accessibilityState={{ selected: hasActiveFilters }}
          onPress={onOpenFilters}
          style={styles.directControlButton}
        >
          <View
            style={[
              styles.directControlVisual,
              {
                borderColor: hasActiveFilters ? themeColors.tint : themeColors.border,
                backgroundColor: themeColors.filterBg,
              },
            ]}
          >
            <SlidersHorizontal
              size={16}
              color={hasActiveFilters ? themeColors.tint : themeColors.secondaryText}
              strokeWidth={2}
            />
          </View>
        </TouchableOpacity>
      ) : null}
    </View>
  ) : null;
  const overflowControl = !directControls && showOverflow && (showFilterButton || showSort || onOpenGroup) ? (
    <ListOverflowMenu
      actions={[
        ...(showFilterButton ? [{
          id: 'filters',
          label: filtersLabel,
          icon: (color: string) => <SlidersHorizontal size={18} color={color} strokeWidth={2} />,
          onPress: onOpenFilters,
          selected: hasActiveFilters,
        }] : []),
        ...(showSort ? [{
          id: 'sort',
          label: t('sort.label'),
          accessibilityLabel: `${t('sort.label')}: ${sortByLabel}`,
          icon: (color: string) => <ArrowUpDown size={18} color={color} strokeWidth={2} />,
          onPress: onOpenSort,
          value: sortByLabel,
        }] : []),
        ...(onOpenGroup ? [{
          id: 'group',
          label: groupLabel,
          accessibilityLabel: `${groupLabel}: ${groupByLabel ?? allLabel}`,
          icon: (color: string) => <Folder size={18} color={color} strokeWidth={2} />,
          onPress: onOpenGroup,
          value: groupByLabel ?? allLabel,
        }] : []),
      ]}
      backLabel={backLabel}
      closeLabel={closeLabel}
      moreLabel={moreOptionsLabel}
      themeColors={themeColors}
      triggerStyle={renderOverflowOnly ? styles.navigationOverflowButton : undefined}
    />
  ) : null;
  if (renderOverflowOnly) return overflowControl;
  return (
    <>
      {showHeader ? (
        <View style={[styles.header, { borderBottomColor: themeColors.border, backgroundColor: themeColors.cardBg }]}>
          <View style={styles.headerTopRow}>
            <Text style={[styles.title, { color: themeColors.text }]} accessibilityRole="header" numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.count, { color: themeColors.secondaryText }]} accessibilityLabel={`${count} tasks`}>
              {count} {t('common.tasks')}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {directControlGroup}
            {activeFilterControl}
            {headerAccessory}
            {overflowControl}
          </View>
        </View>
      ) : directControlGroup || overflowControl || activeFilterControl || headerAccessory ? (
        <View style={styles.headerAccessoryRow}>
          <View style={styles.headerAccessoryLeft}>
            {directControlGroup}
            {activeFilterControl}
          </View>
          <View style={styles.headerAccessoryRight}>
            {headerAccessory}
            {overflowControl}
          </View>
        </View>
      ) : null}

      {activeFilterChips.length > 0 ? (
        <View style={[styles.filterSection, { borderBottomColor: themeColors.border, backgroundColor: themeColors.cardBg }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips}>
            {activeFilterChips.map((chip) => {
              const accent = chip.excluded ? themeColors.danger : themeColors.tint;
              return (
                <TouchableOpacity
                  key={chip.id}
                  accessibilityRole="button"
                  accessibilityLabel={chip.excluded
                    ? `${removeFilterLabel}: ${chip.label} (${excludedStateLabel})`
                    : `${removeFilterLabel}: ${chip.label}`}
                  onPress={chip.onPress}
                  style={[
                    styles.filterChip,
                    {
                      borderColor: accent,
                      backgroundColor: themeColors.filterBg,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      { color: accent },
                      chip.excluded ? { textDecorationLine: 'line-through' } : null,
                    ]}
                  >
                    {chip.label}
                  </Text>
                  <X size={14} color={accent} />
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={clearLabel}
              onPress={onClearFilters}
              style={[styles.filterChip, { borderColor: themeColors.border, backgroundColor: themeColors.filterBg }]}
            >
              <Text style={[styles.filterChipText, { color: themeColors.secondaryText }]}>
                {clearLabel}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      ) : null}
    </>
  );
}
