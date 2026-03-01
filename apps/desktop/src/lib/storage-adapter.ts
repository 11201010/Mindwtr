import { AppData, StorageAdapter, TaskQueryOptions } from '@mindwtr/core';
import { invoke } from '@tauri-apps/api/core';
import { reportError } from './report-error';
import { markLocalWrite } from './local-data-watcher';

const invokeWithError = async <T>(
    action: string,
    command: string,
    args?: Record<string, unknown>
): Promise<T> => {
    try {
        return await invoke<T>(command as any, args as any);
    } catch (error) {
        reportError(`Failed to ${action}`, error);
        throw new Error(`Failed to ${action}.`);
    }
};

export const tauriStorage: StorageAdapter = {
    getData: async (): Promise<AppData> => {
        return invokeWithError<AppData>('load data', 'get_data');
    },
    saveData: async (data: AppData): Promise<void> => {
        markLocalWrite();
        await invokeWithError<void>('save data', 'save_data', { data });
    },
    queryTasks: async (options: TaskQueryOptions) => {
        return invokeWithError('query tasks', 'query_tasks', { options });
    },
    searchAll: async (query: string) => {
        return invokeWithError('search', 'search_fts', { query });
    },
};
