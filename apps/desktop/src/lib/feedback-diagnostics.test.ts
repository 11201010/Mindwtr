import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    loggingEnabled: false,
    invoke: vi.fn(),
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
}));
vi.mock('@mindwtr/core', async (importOriginal) => ({
    ...await importOriginal<typeof import('@mindwtr/core')>(),
    useTaskStore: { getState: () => ({ settings: { diagnostics: { loggingEnabled: mocks.loggingEnabled } } }) },
    getBreadcrumbs: () => ['123:view:settings'],
}));
vi.mock('./runtime', () => ({ isTauriRuntime: () => true }));
vi.mock('./tauri-invoke', () => ({ invokeNative: mocks.invoke }));
vi.mock('./managed-paths', () => ({ getManagedPath: async () => '/fallback/mindwtr.log' }));
vi.mock('@tauri-apps/api/path', () => ({ join: async (...parts: string[]) => parts.join('/') }));
vi.mock('@tauri-apps/plugin-fs', () => ({
    mkdir: vi.fn(), remove: vi.fn(), readTextFile: mocks.readTextFile, writeTextFile: mocks.writeTextFile,
}));

import { clearLog, collectFeedbackDiagnostics, logError, logInfo } from './app-log';

describe('desktop feedback diagnostics', () => {
    beforeEach(async () => {
        await clearLog();
        vi.clearAllMocks();
        mocks.loggingEnabled = false;
        mocks.invoke.mockImplementation(async (name: string) => name === 'get_log_file_path' ? '/native/mindwtr.log' : undefined);
        mocks.readTextFile.mockResolvedValue('');
    });

    it('includes sanitized session failures when disk logging is disabled', async () => {
        await logError(new Error('Sync failed token=private-secret'), { scope: 'sync' });
        await logInfo('Sync requested', { scope: 'sync' });
        expect(mocks.invoke).not.toHaveBeenCalled();
        const diagnostics = await collectFeedbackDiagnostics();
        expect(diagnostics).toContain('Sync failed');
        expect(diagnostics).toContain('Sync requested');
        expect(diagnostics).not.toContain('private-secret');
        expect(diagnostics).toContain('v1.3.0/feedback-diagnostics');
        expect(mocks.writeTextFile).not.toHaveBeenCalled();
        await clearLog();
        expect(await collectFeedbackDiagnostics()).not.toContain('Sync failed');
    });

    it('reads the native log location used by sandboxed installs', async () => {
        mocks.readTextFile.mockResolvedValue(JSON.stringify({
            ts: '2026-09-14T00:00:00.000Z', level: 'error', scope: 'storage', message: 'Native file failure',
        }));
        expect(await collectFeedbackDiagnostics()).toContain('Native file failure');
        expect(mocks.readTextFile).toHaveBeenCalledWith('/native/mindwtr.log');
    });
});
