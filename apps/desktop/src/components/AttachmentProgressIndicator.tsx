import { useEffect, useState } from 'react';
import { type AttachmentProgress, globalProgressTracker } from '@mindwtr/core';
import { cn } from '../lib/utils';
import { useLanguage } from '../contexts/language-context';

type AttachmentProgressIndicatorProps = {
    attachmentId: string;
    className?: string;
};

export function AttachmentProgressIndicator({ attachmentId, className }: AttachmentProgressIndicatorProps) {
    const { t } = useLanguage();
    const [progress, setProgress] = useState<AttachmentProgress | null>(null);

    useEffect(() => {
        return globalProgressTracker.subscribe(attachmentId, (next) => {
            setProgress(next);
        });
    }, [attachmentId]);

    if (!progress || progress.status === 'completed' || progress.status === 'failed') {
        return null;
    }

    const total = progress.totalBytes;
    const percentage = total > 0 ? Math.min(100, Math.round((progress.bytesTransferred / total) * 100)) : null;

    return (
        <div className={cn("flex items-center gap-2 text-[10px] text-muted-foreground", className)}>
            <div
                className="h-1 w-16 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={t('attachments.transferProgress')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percentage ?? undefined}
                aria-valuetext={percentage !== null ? `${percentage}%` : t('attachments.transferProgress')}
            >
                {percentage !== null && (
                    <div className="h-full bg-primary" style={{ width: `${percentage}%` }} />
                )}
            </div>
            <span aria-live="polite">{percentage !== null ? `${percentage}%` : '...'}</span>
        </div>
    );
}
