import { describe, expect, it } from 'vitest';
import { buildCaptureModalRequest, planCaptureModalRequest } from './capture-modal-model';
import { parseQuickAdd } from './quick-add';
import type { Project, Task } from './types';

const NOW = new Date('2026-09-28T14:00:00.000Z');
const request = (text: string, extra: { projects?: readonly Project[]; initialProps?: Partial<Task>; description?: string } = {}) => {
    const projects = extra.projects ?? [];
    return buildCaptureModalRequest({
        parsed: parseQuickAdd(text, projects as Project[], NOW, []),
        text,
        projects,
        initialProps: extra.initialProps ?? {},
        projectParam: '',
        defaultAreaId: undefined,
        description: extra.description ?? '',
        copilot: { tags: [] },
        timeEstimatesEnabled: true,
    });
};

describe('capture confirmation screen model', () => {
    // RN bug (apps/mobile/app/capture-modal.tsx:553, 586-593 before the move): the entry's
    // description stayed under the field, so an edited field saved both, and a cleared one
    // saved the entry's.
    it('saves the description field as it shows it, a typed /note: token after it', () => {
        const shared = { initialProps: { description: 'Body with https://example.com/doc\nhttps://example.com/doc' } };
        const description = (text: string, field: string) => {
            const plan = planCaptureModalRequest(request(text, { ...shared, description: field }));
            return plan.success ? plan.props.description : plan.reason;
        };
        expect(description('Subject', 'Body with https://example.com/doc')).toBe('Body with https://example.com/doc');
        expect(description('Subject', '   ')).toBeUndefined();
        expect(description('Subject /note:read later', 'Body')).toBe('Body\nread later');
        expect(description('Subject /note:read later', '')).toBe('read later');
    });
});
