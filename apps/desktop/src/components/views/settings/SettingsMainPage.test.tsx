import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { getEnglishSettingsLabels } from './labels';
import { SettingsMainPage, type SettingsMainPageProps } from './SettingsMainPage';

const baseProps: SettingsMainPageProps = {
    t: getEnglishSettingsLabels(),
    themeMode: 'system',
    onThemeChange: vi.fn(),
    densityMode: 'comfortable',
    onDensityChange: vi.fn(),
    textSizeMode: 'default',
    onTextSizeChange: vi.fn(),
    showTaskAge: false,
    onShowTaskAgeChange: vi.fn(),
    language: 'en',
    onLanguageChange: vi.fn(),
    weekStart: 'sunday',
    onWeekStartChange: vi.fn(),
    dateFormat: 'system',
    onDateFormatChange: vi.fn(),
    calendarSystem: 'gregorian',
    showCalendarSystem: false,
    onCalendarSystemChange: vi.fn(),
    timeFormat: 'system',
    onTimeFormatChange: vi.fn(),
    globalQuickAddShortcut: 'Control+Alt+M',
    onGlobalQuickAddShortcutChange: vi.fn(),
    undoNotificationsEnabled: true,
    onUndoNotificationsChange: vi.fn(),
    languages: [{ id: 'en', native: 'English' }],
};

describe('SettingsMainPage', () => {
    it('shows native language names without translation-coverage labels', () => {
        const { getByRole } = render(
            <SettingsMainPage
                {...baseProps}
                languages={[
                    { id: 'en', native: 'English' },
                    { id: 'sv', native: 'Svenska' },
                    { id: 'nl', native: 'Nederlands' },
                ]}
            />,
        );

        const options = Array.from(getByRole('combobox', { name: 'Language' }).querySelectorAll('option'))
            .map((option) => option.textContent);
        expect(options).toEqual(['English', 'Svenska', 'Nederlands']);
    });

    it('shows only the native name for the selected language', () => {
        const { getAllByText } = render(
            <SettingsMainPage
                {...baseProps}
                language="nl"
                languages={[{ id: 'nl', native: 'Nederlands' }]}
            />,
        );

        expect(getAllByText('Nederlands')).toHaveLength(2);
    });

    it('shows the Flatpak quick add command and disables app-owned shortcut selection', () => {
        const { getByRole, getByText } = render(
            <SettingsMainPage
                {...baseProps}
                isFlatpak
            />,
        );

        expect(getByText('Flatpak custom shortcut command')).toBeInTheDocument();
        expect(getByText('flatpak run tech.dongdongbh.mindwtr --quick-add')).toBeInTheDocument();
        expect(getByRole('combobox', { name: 'Global quick add shortcut' })).toBeDisabled();
    });

    it('offers Saturday as a week start option', () => {
        const onWeekStartChange = vi.fn();
        const { getAllByText, getByRole } = render(
            <SettingsMainPage
                {...baseProps}
                weekStart="saturday"
                onWeekStartChange={onWeekStartChange}
            />,
        );

        fireEvent.click(getByRole('button', { name: /Regional formats/ }));
        expect(getAllByText('Saturday').length).toBeGreaterThan(0);
        fireEvent.change(getByRole('combobox', { name: 'Week starts on' }), {
            target: { value: 'monday' },
        });

        expect(onWeekStartChange).toHaveBeenCalledWith('monday');
    });

    it('only renders the calendar system selector when enabled', () => {
        const onCalendarSystemChange = vi.fn();
        const hidden = render(<SettingsMainPage {...baseProps} />);
        expect(hidden.queryByText('Calendar system')).toBeNull();
        hidden.unmount();

        const { getByRole, getByText } = render(
            <SettingsMainPage
                {...baseProps}
                showCalendarSystem
                calendarSystem="jalali"
                onCalendarSystemChange={onCalendarSystemChange}
            />,
        );

        fireEvent.click(getByRole('button', { name: /Regional formats/ }));
        expect(getByText('Calendar system')).toBeInTheDocument();
        fireEvent.change(getByRole('combobox', { name: 'Calendar system' }), {
            target: { value: 'gregorian' },
        });

        expect(onCalendarSystemChange).toHaveBeenCalledWith('gregorian');
    });

    it('offers the condensed density preset', () => {
        const onDensityChange = vi.fn();
        const { getByRole } = render(
            <SettingsMainPage
                {...baseProps}
                densityMode="condensed"
                onDensityChange={onDensityChange}
            />,
        );

        const select = getByRole('combobox', { name: 'Density' });
        expect(select).toHaveValue('condensed');

        fireEvent.change(select, {
            target: { value: 'compact' },
        });

        expect(onDensityChange).toHaveBeenCalledWith('compact');
    });

    it('offers the small text size preset', () => {
        const onTextSizeChange = vi.fn();
        const { getByRole } = render(
            <SettingsMainPage
                {...baseProps}
                textSizeMode="small"
                onTextSizeChange={onTextSizeChange}
            />,
        );

        const select = getByRole('combobox', { name: 'Text size' });
        expect(select).toHaveValue('small');

        fireEvent.change(select, {
            target: { value: 'large' },
        });

        expect(onTextSizeChange).toHaveBeenCalledWith('large');
    });
});
