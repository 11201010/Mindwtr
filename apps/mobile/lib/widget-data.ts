import { type AppData, type Language, safeParseDate, SUPPORTED_LANGUAGES, getTranslationsSync, loadTranslations } from '@mindwtr/core';
import type { ColorProp } from 'react-native-android-widget';

export const WIDGET_DATA_KEY = 'mindwtr-data';
export const WIDGET_LANGUAGE_KEY = 'mindwtr-language';
const DARK_THEME_MODES = new Set(['dark', 'material3-dark', 'nord', 'oled']);
const LIGHT_THEME_MODES = new Set(['light', 'material3-light', 'eink', 'sepia']);

export type WidgetSystemColorScheme = 'light' | 'dark' | null | undefined;

export interface WidgetTaskItem {
    id: string;
    title: string;
    statusLabel: string;
}

export interface WidgetPalette {
    background: ColorProp;
    card: ColorProp;
    border: ColorProp;
    text: ColorProp;
    mutedText: ColorProp;
    accent: ColorProp;
    onAccent: ColorProp;
}

export interface TasksWidgetPayload {
    headerTitle: string;
    subtitle: string;
    inboxLabel: string;
    inboxCount: number;
    items: WidgetTaskItem[];
    emptyMessage: string;
    captureLabel: string;
    palette: WidgetPalette;
}

export function resolveWidgetLanguage(saved: string | null, setting?: string): Language {
    const candidate = setting && setting !== 'system' ? setting : saved;
    if (candidate && SUPPORTED_LANGUAGES.includes(candidate as Language)) return candidate as Language;
    return 'en';
}

const resolveWidgetPalette = (
    themeMode: string | undefined,
    systemColorScheme: WidgetSystemColorScheme,
): WidgetPalette => {
    const normalizedMode = (themeMode || '').toLowerCase();
    const isDark = DARK_THEME_MODES.has(normalizedMode)
        ? true
        : LIGHT_THEME_MODES.has(normalizedMode)
            ? false
            : systemColorScheme === 'dark';

    if (isDark) {
        return {
            background: '#111827',
            card: '#1F2937',
            border: '#374151',
            text: '#F9FAFB',
            mutedText: '#CBD5E1',
            accent: '#2563EB',
            onAccent: '#FFFFFF',
        };
    }

    return {
        background: '#F8FAFC',
        card: '#FFFFFF',
        border: '#CBD5E1',
        text: '#0F172A',
        mutedText: '#475569',
        accent: '#2563EB',
        onAccent: '#FFFFFF',
    };
};

export function buildWidgetPayload(
    data: AppData,
    language: Language,
    options?: { systemColorScheme?: WidgetSystemColorScheme }
): TasksWidgetPayload {
    void loadTranslations(language);
    const tr = getTranslationsSync(language);
    const tasks = data.tasks || [];
    const now = new Date();
    const palette = resolveWidgetPalette(
        typeof data.settings?.theme === 'string' ? data.settings.theme : undefined,
        options?.systemColorScheme,
    );

    const activeTasks = tasks.filter((task) => {
        if (task.deletedAt) return false;
        if (task.status === 'archived' || task.status === 'done' || task.status === 'reference') return false;
        if (task.startTime) {
            const start = safeParseDate(task.startTime);
            if (start && start > now) return false;
        }
        return true;
    });

    const focusedTasks = activeTasks.filter((task) => task.isFocusedToday);
    const listSource = focusedTasks;

    const items = listSource.slice(0, 3).map((task) => ({
        id: task.id,
        title: task.title,
        statusLabel: tr[`status.${task.status}`] || task.status,
    }));

    const inboxCount = activeTasks.filter((task) => task.status === 'inbox').length;

    return {
        headerTitle: tr['agenda.todaysFocus'] ?? 'Today',
        subtitle: `${tr['nav.inbox'] ?? 'Inbox'}: ${inboxCount}`,
        inboxLabel: tr['nav.inbox'] ?? 'Inbox',
        inboxCount,
        items,
        emptyMessage: tr['agenda.noTasks'] ?? 'No tasks',
        captureLabel: tr['widget.capture'] ?? 'Quick capture',
        palette,
    };
}
