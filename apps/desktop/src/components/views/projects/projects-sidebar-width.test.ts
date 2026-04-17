import { describe, expect, it } from 'vitest';

import {
    PROJECTS_SIDEBAR_DEFAULT_WIDTH,
    PROJECTS_SIDEBAR_MAX_WIDTH,
    PROJECTS_SIDEBAR_MIN_WIDTH,
    clampProjectsSidebarWidth,
    getProjectsSidebarMaxWidth,
    loadProjectsSidebarWidth,
    saveProjectsSidebarWidth,
} from './projects-sidebar-width';

describe('projects-sidebar-width', () => {
    it('loads the default width when storage is empty or invalid', () => {
        expect(loadProjectsSidebarWidth(null)).toBe(PROJECTS_SIDEBAR_DEFAULT_WIDTH);
        expect(loadProjectsSidebarWidth({ getItem: () => 'not-a-number', setItem: () => undefined })).toBe(PROJECTS_SIDEBAR_DEFAULT_WIDTH);
    });

    it('clamps persisted widths to the supported range', () => {
        expect(loadProjectsSidebarWidth({ getItem: () => '9999', setItem: () => undefined })).toBe(PROJECTS_SIDEBAR_MAX_WIDTH);
        expect(loadProjectsSidebarWidth({ getItem: () => '12', setItem: () => undefined })).toBe(PROJECTS_SIDEBAR_MIN_WIDTH);
    });

    it('reduces the allowed max width when the workspace gets narrow', () => {
        expect(getProjectsSidebarMaxWidth(700)).toBe(320);
        expect(clampProjectsSidebarWidth(520, 700)).toBe(320);
    });

    it('persists the clamped width', () => {
        let storedValue = '';
        const storage = {
            getItem: () => storedValue,
            setItem: (_key: string, value: string) => {
                storedValue = value;
            },
        };

        saveProjectsSidebarWidth(9999, storage);

        expect(storedValue).toBe(String(PROJECTS_SIDEBAR_MAX_WIDTH));
    });
});
