import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Attachment, Project } from '@mindwtr/core';

import { useProjectAttachmentActions } from './useProjectAttachmentActions';
import { isTauriRuntime } from '../../../lib/runtime';

const dialogOpenMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/runtime', () => ({
    isTauriRuntime: vi.fn(() => false),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: dialogOpenMock,
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
}));

const baseProject: Project = {
    id: 'project-1',
    title: 'Project 1',
    status: 'active',
    color: '#94a3b8',
    order: 0,
    tagIds: [],
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('useProjectAttachmentActions', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    const setup = (selectedProject: Project | undefined = baseProject) => {
        const params: Parameters<typeof useProjectAttachmentActions>[0] = {
            t: (key) => key,
            selectedProject,
            updateProject: vi.fn(),
        };

        const hook = renderHook(() => useProjectAttachmentActions(params));
        return { hook, params };
    };

    it('reports file attachments as unsupported on web runtime', async () => {
        const { hook } = setup();

        await act(async () => {
            await hook.result.current.addProjectFileAttachment();
        });

        expect(hook.result.current.attachmentError).toBe('attachments.fileNotSupported');
    });

    it('opens attachments in a browser tab on web runtime', async () => {
        const { hook } = setup();
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        const attachment: Attachment = {
            id: 'attachment-1',
            kind: 'file',
            title: 'Notes',
            uri: '/tmp/notes.txt',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };

        await act(async () => {
            await hook.result.current.openAttachment(attachment);
        });

        expect(openSpy).toHaveBeenCalledWith('file:///tmp/notes.txt', '_blank');
    });

    it('links a picked folder to the project as a plain link', async () => {
        vi.mocked(isTauriRuntime).mockReturnValue(true);
        dialogOpenMock.mockResolvedValue('/Users/dd/Projects/Alpha');
        invokeMock.mockResolvedValue(true);
        const { hook, params } = setup();

        await act(async () => {
            await hook.result.current.addProjectFolderLinkAttachment();
        });

        expect(dialogOpenMock).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
        expect(params.updateProject).toHaveBeenCalledWith('project-1', {
            attachments: [expect.objectContaining({
                kind: 'link',
                title: 'Alpha',
                uri: '/Users/dd/Projects/Alpha',
                mimeType: 'inode/directory',
            })],
        });
        const [{ attachments }] = vi.mocked(params.updateProject).mock.calls[0].slice(1) as [Partial<Project>];
        expect(invokeMock).toHaveBeenCalledWith('remember_link_folder_access', {
            attachmentId: attachments?.[0].id,
            path: '/Users/dd/Projects/Alpha',
        });
        vi.mocked(isTauriRuntime).mockReturnValue(false);
    });
});
