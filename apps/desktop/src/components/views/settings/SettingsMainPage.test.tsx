import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const fontMocks = vi.hoisted(() => ({
    canListInstalledFonts: vi.fn(() => false),
    loadInstalledFontFamilies: vi.fn(async () => [] as string[]),
}));

vi.mock('../../../lib/font-family', () => fontMocks);

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
    fontFamily: '',
    onFontFamilyChange: vi.fn(),
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

    it('browses and searches the installed fonts, applying only an exact pick (#1244)', async () => {
        fontMocks.canListInstalledFonts.mockReturnValue(true);
        fontMocks.loadInstalledFontFamilies.mockResolvedValue(['Inter', 'Roboto']);
        const onFontFamilyChange = vi.fn();
        const { findByRole, getByLabelText, getByRole, queryByRole } = render(
            <SettingsMainPage {...baseProps} fontFamily="" onFontFamilyChange={onFontFamilyChange} />,
        );
        const listedFonts = () => within(getByRole('listbox')).getAllByRole('option').map((option) => option.textContent);

        const input = await findByRole('combobox', { name: 'Font' });
        fireEvent.focus(input);
        await findByRole('option', { name: 'Roboto' });
        expect(listedFonts()).toEqual(['Inter', 'Roboto']);

        fireEvent.change(input, { target: { value: 'rob' } });
        expect(listedFonts()).toEqual(['Roboto']);
        expect(onFontFamilyChange).not.toHaveBeenCalled();

        fireEvent.mouseDown(within(getByRole('listbox')).getByRole('option', { name: 'Roboto' }));
        expect(onFontFamilyChange).toHaveBeenLastCalledWith('Roboto');

        // A half-typed name is only a filter: it reverts on blur instead of applying.
        onFontFamilyChange.mockClear();
        fireEvent.change(input, { target: { value: 'zzz' } });
        fireEvent.blur(input);
        expect(onFontFamilyChange).not.toHaveBeenCalled();
        expect((getByLabelText('Font') as HTMLInputElement).value).toBe('');
        expect(queryByRole('listbox')).toBeNull();
    });

    it('falls back to a typed name when no font list is available (#1244)', () => {
        fontMocks.canListInstalledFonts.mockReturnValue(false);
        const onFontFamilyChange = vi.fn();
        const { getByLabelText } = render(
            <SettingsMainPage {...baseProps} fontFamily="" onFontFamilyChange={onFontFamilyChange} />,
        );

        const input = getByLabelText('Font') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Inter' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onFontFamilyChange).toHaveBeenLastCalledWith('Inter');
    });
});
