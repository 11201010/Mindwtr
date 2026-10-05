import {
    getQuickDate,
    isQuickDatePresetSelected,
    QUICK_DATE_PRESETS,
    tFallback,
    type QuickDatePreset,
} from '@mindwtr/core';

import { cn } from '../lib/utils';

export const QUICK_DATE_LABELS: Record<QuickDatePreset, { key: string; fallback: string }> = {
    today: { key: 'quickDate.today', fallback: 'Today' },
    tomorrow: { key: 'quickDate.tomorrow', fallback: 'Tomorrow' },
    in_2_days: { key: 'quickDate.in2Days', fallback: '+2 days' },
    in_3_days: { key: 'quickDate.in3Days', fallback: '+3 days' },
    next_week: { key: 'quickDate.nextWeek', fallback: 'Next week' },
    next_month: { key: 'quickDate.nextMonth', fallback: 'Next month' },
    no_date: { key: 'quickDate.noDate', fallback: 'No date' },
};

type QuickDateChipsProps = {
    t: (key: string) => string;
    selectedDate?: Date | null;
    onSelect: (date: Date | null, preset: QuickDatePreset) => void;
    className?: string;
    wrap?: boolean;
    allowClear?: boolean;
};

export function QuickDateChips({
    t,
    selectedDate,
    onSelect,
    className,
    wrap = false,
    allowClear = true,
}: QuickDateChipsProps) {
    const now = new Date();

    return (
        <div className={cn(
            'flex max-w-full gap-1.5 pb-1',
            wrap ? 'flex-wrap overflow-visible' : 'overflow-x-auto',
            className,
        )}>
            {QUICK_DATE_PRESETS.filter((preset) => allowClear || preset !== 'no_date').map((preset) => {
                const labelConfig = QUICK_DATE_LABELS[preset];
                const label = tFallback(t, labelConfig.key, labelConfig.fallback);
                const active = isQuickDatePresetSelected(preset, selectedDate, now);

                return (
                    <button
                        key={preset}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onSelect(getQuickDate(preset, now), preset)}
                        className={cn(
                            'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                            active
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
