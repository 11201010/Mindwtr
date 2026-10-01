import { describe, expect, it } from 'vitest';
import { createMockProject, createMockTask, mockAppData } from '../../../packages/core/src/sync-test-utils';
import { validateAppData } from './server-validation';

describe('Archive retention document validation', () => {
    it('accepts synced clocks, rejects malformed policy, and leaves invalid legacy clocks safe to defer', () => {
        const data = mockAppData([createMockTask('task', '2026-09-01T00:00:00.000Z')],
            [createMockProject('project', '2026-09-01T00:00:00.000Z')]);
        data.tasks[0].archivedAt = '2026-09-01T00:00:00.000Z';
        data.projects[0].archivedAt = '2026-09-01T00:00:00.000Z';
        data.settings.gtd = { archiveRetentionDays: 30 };
        expect(validateAppData(data).ok).toBe(true);
        data.settings.gtd.archiveRetentionDays = -1;
        expect(validateAppData(data).ok).toBe(false);
        data.settings.gtd.archiveRetentionDays = 30;
        data.tasks[0].archivedAt = '2026-02-30T00:00:00.000Z';
        expect(validateAppData(data).ok).toBe(true);
        (data.tasks[0] as unknown as Record<string, unknown>).archivedAt = 30;
        expect(validateAppData(data).ok).toBe(false);
    });
});
