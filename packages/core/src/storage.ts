import type { AppData, Task, Project, TaskStatus } from './types';

export type TaskQueryOptions = {
    status?: TaskStatus | 'all';
    projectId?: string;
    excludeStatuses?: TaskStatus[];
    includeArchived?: boolean;
    includeDeleted?: boolean;
};

export type SearchResults = {
    tasks: Task[];
    projects: Project[];
};

export interface StorageAdapter {
    getData(): Promise<AppData>;
    saveData(data: AppData): Promise<void>;
    queryTasks?: (options: TaskQueryOptions) => Promise<Task[]>;
    searchAll?: (query: string) => Promise<SearchResults>;
}

// Default dummy adapter
export const noopStorage: StorageAdapter = {
    getData: async () => ({ tasks: [], projects: [], sections: [], areas: [], settings: {} }),
    saveData: async () => { },
};
