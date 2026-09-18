import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  TASK_LIST_SORT_OPTIONS,
  flushPendingSave,
  getTaskMetadataFilterVisibility,
  getUsedTaskTokens,
  groupTasksByViewSection,
  normalizeBulkTaskTokenInput,
  resolveFeatureFlags,
  resolveNonDoneTaskSortBy,
  SAVED_FILTER_NO_PROJECT_ID,
  shallow,
  sortTasksBy,
  sortViewSectionDefinitions,
  tFallback,
  useTaskStore,
} from '@mindwtr/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task, TaskSortBy, TaskStatus, ViewSectionTaskGroup } from '@mindwtr/core';
import { useTheme } from '../../contexts/theme-context';
import { useLanguage } from '../../contexts/language-context';
import { ArrowUpDown, Eye, Folder, Lightbulb, Plus, SlidersHorizontal } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useVisibleTaskContext } from '@/hooks/use-visible-tasks';
import { compareSomedayTasks } from '@/lib/list-order';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { openContextsScreen, openProjectScreen } from '@/lib/task-meta-navigation';
import { TaskEditModal } from '../task-edit-modal';
import { getBulkMoveStatusOptions } from '../task-list/TaskListBulkBar';
import { assertBulkActionSucceeded, usePruneSelectionToVisible, useTaskListSelection } from '../use-task-list-selection';
import { TaskListView } from '../task-list-view';
import { FilterChip, TaskFilterSheet } from '../task-filter-sheet';
import { resolveTimeEstimateFilterOptions } from '../time-estimate-filter-utils';
import { DeferredProjectsSection, selectDeferredProjects } from './deferred-projects-section';
import { SomedaySectionPicker } from '../someday-section-picker';
import { createSomedaySection } from '@/lib/someday-section-actions';
import { useToast } from '@/contexts/toast-context';
import { logError } from '@/lib/app-log';
import { useSomedaySectionMove } from './use-someday-section-move';
import { ListOverflowMenu } from '../list-overflow-menu';
import { taskMatchesFilterSelections, useTaskFilterSelections } from '@/hooks/use-task-filter-selections';
import { buildTaskGroupSections, type TaskGroupItem } from '@/lib/task-group-sections';

const SOMEDAY_GROUP_OPTIONS = ['viewSection', 'none', 'project', 'area'] as const;
type SomedayGroupBy = typeof SOMEDAY_GROUP_OPTIONS[number];

const getSomedayGroupByLabel = (groupBy: SomedayGroupBy, t: (key: string) => string): string => {
  switch (groupBy) {
    case 'viewSection':
      return tFallback(t, 'viewSections.somedaySection', 'Someday section');
    case 'none':
      return tFallback(t, 'list.groupByNone', 'No grouping');
    case 'project':
      return tFallback(t, 'list.groupByProject', 'Project');
    case 'area':
      return tFallback(t, 'list.groupByArea', 'Area');
  }
};

const toTaskListViewGroups = (items: readonly TaskGroupItem[]): ViewSectionTaskGroup[] => {
  const groups: ViewSectionTaskGroup[] = [];
  let current: ViewSectionTaskGroup | null = null;
  items.forEach((item) => {
    if (item.type === 'section') {
      current = { id: `attribute-group:${item.id}`, title: item.title, muted: item.muted, tasks: [] };
      groups.push(current);
      return;
    }
    current?.tasks.push(item.task);
  });
  return groups;
};

export function SomedayView() {
  const { tasks, projects, settings, updateTask, updateProject, deleteTask, restoreTask, batchMoveTasks, batchDeleteTasks, batchUpdateTasks, highlightTaskId, setHighlightTask } = useTaskStore((state) => ({
    tasks: state.tasks,
    projects: state.projects,
    settings: state.settings,
    updateTask: state.updateTask,
    updateProject: state.updateProject,
    deleteTask: state.deleteTask,
    restoreTask: state.restoreTask,
    batchMoveTasks: state.batchMoveTasks,
    batchDeleteTasks: state.batchDeleteTasks,
    batchUpdateTasks: state.batchUpdateTasks,
    highlightTaskId: state.highlightTaskId,
    setHighlightTask: state.setHighlightTask,
  }), shallow);
  const { isDark } = useTheme();
  const { t } = useLanguage();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [sortBy, setSortBy] = useState<TaskSortBy>('default');
  const [groupBy, setGroupBy] = useState<SomedayGroupBy>('viewSection');
  const [showDetails, setShowDetails] = useState(false);
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [addingGroup, setAddingGroup] = useState<{ sectionId?: string; title: string } | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [addTaskError, setAddTaskError] = useState(false);
  const pendingAddedTaskRef = useRef<{ id: string; title: string } | null>(null);
  const router = useRouter();
  const { showToast } = useToast();
  const restoreActionLabel = tFallback(t, 'trash.restoreToInbox', 'Restore');

  const tc = useThemeColors();
  const insets = useSafeAreaInsets();
  const { areaById, resolvedAreaFilter, visibleTasks } = useVisibleTaskContext();
  const navBarInset = Platform.OS === 'android' && insets.bottom >= 24 ? insets.bottom : 0;
  const tasksById = useMemo(() => {
    return tasks.reduce((acc, task) => {
      acc[task.id] = task;
      return acc;
    }, {} as Record<string, Task>);
  }, [tasks]);
  const taskListContentStyle = useMemo(
    () => [styles.taskListContent, navBarInset ? { paddingBottom: 16 + navBarInset } : null],
    [navBarInset],
  );

  const baseSomedayTasks = useMemo(
    () => visibleTasks.filter((task) => task.status === 'someday'),
    [visibleTasks],
  );
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const areas = useMemo(() => Array.from(areaById.values()), [areaById]);
  const resolvedFeatureFlags = resolveFeatureFlags(settings);
  const metadataFilterVisibility = useMemo(
    () => getTaskMetadataFilterVisibility(baseSomedayTasks, {
      prioritiesEnabled: resolvedFeatureFlags.priorities,
      timeEstimatesEnabled: resolvedFeatureFlags.timeEstimates,
    }),
    [baseSomedayTasks, resolvedFeatureFlags.priorities, resolvedFeatureFlags.timeEstimates],
  );
  const tokenFilterOptions = useMemo(
    () => getUsedTaskTokens(baseSomedayTasks, (task) => [
      ...(task.contexts ?? []).map((token) => normalizeBulkTaskTokenInput(token, 'contexts')),
      ...(task.tags ?? []).map((token) => normalizeBulkTaskTokenInput(token, 'tags')),
    ]),
    [baseSomedayTasks],
  );
  const usedProjectIds = useMemo(
    () => new Set(baseSomedayTasks.map((task) => task.projectId).filter((id): id is string => Boolean(id))),
    [baseSomedayTasks],
  );
  const projectFilterOptions = useMemo(() => {
    const noProjectOption = baseSomedayTasks.some((task) => !task.projectId)
      ? [{ id: SAVED_FILTER_NO_PROJECT_ID, title: tFallback(t, 'taskEdit.noProjectOption', 'No project') }]
      : [];
    const projectOptions = projects
      .filter((project) => usedProjectIds.has(project.id) && !project.deletedAt && !project.purgedAt)
      .sort((left, right) => {
        const leftOrder = Number.isFinite(left.order) ? left.order : Number.POSITIVE_INFINITY;
        const rightOrder = Number.isFinite(right.order) ? right.order : Number.POSITIVE_INFINITY;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return left.title.localeCompare(right.title);
      })
      .map((project) => ({ id: project.id, title: project.title }));
    return [...noProjectOption, ...projectOptions];
  }, [baseSomedayTasks, projects, t, usedProjectIds]);
  const projectFilterOptionIds = useMemo(
    () => projectFilterOptions.map((project) => project.id),
    [projectFilterOptions],
  );
  const getProjectFilterLabel = useCallback(
    (projectId: string) => projectId === SAVED_FILTER_NO_PROJECT_ID
      ? tFallback(t, 'taskEdit.noProjectOption', 'No project')
      : projectById.get(projectId)?.title,
    [projectById, t],
  );
  const selections = useTaskFilterSelections({
    view: 'list',
    t,
    visibility: metadataFilterVisibility,
    retainTokens: tokenFilterOptions,
    retainProjects: projectFilterOptionIds,
    getProjectLabel: getProjectFilterLabel,
  });
  const effectiveSortBy = resolveNonDoneTaskSortBy(sortBy, settings);
  const somedaySortOptions = useMemo(
    () => TASK_LIST_SORT_OPTIONS.filter((option) => (
      option !== 'timeEstimate' || resolvedFeatureFlags.timeEstimates
    )),
    [resolvedFeatureFlags.timeEstimates],
  );
  const timeEstimateFilterOptions = useMemo(
    () => resolveTimeEstimateFilterOptions(settings?.gtd?.timeEstimatePresets),
    [settings?.gtd?.timeEstimatePresets],
  );
  const somedayTasks = useMemo(() => {
    const filtered = baseSomedayTasks.filter((task) => taskMatchesFilterSelections(task, {
      criteria: selections.criteria,
      searchQuery: selections.searchQuery,
    }));
    return effectiveSortBy === 'default'
      ? [...filtered].sort(compareSomedayTasks)
      : sortTasksBy([...filtered], effectiveSortBy);
  }, [baseSomedayTasks, effectiveSortBy, selections.criteria, selections.searchQuery]);
  const deferredProjects = useMemo(
    () => selectDeferredProjects(projects, 'someday', resolvedAreaFilter, areaById),
    [projects, resolvedAreaFilter, areaById],
  );
  const somedaySections = useMemo(
    () => sortViewSectionDefinitions(settings?.gtd?.viewSections?.someday ?? []),
    [settings?.gtd?.viewSections?.someday],
  );
  const somedayTaskGroups = useMemo(() => {
    if (groupBy === 'none') return undefined;
    if (groupBy !== 'viewSection') {
      return toTaskListViewGroups(buildTaskGroupSections({
        groupBy,
        tasks: somedayTasks,
        areas,
        projectById,
        t,
      }));
    }
    if (somedaySections.length === 0) return undefined;
    const grouped = groupTasksByViewSection(
        somedayTasks,
        'someday',
        somedaySections,
        tFallback(t, 'viewSections.noSection', 'No section'),
      );
    const byId = new Map(grouped.map((group) => [group.id, group]));
    // This Someday grouping is actionable: empty definitions still offer Add task.
    return [
      ...somedaySections.map((section) => byId.get(`view-section:someday:${section.id}`)
        ?? { id: `view-section:someday:${section.id}`, title: section.title, tasks: [] }),
      ...(byId.get('view-section:someday:none') ? [byId.get('view-section:someday:none')!] : []),
    ];
  }, [areas, groupBy, projectById, somedaySections, somedayTasks, t]);
  const selection = useTaskListSelection({
    batchDeleteTasks,
    batchMoveTasks,
    batchUpdateTasks,
    restoreActionLabel,
    restoreTask,
    t,
    tasksById,
  });
  const visibleTaskIds = useMemo(() => somedayTasks.map((task) => task.id), [somedayTasks]);
  usePruneSelectionToVisible(selection.setMultiSelectedIds, visibleTaskIds);
  const bulkMoveStatusOptions = useMemo(() => getBulkMoveStatusOptions('someday'), []);
  const sectionMove = useSomedaySectionMove(t, resolvedAreaFilter, selection.exitSelectionMode);
  const moveAssignments = sectionMove.moveTargetIds?.map((id) => tasksById[id]?.viewSectionIds?.someday);
  const moveAssignmentMixed = moveAssignments?.some((assignment) => assignment !== moveAssignments[0]) ?? false;
  const moveSelectedId = moveAssignmentMixed ? undefined : moveAssignments?.[0];

  const openAddTaskForGroup = (groupId: string) => {
    const group = somedayTaskGroups?.find((candidate) => candidate.id === groupId);
    if (!group) return;
    const sectionId = groupId === 'view-section:someday:none'
      ? undefined : groupId.replace('view-section:someday:', '');
    setAddingGroup({ sectionId, title: group.title });
    setNewTaskTitle('');
    setAddTaskError(false);
    pendingAddedTaskRef.current = null;
  };

  const closeAddTask = () => {
    if (addingTask) return;
    setAddingGroup(null);
    setNewTaskTitle('');
    setAddTaskError(false);
  };

  const saveSectionTask = async () => {
    const title = newTaskTitle.trim();
    if (!addingGroup || !title || addingTask) return;
    setAddingTask(true);
    setAddTaskError(false);
    try {
      const latest = useTaskStore.getState();
      if (addingGroup.sectionId && !sortViewSectionDefinitions(latest.settings?.gtd?.viewSections?.someday)
        .some((section) => section.id === addingGroup.sectionId)) {
        setAddTaskError(true);
        return;
      }
      const pending = pendingAddedTaskRef.current;
      if (pending && pending.title === title && latest.tasks.some((task) => task.id === pending.id)) {
        await latest.retryPersistence();
      }
      if (!pending || pending.title !== title || !latest.tasks.some((task) => task.id === pending.id)) {
        const result = await latest.addTask(title, {
          status: 'someday',
          ...(addingGroup.sectionId ? { viewSectionIds: { someday: addingGroup.sectionId } } : {}),
        });
        assertBulkActionSucceeded(result);
        if (result.id) pendingAddedTaskRef.current = { id: result.id, title };
      }
      await flushPendingSave();
      if (useTaskStore.getState().persistenceFailure) throw new Error('Someday section task save incomplete');
      pendingAddedTaskRef.current = null;
      setAddingGroup(null);
      setNewTaskTitle('');
      setAddTaskError(false);
      showToast({ message: tFallback(t, 'calendar.eventTaskCreatedTitle', 'Task created'), tone: 'success' });
    } catch (error) {
      setAddTaskError(true);
      void logError(error, { scope: 'task', extra: { message: 'Failed to add Someday section task' } });
    } finally {
      setAddingTask(false);
    }
  };

  const handleStatusChange = (task: Task, status: TaskStatus) => {
    return updateTask(task.id, { status });
  };
  const handleActivateProject = (projectId: string) => {
    updateProject(projectId, { status: 'active' });
  };
  const handleOpenProject = (projectId: string) => {
    router.push({ pathname: '/projects-screen', params: { projectId } });
  };

  const handleSaveTask = (taskId: string, updates: Partial<Task>) => {
    return updateTask(taskId, updates);
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
          <Text style={styles.statValue}>{baseSomedayTasks.length}</Text>
          <Text style={styles.statLabel}>{t('someday.ideas')}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {baseSomedayTasks.filter((task) => task.projectId).length}
          </Text>
          <Text style={styles.statLabel}>{t('someday.inProjects')}</Text>
        </View>
        {selections.hasActive ? (
          <FilterChip
            label={`${tFallback(t, 'filters.title', 'Filters')} · ${selections.activeCount}`}
            selected
            themeColors={tc}
            onPress={selections.clear}
            removable
            removeLabel={`${tFallback(t, 'filters.clear', 'Clear')}: ${tFallback(t, 'filters.title', 'Filters')}`}
          />
        ) : null}
        <View style={styles.summaryOverflow}>
          <ListOverflowMenu
            actions={[
              {
                id: 'filters',
                label: tFallback(t, 'filters.title', 'Filters'),
                icon: (color) => <SlidersHorizontal size={19} color={color} strokeWidth={2} />,
                onPress: () => setFiltersVisible(true),
                selected: selections.hasActive,
                testID: 'someday-filter-action',
              },
              {
                id: 'sort',
                label: tFallback(t, 'sort.label', 'Sort'),
                accessibilityLabel: `${tFallback(t, 'sort.label', 'Sort')}: ${t(`sort.${effectiveSortBy}`)}`,
                icon: (color) => <ArrowUpDown size={19} color={color} strokeWidth={2} />,
                value: t(`sort.${effectiveSortBy}`),
                testID: 'someday-sort-action',
                submenu: {
                  title: tFallback(t, 'sort.label', 'Sort'),
                  actions: somedaySortOptions.map((option) => ({
                    id: `sort:${option}`,
                    label: t(`sort.${option}`),
                    accessibilityLabel: `${tFallback(t, 'sort.label', 'Sort')}: ${t(`sort.${option}`)}`,
                    icon: (color) => <ArrowUpDown size={18} color={color} strokeWidth={2} />,
                    onPress: () => setSortBy(option),
                    selected: effectiveSortBy === option,
                    testID: `someday-sort-${option}`,
                  })),
                },
              },
              {
                id: 'group',
                label: tFallback(t, 'list.groupBy', 'Group'),
                accessibilityLabel: `${tFallback(t, 'list.groupBy', 'Group')}: ${getSomedayGroupByLabel(groupBy, t)}`,
                icon: (color) => <Folder size={19} color={color} strokeWidth={2} />,
                value: getSomedayGroupByLabel(groupBy, t),
                testID: 'someday-group-action',
                submenu: {
                  title: tFallback(t, 'list.groupBy', 'Group'),
                  actions: SOMEDAY_GROUP_OPTIONS.map((option) => {
                    const label = getSomedayGroupByLabel(option, t);
                    return {
                      id: `group:${option}`,
                      label,
                      accessibilityLabel: `${tFallback(t, 'list.groupBy', 'Group')}: ${label}`,
                      icon: (color: string) => <Folder size={18} color={color} strokeWidth={2} />,
                      onPress: () => setGroupBy(option),
                      selected: groupBy === option,
                      testID: `someday-group-${option}`,
                    };
                  }),
                },
              },
              {
                id: 'details',
                label: showDetails
                  ? tFallback(t, 'list.hideDetails', 'Hide details')
                  : tFallback(t, 'list.showDetails', 'Show details'),
                icon: (color) => <Eye size={19} color={color} strokeWidth={2} />,
                onPress: () => setShowDetails((current) => !current),
                selected: showDetails,
                testID: 'someday-toggle-details',
              },
              {
                id: 'new-section',
                label: tFallback(t, 'viewSections.new', 'New section'),
                icon: (color) => <Plus size={19} color={color} strokeWidth={2} />,
                onPress: () => setNewSectionOpen(true),
                testID: 'someday-new-section-action',
              },
            ]}
            backLabel={tFallback(t, 'common.back', 'Back')}
            closeLabel={tFallback(t, 'common.close', 'Close')}
            moreLabel={tFallback(t, 'taskEdit.moreOptions', 'More options')}
            themeColors={tc}
            triggerTestID="someday-overflow-button"
          />
        </View>
      </View>

      <TaskListView
        tasks={somedayTasks}
        taskGroups={somedayTaskGroups}
        showDetails={showDetails}
        isDark={isDark}
        themeColors={tc}
        t={t}
        onPressTask={setEditingTask}
        onChangeTaskStatus={handleStatusChange}
        onDeleteTask={(task) => deleteTask(task.id)}
        onMoveTaskToSection={sectionMove.openForTask}
        onMoveSelectionToSection={() => sectionMove.openForSelection(selection.selectedIdsArray)}
        onAddTaskToSection={groupBy === 'viewSection' ? openAddTaskForGroup : undefined}
        highlightTaskId={highlightTaskId}
        selection={selection}
        bulkStatusOptions={bulkMoveStatusOptions}
        contentContainerStyle={taskListContentStyle}
        ListHeaderComponent={(
          <DeferredProjectsSection
            projects={deferredProjects}
            areaById={areaById}
            themeColors={tc}
            t={t}
            onActivateProject={handleActivateProject}
            onOpenProject={handleOpenProject}
          />
        )}
        ListEmptyComponent={deferredProjects.length === 0 ? (
          <View style={styles.emptyState}>
            <Lightbulb size={48} color={tc.secondaryText} strokeWidth={1.5} style={styles.emptyIcon} />
            <Text style={[styles.emptyTitle, { color: tc.text }]}>{t('someday.empty')}</Text>
            <Text style={[styles.emptyText, { color: tc.secondaryText }]}>
              {t('someday.emptyHint')}
            </Text>
          </View>
        ) : null}
      />

      <TaskFilterSheet
        visible={filtersVisible}
        onClose={() => setFiltersVisible(false)}
        selections={selections}
        options={{
          tokens: tokenFilterOptions,
          projects: projectFilterOptions,
          timeEstimates: timeEstimateFilterOptions,
          visibility: metadataFilterVisibility,
        }}
        themeColors={tc}
        t={t}
      />

      {newSectionOpen ? (
        <SomedaySectionPicker
          createOnly
          sections={somedaySections}
          onCreate={createSomedaySection}
          onSelect={() => setNewSectionOpen(false)}
          onCancelCreate={() => setNewSectionOpen(false)}
          t={t}
          themeColors={tc}
        />
      ) : null}

      <Modal
        visible={sectionMove.moveTargetIds !== null}
        transparent
        animationType="fade"
        onRequestClose={sectionMove.close}
        accessibilityViewIsModal
      >
        <Pressable style={styles.pickerOverlay} onPress={sectionMove.close}>
          <View style={[styles.pickerCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
            onStartShouldSetResponder={() => true}>
            <Text accessibilityRole="header" style={[styles.pickerTitle, { color: tc.text }]}>
              {tFallback(t, 'viewSections.moveToSection', 'Move to section…')}
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <SomedaySectionPicker
                sections={somedaySections}
                selectedId={moveSelectedId}
                selectionMixed={moveAssignmentMixed || Boolean(moveSelectedId && !somedaySections.some((section) => section.id === moveSelectedId))}
                onCreate={createSomedaySection}
                onSelect={(sectionId) => { void sectionMove.move(sectionId); }}
                t={t}
                themeColors={tc}
                optionsStyle={styles.pickerOptions}
                optionStyle={styles.pickerOption}
                optionTextStyle={styles.pickerOptionText}
              />
            </ScrollView>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('common.cancel')}
              disabled={sectionMove.saving} onPress={sectionMove.close} style={styles.pickerCancel}>
              <Text style={{ color: tc.secondaryText }}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={addingGroup !== null} transparent animationType="fade"
        onRequestClose={closeAddTask} accessibilityViewIsModal>
        <View style={styles.pickerOverlay}>
          <View style={[styles.pickerCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
            <Text accessibilityRole="header" style={[styles.pickerTitle, { color: tc.text }]}>
              {tFallback(t, 'viewSections.addTask', 'Add task to {section}')
                .replace('{section}', addingGroup?.title ?? '')}
            </Text>
            <TextInput
              accessibilityLabel={tFallback(t, 'taskEdit.titleLabel', 'Task title')}
              autoFocus
              value={newTaskTitle}
              editable={!addingTask && !pendingAddedTaskRef.current}
              onChangeText={setNewTaskTitle}
              onSubmitEditing={() => { void saveSectionTask(); }}
              placeholder={tFallback(t, 'quickAdd.inputLabel', 'Task title')}
              placeholderTextColor={tc.secondaryText}
              style={[styles.taskTitleInput, { color: tc.text, borderColor: tc.border, backgroundColor: tc.bg }]}
            />
            {addTaskError ? (
              <Text accessibilityRole="alert" style={{ color: tc.danger }}>
                {tFallback(t, 'task.addFailed', 'Failed to add task')}
              </Text>
            ) : null}
            <View style={styles.pickerActions}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('common.cancel')}
                disabled={addingTask} onPress={closeAddTask} style={styles.pickerCancel}>
                <Text style={{ color: tc.secondaryText }}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button"
                accessibilityLabel={pendingAddedTaskRef.current ? tFallback(t, 'common.retry', 'Retry') : t('common.save')}
                disabled={addingTask || !newTaskTitle.trim()} onPress={() => { void saveSectionTask(); }}
                style={[styles.pickerSave, { backgroundColor: tc.tint, opacity: addingTask || !newTaskTitle.trim() ? 0.5 : 1 }]}>
                <Text style={{ color: tc.onTint }}>
                  {pendingAddedTaskRef.current ? tFallback(t, 'common.retry', 'Retry') : t('common.save')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <TaskEditModal
        visible={editingTask !== null}
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onSave={handleSaveTask}
        defaultTab="view"
        onProjectNavigate={openProjectScreen}
        onContextNavigate={openContextsScreen}
        onTagNavigate={openContextsScreen}
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
    flexWrap: 'wrap',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    columnGap: 24,
    rowGap: 4,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  taskListContent: {
    padding: 16,
  },
  summaryOverflow: { marginLeft: 'auto' },
  pickerOverlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', flex: 1, justifyContent: 'center' },
  pickerCard: { borderRadius: 14, borderWidth: 1, gap: 12, maxHeight: '80%', padding: 16, width: '88%' },
  pickerTitle: { fontSize: 17, fontWeight: '700' },
  pickerOptions: { gap: 8 },
  pickerOption: { borderRadius: 8, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  pickerOptionText: { fontSize: 15 },
  pickerCancel: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  pickerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  pickerSave: { borderRadius: 8, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  taskTitleInput: { borderRadius: 8, borderWidth: 1, fontSize: 16, minHeight: 44, paddingHorizontal: 12 },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIcon: {
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
    lineHeight: 20,
  },
});
