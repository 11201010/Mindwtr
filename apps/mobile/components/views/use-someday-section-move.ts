import { useCallback, useRef, useState } from 'react';
import {
  buildTaskViewSectionUndoUpdates,
  buildTaskViewSectionUpdates,
  flushPendingSave,
  isTaskVisibleInArea,
  sortViewSectionDefinitions,
  tFallback,
  useTaskStore,
  type AreaFilterSelection,
  type Task,
} from '@mindwtr/core';

import { useToast } from '@/contexts/toast-context';
import { logInfo } from '@/lib/app-log';
import { assertBulkActionSucceeded } from '../use-task-list-selection';

type PreviousAssignment = { id: string; sectionId?: string };
type PendingMove = {
  ids: string[];
  destination?: string;
  previous: PreviousAssignment[];
};
type PendingUndo = {
  previous: readonly PreviousAssignment[];
  destination?: string;
  count: number;
};

const sameIds = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

/** Someday's list scope, recomputed from the store at the moment of a write. */
function getLatestEligibleTasks(ids: readonly string[], filter: AreaFilterSelection): Task[] | null {
  const state = useTaskStore.getState();
  const taskById = new Map(state.tasks.map((task) => [task.id, task]));
  const visibility = {
    areaById: new Map((state.areas ?? []).filter((area) => !area.deletedAt).map((area) => [area.id, area])),
    projectById: new Map(state.projects.map((project) => [project.id, project])),
    resolvedAreaFilter: filter,
  };
  const tasks = ids.map((id) => taskById.get(id));
  if (tasks.some((task) => !task || task.status !== 'someday' || !isTaskVisibleInArea(task, visibility))) {
    return null;
  }
  return tasks as Task[];
}

export function useSomedaySectionMove(
  t: (key: string) => string,
  resolvedAreaFilter: AreaFilterSelection,
  exitSelectionMode: () => void,
) {
  const { showToast } = useToast();
  const [moveTargetIds, setMoveTargetIds] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const pendingMoveRef = useRef<PendingMove | null>(null);
  const pendingUndoRef = useRef<PendingUndo | null>(null);
  const undoBusyRef = useRef(false);

  const showMoveFailure = useCallback(() => showToast({
    title: tFallback(t, 'common.error', 'Error'),
    message: tFallback(t, 'viewSections.moveFailed', 'Could not move tasks to the section.'),
    tone: 'error',
    durationMs: 5200,
  }), [showToast, t]);

  const undo = useCallback(async (previous: readonly PreviousAssignment[], destination?: string) => {
    if (undoBusyRef.current) return;
    undoBusyRef.current = true;
    try {
      const latest = useTaskStore.getState();
      const latestTasks = previous.map(({ id }) => latest.tasks.find((task) => task.id === id)).filter((task): task is Task => Boolean(task));
      const updates = buildTaskViewSectionUndoUpdates(latestTasks, 'someday', previous, destination);
      const pending = pendingUndoRef.current?.previous === previous
        && pendingUndoRef.current.destination === destination ? pendingUndoRef.current : null;
      if (updates.length === 0 && !pending) return;
      if (updates.length > 0) {
        assertBulkActionSucceeded(await latest.batchUpdateTasks(updates));
        pendingUndoRef.current = { previous, destination, count: updates.length };
      }
      if (pending && updates.length === 0) {
        await useTaskStore.getState().retryPersistence();
      }
      await flushPendingSave();
      if (useTaskStore.getState().persistenceFailure) throw new Error('Someday section Undo save incomplete');
      const count = pendingUndoRef.current?.count ?? updates.length;
      pendingUndoRef.current = null;
      void logInfo('Someday section assignment saved', {
        scope: 'tasks',
        extra: { releaseCheck: 'v1.3.1/someday-section-move', count, operation: 'undo' },
      });
    } catch {
      showToast({
        title: tFallback(t, 'common.error', 'Error'),
        message: tFallback(t, 'viewSections.undoFailed', 'Could not undo the section move.'),
        tone: 'error',
        durationMs: 5200,
        actionLabel: tFallback(t, 'common.undo', 'Undo'),
        onAction: () => { void undo(previous, destination); },
      });
    } finally {
      undoBusyRef.current = false;
    }
  }, [showToast, t]);

  const openForTask = useCallback((task: Task) => setMoveTargetIds([task.id]), []);
  const openForSelection = useCallback((ids: readonly string[]) => {
    if (ids.length > 0) setMoveTargetIds(Array.from(new Set(ids)));
  }, []);
  const close = useCallback(() => {
    if (!saving) setMoveTargetIds(null);
  }, [saving]);

  const move = useCallback(async (destination?: string) => {
    if (!moveTargetIds?.length || saving) return;
    setSaving(true);
    try {
      const latest = useTaskStore.getState();
      const sortedSections = sortViewSectionDefinitions(latest.settings?.gtd?.viewSections?.someday);
      const section = destination ? sortedSections.find((definition) => definition.id === destination) : undefined;
      if (destination && !section) {
        showMoveFailure();
        return;
      }
      const eligibleTasks = getLatestEligibleTasks(moveTargetIds, resolvedAreaFilter);
      if (!eligibleTasks) {
        showMoveFailure();
        return;
      }
      const updates = buildTaskViewSectionUpdates(eligibleTasks, 'someday', destination);
      const pending = pendingMoveRef.current;
      const resume = pending && sameIds(pending.ids, moveTargetIds)
        && eligibleTasks.every((task) => (task.viewSectionIds?.someday || undefined) === pending.destination)
        ? pending : null;
      const previousById = new Map((resume?.previous ?? []).map((entry) => [entry.id, entry]));
      for (const update of updates) {
        if (previousById.has(update.id)) continue;
        const task = eligibleTasks.find((candidate) => candidate.id === update.id);
        previousById.set(update.id, { id: update.id, sectionId: task?.viewSectionIds?.someday });
      }
      const previous = [...previousById.values()];
      if (previous.length === 0) {
        setMoveTargetIds(null);
        exitSelectionMode();
        return;
      }
      if (updates.length > 0) {
        assertBulkActionSucceeded(await latest.batchUpdateTasks(updates));
      }
      pendingMoveRef.current = { ids: moveTargetIds, destination, previous };
      if (resume && updates.length === 0) {
        await useTaskStore.getState().retryPersistence();
      }
      await flushPendingSave();
      if (useTaskStore.getState().persistenceFailure) throw new Error('Someday section move save incomplete');
      pendingMoveRef.current = null;
      setMoveTargetIds(null);
      exitSelectionMode();
      void logInfo('Someday section assignment saved', {
        scope: 'tasks',
        extra: { releaseCheck: 'v1.3.1/someday-section-move', count: previous.length, operation: 'move' },
      });
      const sectionTitle = section?.title ?? tFallback(t, 'viewSections.noSection', 'No section');
      showToast({
        message: tFallback(t, 'viewSections.moved', 'Moved to {section} ({count})')
          .replace('{count}', String(previous.length)).replace('{section}', sectionTitle),
        tone: 'success',
        durationMs: 5200,
        actionLabel: tFallback(t, 'common.undo', 'Undo'),
        onAction: () => { void undo(previous, destination); },
      });
    } catch {
      showMoveFailure();
    } finally {
      setSaving(false);
    }
  }, [exitSelectionMode, moveTargetIds, resolvedAreaFilter, saving, showMoveFailure, showToast, t, undo]);

  return { moveTargetIds, saving, openForTask, openForSelection, close, move };
}
