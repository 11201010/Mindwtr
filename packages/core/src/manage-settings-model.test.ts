import { describe, expect, it } from 'vitest';
import { buildManagePersonRow, getManageEditorText, isManageAreaNameTaken, isManageEditorSaveDisabled, type ManageUntranslatedText } from './manage-settings-model';
import type { Area, Person } from './types';

const t = (key: string) => ({ 'common.tasks': 'tasks', 'list.countTaskSingular': 'task' }[key] ?? key);
const person = (extra: Partial<Person> = {}): Person => ({
    id: 'pe-dee', name: 'Dee', createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z', ...extra,
});

describe('buildManagePersonRow', () => {
    it('counts one task in the singular', () => {
        const row = buildManagePersonRow(person(), new Map([['dee', 1]]), t);
        expect(row.countLabel).toBe('1 task');
        expect(row.countAccessibilityLabel).toBe('Dee: 1 task');
        expect(buildManagePersonRow(person(), new Map([['dee', 2]]), t).countLabel).toBe('2 tasks');
    });

    it('shows the count once: the second line holds only a note or link', () => {
        expect(buildManagePersonRow(person(), new Map([['dee', 3]]), t).detail).toBeNull();
        expect(buildManagePersonRow(person({ note: ' QA ', referenceLink: 'tel:1' }), new Map(), t).detail).toBe('QA');
        expect(buildManagePersonRow(person({ referenceLink: ' tel:1 ' }), new Map(), t).detail).toBe('tel:1');
    });
});

describe('a new area with a name an area already has', () => {
    const areas = [{ name: 'Home' }, { name: ' Work ' }] as Area[];

    it('turns Save off, as a blank name does, and the editor says why', () => {
        expect(isManageAreaNameTaken('newArea', ' home ', areas)).toBe(true);
        expect(isManageAreaNameTaken('newArea', 'WORK', areas)).toBe(true);
        expect(isManageEditorSaveDisabled('newArea', 'home', areas)).toBe(true);
        expect(isManageEditorSaveDisabled('newArea', 'Garden', areas)).toBe(false);
        expect(isManageEditorSaveDisabled('newArea', '  ', areas)).toBe(true);
        // Renaming an area into another one merges them, as before; only a new area is refused.
        expect(isManageEditorSaveDisabled('area', 'home', areas)).toBe(false);
        const text = (type: 'newArea' | 'area') => getManageEditorText((key) => key, type, {} as ManageUntranslatedText).nameTaken;
        expect(text('newArea')).toBe('An area with this name already exists.');
        expect(text('area')).toBeNull();
    });
});
