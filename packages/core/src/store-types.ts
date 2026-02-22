import type { AppData, Area, Project, Section, Task, TaskStatus } from './types';
import type { TaskQueryOptions } from './storage';

/**
 * Core application state interface.
 *
 * IMPORTANT: `tasks` and `projects` contain only VISIBLE (non-deleted) items for UI.
 * The store internally tracks ALL items (including soft-deleted) for persistence.
 */
export interface TaskStore {
    tasks: Task[];
    projects: Project[];
    sections: Section[];
    areas: Area[];
    settings: AppData['settings'];
    isLoading: boolean;
    error: string | null;
    /** Number of active edit locks (prevents fetchData from clobbering in-progress edits). */
    editLockCount: number;
    /** Updated whenever tasks/projects change (not settings) */
    lastDataChangeAt: number;
    /** Ephemeral highlight task id for UI navigation */
    highlightTaskId: string | null;
    highlightTaskAt: number | null;

    // Internal: full data including tombstones (not exposed to UI)
    _allTasks: Task[];
    _allProjects: Project[];
    _allSections: Section[];
    _allAreas: Area[];

    // Actions
    /** Load all data from storage */
    fetchData: (options?: { silent?: boolean }) => Promise<void>;
    /** Add a new task */
    addTask: (title: string, initialProps?: Partial<Task>) => Promise<void>;
    /** Update an existing task */
    updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
    /** Soft-delete a task */
    deleteTask: (id: string) => Promise<void>;
    /** Restore a soft-deleted task */
    restoreTask: (id: string) => Promise<void>;
    /** Permanently remove a task from storage */
    purgeTask: (id: string) => Promise<void>;
    /** Permanently remove all soft-deleted tasks from storage */
    purgeDeletedTasks: () => Promise<void>;
    /** Duplicate a task (useful for reusable lists/templates) */
    duplicateTask: (id: string, asNextAction?: boolean) => Promise<void>;
    /** Reset checklist items to unchecked */
    resetTaskChecklist: (id: string) => Promise<void>;
    /** Move task to a different status */
    moveTask: (id: string, newStatus: TaskStatus) => Promise<void>;
    /** Batch update multiple tasks */
    batchUpdateTasks: (updates: Array<{ id: string; updates: Partial<Task> }>) => Promise<void>;
    /** Batch move tasks to a status */
    batchMoveTasks: (ids: string[], newStatus: TaskStatus) => Promise<void>;
    /** Batch soft-delete tasks */
    batchDeleteTasks: (ids: string[]) => Promise<void>;
    /** Query tasks using storage adapter when available */
    queryTasks: (options: TaskQueryOptions) => Promise<Task[]>;
    /** Set or clear global error state */
    setError: (error: string | null) => void;
    /** Increment edit lock count */
    lockEditing: () => void;
    /** Decrement edit lock count */
    unlockEditing: () => void;

    // Project Actions
    /** Add a new project */
    addProject: (title: string, color: string, initialProps?: Partial<Project>) => Promise<Project | null>;
    /** Update a project */
    updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
    /** Delete a project */
    deleteProject: (id: string) => Promise<void>;
    /** Duplicate a project with its sections/tasks (fresh task state) */
    duplicateProject: (id: string) => Promise<Project | null>;
    /** Toggle focus status of a project (max 5) */
    toggleProjectFocus: (id: string) => Promise<void>;

    // Section Actions
    /** Add a new section within a project */
    addSection: (projectId: string, title: string, initialProps?: Partial<Section>) => Promise<Section | null>;
    /** Update a section */
    updateSection: (id: string, updates: Partial<Section>) => Promise<void>;
    /** Delete a section and clear sectionId on child tasks */
    deleteSection: (id: string) => Promise<void>;

    // Area Actions
    /** Add a new area */
    addArea: (name: string, initialProps?: Partial<Area>) => Promise<Area | null>;
    /** Update an area */
    updateArea: (id: string, updates: Partial<Area>) => Promise<void>;
    /** Delete an area and clear areaId on child projects/tasks */
    deleteArea: (id: string) => Promise<void>;
    /** Reorder areas by id list */
    reorderAreas: (orderedIds: string[]) => Promise<void>;
    /** Reorder projects within a specific area by id list */
    reorderProjects: (orderedIds: string[], areaId?: string) => Promise<void>;
    /** Reorder tasks within a project or section */
    reorderProjectTasks: (projectId: string, orderedIds: string[], sectionId?: string | null) => Promise<void>;

    // Tag Actions
    /** Delete a tag from tasks and projects */
    deleteTag: (tagId: string) => Promise<void>;

    // Settings Actions
    /** Update application settings */
    updateSettings: (updates: Partial<AppData['settings']>) => Promise<void>;
    /** Highlight a task in UI lists (non-persistent) */
    setHighlightTask: (id: string | null) => void;

    /** Derived state selector (cached by data references) */
    getDerivedState: () => DerivedState;
}

export type DerivedState = {
    projectMap: Map<string, Project>;
    tasksById: Map<string, Task>;
    activeTasksByStatus: Map<TaskStatus, Task[]>;
    allContexts: string[];
    allTags: string[];
    sequentialProjectIds: Set<string>;
    focusedCount: number;
};

export type DerivedCache = {
    tasksRef: Task[];
    projectsRef: Project[];
    lastDataChangeAt: number;
    value: DerivedState;
};

export type SaveBaseState = Pick<TaskStore, '_allTasks' | '_allProjects' | '_allSections' | '_allAreas' | 'settings'>;
