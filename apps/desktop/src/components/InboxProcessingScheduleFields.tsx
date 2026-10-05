import { safeFormatDate, safeParseDate } from '@mindwtr/core';

import { cn } from '../lib/utils';
import { useNativeDateInputLocale } from '../hooks/use-native-date-input-locale';
import { QuickDateChips } from './QuickDateChips';
import { DateField } from './ui/DateField';

export type InboxProcessingScheduleFieldControl = {
    date: string;
    timeDraft: string;
    hasTime: boolean;
    onDateChange: (value: string) => void;
    onTimeDraftChange: (value: string) => void;
    onTimeCommit: () => void;
    onClear: () => void;
    onDateOnly: () => void;
};

export type InboxProcessingScheduleFieldsControls = {
    start: InboxProcessingScheduleFieldControl;
    due: InboxProcessingScheduleFieldControl;
    review: InboxProcessingScheduleFieldControl;
};

export type InboxProcessingScheduleFieldKey = keyof InboxProcessingScheduleFieldsControls;

type InboxProcessingScheduleFieldsProps = {
    t: (key: string) => string;
    fields: InboxProcessingScheduleFieldsControls;
    visibleFieldKeys?: InboxProcessingScheduleFieldKey[];
    variant?: 'quick' | 'guided';
    requiredFieldKeys?: InboxProcessingScheduleFieldKey[];
};

const FIELD_CONFIG = [
    {
        key: 'start',
        labelKey: 'taskEdit.startDateLabel',
        timeAriaKey: 'task.aria.startTime',
    },
    {
        key: 'due',
        labelKey: 'taskEdit.dueDateLabel',
        timeAriaKey: 'task.aria.dueTime',
    },
    {
        key: 'review',
        labelKey: 'taskEdit.reviewDateLabel',
        timeAriaKey: 'task.aria.reviewTime',
    },
] as const;

export function InboxProcessingScheduleFields({
    t,
    fields,
    visibleFieldKeys,
    variant = 'quick',
    requiredFieldKeys = [],
}: InboxProcessingScheduleFieldsProps) {
    const compact = variant === 'quick';
    const { nativeDateInputLocale, dateFormatSetting } = useNativeDateInputLocale();
    const renderedFieldConfig = visibleFieldKeys?.length
        ? FIELD_CONFIG.filter(({ key }) => visibleFieldKeys.includes(key))
        : FIELD_CONFIG;

    return (
        <div className="space-y-3">
            {renderedFieldConfig.map(({ key, labelKey, timeAriaKey }) => {
                const field = fields[key];
                const allowClear = !requiredFieldKeys.includes(key);
                const label = t(labelKey);
                const showClear = Boolean(field.date || field.timeDraft);

                return (
                    <div key={key} className="space-y-1">
                        <label className={cn(
                            'font-medium text-muted-foreground',
                            compact ? 'text-[11px]' : 'text-xs'
                        )}>
                            {label}
                        </label>
                        <DateField
                            t={t}
                            dateAriaLabel={label}
                            dateValue={field.date}
                            selectedDate={safeParseDate(field.date)}
                            dateFormatSetting={dateFormatSetting}
                            nativeDateInputLocale={nativeDateInputLocale}
                            dateInputClassName={cn(
                                'rounded border border-border bg-muted/50 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40',
                                compact ? 'px-3 py-2 text-sm' : 'px-2 py-1 text-xs'
                            )}
                            className="max-w-none"
                            timeInput={(
                                <input
                                    type="text"
                                    aria-label={t(timeAriaKey)}
                                    value={field.timeDraft}
                                    inputMode="numeric"
                                    placeholder="HH:MM"
                                    onChange={(event) => field.onTimeDraftChange(event.target.value)}
                                    onBlur={field.onTimeCommit}
                                    className={cn(
                                        'w-24 shrink-0 rounded border border-border bg-muted/50 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40',
                                        compact ? 'px-3 py-2 text-sm' : 'px-2 py-1 text-xs'
                                    )}
                                />
                            )}
                            hasValue={showClear}
                            onDateChange={field.onDateChange}
                            onClear={allowClear ? field.onClear : undefined}
                            onDateOnly={field.hasTime ? field.onDateOnly : undefined}
                        />
                        <QuickDateChips
                            allowClear={allowClear}
                            t={t}
                            selectedDate={safeParseDate(field.date)}
                            onSelect={(date) => {
                                if (!date) {
                                    field.onClear();
                                    return;
                                }
                                field.onDateChange(safeFormatDate(date, 'yyyy-MM-dd'));
                            }}
                        />
                    </div>
                );
            })}
        </div>
    );
}
