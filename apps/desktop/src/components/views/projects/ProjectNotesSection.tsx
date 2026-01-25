import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Link2, Paperclip } from 'lucide-react';
import type { Attachment, Project } from '@mindwtr/core';
import { Markdown } from '../../Markdown';
import { AttachmentProgressIndicator } from '../../AttachmentProgressIndicator';

type ProjectNotesSectionProps = {
    project: Project;
    notesExpanded: boolean;
    onToggleNotes: () => void;
    showNotesPreview: boolean;
    onTogglePreview: () => void;
    onAddFile: () => void;
    onAddLink: () => void;
    visibleAttachments: Attachment[];
    attachmentError: string | null;
    onOpenAttachment: (attachment: Attachment) => void;
    onRemoveAttachment: (attachmentId: string) => void;
    onUpdateNotes: (notes: string) => void;
    t: (key: string) => string;
};

export function ProjectNotesSection({
    project,
    notesExpanded,
    onToggleNotes,
    showNotesPreview,
    onTogglePreview,
    onAddFile,
    onAddLink,
    visibleAttachments,
    attachmentError,
    onOpenAttachment,
    onRemoveAttachment,
    onUpdateNotes,
    t,
}: ProjectNotesSectionProps) {
    const [draftNotes, setDraftNotes] = useState(project.supportNotes || '');
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        setDraftNotes(project.supportNotes || '');
        if (textareaRef.current) {
            textareaRef.current.scrollTop = 0;
        }
    }, [project.id, project.supportNotes]);

    return (
        <div className="mb-6 border rounded-lg overflow-hidden bg-card">
            <button
                type="button"
                onClick={onToggleNotes}
                className="w-full flex items-center gap-2 p-2 bg-muted/30 hover:bg-muted/50 transition-colors text-sm font-medium"
            >
                {notesExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                {t('project.notes')}
            </button>
            {notesExpanded && (
                <div className="p-3 space-y-3">
                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            onClick={onTogglePreview}
                            className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors text-muted-foreground"
                        >
                            {showNotesPreview ? t('markdown.edit') : t('markdown.preview')}
                        </button>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={onAddFile}
                                className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors flex items-center gap-1"
                            >
                                <Paperclip className="w-3 h-3" />
                                {t('attachments.addFile')}
                            </button>
                            <button
                                type="button"
                                onClick={onAddLink}
                                className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors flex items-center gap-1"
                            >
                                <Link2 className="w-3 h-3" />
                                {t('attachments.addLink')}
                            </button>
                        </div>
                    </div>

                    {showNotesPreview ? (
                        <div className="text-xs bg-muted/30 border border-border rounded px-2 py-2">
                            <Markdown markdown={draftNotes} />
                        </div>
                    ) : (
                        <textarea
                            ref={textareaRef}
                            className="w-full min-h-[120px] p-3 text-sm bg-transparent border border-border rounded resize-y focus:outline-none focus:bg-accent/5"
                            placeholder={t('projects.notesPlaceholder')}
                            value={draftNotes}
                            onChange={(event) => setDraftNotes(event.target.value)}
                            onBlur={(event) => {
                                onUpdateNotes(event.target.value);
                                event.currentTarget.scrollTop = 0;
                            }}
                        />
                    )}

                    <div className="pt-2 border-t border-border/50 space-y-1">
                        <div className="text-xs text-muted-foreground font-medium">{t('attachments.title')}</div>
                        {attachmentError && (
                            <div className="text-xs text-red-400">{attachmentError}</div>
                        )}
                        {visibleAttachments.length === 0 ? (
                            <div className="text-xs text-muted-foreground">{t('common.none')}</div>
                        ) : (
                            <div className="space-y-1">
                                {visibleAttachments.map((attachment) => (
                                    <div key={attachment.id} className="flex items-center justify-between gap-2 text-xs">
                                        <div className="min-w-0 flex-1">
                                            <button
                                                type="button"
                                                onClick={() => onOpenAttachment(attachment)}
                                                className="truncate text-primary hover:underline"
                                                title={attachment.title}
                                            >
                                                {attachment.title}
                                            </button>
                                            <AttachmentProgressIndicator attachmentId={attachment.id} className="mt-1" />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => onRemoveAttachment(attachment.id)}
                                            className="text-muted-foreground hover:text-foreground"
                                        >
                                            {t('attachments.remove')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
