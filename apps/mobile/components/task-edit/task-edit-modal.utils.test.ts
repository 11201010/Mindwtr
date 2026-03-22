import { describe, expect, it, vi } from 'vitest';

import {
    getTaskEditTabOffset,
    getTaskEditorSectionAssignments,
    getTaskEditorSectionOpenDefaults,
    syncTaskEditPagerPosition,
} from './task-edit-modal.utils';

describe('task-edit-modal pager sync', () => {
    it('returns the right offset for the selected tab', () => {
        expect(getTaskEditTabOffset('task', 360)).toBe(0);
        expect(getTaskEditTabOffset('view', 360)).toBe(360);
    });

    it('updates the animated scroll value and direct scroll node', () => {
        const setValue = vi.fn();
        const scrollTo = vi.fn();

        syncTaskEditPagerPosition({
            mode: 'view',
            containerWidth: 412,
            scrollValue: { setValue },
            scrollNode: { scrollTo },
            animated: false,
        });

        expect(setValue).toHaveBeenCalledWith(412);
        expect(scrollTo).toHaveBeenCalledWith({ x: 412, animated: false });
    });

    it('falls back to getNode scrollTo when needed', () => {
        const setValue = vi.fn();
        const scrollTo = vi.fn();

        syncTaskEditPagerPosition({
            mode: 'task',
            containerWidth: 320,
            scrollValue: { setValue },
            scrollNode: { getNode: () => ({ scrollTo }) },
        });

        expect(setValue).toHaveBeenCalledWith(0);
        expect(scrollTo).toHaveBeenCalledWith({ x: 0, animated: true });
    });

    it('does nothing when the layout width is not ready yet', () => {
        const setValue = vi.fn();
        const scrollTo = vi.fn();

        syncTaskEditPagerPosition({
            mode: 'view',
            containerWidth: 0,
            scrollValue: { setValue },
            scrollNode: { scrollTo },
        });

        expect(setValue).not.toHaveBeenCalled();
        expect(scrollTo).not.toHaveBeenCalled();
    });

    it('merges saved task editor section overrides with defaults', () => {
        expect(getTaskEditorSectionAssignments({
            sections: {
                dueDate: 'scheduling',
                tags: 'details',
            },
        })).toMatchObject({
            dueDate: 'scheduling',
            tags: 'details',
            section: 'basic',
            contexts: 'organization',
        });
    });

    it('uses saved section-open defaults when present', () => {
        expect(getTaskEditorSectionOpenDefaults({
            sectionOpen: {
                scheduling: true,
                details: false,
            },
        })).toEqual({
            basic: true,
            scheduling: true,
            organization: false,
            details: false,
        });
    });
});
