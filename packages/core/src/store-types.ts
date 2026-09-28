import type { ProjectTaskSummary } from './project-row-meta';
import type { FocusStarAction } from './focus-star';
import type { AppData, Area, Person, Project, Section, Task, TaskStatus } from './types';
import type { TaskQueryOptions } from './storage';
import type { TaskDateCoherenceIssue } from './task-date-coherence';
import type { TaskTokenUsage } from './task-token-usage';
import type { ProcessInboxPlan } from './process-inbox-plan';
import type { AreaOrderIntent } from './area-ordering';

export type StoreActionResult = {
    success: boolean;
    error?: string;
    id?: string;
    ids?: string[];
    /** For promoteTaskToProject: true when an existing same-named project was reused instead of created. */
    reused?: boolean;
};

/** Internal native journal mutation. Null is an explicit clear, never omission. */
export type PreparedTaskEdit = {
    before: Task;
    changes: { [K in keyof Task]?: Exclude<Task[K], undefined> | null };
};
export type PreparedTaskEditResult = StoreActionResult & {
    outcome?: 'applied' | 'replayed';
    reason?: 'missing' | 'conflict' | 'invalid';
};

/** One frozen project-only creation. The full project row is its durable receipt. */
export type PreparedProjectCreate = {
    project: Project;
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    selectedArea: { id: string; name: string; color: string | null; deletedAt: null } | null;
    orderMax: number;
    defaultProjectFlowMode: string | null;
};

/** One frozen native Project Focus star change and its complete Project receipt. */
export type PreparedProjectFocus = {
    scope: { project: Project; focusedProjectCount: number };
    effect: { project: { before: Project; after: Project } };
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    updateAt: string;
};

/** One frozen native Project title edit and its complete Project receipt. */
export type PreparedProjectRename = {
    scope: { project: Project };
    effect: { project: { before: Project; after: Project } };
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    updateAt: string;
};

export type ProjectFlowAction = { kind: 'toggleType' }
    | { kind: 'setScope'; scope: 'project' | 'section' };

/** One frozen native Project type or sequential-scope change and its complete Project receipt. */
export type PreparedProjectFlow = {
    scope: { project: Project };
    effect: { project: { before: Project; after: Project } };
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    updateAt: string;
};

/** One frozen native raw Project Notes edit and its complete Project receipt. */
export type PreparedProjectNotesWrite = {
    scope: { project: Project };
    effect: { project: { before: Project; after: Project } };
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    updateAt: string;
};

/** One frozen nonarchived Project status change and its complete Project receipt. */
export type PreparedProjectStatus = {
    scope: { project: Project };
    effect: { project: { before: Project; after: Project } };
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    updateAt: string;
};

/** One frozen Project start/due calendar-day change and its complete Project receipt. */
export type PreparedProjectDate = {
    scope: { project: Project };
    effect: { project: { before: Project; after: Project } };
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    updateAt: string;
};

/** Frozen parent/order witness and the new Section's complete receipt. */
export type PreparedProjectSectionCreate = {
    request: { requestId: string; projectId: string; title: string };
    scope: { project: Project; orderMax: number };
    section: Section;
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    preparedAt: string;
};

/** Frozen parent and complete before/after Section rows for a native rename. */
export type PreparedProjectSectionRename = {
    scope: { project: Project };
    effect: { section: { before: Section; after: Section } };
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    preparedAt: string;
};

/** Frozen Section tombstone and every linked Task detach, including trashed Tasks. */
export type PreparedProjectSectionDelete = {
    scope: { project: Project; section: Section; tasks: Task[] };
    effect: { section: { before: Section; after: Section };
        tasks: Array<{ before: Task; after: Task }> };
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    preparedAt: string;
};

/** Frozen final rows for a native Area create or legacy tombstone restoration. */
export type PreparedAreaCreate = {
    kind: 'fresh' | 'restored';
    scope: { area: Area | null; projects: Project[]; sections: Section[]; tasks: Task[] };
    effect: {
        area: { before: Area | null; after: Area };
        projects: Array<{ before: Project; after: Project }>;
        sections: Array<{ before: Section; after: Section }>;
        tasks: Array<{ before: Task; after: Task }>;
    };
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    orderMax: number;
    restoreAt: string;
    updateAt: string;
};

/** Frozen Area recolor and all linked Project rows the RN writer inspected. */
export type PreparedAreaColor = {
    scope: { area: Area; projects: Project[] };
    effect: { area: { before: Area; after: Area }; projects: Array<{ before: Project; after: Project }> };
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    updateAt: string;
};

/** Frozen order revision for every live Area, including unchanged numeric orders. */
export type PreparedAreaOrder = {
    scope: { areas: Area[] };
    effect: { areas: Array<{ before: Area; after: Area }> };
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    updateAt: string;
};

/** Frozen native manager Area tombstone and every directly linked Task detach. */
export type PreparedAreaDelete = {
    scope: { area: Area; tasks: Task[]; liveProjects: Project[] };
    effect: { area: { before: Area; after: Area }; tasks: Array<{ before: Task; after: Task }> };
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    updateAt: string;
};

/** Internal native Board journal: before is the source guard, after the sole written row. */
export type PreparedBoardTask = {
    kind: 'duplicateTask' | 'trashTask';
    before: Task;
    after: Task;
    deviceIdToInitialize: string | null;
};

/** One frozen Calendar scheduling row; its complete after-row is the receipt. */
export type PreparedCalendarTask = {
    before: Task;
    after: Task;
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
};

/** Native Calendar New task: the task row is the receipt, project is an atomic companion. */
export type PreparedCalendarCreate = {
    task: Task;
    project: Project | null;
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    intent: { props: Partial<Task>; projectToCreate: { name: string; color: string; areaId: string | null } | null };
    creation: {
        selectedProject: Project | null;
        areas: Area[];
        projectOrderMax: number | null;
        taskOrderMax: number | null;
        defaultAreaMode: string | null;
        defaultAreaId: string | null;
        defaultProjectFlowMode: string | null;
        focusCount: number;
        focusLimit: number;
        focusRequested: boolean;
        sequentialEmpty: boolean;
        focusEndOfTodayIso: string | null;
        focusEndOffsetMinutes: number | null;
        preparedOffsetMinutes: number;
        preparedLocalDay: string;
    };
};

/** One Process Inbox decision's complete atomic affected-row set. */
export type PreparedInboxEffect = {
    kind: 'decision' | 'skip' | 'projectCreate';
    tasks: Array<{ before: Task | null; after: Task }>;
    projects: Array<{ before: Project | null; after: Project }>;
    sections: Array<{ before: Section | null; after: Section }>;
    sourceBefore: Task;
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    guards: {
        selectedProject: Project | null;
        selectedArea: Area | null;
        projectOrder: { areaId: string | null; max: number } | null;
        taskOrders: Array<{ projectId: string; max: number }>;
        reactivation: { projectId: string; taskIds: string[]; sectionIds: string[] } | null;
        recurringCandidate: Task | null;
        recurringDuplicate: Task | null;
        defaultScheduleTime: string | null;
        defaultProjectFlowMode: string | null;
        creationSettings: { defaultAreaMode: string | null; defaultAreaId: string | null;
            defaultProjectFlowMode: string | null } | null;
        plan: ProcessInboxPlan;
        focusCount: number | null;
        focusLimit: number | null;
        focusBoundary: string | null;
    };
};

/** A native checklist Save or Reset's complete, bounded atomic affected-row set. */
export type PreparedChecklistEffect = {
    tasks: Array<{ before: Task | null; after: Task }>;
    projects: Array<{ before: Project | null; after: Project }>;
    sections: Array<{ before: Section | null; after: Section }>;
    sourceBefore: Task;
    deviceIdBefore: string | null;
    deviceIdToInitialize: string | null;
    guards: {
        selectedProject: Project | null;
        selectedArea: Area | null;
        taskOrders: Array<{ projectId: string; max: number }>;
        reactivation: { projectId: string; taskIds: string[]; sectionIds: string[] } | null;
        recurringCandidate: Task | null;
        recurringDuplicate: Task | null;
        focusCount: number | null;
        focusLimit: number | null;
        focusBoundary: string | null;
        autoArchiveDays: number | null;
    };
};

/** Device-local recovery state for a snapshot that exhausted durable-save retries. */
export type PersistenceFailure = {
    message: string;
    failedAt: string;
    retrying: boolean;
};

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
    people: Person[];
    settings: AppData['settings'];
    isLoading: boolean;
    error: string | null;
    /** Ephemeral device-local state. This is deliberately excluded from AppData and sync. */
    persistenceFailure: PersistenceFailure | null;
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
    _allPeople: Person[];
    _tasksById: Map<string, Task>;
    _projectsById: Map<string, Project>;
    _sectionsById: Map<string, Section>;
    _areasById: Map<string, Area>;
    _peopleById: Map<string, Person>;

    // Actions
    /** Load all data from storage, or apply an already-persisted snapshot without re-reading storage */
    fetchData: (options?: {
        silent?: boolean;
        preloadedData?: AppData;
        /** Re-throw storage failures after updating store error state. */
        throwOnError?: boolean;
        /** Exclusive native owner only: preserve adapter rows while resolving a durable journal.
         * Run a normal load before exposing UI to resume normalization and migrations. */
        recoveryLoad?: boolean;
        /** Skip applying or acknowledging the read when its owning lifecycle has ended. */
        isResultStillRelevant?: () => boolean;
    }) => Promise<void>;
    /** Add the shared Getting Started project/tasks when missing, localized to the given app language. */
    seedGettingStarted: (options?: { language?: string }) => Promise<StoreActionResult>;
    /** Add a new task */
    addTask: (
        title: string,
        initialProps?: Partial<Task>,
        options?: { captureId: string },
    ) => Promise<StoreActionResult>;
    /** Add multiple new tasks in a single store update */
    addTasks: (items: Array<{
        title: string;
        initialProps?: Partial<Task>;
        captureId?: string;
    }>) => Promise<StoreActionResult>;
    /** Internal prepared-capture commit; the native contract validates the journal envelope first. */
    commitPreparedCapture: (input: {
        task: Task;
        project: Project | null;
        deviceIdToInitialize: string | null;
    }) => Promise<StoreActionResult>;
    /** Internal prepared edit; native validates the journal before this atomic guarded overlay. */
    commitPreparedTaskEdit: (input: PreparedTaskEdit) => Promise<PreparedTaskEditResult>;
    /** Native validates the action-specific envelope before this atomic guarded write. */
    commitPreparedBoardTask: (input: PreparedBoardTask) => Promise<PreparedTaskEditResult>;
    commitPreparedCalendarTask: (input: PreparedCalendarTask) => Promise<PreparedTaskEditResult>;
    commitPreparedCalendarCreate: (input: PreparedCalendarCreate) => Promise<PreparedTaskEditResult>;
    commitPreparedInboxEffect: (input: PreparedInboxEffect) => Promise<PreparedTaskEditResult>;
    commitPreparedChecklistEffect: (input: PreparedChecklistEffect) => Promise<PreparedTaskEditResult>;
    /** Update an existing task */
    updateTask: (id: string, updates: Partial<Task>) => Promise<StoreActionResult>;
    /** Archive a task as cancelled without completing it */
    cancelTask: (id: string) => Promise<StoreActionResult>;
    /** Skip one fixed-schedule occurrence without recording completion */
    skipRecurringTaskOccurrence: (id: string) => Promise<StoreActionResult>;
    /** Soft-delete a task */
    deleteTask: (id: string) => Promise<StoreActionResult>;
    /** Restore a soft-deleted task */
    restoreTask: (id: string) => Promise<StoreActionResult>;
    /** Restore multiple soft-deleted tasks in one store update */
    restoreTasks: (ids: string[]) => Promise<StoreActionResult>;
    /** Permanently remove a task from storage */
    purgeTask: (id: string) => Promise<StoreActionResult>;
    /** Permanently remove multiple soft-deleted tasks from storage in one store update */
    purgeTasks: (ids: string[]) => Promise<StoreActionResult>;
    /** Permanently remove all soft-deleted tasks from storage */
    purgeDeletedTasks: () => Promise<StoreActionResult>;
    /** Duplicate a task (useful for reusable lists/templates) */
    duplicateTask: (id: string, asNextAction?: boolean, copyId?: string) => Promise<StoreActionResult>;
    /** Convert a task into a section of its project; checklist items become tasks and the task is soft-deleted */
    convertTaskToSection: (id: string) => Promise<StoreActionResult>;
    /** Create or reuse a project from a task, then move the task into it */
    promoteTaskToProject: (id: string, options?: { title?: string; color?: string; areaId?: string }) => Promise<StoreActionResult>;
    /** Reset checklist items to unchecked */
    resetTaskChecklist: (id: string) => Promise<StoreActionResult>;
    /** Move task to a different status */
    moveTask: (id: string, newStatus: TaskStatus) => Promise<StoreActionResult>;
    /** Batch update multiple tasks */
    batchUpdateTasks: (updates: Array<{ id: string; updates: Partial<Task> }>) => Promise<StoreActionResult>;
    /** Batch move tasks to a status */
    batchMoveTasks: (ids: string[], newStatus: TaskStatus) => Promise<StoreActionResult>;
    /** Batch soft-delete tasks */
    batchDeleteTasks: (ids: string[]) => Promise<StoreActionResult>;
    /** Reorder Today's Focus by id list, assigning focusOrder 0..n-1 in one update */
    reorderFocusedTasks: (orderedIds: string[]) => Promise<StoreActionResult>;
    /** Query tasks using storage adapter when available */
    queryTasks: (options: TaskQueryOptions) => Promise<Task[]>;
    /** Resolve the Today's Focus star action for a task: eligibility, cap, label key, patch */
    getFocusStarAction: (task: Task, options?: { allowUnclarified?: boolean }) => FocusStarAction;
    /** Set or clear global error state */
    setError: (error: string | null) => void;
    /** Re-enqueue the authoritative in-memory snapshot and wait for a durable save. */
    retryPersistence: () => Promise<void>;
    /** Increment edit lock count */
    lockEditing: () => void;
    /** Decrement edit lock count */
    unlockEditing: () => void;

    // Project Actions
    /** Add a new project */
    addProject: (title: string, color: string, initialProps?: Partial<Project>) => Promise<Project | null>;
    /** Private native journal writer; the contract validates the frozen project first. */
    commitPreparedProjectCreate: (input: PreparedProjectCreate) => Promise<PreparedTaskEditResult>;
    commitPreparedProjectFocus: (input: PreparedProjectFocus & { request: { projectId: string; focused: boolean } }) => Promise<PreparedTaskEditResult>;
    commitPreparedProjectRename: (input: PreparedProjectRename & { request: { projectId: string; title: string } }) => Promise<PreparedTaskEditResult>;
    commitPreparedProjectFlow: (input: PreparedProjectFlow & { request: { projectId: string; action: ProjectFlowAction } }) => Promise<PreparedTaskEditResult>;
    commitPreparedProjectNotesWrite: (input: PreparedProjectNotesWrite & { request: { projectId: string; text: string } }) => Promise<PreparedTaskEditResult>;
    commitPreparedProjectStatus: (input: PreparedProjectStatus & { request: { projectId: string; status: 'active' | 'waiting' | 'someday' } }) => Promise<PreparedTaskEditResult>;
    commitPreparedProjectDate: (input: PreparedProjectDate & { request: { projectId: string; field: 'startDate' | 'dueDate'; value: string | null } }) => Promise<PreparedTaskEditResult>;
    commitPreparedProjectSectionCreate: (input: PreparedProjectSectionCreate) => Promise<PreparedTaskEditResult>;
    commitPreparedProjectSectionRename: (input: PreparedProjectSectionRename & { request: {
        projectId: string; sectionId: string; title: string } }) => Promise<PreparedTaskEditResult>;
    commitPreparedProjectSectionDelete: (input: PreparedProjectSectionDelete & { request: {
        projectId: string; sectionId: string } }) => Promise<PreparedTaskEditResult>;
    commitPreparedAreaCreate: (input: PreparedAreaCreate & { request: { requestId: string; name: string; color: string; expectedAreaId: string } }) => Promise<PreparedTaskEditResult>;
    commitPreparedAreaColor: (input: PreparedAreaColor & { request: { requestId: string; areaId: string; color: string | null } }) => Promise<PreparedTaskEditResult>;
    commitPreparedAreaOrder: (input: PreparedAreaOrder & { request: { requestId: string; intent: AreaOrderIntent; expectedAreas: unknown[] }; result: { orderedIds: string[] } }) => Promise<PreparedTaskEditResult>;
    commitPreparedAreaDelete: (input: PreparedAreaDelete & { request: { requestId: string; areaId: string }; result: { areaId: string } }) => Promise<PreparedTaskEditResult>;
    /** Update a project */
    updateProject: (id: string, updates: Partial<Project>) => Promise<StoreActionResult>;
    /** Archive a project as cancelled and cancel its unfinished child tasks */
    cancelProject: (id: string) => Promise<StoreActionResult>;
    /** Delete a project */
    deleteProject: (id: string) => Promise<StoreActionResult>;
    /** Restore a soft-deleted project and its cascaded children */
    restoreProject: (id: string) => Promise<StoreActionResult>;
    /** Permanently remove a soft-deleted project from Trash */
    purgeProject: (id: string) => Promise<StoreActionResult>;
    /** Permanently remove all soft-deleted projects from Trash */
    purgeDeletedProjects: () => Promise<StoreActionResult>;
    /** Duplicate a project with its sections/tasks (fresh task state) */
    duplicateProject: (id: string) => Promise<Project | null>;
    /** Toggle focus status of a project (max 5) */
    toggleProjectFocus: (id: string) => Promise<void>;

    // Section Actions
    /** Add a new section within a project */
    addSection: (projectId: string, title: string, initialProps?: Partial<Section>) => Promise<Section | null>;
    /** Update a section */
    updateSection: (id: string, updates: Partial<Section>) => Promise<StoreActionResult>;
    /** Delete a section and clear sectionId on child tasks */
    deleteSection: (id: string) => Promise<StoreActionResult>;
    /** Reorder sections within a project by id list */
    reorderSections: (projectId: string, orderedIds: string[]) => Promise<void>;

    // Area Actions
    /** Add a new area */
    addArea: (name: string, initialProps?: Partial<Area>) => Promise<Area | null>;
    /** Update an area */
    updateArea: (id: string, updates: Partial<Area>) => Promise<StoreActionResult>;
    /** Soft-delete an area and cascade matching tombstones to child projects/sections/tasks */
    deleteArea: (id: string) => Promise<StoreActionResult>;
    /** Restore a soft-deleted area and children from the same cascade */
    restoreArea: (id: string) => Promise<StoreActionResult>;
    /** Reorder areas by id list */
    reorderAreas: (orderedIds: string[]) => Promise<void>;
    /** Reorder projects within a specific area by id list */
    reorderProjects: (orderedIds: string[], areaId?: string) => Promise<void>;
    /** Reorder tasks within a project or section */
    reorderProjectTasks: (projectId: string, orderedIds: string[], sectionId?: string | null) => Promise<void>;
    /** Reorder tasks within a Board status column by id list */
    reorderBoardTasks: (status: TaskStatus, orderedIds: string[], movedTaskId?: string) => Promise<void>;

    // People Actions
    /** Add a new managed person for delegated tasks */
    addPerson: (name: string, initialProps?: Partial<Person>) => Promise<Person | null>;
    /** Update managed person metadata */
    updatePerson: (id: string, updates: Partial<Person>) => Promise<StoreActionResult>;
    /** Rename a person and optionally update exact task assignments */
    renamePerson: (id: string, name: string, options?: { updateTasks?: boolean }) => Promise<StoreActionResult>;
    /** Soft-delete a managed person without clearing task assignments */
    deletePerson: (id: string) => Promise<StoreActionResult>;
    /** Restore a soft-deleted managed person */
    restorePerson: (id: string) => Promise<StoreActionResult>;

    // Tag Actions
    /** Delete a tag from tasks and projects */
    deleteTag: (tagId: string) => Promise<void>;
    /** Rename a tag across all tasks and projects */
    renameTag: (oldTagId: string, newTagId: string) => Promise<void>;

    // Context Actions
    /** Delete a context from all tasks */
    deleteContext: (context: string) => Promise<void>;
    /** Rename a context across all tasks */
    renameContext: (oldContext: string, newContext: string) => Promise<void>;

    // Settings Actions
    /** Update application settings */
    updateSettings: (updates: Partial<AppData['settings']>) => Promise<void>;
    /** Persist current in-memory snapshot through the save queue */
    persistSnapshot: () => Promise<void>;
    /** Highlight a task in UI lists (non-persistent) */
    setHighlightTask: (id: string | null) => void;

    /** Derived state selector (cached by data references) */
    getDerivedState: () => DerivedState;
    /** Cheap focused-task count (cached by `tasks` array identity); prefer this
     *  over getDerivedState().focusedCount when nothing else derived is needed. */
    getFocusedCount: () => number;
}

export type DerivedState = {
    projectMap: Map<string, Project>;
    tasksById: Map<string, Task>;
    activeTasksByStatus: Map<TaskStatus, Task[]>;
    tasksByProjectId: Map<string, Task[]>;
    tasksByContext: Map<string, Task[]>;
    tasksByTag: Map<string, Task[]>;
    focusedTasks: Task[];
    projectTaskSummaryById: Map<string, ProjectTaskSummary>;
    allContexts: string[];
    allTags: string[];
    contextTokenUsage: TaskTokenUsage[];
    tagTokenUsage: TaskTokenUsage[];
    sequentialProjectIds: Set<string>;
    sequentialWithinSectionProjectIds: Set<string>;
    dateCoherenceIssuesByTaskId: Map<string, TaskDateCoherenceIssue[]>;
    focusedCount: number;
    focusedProjectCount: number;
};

export type DerivedCache = {
    visibleTasksRef: Task[];
    taskLookupRef: Map<string, Task>;
    projectLookupRef: Map<string, Project>;
    day: string;
    value: DerivedState;
};

export type SaveBaseState = Pick<TaskStore, '_allTasks' | '_allProjects' | '_allSections' | '_allAreas' | '_allPeople' | 'settings'>;
