export interface AttachmentProgress {
    attachmentId: string;
    operation: 'upload' | 'download';
    bytesTransferred: number;
    totalBytes: number;
    percentage: number;
    status: 'pending' | 'active' | 'completed' | 'failed';
    error?: string;
}

export type ProgressCallback = (progress: AttachmentProgress) => void;

export class AttachmentProgressTracker {
    private listeners = new Map<string, Set<ProgressCallback>>();
    private progress = new Map<string, AttachmentProgress>();

    subscribe(attachmentId: string, callback: ProgressCallback): () => void {
        const existing = this.listeners.get(attachmentId) ?? new Set<ProgressCallback>();
        existing.add(callback);
        this.listeners.set(attachmentId, existing);
        const current = this.progress.get(attachmentId);
        if (current) callback(current);
        return () => {
            const set = this.listeners.get(attachmentId);
            if (!set) return;
            set.delete(callback);
            if (set.size === 0) {
                this.listeners.delete(attachmentId);
            }
        };
    }

    updateProgress(attachmentId: string, update: Partial<AttachmentProgress>): void {
        const existing = this.progress.get(attachmentId);
        const next: AttachmentProgress = {
            attachmentId,
            operation: update.operation ?? existing?.operation ?? 'download',
            bytesTransferred: update.bytesTransferred ?? existing?.bytesTransferred ?? 0,
            totalBytes: update.totalBytes ?? existing?.totalBytes ?? 0,
            percentage: update.percentage ?? existing?.percentage ?? 0,
            status: update.status ?? existing?.status ?? 'pending',
            error: update.error ?? existing?.error,
        };
        this.progress.set(attachmentId, next);
        const listeners = this.listeners.get(attachmentId);
        if (listeners) {
            listeners.forEach((listener) => listener(next));
        }
    }

    getProgress(attachmentId: string): AttachmentProgress | undefined {
        return this.progress.get(attachmentId);
    }

    clear(attachmentId: string): void {
        this.progress.delete(attachmentId);
        const listeners = this.listeners.get(attachmentId);
        if (listeners) {
            listeners.forEach((listener) =>
                listener({
                    attachmentId,
                    operation: 'download',
                    bytesTransferred: 0,
                    totalBytes: 0,
                    percentage: 0,
                    status: 'pending',
                })
            );
        }
    }
}

export const globalProgressTracker = new AttachmentProgressTracker();
