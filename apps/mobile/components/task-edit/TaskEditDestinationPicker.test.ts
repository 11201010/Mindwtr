import { describe, expect, it, vi } from 'vitest';

import { applyTaskEditDestination } from './TaskEditDestinationPicker';

describe('applyTaskEditDestination', () => {
    it('moves to a project and clears an incompatible area and section', () => {
        const setDraftField = vi.fn();

        applyTaskEditDestination(setDraftField, 'project-old', 'section-old', {
            kind: 'project',
            id: 'project-new',
        });

        expect(setDraftField.mock.calls).toEqual([
            ['projectId', 'project-new'],
            ['areaId', ''],
            ['sectionId', ''],
        ]);
    });

    it('keeps the section when reselecting the same project', () => {
        const setDraftField = vi.fn();

        applyTaskEditDestination(setDraftField, 'project-1', 'section-1', {
            kind: 'project',
            id: 'project-1',
        });

        expect(setDraftField).toHaveBeenLastCalledWith('sectionId', 'section-1');
    });

    it('moves to an area and clears project-only organization', () => {
        const setDraftField = vi.fn();

        applyTaskEditDestination(setDraftField, 'project-1', 'section-1', {
            kind: 'area',
            id: 'area-1',
        });

        expect(setDraftField.mock.calls).toEqual([
            ['projectId', ''],
            ['areaId', 'area-1'],
            ['sectionId', ''],
        ]);
    });

    it('clears every destination field for None', () => {
        const setDraftField = vi.fn();

        applyTaskEditDestination(setDraftField, 'project-1', 'section-1', { kind: 'none' });

        expect(setDraftField.mock.calls).toEqual([
            ['projectId', ''],
            ['areaId', ''],
            ['sectionId', ''],
        ]);
    });
});
