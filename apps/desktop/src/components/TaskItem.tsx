import { useState, memo, useEffect, useRef, useCallback, type ReactNode } from 'react';
import {
    DEFAULT_PROJECT_COLOR,
    Task,
    TaskEditorFieldId,
    type Recurrence,
    parseRRuleString,
    Project,
    generateUUID,
    parseQuickAdd,
    extractChecklistFromMarkdown,
} from '@mindwtr/core';
import { cn } from '../lib/utils';
import { PromptModal } from './PromptModal';
import { ConfirmModal } from './ConfirmModal';
import { useLanguage } from '../contexts/language-context';
import { TaskItemEditor } from './Task/TaskItemEditor';
import { TaskItemDisplay } from './Task/TaskItemDisplay';
import { TaskItemFieldRenderer } from './Task/TaskItemFieldRenderer';
import { TaskItemRecurrenceModal } from './Task/TaskItemRecurrenceModal';
import { AttachmentModals } from './Task/AttachmentModals';
import { WEEKDAY_FULL_LABELS, WEEKDAY_ORDER } from './Task/recurrence-constants';
import {
    getRecurrenceRuleValue,
    getRecurrenceRRuleValue,
    getRecurrenceStrategyValue,
    toDateTimeLocalValue,
} from './Task/task-item-helpers';
import { useTaskItemAttachments } from './Task/useTaskItemAttachments';
import { useTaskItemRecurrence } from './Task/useTaskItemRecurrence';
import { useTaskItemAi } from './Task/useTaskItemAi';
import { useTaskItemEditState } from './Task/useTaskItemEditState';
import { useTaskItemProjectContext } from './Task/useTaskItemProjectContext';
import { useTaskItemFieldLayout } from './Task/useTaskItemFieldLayout';
import { reportError } from '../lib/report-error';
import { mergeMarkdownChecklist } from './Task/task-item-checklist';
import { useTaskItemStoreState, useTaskItemUiState } from './Task/useTaskItemStoreState';

interface TaskItemProps {
    task: Task;
    project?: Project;
    isSelected?: boolean;
    onSelect?: () => void;
    selectionMode?: boolean;
    isMultiSelected?: boolean;
    onToggleSelect?: () => void;
    showQuickDone?: boolean;
    showStatusSelect?: boolean;
    showProjectBadgeInActions?: boolean;
    actionsOverlay?: boolean;
    dragHandle?: ReactNode;
    focusToggle?: {
        isFocused: boolean;
        canToggle: boolean;
        onToggle: () => void;
        title: string;
        ariaLabel: string;
    };
    readOnly?: boolean;
    compactMetaEnabled?: boolean;
    enableDoubleClickEdit?: boolean;
    showHoverHint?: boolean;
    editorPresentation?: 'inline' | 'modal';
}

export const TaskItem = memo(function TaskItem({
    task,
    project: propProject,
    isSelected,
    onSelect,
    selectionMode = false,
    isMultiSelected = false,
    onToggleSelect,
    showQuickDone = true,
    showStatusSelect = true,
    showProjectBadgeInActions = true,
    actionsOverlay = false,
    dragHandle,
    focusToggle,
    readOnly = false,
    compactMetaEnabled = true,
    enableDoubleClickEdit = false,
    showHoverHint = true,
    editorPresentation = 'inline',
}: TaskItemProps) {
    const {
        updateTask,
        deleteTask,
        moveTask,
        projects,
        sections,
        areas,
        settings,
        duplicateTask,
        resetTaskChecklist,
        restoreTask,
        highlightTaskId,
        setHighlightTask,
        addProject,
        addArea,
        addSection,
        lockEditing,
        unlockEditing,
    } = useTaskItemStoreState();
    const { setProjectView, editingTaskId, setEditingTaskId, showToast } = useTaskItemUiState();
    const setSelectedProjectId = useCallback(
        (value: string | null) => setProjectView({ selectedProjectId: value }),
        [setProjectView]
    );
    const { t, language } = useLanguage();
    const [isEditing, setIsEditing] = useState(false);
    const [autoFocusTitle, setAutoFocusTitle] = useState(false);
    const {
        editAttachments,
        attachmentError,
        showLinkPrompt,
        setShowLinkPrompt,
        addFileAttachment,
        addLinkAttachment,
        handleAddLinkAttachment,
        removeAttachment,
        openAttachment,
        resetAttachmentState,
        audioAttachment,
        audioSource,
        audioError,
        audioRef,
        openAudioExternally,
        handleAudioError,
        closeAudio,
        imageAttachment,
        imageSource,
        closeImage,
        textAttachment,
        textContent,
        textError,
        textLoading,
        openTextExternally,
        openImageExternally,
        closeText,
    } = useTaskItemAttachments({ task, t });
    const {
        editTitle,
        setEditTitle,
        editDueDate,
        setEditDueDate,
        editStartTime,
        setEditStartTime,
        editProjectId,
        setEditProjectId,
        editSectionId,
        setEditSectionId,
        editAreaId,
        setEditAreaId,
        editStatus,
        setEditStatus,
        editContexts,
        setEditContexts,
        editTags,
        setEditTags,
        editDescription,
        setEditDescription,
        editLocation,
        setEditLocation,
        editRecurrence,
        setEditRecurrence,
        editRecurrenceStrategy,
        setEditRecurrenceStrategy,
        editRecurrenceRRule,
        setEditRecurrenceRRule,
        editTimeEstimate,
        setEditTimeEstimate,
        editPriority,
        setEditPriority,
        editReviewAt,
        setEditReviewAt,
        showDescriptionPreview,
        setShowDescriptionPreview,
        resetEditState: resetLocalEditState,
    } = useTaskItemEditState({
        task,
        resetAttachmentState,
    });
    const [isViewOpen, setIsViewOpen] = useState(false);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const prioritiesEnabled = settings?.features?.priorities === true;
    const timeEstimatesEnabled = settings?.features?.timeEstimates === true;
    const isCompact = settings?.appearance?.density === 'compact';
    const isHighlighted = highlightTaskId === task.id;
    const recurrenceRule = getRecurrenceRuleValue(task.recurrence);
    const recurrenceStrategy = getRecurrenceStrategyValue(task.recurrence);
    const isStagnant = (task.pushCount ?? 0) > 3;
    const effectiveReadOnly = readOnly || task.status === 'done';
    const handleToggleChecklistItem = useCallback((index: number) => {
        if (effectiveReadOnly) return;
        const checklist = task.checklist || [];
        if (!checklist[index]) return;
        const nextChecklist = checklist.map((item, i) =>
            i === index ? { ...item, isCompleted: !item.isCompleted } : item
        );
        void updateTask(task.id, { checklist: nextChecklist });
    }, [effectiveReadOnly, task, updateTask]);
    const {
        monthlyRecurrence,
        showCustomRecurrence,
        setShowCustomRecurrence,
        customInterval,
        setCustomInterval,
        customMode,
        setCustomMode,
        customOrdinal,
        setCustomOrdinal,
        customWeekday,
        setCustomWeekday,
        customMonthDay,
        setCustomMonthDay,
        openCustomRecurrence,
        applyCustomRecurrence,
    } = useTaskItemRecurrence({
        task,
        editDueDate,
        editRecurrence,
        editRecurrenceRRule,
        setEditRecurrence,
        setEditRecurrenceRRule,
    });

    useEffect(() => {
        if (!isHighlighted) return;
        const timer = setTimeout(() => {
            setHighlightTask(null);
        }, 3500);
        return () => clearTimeout(timer);
    }, [isHighlighted, setHighlightTask]);

    const {
        projectById,
        sectionsByProject,
        areaById,
        projectContext,
        tagOptions,
        popularTagOptions,
        allContexts,
    } = useTaskItemProjectContext({
        task,
        propProject,
        projects,
        sections,
        areas,
        isEditing,
        editProjectId,
        setEditAreaId,
    });

    useEffect(() => {
        const projectId = editProjectId || task.projectId || '';
        if (!projectId) {
            if (editSectionId) setEditSectionId('');
            return;
        }
        const projectSections = sectionsByProject.get(projectId) ?? [];
        if (editSectionId && !projectSections.some((section) => section.id === editSectionId)) {
            setEditSectionId('');
        }
    }, [editProjectId, editSectionId, sectionsByProject, setEditSectionId, task.projectId]);

    const {
        aiEnabled,
        isAIWorking,
        aiClarifyResponse,
        aiError,
        aiBreakdownSteps,
        copilotSuggestion,
        copilotApplied,
        copilotContext,
        copilotEstimate,
        resetCopilotDraft,
        resetAiState,
        clearAiBreakdown,
        clearAiClarify,
        applyCopilotSuggestion,
        applyAISuggestion,
        handleAIClarify,
        handleAIBreakdown,
    } = useTaskItemAi({
        taskId: task.id,
        settings,
        t,
        editTitle,
        editDescription,
        editContexts,
        editTags,
        tagOptions,
        projectContext,
        timeEstimatesEnabled,
        setEditTitle,
        setEditContexts,
        setEditTags,
        setEditTimeEstimate,
    });

    const resetEditState = useCallback(() => {
        resetLocalEditState();
        setShowCustomRecurrence(false);
        resetAiState();
    }, [resetLocalEditState, resetAiState, setShowCustomRecurrence]);
    const startEditing = useCallback(() => {
        if (effectiveReadOnly || isEditing) return;
        resetEditState();
        setIsViewOpen(false);
        setAutoFocusTitle(true);
        setIsEditing(true);
        setEditingTaskId(task.id);
    }, [effectiveReadOnly, isEditing, resetEditState, setEditingTaskId, task.id]);

    const handleCreateProject = useCallback(async (title: string) => {
        const trimmed = title.trim();
        if (!trimmed) return null;
        const existing = projects.find((project) => project.title.toLowerCase() === trimmed.toLowerCase());
        if (existing) return existing.id;
        const created = await addProject(trimmed, DEFAULT_PROJECT_COLOR);
        return created?.id ?? null;
    }, [addProject, projects]);
    const handleCreateArea = useCallback(async (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return null;
        const existing = areas.find((area) => area.name.toLowerCase() === trimmed.toLowerCase());
        if (existing) return existing.id;
        const created = await addArea(trimmed, { color: DEFAULT_PROJECT_COLOR });
        return created?.id ?? null;
    }, [addArea, areas]);
    const handleCreateSection = useCallback(async (title: string) => {
        const trimmed = title.trim();
        if (!trimmed) return null;
        const projectId = editProjectId || task.projectId;
        if (!projectId) return null;
        const existing = (sectionsByProject.get(projectId) ?? [])
            .find((section) => section.title.toLowerCase() === trimmed.toLowerCase());
        if (existing) return existing.id;
        const created = await addSection(projectId, trimmed);
        return created?.id ?? null;
    }, [addSection, editProjectId, sectionsByProject, task.projectId]);
    const visibleAttachments = (task.attachments || []).filter((a) => !a.deletedAt);
    const visibleEditAttachments = editAttachments.filter((a) => !a.deletedAt);
    const wasEditingRef = useRef(false);

    const {
        showProjectField,
        showAreaField,
        showSectionField,
        showDueDate,
        alwaysFields,
        schedulingFields,
        organizationFields,
        detailsFields,
        sectionCounts,
    } = useTaskItemFieldLayout({
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
        visibleEditAttachmentsLength: visibleEditAttachments.length,
    });
    const activeProjectId = editProjectId || task.projectId || '';
    const projectSections = activeProjectId ? (sectionsByProject.get(activeProjectId) ?? []) : [];

    const renderField = (fieldId: TaskEditorFieldId) => (
        <TaskItemFieldRenderer
            fieldId={fieldId}
            data={{
                t,
                task,
                taskId: task.id,
                showDescriptionPreview,
                editDescription,
                attachmentError,
                visibleEditAttachments,
                editStartTime,
                editReviewAt,
                editStatus,
                editPriority,
                editRecurrence,
                editRecurrenceStrategy,
                editRecurrenceRRule,
                monthlyRecurrence,
                editTimeEstimate,
                editContexts,
                editTags,
                language,
                popularTagOptions,
            }}
            handlers={{
                toggleDescriptionPreview: () => setShowDescriptionPreview((prev) => !prev),
                setEditDescription: (value) => {
                    setEditDescription(value);
                    resetCopilotDraft();
                },
                addFileAttachment,
                addLinkAttachment,
                openAttachment,
                removeAttachment,
                setEditStartTime,
                setEditReviewAt,
                setEditStatus,
                setEditPriority,
                setEditRecurrence,
                setEditRecurrenceStrategy,
                setEditRecurrenceRRule,
                openCustomRecurrence,
                setEditTimeEstimate,
                setEditContexts,
                setEditTags,
                updateTask,
                resetTaskChecklist,
            }}
        />
    );

    useEffect(() => {
        if (effectiveReadOnly && isEditing) {
            setIsEditing(false);
            if (editingTaskId === task.id) {
                setEditingTaskId(null);
            }
            return;
        }
        if (!isEditing) {
            wasEditingRef.current = false;
            return;
        }
        wasEditingRef.current = true;
    }, [effectiveReadOnly, isEditing, editingTaskId, setEditingTaskId, task.id]);

    useEffect(() => {
        if (!isEditing) return;
        if (editingTaskId !== task.id) {
            setIsEditing(false);
        }
    }, [editingTaskId, isEditing, task.id]);

    useEffect(() => {
        if (isEditing) return;
        if (editingTaskId === task.id && !effectiveReadOnly) {
            setIsViewOpen(false);
            setIsEditing(true);
        }
    }, [editingTaskId, effectiveReadOnly, isEditing, task.id]);

    useEffect(() => {
        if (!isEditing) return;
        if (!autoFocusTitle) return;
        const raf = requestAnimationFrame(() => setAutoFocusTitle(false));
        return () => cancelAnimationFrame(raf);
    }, [autoFocusTitle, isEditing]);

    useEffect(() => {
        if (isEditing) {
            setIsViewOpen(false);
        }
    }, [isEditing]);

    useEffect(() => {
        if (!isEditing) return;
        lockEditing();
        return () => {
            unlockEditing();
        };
    }, [isEditing, lockEditing, unlockEditing]);


    const handleDiscardChanges = useCallback(() => {
        resetEditState();
        setIsEditing(false);
        if (editingTaskId === task.id) {
            setEditingTaskId(null);
        }
    }, [editingTaskId, resetEditState, setEditingTaskId, task.id]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const { title: parsedTitle, props: parsedProps, projectTitle } = parseQuickAdd(editTitle, projects, new Date(), areas);
        const cleanedTitle = parsedTitle.trim() ? parsedTitle : task.title;
        if (!cleanedTitle.trim()) return;

        const hasProjectCommand = Boolean(parsedProps.projectId || projectTitle);
        let resolvedProjectId = parsedProps.projectId || undefined;
        if (!resolvedProjectId && projectTitle) {
            try {
                const created = await addProject(projectTitle, DEFAULT_PROJECT_COLOR);
                resolvedProjectId = created?.id;
                if (!resolvedProjectId) {
                    const projectCreateFailed = t('projects.createFailed');
                    showToast(
                        projectCreateFailed === 'projects.createFailed'
                            ? 'Failed to create project from quick add.'
                            : projectCreateFailed,
                        'error'
                    );
                }
            } catch (error) {
                reportError('Failed to create project from quick add', error);
                const projectCreateFailed = t('projects.createFailed');
                showToast(
                    projectCreateFailed === 'projects.createFailed'
                        ? 'Failed to create project from quick add.'
                        : projectCreateFailed,
                    'error'
                );
            }
        }
        if (!resolvedProjectId) {
            resolvedProjectId = editProjectId || undefined;
        }
        const recurrenceValue: Recurrence | undefined = editRecurrence
            ? { rule: editRecurrence, strategy: editRecurrenceStrategy }
            : undefined;
        if (recurrenceValue && editRecurrenceRRule) {
            const parsed = parseRRuleString(editRecurrenceRRule);
            if (parsed.byDay && parsed.byDay.length > 0) {
                recurrenceValue.byDay = parsed.byDay;
            }
            recurrenceValue.rrule = editRecurrenceRRule;
        }
        const currentContexts = editContexts.split(',').map(c => c.trim()).filter(Boolean);
        const mergedContexts = Array.from(new Set([...currentContexts, ...(parsedProps.contexts || [])]));
        const currentTags = editTags.split(',').map(c => c.trim()).filter(Boolean);
        const mergedTags = Array.from(new Set([...currentTags, ...(parsedProps.tags || [])]));
        const resolvedDescription = parsedProps.description
            ? (editDescription ? `${editDescription}\n${parsedProps.description}` : parsedProps.description)
            : (editDescription || undefined);
        const markdownChecklist = extractChecklistFromMarkdown(String(resolvedDescription ?? ''));
        const resolvedChecklist = markdownChecklist.length > 0
            ? mergeMarkdownChecklist(markdownChecklist, task.checklist)
            : undefined;
        const projectChangedByCommand = hasProjectCommand && resolvedProjectId !== (editProjectId || undefined);
        const resolvedSectionId = projectChangedByCommand
            ? undefined
            : (resolvedProjectId ? (editSectionId || undefined) : undefined);
        const resolvedAreaId = projectChangedByCommand
            ? undefined
            : (resolvedProjectId ? undefined : (editAreaId || undefined));
        await updateTask(task.id, {
            title: cleanedTitle,
            status: parsedProps.status || editStatus,
            dueDate: parsedProps.dueDate || editDueDate || undefined,
            startTime: editStartTime || undefined,
            projectId: resolvedProjectId,
            sectionId: resolvedSectionId,
            areaId: resolvedAreaId,
            contexts: mergedContexts,
            tags: mergedTags,
            description: resolvedDescription,
            ...(resolvedChecklist ? { checklist: resolvedChecklist } : {}),
            location: editLocation || undefined,
            recurrence: recurrenceValue,
            timeEstimate: editTimeEstimate || undefined,
            priority: editPriority || undefined,
            reviewAt: editReviewAt || undefined,
            attachments: editAttachments.length > 0 ? editAttachments : undefined,
        });
        setIsEditing(false);
        if (editingTaskId === task.id) {
            setEditingTaskId(null);
        }
    };

    const project = propProject || (task.projectId ? projectById.get(task.projectId) : undefined);
    const taskArea = task.projectId
        ? (project?.areaId ? areaById.get(project.areaId) : undefined)
        : (task.areaId ? areaById.get(task.areaId) : undefined);
    const projectColor = project?.areaId ? areaById.get(project.areaId)?.color : undefined;
    const handleOpenProject = useCallback((projectId: string) => {
        setHighlightTask(task.id);
        setSelectedProjectId(projectId);
        window.dispatchEvent(new CustomEvent('mindwtr:navigate', { detail: { view: 'projects' } }));
    }, [setHighlightTask, setSelectedProjectId, task.id]);
    const hasPendingEdits = useCallback(() => {
        if (editTitle !== task.title) return true;
        if (editDescription !== (task.description || '')) return true;
        if (editProjectId !== (task.projectId || '')) return true;
        if (editSectionId !== (task.sectionId || '')) return true;
        if (editAreaId !== (task.areaId || '')) return true;
        if (editStatus !== task.status) return true;
        if (editContexts.trim() !== (task.contexts?.join(', ') || '').trim()) return true;
        if (editTags.trim() !== (task.tags?.join(', ') || '').trim()) return true;
        if (editLocation !== (task.location || '')) return true;
        if (editRecurrence !== getRecurrenceRuleValue(task.recurrence)) return true;
        if (editRecurrenceStrategy !== getRecurrenceStrategyValue(task.recurrence)) return true;
        if (editRecurrenceRRule !== getRecurrenceRRuleValue(task.recurrence)) return true;
        if (editTimeEstimate !== (task.timeEstimate || '')) return true;
        if (editPriority !== (task.priority || '')) return true;
        if (editDueDate !== toDateTimeLocalValue(task.dueDate)) return true;
        if (editStartTime !== toDateTimeLocalValue(task.startTime)) return true;
        if (editReviewAt !== toDateTimeLocalValue(task.reviewAt)) return true;
        return false;
    }, [
        editTitle,
        editDescription,
        editProjectId,
        editSectionId,
        editAreaId,
        editStatus,
        editContexts,
        editTags,
        editLocation,
        editRecurrence,
        editRecurrenceStrategy,
        editRecurrenceRRule,
        editTimeEstimate,
        editPriority,
        editDueDate,
        editStartTime,
        editReviewAt,
        task,
    ]);
    const isModalEditor = editorPresentation === 'modal';
    const handleEditorCancel = useCallback(() => {
        if (hasPendingEdits()) {
            setShowDiscardConfirm(true);
            return;
        }
        handleDiscardChanges();
    }, [handleDiscardChanges, hasPendingEdits]);
    const renderEditor = () => (
        <TaskItemEditor
            t={t}
            editTitle={editTitle}
            setEditTitle={setEditTitle}
            autoFocusTitle={autoFocusTitle}
            resetCopilotDraft={resetCopilotDraft}
            aiEnabled={aiEnabled}
            isAIWorking={isAIWorking}
            handleAIClarify={handleAIClarify}
            handleAIBreakdown={handleAIBreakdown}
            copilotSuggestion={copilotSuggestion}
            copilotApplied={copilotApplied}
            applyCopilotSuggestion={applyCopilotSuggestion}
            copilotContext={copilotContext}
            copilotEstimate={copilotEstimate}
            copilotTags={copilotSuggestion?.tags ?? []}
            timeEstimatesEnabled={timeEstimatesEnabled}
            aiError={aiError}
            aiBreakdownSteps={aiBreakdownSteps}
            onAddBreakdownSteps={() => {
                if (!aiBreakdownSteps?.length) return;
                const newItems = aiBreakdownSteps.map((step) => ({
                    id: generateUUID(),
                    title: step,
                    isCompleted: false,
                }));
                updateTask(task.id, { checklist: [...(task.checklist || []), ...newItems] });
                clearAiBreakdown();
            }}
            onDismissBreakdown={clearAiBreakdown}
            aiClarifyResponse={aiClarifyResponse}
            onSelectClarifyOption={(action) => {
                setEditTitle(action);
                clearAiClarify();
            }}
            onApplyAISuggestion={() => {
                if (aiClarifyResponse?.suggestedAction) {
                    applyAISuggestion(aiClarifyResponse.suggestedAction);
                }
            }}
            onDismissClarify={clearAiClarify}
            projects={projects}
            areas={areas}
            editProjectId={editProjectId}
            setEditProjectId={setEditProjectId}
            sections={projectSections}
            editSectionId={editSectionId}
            setEditSectionId={setEditSectionId}
            editAreaId={editAreaId}
            setEditAreaId={setEditAreaId}
            onCreateProject={handleCreateProject}
            onCreateArea={handleCreateArea}
            onCreateSection={handleCreateSection}
            showProjectField={showProjectField}
            showAreaField={showAreaField}
            showSectionField={showSectionField}
            showDueDate={showDueDate}
            editDueDate={editDueDate}
            setEditDueDate={setEditDueDate}
            alwaysFields={alwaysFields}
            schedulingFields={schedulingFields}
            organizationFields={organizationFields}
            detailsFields={detailsFields}
            sectionCounts={sectionCounts}
            renderField={renderField}
            editLocation={editLocation}
            setEditLocation={setEditLocation}
            language={language}
            inputContexts={allContexts}
            onDuplicateTask={() => duplicateTask(task.id, false)}
            onCancel={handleEditorCancel}
            onSubmit={handleSubmit}
        />
    );

    const selectAriaLabel = (() => {
        const label = t('task.select');
        return label === 'task.select' ? 'Select task' : label;
    })();
    const resolveText = useCallback((key: string, fallback: string) => {
        const value = t(key);
        return value === key ? fallback : value;
    }, [t]);

    return (
        <>
            <div
                data-task-id={task.id}
                onClickCapture={onSelect ? () => onSelect?.() : undefined}
                onDoubleClick={(event) => {
                    if (!enableDoubleClickEdit || selectionMode || effectiveReadOnly || isEditing) return;
                    event.stopPropagation();
                    startEditing();
                }}
                className={cn(
                    "group rounded-lg hover:bg-muted/50 dark:hover:bg-muted/20 transition-colors animate-in fade-in slide-in-from-bottom-2",
                    isCompact ? "p-2.5" : "px-3 py-3",
                    isSelected && "ring-2 ring-inset ring-primary/40 bg-primary/5",
                    isHighlighted && "ring-2 ring-inset ring-primary/70 bg-primary/5"
                )}
            >
                <div className={cn("flex items-start", isCompact ? "gap-2" : "gap-3")}>
                    {selectionMode && (
                        <input
                            type="checkbox"
                            aria-label={selectAriaLabel}
                            checked={isMultiSelected}
                            onChange={() => onToggleSelect?.()}
                            className={cn(
                                "h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer",
                                isCompact ? "mt-1" : "mt-1.5"
                            )}
                        />
                    )}

                    {isEditing && !isModalEditor ? (
                        <div className="flex-1 min-w-0">
                            {renderEditor()}
                        </div>
                    ) : (
                        <TaskItemDisplay
                            task={task}
                            project={project}
                            area={taskArea}
                            projectColor={projectColor}
                            selectionMode={selectionMode}
                            isViewOpen={isViewOpen}
                            actions={{
                                onToggleSelect,
                                onToggleView: () => setIsViewOpen((prev) => !prev),
                                onEdit: startEditing,
                                onDelete: () => setShowDeleteConfirm(true),
                                onDuplicate: () => duplicateTask(task.id, false),
                                onStatusChange: (status) => moveTask(task.id, status),
                                onOpenProject: project ? handleOpenProject : undefined,
                                openAttachment,
                                onToggleChecklistItem: handleToggleChecklistItem,
                                focusToggle,
                            }}
                            visibleAttachments={visibleAttachments}
                            recurrenceRule={recurrenceRule}
                            recurrenceStrategy={recurrenceStrategy}
                            prioritiesEnabled={prioritiesEnabled}
                            timeEstimatesEnabled={timeEstimatesEnabled}
                            isStagnant={isStagnant}
                            showQuickDone={showQuickDone}
                            showStatusSelect={showStatusSelect}
                            showProjectBadgeInActions={showProjectBadgeInActions}
                            readOnly={effectiveReadOnly}
                            compactMetaEnabled={compactMetaEnabled}
                            dense={isCompact}
                            actionsOverlay={actionsOverlay}
                            dragHandle={dragHandle}
                            showHoverHint={showHoverHint}
                            t={t}
                        />
                    )}
                </div>
            </div>
            {isEditing && isModalEditor && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label={t('taskEdit.editTask') || 'Edit task'}
                    onMouseDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        handleEditorCancel();
                    }}
                >
                    <div
                        className="w-[min(1100px,92vw)] max-h-[90vh] rounded-xl border border-border bg-card p-4 shadow-2xl"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                    >
                        {renderEditor()}
                    </div>
                </div>
            )}
            {showCustomRecurrence && (
                <TaskItemRecurrenceModal
                    t={t}
                    weekdayOrder={WEEKDAY_ORDER}
                    weekdayLabels={WEEKDAY_FULL_LABELS}
                    customInterval={customInterval}
                    customMode={customMode}
                    customOrdinal={customOrdinal}
                    customWeekday={customWeekday}
                    customMonthDay={customMonthDay}
                    onIntervalChange={(value) => setCustomInterval(value)}
                    onModeChange={(value) => setCustomMode(value)}
                    onOrdinalChange={(value) => setCustomOrdinal(value)}
                    onWeekdayChange={(value) => setCustomWeekday(value)}
                    onMonthDayChange={(value) => {
                        const safe = Number.isFinite(value) ? Math.min(Math.max(value, 1), 31) : 1;
                        setCustomMonthDay(safe);
                    }}
                    onClose={() => setShowCustomRecurrence(false)}
                    onApply={applyCustomRecurrence}
                />
            )}
            {showLinkPrompt && (
                <PromptModal
                    isOpen={showLinkPrompt}
                    title={t('attachments.addLink')}
                    description={t('attachments.linkInputHint')}
                    placeholder={t('attachments.linkPlaceholder')}
                    defaultValue=""
                    confirmLabel={t('common.save')}
                    cancelLabel={t('common.cancel')}
                    onCancel={() => setShowLinkPrompt(false)}
                    onConfirm={(value) => {
                        const added = handleAddLinkAttachment(value);
                        if (!added) return;
                        setShowLinkPrompt(false);
                    }}
                />
            )}
            {showDeleteConfirm && (
                <ConfirmModal
                    isOpen={showDeleteConfirm}
                    title={resolveText('common.delete', 'Delete task')}
                    description={resolveText('list.confirmBatchDelete', 'Delete selected tasks?')}
                    confirmLabel={resolveText('common.delete', 'Delete')}
                    cancelLabel={t('common.cancel')}
                    onCancel={() => setShowDeleteConfirm(false)}
                    onConfirm={() => {
                        setShowDeleteConfirm(false);
                        void deleteTask(task.id);
                        const restoreLabel = resolveText('trash.restoreToInbox', 'Restore');
                        const deletedMessage = resolveText('task.aria.delete', 'Task deleted');
                        showToast(
                            deletedMessage,
                            'info',
                            5000,
                            {
                                label: restoreLabel,
                                onClick: () => {
                                    void restoreTask(task.id);
                                },
                            }
                        );
                    }}
                />
            )}
            {showDiscardConfirm && (
                <ConfirmModal
                    isOpen={showDiscardConfirm}
                    title={resolveText('taskEdit.discardChanges', 'Discard unsaved changes?')}
                    description={resolveText('taskEdit.discardChangesDesc', 'Your changes will be lost if you leave now.')}
                    confirmLabel={resolveText('common.discard', 'Discard')}
                    cancelLabel={t('common.cancel')}
                    onCancel={() => setShowDiscardConfirm(false)}
                    onConfirm={() => {
                        setShowDiscardConfirm(false);
                        handleDiscardChanges();
                    }}
                />
            )}
            <AttachmentModals
                audioAttachment={audioAttachment}
                audioSource={audioSource}
                audioRef={audioRef}
                audioError={audioError}
                onCloseAudio={closeAudio}
                onAudioError={handleAudioError}
                onOpenAudioExternally={openAudioExternally}
                imageAttachment={imageAttachment}
                imageSource={imageSource}
                onCloseImage={closeImage}
                onOpenImageExternally={openImageExternally}
                textAttachment={textAttachment}
                textContent={textContent}
                textLoading={textLoading}
                textError={textError}
                onCloseText={closeText}
                onOpenTextExternally={openTextExternally}
                t={t}
            />
        </>
    );
});
