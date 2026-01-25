import { useCallback, useEffect, useRef, useState } from 'react';
import { Attachment, generateUUID, validateAttachmentForUpload, type Task } from '@mindwtr/core';
import { invoke } from '@tauri-apps/api/core';
import { dataDir } from '@tauri-apps/api/path';
import { BaseDirectory, readFile, readTextFile, size } from '@tauri-apps/plugin-fs';
import { normalizeAttachmentInput } from '../../lib/attachment-utils';
import { isTauriRuntime } from '../../lib/runtime';
import { logWarn } from '../../lib/app-log';
import {
    isAudioAttachment,
    isImageAttachment,
    isTextAttachment,
    resolveAttachmentSource,
} from './task-item-attachment-utils';

type UseTaskItemAttachmentsProps = {
    task: Task;
    t: (key: string) => string;
};

export function useTaskItemAttachments({ task, t }: UseTaskItemAttachmentsProps) {
    const [editAttachments, setEditAttachments] = useState<Attachment[]>(task.attachments || []);
    const [attachmentError, setAttachmentError] = useState<string | null>(null);
    const [audioAttachment, setAudioAttachment] = useState<Attachment | null>(null);
    const [audioSource, setAudioSource] = useState<string | null>(null);
    const [audioError, setAudioError] = useState<string | null>(null);
    const [audioObjectUrl, setAudioObjectUrl] = useState<string | null>(null);
    const [imageAttachment, setImageAttachment] = useState<Attachment | null>(null);
    const [imageSource, setImageSource] = useState<string | null>(null);
    const [textAttachment, setTextAttachment] = useState<Attachment | null>(null);
    const [textContent, setTextContent] = useState('');
    const [textError, setTextError] = useState<string | null>(null);
    const [textLoading, setTextLoading] = useState(false);
    const [showLinkPrompt, setShowLinkPrompt] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const resolveValidationMessage = useCallback((error?: string) => {
        if (error === 'file_too_large') return t('attachments.fileTooLarge');
        if (error === 'mime_type_blocked' || error === 'mime_type_not_allowed') return t('attachments.invalidFileType');
        return t('attachments.fileNotSupported');
    }, [t]);

    const resolveAudioBlobSource = useCallback(async (attachment: Attachment) => {
        if (!isTauriRuntime()) return null;
        const uri = attachment.uri.replace(/^file:\/\//i, '');
        try {
            const baseDir = await dataDir();
            if (!uri.startsWith(baseDir)) return null;
            const relative = uri.slice(baseDir.length).replace(/^[\\/]/, '');
            const bytes = await readFile(relative, { baseDir: BaseDirectory.Data });
            const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            const mimeType = attachment.mimeType || 'audio/wav';
            const blob = new Blob([buffer], { type: mimeType });
            return URL.createObjectURL(blob);
        } catch (error) {
            void logWarn('Failed to load audio bytes', {
                scope: 'attachment',
                extra: { error: error instanceof Error ? error.message : String(error) },
            });
            return null;
        }
    }, []);

    const loadTextAttachment = useCallback(async (attachment: Attachment) => {
        if (!isTauriRuntime()) {
            throw new Error(t('attachments.fileNotSupported'));
        }
        const uri = attachment.uri.replace(/^file:\/\//i, '');
        if (/^https?:\/\//i.test(uri)) {
            throw new Error(t('attachments.fileNotSupported'));
        }
        const base = await dataDir();
        if (uri.startsWith(base)) {
            const relative = uri.slice(base.length).replace(/^[\\/]/, '');
            return await readTextFile(relative, { baseDir: BaseDirectory.Data });
        }
        return await readTextFile(uri);
    }, [t]);

    const openExternal = useCallback(async (uri: string) => {
        setAttachmentError(null);
        const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(uri);
        const normalized = hasScheme ? uri : `file://${uri}`;
        if (isTauriRuntime()) {
            try {
                await invoke('open_path', { path: uri });
                return;
            } catch (error) {
                void logWarn('Failed to open attachment', {
                    scope: 'attachment',
                    extra: { error: error instanceof Error ? error.message : String(error) },
                });
                const message = error instanceof Error ? error.message : String(error);
                setAttachmentError(message || t('attachments.fileNotSupported'));
            }
        }
        window.open(normalized, '_blank');
    }, [t]);

    const closeAudio = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        setAudioAttachment(null);
        setAudioSource(null);
        setAudioError(null);
        if (audioObjectUrl) {
            URL.revokeObjectURL(audioObjectUrl);
            setAudioObjectUrl(null);
        }
    }, [audioObjectUrl]);

    const closeImage = useCallback(() => {
        setImageAttachment(null);
        setImageSource(null);
    }, []);

    const closeText = useCallback(() => {
        setTextAttachment(null);
        setTextContent('');
        setTextError(null);
        setTextLoading(false);
    }, []);

    const openAudioExternally = useCallback(() => {
        if (!audioAttachment) return;
        void openExternal(audioAttachment.uri);
    }, [audioAttachment, openExternal]);

    const handleAudioError = useCallback(() => {
        const code = audioRef.current?.error?.code;
        const message = code === 1
            ? 'Audio playback aborted.'
            : code === 2
                ? 'Network error while loading audio.'
                : code === 3
                    ? 'Audio decoding failed.'
                    : code === 4
                        ? 'Audio format not supported.'
                        : 'Audio playback failed.';
        setAudioError(message);
    }, []);

    const openTextExternally = useCallback(() => {
        if (!textAttachment) return;
        void openExternal(textAttachment.uri);
    }, [textAttachment, openExternal]);

    const openImageExternally = useCallback(() => {
        if (!imageAttachment) return;
        void openExternal(imageAttachment.uri);
    }, [imageAttachment, openExternal]);

    useEffect(() => {
        if (!audioAttachment && !imageAttachment && !textAttachment) return;
        const handler = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            if (audioAttachment) closeAudio();
            if (imageAttachment) closeImage();
            if (textAttachment) closeText();
        };
        window.addEventListener('keydown', handler);
        return () => {
            window.removeEventListener('keydown', handler);
        };
    }, [audioAttachment, closeAudio, closeImage, closeText, imageAttachment, textAttachment]);

    const openAttachment = useCallback((attachment: Attachment) => {
        if (isAudioAttachment(attachment)) {
            setAudioAttachment(attachment);
            setAudioError(null);
            void resolveAudioBlobSource(attachment).then((blobUrl) => {
                if (blobUrl) {
                    if (audioObjectUrl) {
                        URL.revokeObjectURL(audioObjectUrl);
                    }
                    setAudioObjectUrl(blobUrl);
                    setAudioSource(blobUrl);
                } else {
                    setAudioSource(resolveAttachmentSource(attachment.uri));
                }
            });
            setAudioError(null);
            return;
        }
        if (isTextAttachment(attachment)) {
            setTextAttachment(attachment);
            setTextError(null);
            setTextLoading(true);
            void loadTextAttachment(attachment)
                .then((content) => {
                    setTextContent(content);
                })
                .catch((error) => {
                    void logWarn('Failed to read text attachment', {
                        scope: 'attachment',
                        extra: { error: error instanceof Error ? error.message : String(error) },
                    });
                    const message = error instanceof Error ? error.message : String(error);
                    setTextError(message || t('attachments.fileNotSupported'));
                })
                .finally(() => {
                    setTextLoading(false);
                });
            return;
        }
        if (isImageAttachment(attachment)) {
            setImageAttachment(attachment);
            setImageSource(resolveAttachmentSource(attachment.uri));
            return;
        }
        void openExternal(attachment.uri);
    }, [audioObjectUrl, loadTextAttachment, openExternal, resolveAudioBlobSource, t]);

    const addFileAttachment = useCallback(async () => {
        if (!isTauriRuntime()) {
            setAttachmentError(t('attachments.fileNotSupported'));
            return;
        }
        setAttachmentError(null);
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
        setEditAttachments((prev) => [...prev, attachment]);
    }, [resolveValidationMessage, t]);

    const addLinkAttachment = useCallback(() => {
        setAttachmentError(null);
        setShowLinkPrompt(true);
    }, []);

    const handleAddLinkAttachment = useCallback((value: string) => {
        const normalized = normalizeAttachmentInput(value);
        if (!normalized.uri) return false;
        const now = new Date().toISOString();
        const attachment: Attachment = {
            id: generateUUID(),
            kind: normalized.kind,
            title: normalized.title,
            uri: normalized.uri,
            createdAt: now,
            updatedAt: now,
        };
        setEditAttachments((prev) => [...prev, attachment]);
        return true;
    }, []);

    const removeAttachment = useCallback((id: string) => {
        const now = new Date().toISOString();
        setEditAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, deletedAt: now, updatedAt: now } : a))
        );
    }, []);

    const resetAttachmentState = useCallback((attachments: Attachment[] | undefined) => {
        setEditAttachments(attachments || []);
        setAttachmentError(null);
        setShowLinkPrompt(false);
        closeAudio();
        closeImage();
        closeText();
    }, [closeAudio, closeImage, closeText]);

    return {
        editAttachments,
        setEditAttachments,
        attachmentError,
        setAttachmentError,
        showLinkPrompt,
        setShowLinkPrompt,
        addFileAttachment,
        addLinkAttachment,
        handleAddLinkAttachment,
        removeAttachment,
        openAttachment,
        resetAttachmentState,
        audioAttachment,
        audioSource,
        audioError,
        audioRef,
        openAudioExternally,
        handleAudioError,
        closeAudio,
        imageAttachment,
        imageSource,
        closeImage,
        textAttachment,
        textContent,
        textError,
        textLoading,
        openTextExternally,
        openImageExternally,
        closeText,
    };
}
