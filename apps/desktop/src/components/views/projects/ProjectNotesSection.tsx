import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Link2, Paperclip } from 'lucide-react';
import type { Attachment, Project } from '@mindwtr/core';
import { Markdown } from '../../Markdown';
import { AttachmentProgressIndicator } from '../../AttachmentProgressIndicator';
import { getAttachmentDisplayTitle } from '../../../lib/attachment-utils';

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
        <section className="py-5 border-b border-border/50">
            <button
                type="button"
                onClick={onToggleNotes}
                className="w-full flex items-center gap-2 py-1 text-sm font-medium hover:text-foreground transition-colors"
            >
                {notesExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                {t('project.notes')}
            </button>
            {notesExpanded && (
                <div className="pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            onClick={onTogglePreview}
                            className="h-7 text-xs px-2.5 rounded-md border border-border bg-background hover:bg-muted/40 transition-colors text-muted-foreground"
                        >
                            {showNotesPreview ? t('markdown.edit') : t('markdown.preview')}
                        </button>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={onAddFile}
                                className="h-7 text-xs px-2.5 rounded-md border border-border bg-background hover:bg-muted/40 transition-colors flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                                disabled={attachmentsBusy}
                                aria-busy={attachmentsBusy}
                            >
                                <Paperclip className="w-3 h-3" />
                                {t('attachments.addFile')}
                            </button>
                            <button
                                type="button"
                                onClick={onAddLink}
                                className="h-7 text-xs px-2.5 rounded-md border border-border bg-background hover:bg-muted/40 transition-colors flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                                disabled={attachmentsBusy}
                                aria-busy={attachmentsBusy}
                            >
                                <Link2 className="w-3 h-3" />
                                {t('attachments.addLink')}
                            </button>
                        </div>
                    </div>

                    {showNotesPreview ? (
                        <div className="text-xs border border-border rounded-md px-2.5 py-2.5">
                            <Markdown markdown={draftNotes} />
                        </div>
                    ) : (
                        <textarea
                            ref={textareaRef}
                            className="w-full min-h-[120px] p-3 text-sm bg-background border border-border rounded-md resize-y focus:outline-none focus:bg-accent/5"
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
                                {visibleAttachments.map((attachment) => {
                                    const displayTitle = getAttachmentDisplayTitle(attachment);
                                    const fullTitle = attachment.kind === 'link' ? attachment.uri : attachment.title;
                                    return (
                                        <div key={attachment.id} className="flex items-center justify-between gap-2 text-xs rounded-md border border-border/60 px-2 py-1.5">
                                            <div className="min-w-0 flex-1">
                                                <button
                                                    type="button"
                                                    onClick={() => onOpenAttachment(attachment)}
                                                    className="truncate text-primary hover:underline"
                                                    title={fullTitle || displayTitle}
                                                >
                                                    {displayTitle}
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
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}
