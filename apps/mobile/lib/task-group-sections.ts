/**
 * Task-attribute grouping lives in core (packages/core/src/task-group-sections.ts),
 * shared with the native host. This module keeps the mobile import path.
 */
export {
  buildTaskGroupSections,
  getTaskGroupByLabel,
  type BuildTaskGroupSectionsParams,
  type TaskGroupBy,
  type TaskGroupItem,
  type TaskGroupSectionItem,
  type TaskGroupTaskItem,
} from '@mindwtr/core';
