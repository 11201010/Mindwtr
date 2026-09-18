import { ListFilter } from 'lucide-react';
import { tFallback, type TaskStatus } from '@mindwtr/core';
import { ToolbarSelect } from '../list/ToolbarSelect';

type ReviewFiltersBarProps = {
    filterStatus: TaskStatus | 'all';
    statusOptions: TaskStatus[];
    statusCounts: Record<string, number>;
    onSelect: (status: TaskStatus | 'all') => void;
    t: (key: string) => string;
};

export function ReviewFiltersBar({
    filterStatus,
    statusOptions,
    statusCounts,
    onSelect,
    t,
}: ReviewFiltersBarProps) {
    const statusLabel = tFallback(t, 'taskEdit.statusLabel', 'Status');
    const openTasksLabel = tFallback(t, 'review.openTasks', 'Open tasks');

    return (
        <ToolbarSelect
            className="w-full min-w-[12rem] sm:w-auto"
            label={statusLabel}
            icon={<ListFilter className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
            value={filterStatus}
            options={[
                { value: 'all', label: `${openTasksLabel} (${statusCounts.all ?? 0})` },
                ...statusOptions.map((status) => ({
                    value: status,
                    label: `${t(`status.${status}`)} (${statusCounts[status] ?? 0})`,
                })),
            ]}
            onChange={(next) => onSelect(next as TaskStatus | 'all')}
        />
    );
}
