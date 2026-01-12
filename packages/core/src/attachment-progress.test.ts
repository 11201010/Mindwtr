import { describe, expect, it, vi } from 'vitest';
import { AttachmentProgressTracker } from './attachment-progress';

describe('AttachmentProgressTracker', () => {
    it('notifies subscribers on update', () => {
        const tracker = new AttachmentProgressTracker();
        const listener = vi.fn();
        tracker.subscribe('att-1', listener);
        tracker.updateProgress('att-1', {
            operation: 'download',
            bytesTransferred: 50,
            totalBytes: 100,
            percentage: 50,
            status: 'active',
        });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0]).toMatchObject({ bytesTransferred: 50, totalBytes: 100 });
    });

    it('supports multiple subscribers', () => {
        const tracker = new AttachmentProgressTracker();
        const listenerA = vi.fn();
        const listenerB = vi.fn();
        tracker.subscribe('att-1', listenerA);
        tracker.subscribe('att-1', listenerB);
        tracker.updateProgress('att-1', { status: 'active' });
        expect(listenerA).toHaveBeenCalledTimes(1);
        expect(listenerB).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe stops updates', () => {
        const tracker = new AttachmentProgressTracker();
        const listener = vi.fn();
        const unsubscribe = tracker.subscribe('att-1', listener);
        unsubscribe();
        tracker.updateProgress('att-1', { status: 'active' });
        expect(listener).not.toHaveBeenCalled();
    });

    it('clear resets progress', () => {
        const tracker = new AttachmentProgressTracker();
        tracker.updateProgress('att-1', { status: 'active', bytesTransferred: 10, totalBytes: 20, percentage: 50 });
        tracker.clear('att-1');
        const progress = tracker.getProgress('att-1');
        expect(progress).toBeUndefined();
    });
});
