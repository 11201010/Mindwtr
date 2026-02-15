import { useCallback, useEffect, useState } from 'react';
import { type Attachment, generateUUID, type Project, validateAttachmentForUpload } from '@mindwtr/core';
import { invoke } from '@tauri-apps/api/core';
import { size } from '@tauri-apps/plugin-fs';
import { isTauriRuntime } from '../../../lib/runtime';
import { logWarn } from '../../../lib/app-log';

type UseProjectAttachmentActionsParams = {
    t: (key: string) => string;
    selectedProject: Project | undefined;
    updateProject: (projectId: string, updates: Partial<Project>) => void;
    resolveValidationMessage: (error?: string) => string;
};

export function useProjectAttachmentActions({
    t,
    selectedProject,
    updateProject,
    resolveValidationMessage,
}: UseProjectAttachmentActionsParams) {
    const [attachmentError, setAttachmentError] = useState<string | null>(null);
    const [showLinkPrompt, setShowLinkPrompt] = useState(false);
    const [isProjectAttachmentBusy, setIsProjectAttachmentBusy] = useState(false);

    useEffect(() => {
        setAttachmentError(null);
    }, [selectedProject?.id]);

    const openAttachment = useCallback(async (attachment: Attachment) => {
        const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(attachment.uri);
        const normalized = hasScheme ? attachment.uri : `file://${attachment.uri}`;
        if (isTauriRuntime()) {
            try {
                await invoke('open_path', { path: attachment.uri });
                return;
            } catch (error) {
                void logWarn('Failed to open attachment', {
                    scope: 'attachment',
                    extra: { error: error instanceof Error ? error.message : String(error) },
                });
            }
        }
        window.open(normalized, '_blank');
    }, []);

    const addProjectFileAttachment = useCallback(async () => {
        if (!selectedProject) return;
        if (isProjectAttachmentBusy) return;
        if (!isTauriRuntime()) {
            setAttachmentError(t('attachments.fileNotSupported'));
            return;
        }
        setIsProjectAttachmentBusy(true);
        setAttachmentError(null);
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                multiple: false,
                directory: false,
                title: t('attachments.addFile'),
            });
            if (!selected || typeof selected !== 'string') return;
            try {
                const fileSize = await size(selected);
                const validation = await validateAttachmentForUpload(
                    {
                        id: 'pending',
                        kind: 'file',
                        title: selected.split(/[/\\]/).pop() || selected,
                        uri: selected,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    },
                    fileSize
                );
                if (!validation.valid) {
                    setAttachmentError(resolveValidationMessage(validation.error));
                    return;
                }
            } catch (error) {
                void logWarn('Failed to validate attachment size', {
                    scope: 'attachment',
                    extra: { error: error instanceof Error ? error.message : String(error) },
                });
            }
            const now = new Date().toISOString();
            const title = selected.split(/[/\\]/).pop() || selected;
            const attachment: Attachment = {
                id: generateUUID(),
                kind: 'file',
                title,
                uri: selected,
                createdAt: now,
                updatedAt: now,
            };
            updateProject(selectedProject.id, { attachments: [...(selectedProject.attachments || []), attachment] });
        } finally {
            setIsProjectAttachmentBusy(false);
        }
    }, [isProjectAttachmentBusy, resolveValidationMessage, selectedProject, t, updateProject]);

    const addProjectLinkAttachment = useCallback(() => {
        if (!selectedProject) return;
        setAttachmentError(null);
        setShowLinkPrompt(true);
    }, [selectedProject]);

    const removeProjectAttachment = useCallback((id: string) => {
        if (!selectedProject) return;
        const now = new Date().toISOString();
        const next = (selectedProject.attachments || []).map((attachment) =>
            attachment.id === id ? { ...attachment, deletedAt: now, updatedAt: now } : attachment
        );
        updateProject(selectedProject.id, { attachments: next });
    }, [selectedProject, updateProject]);

    return {
        attachmentError,
        setAttachmentError,
        showLinkPrompt,
        setShowLinkPrompt,
        isProjectAttachmentBusy,
        openAttachment,
        addProjectFileAttachment,
        addProjectLinkAttachment,
        removeProjectAttachment,
    };
}
