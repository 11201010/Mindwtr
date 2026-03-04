import type { TaskStatus } from '@mindwtr/core';

type ListBulkActionsProps = {
    selectionCount: number;
    onMoveToStatus: (status: TaskStatus) => void;
    onAssignArea?: (areaId: string | null) => void;
    areaOptions?: Array<{ id: string; name: string }>;
    onAddTag: () => void;
    onAddContext: () => void;
    onRemoveContext: () => void;
    onDelete: () => void;
    isDeleting?: boolean;
    t: (key: string) => string;
};

const BULK_STATUS_OPTIONS: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'reference', 'done'];

export function ListBulkActions({
    selectionCount,
    onMoveToStatus,
    onAssignArea,
    areaOptions,
    onAddTag,
    onAddContext,
    onRemoveContext,
    onDelete,
    isDeleting = false,
    t,
}: ListBulkActionsProps) {
    if (selectionCount === 0) return null;
    const areaLabelRaw = t('projects.areaLabel');
    const areaLabel = areaLabelRaw === 'projects.areaLabel' ? 'Area' : areaLabelRaw;
    const noAreaLabelRaw = t('taskEdit.noAreaOption');
    const noAreaLabel = noAreaLabelRaw === 'taskEdit.noAreaOption' ? 'No area' : noAreaLabelRaw;
    const hasAreaAssignment = Boolean(onAssignArea) && (areaOptions?.length ?? 0) > 0;

    return (
        <div className="flex flex-wrap items-center gap-2 bg-card border border-border rounded-lg p-3">
            <span className="text-sm text-muted-foreground">
                {selectionCount} {t('bulk.selected')}
            </span>
            <div className="flex items-center gap-2">
                {BULK_STATUS_OPTIONS.map((status) => (
                    <button
                        key={status}
                        onClick={() => onMoveToStatus(status)}
                        className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors"
                        aria-label={t(`status.${status}`)}
                    >
                        {t(`status.${status}`)}
                    </button>
                ))}
            </div>
            {hasAreaAssignment && (
                <select
                    defaultValue=""
                    onChange={(event) => {
                        const value = event.currentTarget.value;
                        if (!value || !onAssignArea) return;
                        onAssignArea(value === '__NO_AREA__' ? null : value);
                        event.currentTarget.value = '';
                    }}
                    className="text-xs px-2 py-1 rounded bg-muted/50 border border-border hover:bg-muted transition-colors"
                    aria-label={areaLabel}
                >
                    <option value="">{areaLabel}</option>
                    <option value="__NO_AREA__">{noAreaLabel}</option>
                    {(areaOptions ?? []).map((area) => (
                        <option key={area.id} value={area.id}>
                            {area.name}
                        </option>
                    ))}
                </select>
            )}
            <button
                onClick={onAddTag}
                className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors"
                aria-label={t('bulk.addTag')}
            >
                {t('bulk.addTag')}
            </button>
            <button
                onClick={onAddContext}
                className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors"
                aria-label={t('bulk.addContext')}
            >
                {t('bulk.addContext')}
            </button>
            <button
                onClick={onRemoveContext}
                className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors"
                aria-label={t('bulk.removeContext')}
            >
                {t('bulk.removeContext')}
            </button>
            <button
                onClick={onDelete}
                className="text-xs px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                aria-label={t('bulk.delete')}
                disabled={isDeleting}
                aria-busy={isDeleting}
            >
                {t('bulk.delete')}
            </button>
        </div>
    );
}
