import { List } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { TaskSortBy } from '@mindwtr/core';

type ListHeaderProps = {
    title: string;
    showNextCount: boolean;
    nextCount: number;
    taskCount: number;
    hasFilters: boolean;
    filterSummaryLabel: string;
    filterSummarySuffix: string;
    sortBy: TaskSortBy;
    onChangeSortBy: (value: TaskSortBy) => void;
    selectionMode: boolean;
    onToggleSelection: () => void;
    showListDetails: boolean;
    onToggleDetails: () => void;
    t: (key: string) => string;
};

export function ListHeader({
    title,
    showNextCount,
    nextCount,
    taskCount,
    hasFilters,
    filterSummaryLabel,
    filterSummarySuffix,
    sortBy,
    onChangeSortBy,
    selectionMode,
    onToggleSelection,
    showListDetails,
    onToggleDetails,
    t,
}: ListHeaderProps) {
    return (
        <header className="flex items-center justify-between">
            <h2 className="text-3xl font-bold tracking-tight">
                {title}
                {showNextCount && <span className="ml-2 text-lg font-normal text-muted-foreground">({nextCount})</span>}
            </h2>
            <div className="flex items-center gap-3">
                <span className="text-muted-foreground text-sm" aria-live="polite">
                    {taskCount} {t('common.tasks')}
                    {hasFilters && (
                        <span className="ml-1 text-primary">• {filterSummaryLabel}{filterSummarySuffix}</span>
                    )}
                </span>
                <select
                    value={sortBy}
                    onChange={(e) => onChangeSortBy(e.target.value as TaskSortBy)}
                    aria-label={t('sort.label')}
                    className="text-xs bg-muted/50 text-foreground border border-border rounded px-2 py-1 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                    <option value="default">{t('sort.default')}</option>
                    <option value="due">{t('sort.due')}</option>
                    <option value="start">{t('sort.start')}</option>
                    <option value="review">{t('sort.review')}</option>
                    <option value="title">{t('sort.title')}</option>
                    <option value="created">{t('sort.created')}</option>
                    <option value="created-desc">{t('sort.created-desc')}</option>
                </select>
                <button
                    onClick={onToggleSelection}
                    className={cn(
                        "text-xs px-3 py-1 rounded-md border transition-colors",
                        selectionMode
                            ? "bg-primary/10 text-primary border-primary"
                            : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                    )}
                >
                    {selectionMode ? t('bulk.exitSelect') : t('bulk.select')}
                </button>
                <button
                    type="button"
                    onClick={onToggleDetails}
                    aria-pressed={showListDetails}
                    className={cn(
                        "text-xs px-3 py-1 rounded-md border transition-colors inline-flex items-center gap-1.5",
                        showListDetails
                            ? "bg-primary/10 text-primary border-primary"
                            : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                    )}
                    title={showListDetails ? (t('list.details') || 'Details on') : (t('list.detailsOff') || 'Details off')}
                >
                    <List className="w-3.5 h-3.5" />
                    {showListDetails ? (t('list.details') || 'Details') : (t('list.compact') || 'Compact')}
                </button>
            </div>
        </header>
    );
}
