import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { RangeSelectionOptions, Task } from '@mindwtr/core';
import { StoreTaskItem } from '../list/StoreTaskItem';

type ReviewTaskListProps = {
    tasks: Task[];
    showListDetails: boolean;
    selectionMode: boolean;
    multiSelectedIds: Set<string>;
    highlightTaskId?: string | null;
    highlightTaskAt?: number | null;
    onToggleSelect: (taskId: string, options?: RangeSelectionOptions) => void;
    emptyMessage?: string;
    t: (key: string) => string;
};

export function ReviewTaskList({
    tasks,
    showListDetails,
    selectionMode,
    multiSelectedIds,
    highlightTaskId,
    highlightTaskAt,
    onToggleSelect,
    emptyMessage,
    t,
}: ReviewTaskListProps) {
    const shouldVirtualize = tasks.length > 100;
    const parentRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: shouldVirtualize ? tasks.length : 0,
        getScrollElement: () => parentRef.current,
        estimateSize: () => (showListDetails ? 120 : 104),
        overscan: 6,
    });

    useEffect(() => {
        if (!highlightTaskId) return;
        const index = tasks.findIndex((task) => task.id === highlightTaskId);
        if (index < 0) return;
        if (shouldVirtualize && parentRef.current) {
            rowVirtualizer.scrollToIndex(index, { align: 'start' });
        }
        const scrollToHighlightedTask = () => {
            const target = document.querySelector(`[data-task-id="${highlightTaskId}"]`) as HTMLElement | null;
            if (target && typeof (target as any).scrollIntoView === 'function') {
                target.scrollIntoView({ block: 'start' });
            }
        };
        scrollToHighlightedTask();
        if (typeof window.requestAnimationFrame === 'function') {
            const raf = window.requestAnimationFrame(scrollToHighlightedTask);
            return () => {
                if (typeof window.cancelAnimationFrame === 'function') {
                    window.cancelAnimationFrame(raf);
                }
            };
        }
        const timeout = window.setTimeout(scrollToHighlightedTask, 0);
        return () => window.clearTimeout(timeout);
    }, [highlightTaskAt, highlightTaskId, tasks, shouldVirtualize, rowVirtualizer]);

    if (tasks.length === 0) {
        return (
            <div className="text-center py-12 text-muted-foreground">
                <p>{emptyMessage ?? t('review.noTasks')}</p>
            </div>
        );
    }

    if (!shouldVirtualize) {
        return (
            <div className="divide-y divide-border/30">
                {tasks.map((task) => (
                    <StoreTaskItem
                        key={task.id}
                        taskId={task.id}
                        compactMetaEnabled={showListDetails}
                        showProjectBadgeInActions={false}
                        selectionMode={selectionMode}
                        isMultiSelected={multiSelectedIds.has(task.id)}
                        onToggleSelectId={onToggleSelect}
                    />
                ))}
            </div>
        );
    }

    return (
        <div ref={parentRef} className="max-h-[70vh] overflow-y-auto">
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const task = tasks[virtualRow.index];
                    if (!task) return null;
                    return (
                        <div
                            key={task.id}
                            ref={rowVirtualizer.measureElement}
                            data-index={virtualRow.index}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                        >
                            <div className="pb-1.5">
                                <StoreTaskItem
                                    taskId={task.id}
                                    compactMetaEnabled={showListDetails}
                                    showProjectBadgeInActions={false}
                                    selectionMode={selectionMode}
                                    isMultiSelected={multiSelectedIds.has(task.id)}
                                    onToggleSelectId={onToggleSelect}
                                />
                                <div className="mx-3 mt-1 h-px bg-border/30" />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
