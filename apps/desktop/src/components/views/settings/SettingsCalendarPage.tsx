import type { SystemCalendarPermissionStatus } from '../../../lib/system-calendar';
import type { ExternalCalendarSubscription } from '@mindwtr/core';

import { cn } from '../../../lib/utils';

type Labels = {
    calendarDesc: string;
    calendarName: string;
    calendarUrl: string;
    calendarAdd: string;
    calendarRemove: string;
    externalCalendars: string;
    calendarSystemTitle: string;
    calendarSystemDesc: string;
    calendarSystemStatus: string;
    calendarSystemPermissionGranted: string;
    calendarSystemPermissionUndetermined: string;
    calendarSystemPermissionDenied: string;
    calendarSystemPermissionUnsupported: string;
    calendarSystemRequestAccess: string;
    calendarSystemDeniedHint: string;
};

type SettingsCalendarPageProps = {
    t: Labels;
    newCalendarName: string;
    newCalendarUrl: string;
    calendarError: string | null;
    externalCalendars: ExternalCalendarSubscription[];
    showSystemCalendarSection: boolean;
    systemCalendarPermission: SystemCalendarPermissionStatus;
    onCalendarNameChange: (value: string) => void;
    onCalendarUrlChange: (value: string) => void;
    onAddCalendar: () => void;
    onToggleCalendar: (id: string, enabled: boolean) => void;
    onRemoveCalendar: (id: string) => void;
    onRequestSystemCalendarPermission: () => void;
    maskCalendarUrl: (url: string) => string;
};

export function SettingsCalendarPage({
    t,
    newCalendarName,
    newCalendarUrl,
    calendarError,
    externalCalendars,
    showSystemCalendarSection,
    systemCalendarPermission,
    onCalendarNameChange,
    onCalendarUrlChange,
    onAddCalendar,
    onToggleCalendar,
    onRemoveCalendar,
    onRequestSystemCalendarPermission,
    maskCalendarUrl,
}: SettingsCalendarPageProps) {
    const permissionLabel = (() => {
        if (systemCalendarPermission === 'granted') return t.calendarSystemPermissionGranted;
        if (systemCalendarPermission === 'undetermined') return t.calendarSystemPermissionUndetermined;
        if (systemCalendarPermission === 'denied') return t.calendarSystemPermissionDenied;
        return t.calendarSystemPermissionUnsupported;
    })();

    return (
        <div className="space-y-6">
            {showSystemCalendarSection && (
                <div className="bg-card border border-border rounded-lg p-6 space-y-4">
                    <div className="space-y-1">
                        <div className="text-sm font-semibold">{t.calendarSystemTitle}</div>
                        <p className="text-sm text-muted-foreground">{t.calendarSystemDesc}</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm">
                            <span className="text-muted-foreground">{t.calendarSystemStatus}: </span>
                            <span className="font-medium">{permissionLabel}</span>
                        </div>
                        {systemCalendarPermission !== 'granted' && (
                            <button
                                type="button"
                                onClick={onRequestSystemCalendarPermission}
                                className="text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                            >
                                {t.calendarSystemRequestAccess}
                            </button>
                        )}
                    </div>
                    {systemCalendarPermission === 'denied' && (
                        <p className="text-xs text-muted-foreground">{t.calendarSystemDeniedHint}</p>
                    )}
                </div>
            )}

            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
                <p className="text-sm text-muted-foreground">{t.calendarDesc}</p>

                <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                        <div className="text-sm font-medium">{t.calendarName}</div>
                        <input
                            value={newCalendarName}
                            onChange={(e) => onCalendarNameChange(e.target.value)}
                            placeholder={t.calendarName}
                            className="w-full text-sm px-3 py-2 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                    </div>
                    <div className="space-y-1">
                        <div className="text-sm font-medium">{t.calendarUrl}</div>
                        <input
                            value={newCalendarUrl}
                            onChange={(e) => onCalendarUrlChange(e.target.value)}
                            placeholder="https://..."
                            className="w-full text-sm px-3 py-2 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                    <button
                        disabled={!newCalendarUrl.trim()}
                        onClick={onAddCalendar}
                        className={cn(
                            "text-sm px-3 py-2 rounded-md transition-colors",
                            newCalendarUrl.trim()
                                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                : "bg-muted text-muted-foreground cursor-not-allowed"
                        )}
                    >
                        {t.calendarAdd}
                    </button>
                    {calendarError && (
                        <div className="text-xs text-red-400">{calendarError}</div>
                    )}
                </div>
            </div>

            {externalCalendars.length > 0 && (
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="px-4 py-3 text-sm font-medium border-b border-border">{t.externalCalendars}</div>
                    <div className="divide-y divide-border">
                        {externalCalendars.map((calendar) => (
                            <div key={calendar.id} className="p-4 flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium truncate">{calendar.name}</div>
                                    <div className="text-xs text-muted-foreground truncate mt-1">{maskCalendarUrl(calendar.url)}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        checked={calendar.enabled}
                                        onChange={(e) => onToggleCalendar(calendar.id, e.target.checked)}
                                        className="h-4 w-4 accent-blue-600"
                                    />
                                    <button
                                        onClick={() => onRemoveCalendar(calendar.id)}
                                        className="text-sm text-red-400 hover:text-red-300"
                                    >
                                        {t.calendarRemove}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
