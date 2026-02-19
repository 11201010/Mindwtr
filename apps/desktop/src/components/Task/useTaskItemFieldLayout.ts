import { useCallback, useMemo } from 'react';
import type { AppData, Task, TaskEditorFieldId, TaskPriority, RecurrenceRule, TimeEstimate } from '@mindwtr/core';
import { DEFAULT_TASK_EDITOR_HIDDEN, DEFAULT_TASK_EDITOR_ORDER } from './task-item-helpers';

type UseTaskItemFieldLayoutParams = {
    settings: AppData['settings'] | undefined;
    task: Task;
    editProjectId: string;
    editSectionId: string;
    editAreaId: string;
    editPriority: TaskPriority | '';
    editContexts: string;
    editDescription: string;
    editDueDate: string;
    editRecurrence: RecurrenceRule | '';
    editReviewAt: string;
    editStartTime: string;
    editTags: string;
    editTimeEstimate: TimeEstimate | '';
    prioritiesEnabled: boolean;
    timeEstimatesEnabled: boolean;
    visibleEditAttachmentsLength: number;
};

export function useTaskItemFieldLayout({
    settings,
    task,
    editProjectId,
    editSectionId,
    editAreaId,
    editPriority,
    editContexts,
    editDescription,
    editDueDate,
    editRecurrence,
    editReviewAt,
    editStartTime,
    editTags,
    editTimeEstimate,
    prioritiesEnabled,
    timeEstimatesEnabled,
    visibleEditAttachmentsLength,
}: UseTaskItemFieldLayoutParams) {
    const savedOrder = settings?.gtd?.taskEditor?.order ?? [];
    const savedHidden = settings?.gtd?.taskEditor?.hidden ?? DEFAULT_TASK_EDITOR_HIDDEN;
    const disabledFields = useMemo(() => {
        const disabled = new Set<TaskEditorFieldId>();
        if (!prioritiesEnabled) disabled.add('priority');
        if (!timeEstimatesEnabled) disabled.add('timeEstimate');
        return disabled;
    }, [prioritiesEnabled, timeEstimatesEnabled]);

    const taskEditorOrder = useMemo(() => {
        const known = new Set(DEFAULT_TASK_EDITOR_ORDER);
        const normalized = savedOrder.filter((id) => known.has(id));
        const missing = DEFAULT_TASK_EDITOR_ORDER.filter((id) => !normalized.includes(id));
        return [...normalized, ...missing].filter((id) => !disabledFields.has(id));
    }, [savedOrder, disabledFields]);
    const hiddenSet = useMemo(() => {
        const known = new Set(taskEditorOrder);
        const next = new Set(savedHidden.filter((id) => known.has(id)));
        if (settings?.features?.priorities === false) next.add('priority');
        if (settings?.features?.timeEstimates === false) next.add('timeEstimate');
        return next;
    }, [savedHidden, settings?.features?.priorities, settings?.features?.timeEstimates, taskEditorOrder]);
    const isReference = task.status === 'reference';
    const referenceHiddenFields = useMemo(() => new Set<TaskEditorFieldId>([
        'startTime',
        'dueDate',
        'reviewAt',
        'recurrence',
        'priority',
        'timeEstimate',
        'checklist',
    ]), []);

    const hasValue = useCallback((fieldId: TaskEditorFieldId) => {
        switch (fieldId) {
            case 'status':
                return task.status !== 'inbox';
            case 'project':
                return Boolean(editProjectId || task.projectId);
            case 'section':
                return Boolean(editSectionId || task.sectionId);
            case 'area':
                return Boolean(editAreaId || task.areaId);
            case 'priority':
                if (!prioritiesEnabled) return false;
                return Boolean(editPriority);
            case 'contexts':
                return Boolean(editContexts.trim());
            case 'description':
                return Boolean(editDescription.trim());
            case 'tags':
                return Boolean(editTags.trim());
            case 'timeEstimate':
                if (!timeEstimatesEnabled) return false;
                return Boolean(editTimeEstimate);
            case 'recurrence':
                return Boolean(editRecurrence);
            case 'startTime':
                return Boolean(editStartTime);
            case 'dueDate':
                return Boolean(editDueDate);
            case 'reviewAt':
                return Boolean(editReviewAt);
            case 'attachments':
                return visibleEditAttachmentsLength > 0;
            case 'checklist':
                return (task.checklist || []).length > 0;
            default:
                return false;
        }
    }, [
        editAreaId,
        editContexts,
        editDescription,
        editDueDate,
        editPriority,
        editProjectId,
        editRecurrence,
        editReviewAt,
        editSectionId,
        editStartTime,
        editTags,
        editTimeEstimate,
        prioritiesEnabled,
        task.areaId,
        task.checklist,
        task.projectId,
        task.sectionId,
        task.status,
        timeEstimatesEnabled,
        visibleEditAttachmentsLength,
    ]);

    const isFieldVisible = useCallback(
        (fieldId: TaskEditorFieldId) => {
            if (isReference && referenceHiddenFields.has(fieldId)) return false;
            return !hiddenSet.has(fieldId) || hasValue(fieldId);
        },
        [hasValue, hiddenSet, isReference, referenceHiddenFields]
    );
    const showProjectField = isFieldVisible('project');
    const showAreaField = isFieldVisible('area') && !editProjectId;
    const showSectionField = isFieldVisible('section') && !!editProjectId;
    const showDueDate = isFieldVisible('dueDate');
    const orderFields = useCallback(
        (fields: TaskEditorFieldId[]) => {
            const ordered = taskEditorOrder.filter((id) => fields.includes(id));
            const missing = fields.filter((id) => !ordered.includes(id));
            return [...ordered, ...missing];
        },
        [taskEditorOrder]
    );
    const filterVisibleFields = useCallback(
        (fields: TaskEditorFieldId[]) => fields.filter((fieldId) => !hiddenSet.has(fieldId) || hasValue(fieldId)),
        [hiddenSet, hasValue]
    );
    const alwaysFields = useMemo(
        () => orderFields(['status']).filter(isFieldVisible),
        [orderFields, isFieldVisible]
    );
    const schedulingFields = useMemo(
        () => filterVisibleFields(orderFields(['startTime', 'recurrence', 'reviewAt'])),
        [filterVisibleFields, orderFields]
    );
    const organizationFields = useMemo(
        () => filterVisibleFields(orderFields(['contexts', 'tags', 'priority', 'timeEstimate'])),
        [filterVisibleFields, orderFields]
    );
    const detailsFields = useMemo(
        () => filterVisibleFields(orderFields(['description', 'attachments', 'checklist'])),
        [filterVisibleFields, orderFields]
    );
    const sectionCounts = useMemo(
        () => ({
            scheduling: schedulingFields.filter((fieldId) => hasValue(fieldId)).length,
            organization: organizationFields.filter((fieldId) => hasValue(fieldId)).length,
            details: detailsFields.filter((fieldId) => hasValue(fieldId)).length,
        }),
        [detailsFields, hasValue, organizationFields, schedulingFields]
    );

    return {
        showProjectField,
        showAreaField,
        showSectionField,
        showDueDate,
        alwaysFields,
        schedulingFields,
        organizationFields,
        detailsFields,
        sectionCounts,
    };
}
