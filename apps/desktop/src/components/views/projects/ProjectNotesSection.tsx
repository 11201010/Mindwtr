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
    attachmentsBusy?: boolean;
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
    attachmentsBusy = false,
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
        <div className="mb-4 rounded-xl border border-border/70 overflow-hidden bg-card/55">
            <button
                type="button"
                onClick={onToggleNotes}
                className="w-full flex items-center gap-2 px-3 py-2 bg-muted/25 hover:bg-muted/40 transition-colors text-sm font-medium"
            >
                {notesExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                {t('project.notes')}
            </button>
            {notesExpanded && (
                <div className="p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            onClick={onTogglePreview}
                            className="h-7 text-xs px-2.5 rounded-md border border-border bg-muted/40 hover:bg-muted/70 transition-colors text-muted-foreground"
                        >
                            {showNotesPreview ? t('markdown.edit') : t('markdown.preview')}
                        </button>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={onAddFile}
                                className="h-7 text-xs px-2.5 rounded-md border border-border bg-muted/40 hover:bg-muted/70 transition-colors flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                                disabled={attachmentsBusy}
                                aria-busy={attachmentsBusy}
                            >
                                <Paperclip className="w-3 h-3" />
                                {t('attachments.addFile')}
                            </button>
                            <button
                                type="button"
                                onClick={onAddLink}
                                className="h-7 text-xs px-2.5 rounded-md border border-border bg-muted/40 hover:bg-muted/70 transition-colors flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                                disabled={attachmentsBusy}
                                aria-busy={attachmentsBusy}
                            >
                                <Link2 className="w-3 h-3" />
                                {t('attachments.addLink')}
                            </button>
                        </div>
                    </div>

                    {showNotesPreview ? (
                        <div className="text-xs bg-muted/20 border border-border rounded-md px-2.5 py-2.5">
                            <Markdown markdown={draftNotes} />
                        </div>
                    ) : (
                        <textarea
                            ref={textareaRef}
                            className="w-full min-h-[120px] p-3 text-sm bg-background/40 border border-border rounded-md resize-y focus:outline-none focus:bg-accent/5"
                            placeholder={t('projects.notesPlaceholder')}
                            value={draftNotes}
                            onChange={(event) => setDraftNotes(event.target.value)}
                            onBlur={(event) => {
                                onUpdateNotes(event.target.value);
                                event.currentTarget.scrollTop = 0;
                            }}
                        />
                    )}

                    <div className="pt-2 border-t border-border/50 space-y-1.5">
                        <div className="text-xs text-muted-foreground font-medium">{t('attachments.title')}</div>
                        {attachmentError && (
                            <div className="text-xs text-red-400">{attachmentError}</div>
                        )}
                        {visibleAttachments.length === 0 ? (
                            <div className="text-xs text-muted-foreground">{t('common.none')}</div>
                        ) : (
                            <div className="space-y-1.5">
                                {visibleAttachments.map((attachment) => (
                                    <div key={attachment.id} className="flex items-center justify-between gap-2 text-xs rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
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
                                            className="text-muted-foreground hover:text-foreground text-[11px]"
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
