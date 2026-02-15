import { Link2, Paperclip } from 'lucide-react';
import type { Attachment } from '@mindwtr/core';

type AttachmentsFieldProps = {
    t: (key: string) => string;
    attachmentError: string | null;
    visibleEditAttachments: Attachment[];
    addFileAttachment: () => void;
    addLinkAttachment: () => void;
    openAttachment: (attachment: Attachment) => void;
    removeAttachment: (id: string) => void;
};

export function AttachmentsField({
    t,
    attachmentError,
    visibleEditAttachments,
    addFileAttachment,
    addLinkAttachment,
    openAttachment,
    removeAttachment,
}: AttachmentsFieldProps) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground font-medium">{t('attachments.title')}</label>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={addFileAttachment}
                        className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors flex items-center gap-1"
                    >
                        <Paperclip className="w-3 h-3" />
                        {t('attachments.addFile')}
                    </button>
                    <button
                        type="button"
                        onClick={addLinkAttachment}
                        className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-muted transition-colors flex items-center gap-1"
                    >
                        <Link2 className="w-3 h-3" />
                        {t('attachments.addLink')}
                    </button>
                </div>
            </div>
            {attachmentError && (
                <div role="alert" className="text-xs text-red-400">{attachmentError}</div>
            )}
            {visibleEditAttachments.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('common.none')}</p>
            ) : (
                <div className="space-y-1">
                    {visibleEditAttachments.map((attachment) => (
                        <div key={attachment.id} className="flex items-center justify-between gap-2 text-xs">
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    openAttachment(attachment);
                                }}
                                className="truncate text-primary hover:underline"
                                title={attachment.title}
                            >
                                {attachment.title}
                            </button>
                            <button
                                type="button"
                                onClick={() => removeAttachment(attachment.id)}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                {t('attachments.remove')}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
