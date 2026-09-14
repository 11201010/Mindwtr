import { describe, expect, it, vi } from 'vitest';

import {
    buildFileSyncAttachmentFailureExtra,
    runFileSyncAttachmentStage,
} from './file-sync-attachment-diagnostics';

describe('File Sync attachment failure diagnostics', () => {
    it('extracts an explicit Windows OS error through bounded causes without leaking messages', () => {
        const privatePath = 'C:\\Private\\customer-secret.pdf';
        const error = new Error('File Sync attachment generation failed integrity verification') as Error & {
            cause?: unknown;
        };
        error.cause = new Error(`The process cannot access ${privatePath} (os error 32)`);

        const extra = buildFileSyncAttachmentFailureExtra('existing-generation-verify', error);

        expect(extra).toEqual({
            releaseCheck: 'v1.3.1/file-sync-attachment-failure',
            backend: 'file',
            operation: 'upload',
            stage: 'existing-generation-verify',
            errorType: 'native-os-error',
            nativeCode: '32',
        });
        expect(JSON.stringify(extra)).not.toContain(privatePath);
        expect(JSON.stringify(extra)).not.toContain('process cannot access');
    });

    it('accepts only allowlisted symbolic errno values and does not infer a bare numeric errno', () => {
        expect(buildFileSyncAttachmentFailureExtra('scratch-open', { code: 'EACCES' })).toMatchObject({
            errorType: 'native-errno',
            nativeCode: 'EACCES',
        });
        expect(buildFileSyncAttachmentFailureExtra('scratch-open', new Error('errno 13'))).toMatchObject({
            errorType: 'error',
            nativeCode: 'unknown',
        });
        expect(buildFileSyncAttachmentFailureExtra('scratch-open', { code: 'CUSTOM_SECRET' })).toMatchObject({
            errorType: 'unknown',
            nativeCode: 'unknown',
        });
    });

    it('preserves the original failure when the diagnostic logger throws', async () => {
        const transferError = new TypeError('private transfer failure');
        const logSyncWarning = vi.fn(() => {
            throw new Error('logger unavailable');
        });

        const thrown = await runFileSyncAttachmentStage(
            'native-publication',
            logSyncWarning,
            async () => { throw transferError; },
        ).catch((error: unknown) => error);

        expect(thrown).toBe(transferError);
        expect(logSyncWarning).toHaveBeenCalledWith(
            'File Sync attachment operation failed',
            undefined,
            {
                releaseCheck: 'v1.3.1/file-sync-attachment-failure',
                backend: 'file',
                operation: 'upload',
                stage: 'native-publication',
                errorType: 'error',
                nativeCode: 'unknown',
            },
        );
    });

    it('does not call the diagnostic logger when a stage succeeds', async () => {
        const logSyncWarning = vi.fn(() => {
            throw new Error('logger unavailable');
        });

        await expect(runFileSyncAttachmentStage(
            'scratch-write',
            logSyncWarning,
            async () => 'published',
        )).resolves.toBe('published');
        expect(logSyncWarning).not.toHaveBeenCalled();
    });
});
