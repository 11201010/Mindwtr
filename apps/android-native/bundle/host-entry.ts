import {
    DEFAULT_GLOBAL_SEARCH_FILTERS,
    STATUS_COLORS_BY_THEME,
    SqliteAdapter,
    TASK_PRIORITY_COLORS,
    createNativeHostContract,
    legacyImportMismatch,
    assertNativeLegacyBackupSafe,
    logInfo,
    logWarn,
    planLegacyJsonImport,
    setStorageAdapter,
    splitSqlStatements,
    sqliteHasAnyData,
    themeDescriptor,
    resolveThemeStatusPreset,
    type AppTheme,
    type FocusTaskSectionKey,
    type SqliteClient,
    useTaskStore,
    flushPendingSave,
    webdavDeleteFile,
    webdavGetFile,
    webdavGetJson,
    webdavGetSyncDocument,
    webdavHeadFile,
    cloudHeadJson,
    webdavMakeDirectory,
    webdavPutFile,
    webdavPutJson,
} from '@mindwtr/core';

type NativeBridge = {
    sqlRun(sql: string, params: string): string | null;
    sqlAll(sql: string, params: string): string;
    sqlExec(sql: string): string | null;
    nowMs(): number;
    randomBytes(length: number): string;
    log(line: string): void;
    rnStateCommit(change: string): string | null;
};

declare const globalThis: Record<string, unknown> & { MindwtrHost?: unknown };
const native = (): NativeBridge => {
    const bridge = globalThis.__mindwtrNative as NativeBridge | undefined;
    if (!bridge) throw new Error('Native bridge unavailable');
    return bridge;
};

// Kotlin returns a storage exception as a marked string (see CoreHost.guarded):
// a Java exception thrown across the QuickJS JNI boundary aborts the process.
const NATIVE_ERROR = '!MindwtrNativeError:';
const checked = <T,>(value: T): T => {
    if (typeof value === 'string' && value.startsWith(NATIVE_ERROR)) throw new Error(value.slice(NATIVE_ERROR.length));
    return value;
};

const sqlite: SqliteClient = {
    run: async (sql, params) => { checked(native().sqlRun(sql, JSON.stringify(params ?? []))); },
    all: async <T,>(sql: string, params?: unknown[]): Promise<T[]> =>
        JSON.parse(checked(native().sqlAll(sql, JSON.stringify(params ?? [])))) as T[],
    get: async <T,>(sql: string, params?: unknown[]): Promise<T | undefined> =>
        (JSON.parse(checked(native().sqlAll(sql, JSON.stringify(params ?? [])))) as T[])[0],
    exec: async (sql) => {
        for (const statement of splitSqlStatements(sql)) checked(native().sqlExec(statement));
    },
};

type LoadedData = Awaited<ReturnType<SqliteAdapter['getData']>>;
class ValidatedSqliteAdapter extends SqliteAdapter {
    latestData: LoadedData | null = null;

    override async getData(): Promise<LoadedData> {
        const data = await super.getData();
        for (const table of ['tasks', 'projects', 'sections', 'areas', 'people'] as const) {
            const rows = await sqlite.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
            if (data[table].length !== rows?.n) throw new Error(`Incomplete ${table} load`);
        }
        const settingsCount = await sqlite.get<{ n: number }>('SELECT COUNT(*) AS n FROM settings WHERE id = 1');
        const settings = await sqlite.get<{ data: string }>('SELECT data FROM settings WHERE id = 1');
        if (![0, 1].includes(settingsCount?.n ?? -1) || (settingsCount?.n === 1) !== Boolean(settings)) {
            throw new Error('Incomplete settings load');
        }
        if (settings) {
            const parsed = JSON.parse(settings.data) as Record<string, unknown>;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid settings load');
            for (const [key, value] of Object.entries(parsed)) {
                if (key !== 'savedFilters' && JSON.stringify(data.settings[key as keyof typeof data.settings]) !== JSON.stringify(value)) {
                    throw new Error('Incomplete settings load');
                }
            }
        }
        const savedFilters = await sqlite.get<{ n: number }>('SELECT COUNT(*) AS n FROM saved_filters');
        if (!Number.isSafeInteger(savedFilters?.n) || savedFilters!.n < 0
            || (savedFilters!.n > 0 && data.settings.savedFilters?.length !== savedFilters!.n)) {
            throw new Error('Incomplete saved filters load');
        }
        this.latestData = data;
        return data;
    }
}

type Pending = { done: boolean; value?: unknown; error?: string; controller: AbortController };
const pending = new Map<number, Pending>();
let nextId = 1;
/** Runs [work] as one host operation; [work]'s signal fires if the operation outlives its deadline (MindwtrHost.cancel). */
const submit = (work: (signal: AbortSignal) => Promise<unknown>): string => {
    const id = nextId++;
    const slot: Pending = { done: false, controller: new AbortController() };
    pending.set(id, slot);
    void work(slot.controller.signal).then(
        (value) => { slot.value = value; },
        (error) => { slot.error = error instanceof Error ? error.message : String(error); },
    ).finally(() => { slot.done = true; });
    return String(id);
};

const contract = createNativeHostContract();
const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
    if ('error' in result) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
};
type MenuCommand = 'activateProject' | 'somedayMove' | 'somedayUndo' | 'somedayTask' | 'somedaySection' | 'taskListSort' | 'archiveAction' | 'contextsAction' | 'trashAction' | 'reviewAction' | 'reviewTask' | 'calendarAction' | 'calendarCreate' | 'boardAction' | 'boardCreate'
    | 'bulkAction' | 'focusGroup' | 'focusSave' | 'focusCriterion' | 'focusDelete' | 'focusReorder' | 'bulkCreate' | 'mindSweepAdd' | 'savedSearchDelete'
    | 'generalSetting' | 'gtdSetting' | 'manageEditor' | 'manageDelete' | 'somedayRename' | 'somedayReorder' | 'somedayDelete';
type Command = 'create' | 'complete' | 'update' | 'saveTaskDraft' | 'resetChecklist' | 'taskFocus' | 'projectFocus' | 'createProject' | 'areaFilter'
    | 'saveSearch' | 'inboxCommit' | 'inboxSkip' | 'quickCapture' | 'quickCaptureLines' | 'quickCapturePicker' | MenuCommand;
const taskResult = <T>(operation: Command, result: Parameters<typeof unwrap<T>>[0]): T => {
    const ios = globalThis.__mindwtrHostPlatform === 'ios';
    const meta = {
        scope: ios ? 'native-ios' : 'native-android',
        category: 'storage' as const,
        extra: { releaseCheck: ios ? 'v1.3.3/native-ios-dev-task-command' : 'v1.3.3/native-android-dev-task-command', operation, outcome: result.ok ? 'saved' : 'failed' },
    };
    try {
        const message = ios ? 'Native iOS task command' : 'Native Android task command';
        if (result.ok) logInfo(message, meta);
        else logWarn(message, meta);
    } catch { /* a diagnostic sink must not change a durable acknowledgment */ }
    return unwrap(result);
};

type LegacyState = { jsonAhead: boolean; reconciled: boolean; backupVersion: string | null; backupPresent: boolean };

/**
 * The React Native app's AsyncStorage backup, imported as RN's next launch would
 * (core's planLegacyJsonImport). Runs after the validated load. RN's own state
 * (the json-ahead marker, the reconcile flag) changes only after the validated
 * re-read holds every imported row and the settings exactly.
 *
 * If that RN state change fails, the boot fails closed: no activation, so no
 * native edit can exist while the marker is still set. Core's merge can let a
 * tombstone beat a newer live row, so re-importing a stale backup over native
 * edits could discard them. The next boot plans again, finds the import already
 * saved, writes nothing to SQLite, and retries only the RN state change.
 */
const importLegacyJson = async (adapter: ValidatedSqliteAdapter, state: LegacyState, backup: string): Promise<void> => {
    const loaded = adapter.latestData;
    if (!loaded) throw new Error('Native storage load was not validated');
    const plan = planLegacyJsonImport({
        jsonAhead: state.jsonAhead,
        reconciled: state.reconciled,
        backupVersion: state.backupVersion,
        backupJson: state.backupPresent ? backup : null,
    }, loaded, await sqliteHasAnyData(sqlite));
    if (plan.merged && legacyImportMismatch(plan.merged, loaded)) {
        await adapter.saveData(plan.merged);
        const mismatch = legacyImportMismatch(plan.merged, await adapter.getData());
        if (mismatch) throw new Error(`Legacy import not confirmed: ${mismatch}`);
    }
    let rnState = 'unchanged';
    let rnFailure = '';
    if (plan.clearJsonAhead || plan.setReconciled) {
        try {
            checked(native().rnStateCommit(JSON.stringify({ clearJsonAhead: plan.clearJsonAhead, setReconciled: plan.setReconciled })));
            rnState = 'updated';
        } catch (error) {
            rnState = 'failed';
            rnFailure = error instanceof Error ? error.message : String(error);
        }
    }
    if (plan.outcome !== 'none') logLegacyImport(plan, rnState);
    if (rnState === 'failed') throw new Error(`Cannot update the previous app version's saved state: ${rnFailure}`);
};

const logLegacyImport = (plan: ReturnType<typeof planLegacyJsonImport>, rnState: string): void => {
    const ios = globalThis.__mindwtrHostPlatform === 'ios';
    const extra: Record<string, string> = {
        releaseCheck: ios ? 'v1.3.3/native-ios-legacy-json-import' : 'v1.3.3/native-android-legacy-json-import', outcome: plan.outcome, path: plan.path ?? '', rnState,
    };
    if (plan.reason) extra.reason = plan.reason;
    for (const [name, count] of Object.entries(plan.counts ?? {})) extra[name] = String(count);
    const meta = { scope: ios ? 'native-ios' : 'native-android', category: 'storage' as const, extra };
    try {
        const message = ios ? 'Native iOS legacy JSON import' : 'Native Android legacy JSON import';
        if (rnState === 'failed') logWarn(message, meta);
        else logInfo(message, meta);
    } catch { /* a diagnostic sink must not fail the boot */ }
};

// After a failed save the store holds changes that are not on disk. Reads
// wait for the exact retry, so no screen treats those changes as stored.
const requireSaved = () => {
    const failure = useTaskStore.getState().persistenceFailure;
    if (failure) throw new Error(`SAVE_FAILED: ${failure.message}`);
};

/** host-polyfills.js's secret calls (SecretStore.kt). */
type HostSecrets = {
    getSecret(key: string): Promise<string | null>;
    setSecret(key: string, value: string): Promise<void>;
    deleteSecret(key: string): Promise<void>;
};

/**
 * Debug builds only (CoreHost.netCheck): check-net-device.mjs's server at http://127.0.0.1:<port> (adb reverse). Core's
 * WebDAV calls (PUT, GET, HEAD, bytes both ways, MKCOL answered 409 then PROPFIND, a refused and a followed redirect,
 * DELETE, five damaged bodies), an abort, core's timeout, AbortSignal.timeout, and a secret round trip, each step's outcome
 * in the answer.
 * It touches no task data.
 */
const runNetCheck = async (port: string) => {
    if (!/^\d{4,5}$/.test(port)) throw new Error('INVALID_INPUT: net check port');
    const base = `http://127.0.0.1:${port}`;
    const steps: Record<string, { ok: boolean; value?: unknown; name?: string; error?: string; ms: number }> = {};
    const step = async (name: string, work: () => Promise<unknown>) => {
        const started = Date.now();
        try {
            steps[name] = { ok: true, value: await work(), ms: Date.now() - started };
        } catch (error) {
            steps[name] = {
                ok: false,
                name: error instanceof Error ? error.name : typeof error,
                error: error instanceof Error ? error.message : String(error),
                ms: Date.now() - started,
            };
        }
    };
    const doc = { check: 'net', text: 'Grüße ✓ 😀' };
    await step('put', async () => (await webdavPutJson(`${base}/dav/data.json`, doc)).etag);
    await step('get', () => webdavGetJson(`${base}/dav/data.json`));
    await step('head', async () => (await webdavHeadFile(`${base}/dav/data.json`)).contentLength);
    await step('putBytes', () => webdavPutFile(`${base}/dav/bytes.bin`, Uint8Array.from({ length: 256 }, (_, i) => i), 'application/octet-stream'));
    await step('getBytes', async () => new Uint8Array(await webdavGetFile(`${base}/dav/bytes.bin`)).every((value, i) => value === i));
    await step('mkcol', () => webdavMakeDirectory(`${base}/dav/folder`));
    await step('redirectPut', () => webdavPutJson(`${base}/dav/redirect.json`, doc));
    await step('redirectGet', () => webdavGetJson(`${base}/dav/moved.json`));
    await step('delete', () => webdavDeleteFile(`${base}/dav/data.json`));
    // A HEAD answered with `Content-Encoding: gzip` has no body to decode (cloud's HEAD lets OkHttp ask for gzip).
    await step('headGzipDav', async () => (await webdavHeadFile(`${base}/gz/data.json`)).etag);
    await step('headGzipCloud', async () => (await cloudHeadJson(`${base}/gz/data.json`)).etag);
    // Truncation: a body cut short, reset mid-chunk, over the size limit (declared or streamed), or a broken gzip stream.
    // Core's sync document read must throw: an empty or partial body would read as a missing remote, which sync writes over.
    // A body that is not UTF-8 must throw too, not read as other text (E2 alone once read as a space, so an empty body).
    for (const cut of ['half', 'reset', 'oversize', 'stream', 'gzip', 'utf8']) await step(`cut-${cut}`, () => webdavGetSyncDocument(`${base}/cut/${cut}.json`));
    await step('abort', () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 500);
        return webdavGetJson(`${base}/slow/abort`, { signal: controller.signal });
    });
    // An abort after the headers arrived, while the body is still coming: the host must still cancel the request.
    await step('abortBody', () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 500);
        return webdavGetJson(`${base}/slow/body`, { signal: controller.signal });
    });
    await step('timeout', () => webdavGetJson(`${base}/slow/timeout`, { timeoutMs: 1500 }));
    await step('signalTimeout', () => fetch(`${base}/slow/signal`, { signal: AbortSignal.timeout(1000) }));
    const secrets = globalThis.__mindwtrSecrets as HostSecrets;
    const key = 'mindwtr_native_net_check';
    await step('secretSet', () => secrets.setSecret(key, doc.text));
    await step('secretGet', () => secrets.getSecret(key));
    // The server reads the app's SecureStore file (adb run-as) while the secret is saved, then answers.
    await step('secretStored', async () => (await fetch(`${base}/secret-stored`)).json());
    await step('secretDelete', () => secrets.deleteSecret(key));
    await step('secretGone', () => secrets.getSecret(key));
    return steps;
};

/**
 * Debug builds only (CoreHost.netCheck): an operation that outlives its deadline. A GET the server never answers, sent
 * without the operation's signal so only the host's cancel stops it; then a write, which the host must refuse while the
 * operation drains. In `stuck` mode it also waits on a timer longer than the drain, so the host must stop instead.
 * The outcome is logged here: the host reports only that the operation timed out.
 */
const runNetDeadline = async (port: string, mode: string, signal: AbortSignal) => {
    if (!/^\d{4,5}$/.test(port) || !['drain', 'stuck'].includes(mode)) throw new Error('INVALID_INPUT: net deadline');
    const base = `http://127.0.0.1:${port}`;
    const events: string[] = [];
    signal.addEventListener('abort', () => events.push('signal'));
    try {
        await fetch(`${base}/slow/deadline-${mode}`);
        events.push('answered');
    } catch (error) {
        events.push(`fetch:${(error as Error).name}`);
    }
    if (mode === 'stuck') await new Promise((done) => setTimeout(done, 15_000));
    try {
        await fetch(`${base}/dav/after-${mode}.json`, { method: 'PUT', body: '{}' });
        events.push('written');
    } catch (error) {
        events.push(`write:${(error as Error).name}`);
    }
    native().log(`Native Android net deadline ${mode} events=${JSON.stringify(events)}`);
    return events;
};

type Reply = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
/** What an entry point opened, by kind only: never its URL, route text, or shared text. */
const logEntryPoint = (input: { kind?: unknown }, result: Reply): Reply => {
    const entry = result.ok ? result.value as { route: string | null; taskId: string | null; projectId: string | null; search: unknown; capture: unknown; notice: unknown } : null;
    const outcome = !entry ? 'refused' : entry.capture ? 'capture' : entry.notice ? 'notice' : entry.taskId ? 'task' : entry.projectId ? 'project'
        : entry.search ? 'search' : entry.route ? 'screen' : 'nothing';
    const kind = ['link', 'share', 'createNote'].includes(input?.kind as string) ? input.kind as string : 'other';
    try {
        logInfo('Native Android entry point', { scope: 'native-android', extra: { releaseCheck: 'v1.3.3/native-android-entry-point', kind, outcome } });
    } catch { /* a diagnostic sink must not change what the entry opens */ }
    return result;
};
/**
 * The Menu tab's reads (native-host-contract-menu-views.ts; History's tabs, Archive, Contexts and Trash from the list views
 * block; the Review screen and the Weekly and Daily Review from native-host-contract-review-views.ts; the Calendar and the
 * Board from native-host-contract-calendar.ts and native-host-contract-board.ts; Settings from native-host-contract-settings.ts):
 * each passes Kotlin's input to the contract method unchanged. The composer's open and edit write nothing, so they are reads.
 */
const MENU_READS: Record<string, (input: never) => Reply> = {
    more: () => contract.getMoreMenu(),
    projects: (input) => contract.getFilteredProjects(input),
    projectDetailView: (input) => contract.getProjectDetailView(input),
    projectTaskOrderView: (input) => contract.getProjectTaskOrderView(input),
    projectDetailFilterView: (input) => contract.getProjectDetailFilterView(input),
    projectDetailFilterOptions: (input) => contract.getProjectDetailFilterOptions(input),
    waiting: (input) => contract.getWaitingView(input),
    someday: (input) => contract.getSomedayView(input),
    reference: (input) => contract.getReferenceView(input),
    done: (input) => contract.getDoneView(input),
    collection: (input) => contract.getMenuViewCollection(input),
    moveDialog: (input) => contract.getSomedayMoveDialog(input),
    history: (input) => contract.getHistoryView(input),
    archive: (input) => contract.getArchiveView(input),
    contexts: (input) => contract.getContextsView(input),
    trash: (input) => contract.getTrashView(input),
    review: (input) => contract.getReviewOverview(input),
    reviewOverview: (input) => contract.getReviewOverview(input),
    weekly: (input) => contract.getWeeklyReview(input),
    weeklyReview: (input) => contract.getWeeklyReview(input),
    weeklyList: (input) => contract.getWeeklyReviewList(input),
    weeklyReviewList: (input) => contract.getWeeklyReviewList(input),
    daily: (input) => contract.getDailyReview(input),
    dailyReview: (input) => contract.getDailyReview(input),
    calendar: (input) => contract.getCalendarView(input),
    calendarSheet: (input) => contract.getCalendarItemSheet(input),
    calendarItem: (input) => contract.getCalendarItemSheet(input),
    calendarComposer: (input) => contract.openCalendarComposer(input),
    calendarEdit: (input) => contract.editCalendarComposer(input),
    calendarPreferences: () => contract.getCalendarPreferences(),
    board: (input) => contract.getBoardView(input),
    boardList: (input) => contract.getBoardList(input),
    // The Inbox tab and its filter sheet's tokens, Archive's tokens, a list's selection mode, and Focus's sheet lists.
    inbox: (input) => contract.getInboxView(input),
    inboxTokens: (input) => contract.getInboxFilterTokens(input),
    archiveTokens: (input) => contract.getArchiveFilterTokens(input),
    bulk: (input) => contract.getBulkActions(input),
    focus: (input) => contract.getFocus(input),
    focusSection: (input) => contract.getFocusSectionWindow(input),
    focusList: (input) => contract.getFocusControlsList(input),
    focusControls: (input) => contract.getFocusControlsList(input),
    // Settings (native-host-contract-settings.ts): the menu, General, GTD, Manage and its lists, and Manage's Someday sections.
    settingsMenu: (input) => contract.getSettingsMenu(input),
    generalSettings: (input) => contract.getGeneralSettings(input),
    gtdSettings: (input) => contract.getGtdSettings(input),
    manageSettings: (input) => contract.getManageSettings(input),
    manageList: (input) => contract.getManageSettingsList(input),
    manageCheck: (input) => contract.checkManageEditor(input),
    somedaySections: (input) => contract.getSomedaySections(input),
    // Mind Sweep and a saved search's screen.
    mindSweep: (input) => contract.getMindSweep(input),
    savedSearch: (input) => contract.getSavedSearchView(input),
    // A link, text share or assistant note (native-host-contract-entry-points.ts), and the capture popup's Import .txt.
    entryPoint: (input) => logEntryPoint(input, contract.resolveNativeEntryPoint(input)),
    captureImport: (input) => contract.planQuickCaptureImport(input),
};
/** The Menu tab's commands, by their diagnostic operation: each passes Kotlin's input (its request or capture UUID included) unchanged. */
const MENU_COMMANDS: Record<MenuCommand, (input: never) => Promise<Reply>> = {
    activateProject: (input) => contract.activateProject(input),
    somedayMove: (input) => contract.moveSomedayTasksToSection(input),
    somedayUndo: (input) => contract.undoSomedaySectionMove(input),
    somedayTask: (input) => contract.addSomedaySectionTask(input),
    somedaySection: (input) => contract.createSomedaySection(input),
    taskListSort: (input) => contract.setTaskListSort(input),
    archiveAction: (input) => contract.runArchiveAction(input),
    contextsAction: (input) => contract.runContextsAction(input),
    trashAction: (input) => contract.runTrashAction(input),
    reviewAction: (input) => contract.runReviewAction(input),
    // The Weekly Review's project Add task: runReviewAction too, logged apart because its request is kept on disk.
    reviewTask: (input) => contract.runReviewAction(input),
    // The Calendar's and the Board's actions; a create (a composer save, a Duplicate) is logged apart because its request is kept on disk.
    calendarAction: (input) => contract.runCalendarAction(input),
    calendarCreate: (input) => contract.runCalendarAction(input),
    boardAction: (input) => contract.runBoardAction(input),
    boardCreate: (input) => contract.runBoardAction(input),
    // A list's bulk bar (its delete's Undo too), and Focus's View options grouping, saved filters and Today's Focus order.
    bulkAction: (input) => contract.runBulkAction(input),
    focusGroup: (input) => contract.setFocusGroupBy(input),
    focusSave: (input) => contract.saveFocusFilter(input),
    focusCriterion: (input) => contract.removeFocusFilterCriterion(input),
    focusDelete: (input) => contract.deleteFocusFilter(input),
    focusReorder: (input) => contract.reorderFocus(input),
    // Bulk organize's new project or area, Mind Sweep's Add, and a saved search's Delete.
    bulkCreate: (input) => contract.createBulkOrganizeDestination(input),
    mindSweepAdd: (input) => contract.addMindSweepItem(input),
    savedSearchDelete: (input) => contract.deleteSavedSearch(input),
    // Settings: General's and GTD's controls, Manage's editor Save and Delete, and Manage's Someday section rename, reorder and delete.
    generalSetting: (input) => contract.setGeneralSetting(input),
    gtdSetting: (input) => contract.setGtdSetting(input),
    manageEditor: (input) => contract.saveManageEditor(input),
    manageDelete: (input) => contract.deleteManageItem(input),
    somedayRename: (input) => contract.renameSomedaySection(input),
    somedayReorder: (input) => contract.reorderSomedaySections(input),
    somedayDelete: (input) => contract.deleteSomedaySection(input),
};

let bootAdapter: ValidatedSqliteAdapter | null = null;
const activateAndVerify = async (adapter: ValidatedSqliteAdapter, recoveryLoad = false) => {
    unwrap(await contract.activate(recoveryLoad ? { writeSafetyReady: true, recoveryLoad: true } : { writeSafetyReady: true }));
    await flushPendingSave();
    const data = await adapter.getData();
    const loaded = useTaskStore.getState();
    for (const [table, storeRows] of [
        ['tasks', loaded._allTasks], ['projects', loaded._allProjects],
        ['sections', loaded._allSections], ['areas', loaded._allAreas],
        ['people', loaded._allPeople],
    ] as const) {
        if (storeRows.length !== data[table].length) throw new Error(`Incomplete ${table} activation`);
    }
    return unwrap(contract.getInboxWindow({ offset: 0, limit: 50 }));
};
const boot = (legacyState: string, legacyBackup: string, recoveryLoad = false): string => submit(async () => {
    const adapter = new ValidatedSqliteAdapter(sqlite, { rejectConcurrentWrites: true });
    // Schema setup may write only after the native host's validated checkpoint.
    setStorageAdapter(adapter);
    await adapter.getData();
    if (legacyState) await importLegacyJson(adapter, JSON.parse(legacyState) as LegacyState, legacyBackup);
    const result = await activateAndVerify(adapter, recoveryLoad);
    bootAdapter = adapter;
    return result;
});

globalThis.MindwtrHost = {
    /** Read-only upgrade preflight, before the native host opens SQLite. */
    legacyCheck(legacyState: string, legacyBackup: string): string {
        return submit(async () => {
            const state = JSON.parse(legacyState) as LegacyState;
            assertNativeLegacyBackupSafe({ jsonAhead: state.jsonAhead, backupJson: state.backupPresent ? legacyBackup : null });
            return null;
        });
    },
    poll(idText: string): string | null {
        const id = Number(idText);
        const slot = pending.get(id);
        if (!slot?.done) return null;
        pending.delete(id);
        return JSON.stringify(slot.error === undefined
            ? { ok: true, value: slot.value }
            : { ok: false, error: slot.error });
    },
    /** `legacyState` is "" for the dev database; else LegacyRnStoreGuard's reading of RN's AsyncStorage. */
    boot(legacyState: string, legacyBackup: string): string {
        return boot(legacyState, legacyBackup);
    },
    /** Private iOS journal recovery: no dynamic load maintenance before exact replay. */
    bootRecovery(legacyState: string, legacyBackup: string): string {
        return boot(legacyState, legacyBackup, true);
    },
    /** The native host calls this after durable journal cleanup, before exposing the UI. */
    resumeActivation(): string {
        return submit(async () => {
            if (!bootAdapter) throw new Error('Native recovery adapter unavailable');
            return activateAndVerify(bootAdapter);
        });
    },
    window(offset: number, limit: number, revision: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getInboxWindow({ offset, limit, revision: revision || undefined }));
        });
    },
    /** The RN Inbox screen model: core owns the toolbar, scope, empty state and rows. */
    inboxView(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getInboxView(JSON.parse(json)));
        });
    },
    /**
     * `controls` is the control state Kotlin keeps and `controlEdit` a control's edit, as JSON; "" leaves either out, so a read
     * that sends neither keeps the flat Focus it always had.
     */
    focus(limit: number, controls = '', controlEdit = ''): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getFocus({ limit, ...(controls ? { controls: JSON.parse(controls) } : {}), ...(controlEdit ? { controlEdit: JSON.parse(controlEdit) } : {}) }));
        });
    },
    /** Core checks `key` and refuses a stale `revision`; Kotlin then reads Focus again from offset 0. `controls` as for focus. */
    focusWindow(key: string, offset: number, limit: number, revision: string, controls = ''): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getFocusSectionWindow({ key: key as FocusTaskSectionKey, offset, limit, revision, ...(controls ? { controls: JSON.parse(controls) } : {}) }));
        });
    },
    /** The task's View tab; core formats its fields, Markdown and checklist windows. */
    taskView(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getTaskView(JSON.parse(json)));
        });
    },
    editorModel(id: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getTaskEditorModel({ id }));
        });
    },
    destinationPicker(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getTaskDraftDestinationPicker(JSON.parse(json)));
        });
    },
    /** The checklist and live attachment titles of core's getTask, which the editor shows read-only. */
    editorContent(id: string): string {
        return submit(async () => {
            requireSaved();
            const task = unwrap(contract.getTask({ id }));
            return {
                checklist: (task.checklist ?? []).map(({ title, isCompleted }) => ({ title, isCompleted: isCompleted === true })),
                attachments: (task.attachments ?? []).filter((attachment) => !attachment.deletedAt).map((attachment) => attachment.title),
            };
        });
    },
    /** `json` is `{ id, draft, checklist, edit? }`, passed to core's editTaskChecklist unchanged: one checklist edit on the draft. Nothing is written. */
    editChecklist(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.editTaskChecklist(JSON.parse(json)));
        });
    },
    /** `json` is `{ id, requestId }`: RN's Reset checklist, written at once. A repeat of the request after a failed save only finishes it. */
    resetChecklist(json: string): string {
        return submit(async () => taskResult('resetChecklist', await contract.resetTaskChecklist(JSON.parse(json))));
    },
    /** `json` is `{ id, draft, edit? }`, passed to core's editTaskDraft unchanged: the model for the edited draft. */
    editDraft(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.editTaskDraft(JSON.parse(json)));
        });
    },
    /** Core's suggestions for the whole text of a context, tag, or person input. */
    editorSuggestions(id: string, field: string, query: string, limit: number): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getTaskEditorSuggestions({ id, field: field as 'contexts' | 'tags' | 'assignedTo', query, limit }));
        });
    },
    /** Core's setLanguage. "" is no stored language. Labels are not stored data, so no failed save blocks them. */
    language(stored: string, system: string): string {
        return submit(async () => unwrap(await contract.setLanguage({ storedLanguage: stored || null, systemLocale: system || null })));
    },
    /** `keysJson` is a JSON array of core i18n keys. */
    strings(keysJson: string): string {
        return submit(async () => unwrap(contract.getStrings({ keys: JSON.parse(keysJson) as string[] })));
    },
    /**
     * The React Native app's theme, resolved as its theme-context.tsx does: the synced
     * `settings.theme` wins, then RN's device-local `@mindwtr_theme` ([stored], "" for none),
     * then the system. Core classifies the mode and owns the status and priority hues;
     * Kotlin holds only the mobile palettes. Cosmetic, so no failed save blocks it.
     */
    theme(stored: string): string {
        return submit(async () => {
            const synced = useTaskStore.getState().settings?.theme;
            const mode = typeof synced === 'string' && synced ? synced : (stored || 'system');
            const descriptor = themeDescriptor(mode);
            const preset = descriptor?.statusPreset ?? null;
            const lightPreset = resolveThemeStatusPreset(mode as AppTheme, 'light');
            const darkPreset = resolveThemeStatusPreset(mode as AppTheme, 'dark');
            return {
                mode,
                preset: preset ?? 'default',
                presets: {
                    light: lightPreset ?? 'default',
                    dark: darkPreset ?? 'default',
                },
                material: mode === 'material3-light' || mode === 'material3-dark',
                scheme: descriptor?.scheme === 'system' ? null : descriptor?.scheme ?? null,
                // Core's status palettes ({ bg, text, border } per status): RN's badges, glyphs, and Done swipe.
                status: {
                    light: STATUS_COLORS_BY_THEME[lightPreset ?? 'light'],
                    dark: STATUS_COLORS_BY_THEME[darkPreset ?? 'dark'],
                },
                priority: TASK_PRIORITY_COLORS,
            };
        });
    },
    /**
     * RN's app lock gate: core's General row for it, whose `value` is `settings.security.mobileAppLockEnabled` (per device).
     * The gate guards the screens and shows no stored data, so no failed save blocks it: a lock turned on whose save is owed
     * still locks.
     */
    appLock(): string {
        return submit(async () => unwrap(contract.getGeneralSettings({})).privacy.appLock);
    },
    projects(): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjects());
        });
    },
    /** Native Projects quick-add choices, including the current Area filter default. */
    projectCreateOptions(): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectCreateOptions());
        });
    },
    projectCreateRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.projectCreateRetryOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation; the host journals the exact envelope before commit. */
    projectCreatePrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectCreate(JSON.parse(json)));
        });
    },
    /** Pure validation also runs during cold recovery before SQLite is opened. */
    projectCreateValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectCreate(JSON.parse(json))));
    },
    projectCreateCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectCreate(JSON.parse(json))));
    },
    projectSectionOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectSectionOptions(JSON.parse(json)));
        });
    },
    projectSectionCreateRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectSectionCreateOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectSectionCreatePrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectSectionCreate(JSON.parse(json)));
        });
    },
    projectSectionCreateValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectSectionCreate(JSON.parse(json))));
    },
    projectSectionCreateCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectSectionCreate(JSON.parse(json))));
    },
    projectSectionRenameOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectSectionRenameOptions(JSON.parse(json)));
        });
    },
    projectSectionRenameRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectSectionRenameOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectSectionRenamePrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectSectionRename(JSON.parse(json)));
        });
    },
    projectSectionRenameValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectSectionRename(JSON.parse(json))));
    },
    projectSectionRenameCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectSectionRename(JSON.parse(json))));
    },
    projectSectionDeleteOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectSectionDeleteOptions(JSON.parse(json)));
        });
    },
    projectSectionDeleteRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectSectionDeleteOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectSectionDeletePrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectSectionDelete(JSON.parse(json)));
        });
    },
    projectSectionDeleteValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectSectionDelete(JSON.parse(json))));
    },
    projectSectionDeleteCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectSectionDelete(JSON.parse(json))));
    },
    projectSectionOrderOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectSectionOrderOptions(JSON.parse(json)));
        });
    },
    projectSectionOrderRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectSectionOrderOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectSectionOrderPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectSectionOrder(JSON.parse(json)));
        });
    },
    projectSectionOrderValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectSectionOrder(JSON.parse(json))));
    },
    projectSectionOrderCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectSectionOrder(JSON.parse(json))));
    },
    areaCreateOptions(): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getAreaCreateOptions());
        });
    },
    areaCreateResolve(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.resolveAreaCreateName(JSON.parse(json)));
        });
    },
    areaCreateRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeAreaCreateOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    areaCreatePrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareAreaCreate(JSON.parse(json)));
        });
    },
    areaCreateValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedAreaCreate(JSON.parse(json))));
    },
    areaCreateCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedAreaCreate(JSON.parse(json))));
    },
    areaColorOptions(): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getAreaColorOptions());
        });
    },
    areaColorRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeAreaColorOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    areaColorPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareAreaColor(JSON.parse(json)));
        });
    },
    areaColorValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedAreaColor(JSON.parse(json))));
    },
    areaColorCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedAreaColor(JSON.parse(json))));
    },
    areaRenameRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeAreaRenameOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    areaRenamePrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareAreaRename(JSON.parse(json)));
        });
    },
    areaRenameValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedAreaRename(JSON.parse(json))));
    },
    areaRenameCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedAreaRename(JSON.parse(json))));
    },
    areaOrderOptions(): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getAreaOrderOptions());
        });
    },
    areaOrderRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeAreaOrderOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    areaOrderPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareAreaOrder(JSON.parse(json)));
        });
    },
    areaOrderValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedAreaOrder(JSON.parse(json))));
    },
    areaOrderCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedAreaOrder(JSON.parse(json))));
    },
    areaDeleteOptions(): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getAreaDeleteOptions());
        });
    },
    areaDeleteRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeAreaDeleteOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    areaDeletePrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareAreaDelete(JSON.parse(json)));
        });
    },
    areaDeleteValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedAreaDelete(JSON.parse(json))));
    },
    areaDeleteCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedAreaDelete(JSON.parse(json))));
    },
    taskListSortOptions(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(contract.getTaskListSortOptions(JSON.parse(json))); });
    },
    taskListSortValidate(json: string): string {
        return submit(async () => unwrap(contract.validateTaskListSortWrite(JSON.parse(json))));
    },
    taskListSortWrite(json: string): string {
        return submit(async () => unwrap(await contract.setTaskListSortChecked(JSON.parse(json))));
    },
    taskListSortRetryOutcome(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(contract.probeTaskListSortOutcome(JSON.parse(json))); });
    },
    focusGroupOptions(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(contract.getFocusGroupOptions(JSON.parse(json))); });
    },
    focusGroupValidate(json: string): string {
        return submit(async () => unwrap(contract.validateFocusGroupWrite(JSON.parse(json))));
    },
    /** Exact scalar intent; the iOS host journals before dispatch. */
    focusGroupWrite(json: string): string {
        return submit(async () => unwrap(await contract.setFocusGroupChecked(JSON.parse(json))));
    },
    focusGroupRetryOutcome(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(contract.probeFocusGroupOutcome(JSON.parse(json))); });
    },
    projectFocusOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectFocusOptions(JSON.parse(json)));
        });
    },
    projectFocusRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectFocusOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectFocusPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectFocus(JSON.parse(json)));
        });
    },
    projectFocusValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectFocus(JSON.parse(json))));
    },
    projectFocusCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectFocus(JSON.parse(json))));
    },
    taskFocusOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getTaskFocusOptions(JSON.parse(json)));
        });
    },
    taskFocusWrite(_json: string): string {
        return submit(async () => { throw new Error('INVALID_INPUT: Task Focus writes require a durable host journal'); });
    },
    taskFocusRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeTaskFocusOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    taskFocusPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareTaskFocus(JSON.parse(json)));
        });
    },
    taskFocusValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedTaskFocus(JSON.parse(json))));
    },
    taskFocusCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedTaskFocus(JSON.parse(json))));
    },
    projectRenameOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectRenameOptions(JSON.parse(json)));
        });
    },
    projectRenameRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectRenameOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectRenamePrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectRename(JSON.parse(json)));
        });
    },
    projectRenameValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectRename(JSON.parse(json))));
    },
    projectRenameCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectRename(JSON.parse(json))));
    },
    projectFlowOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectFlowOptions(JSON.parse(json)));
        });
    },
    projectFlowRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectFlowOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectFlowPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectFlow(JSON.parse(json)));
        });
    },
    projectFlowValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectFlow(JSON.parse(json))));
    },
    projectFlowCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectFlow(JSON.parse(json))));
    },
    projectTaskSortOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectTaskSortOptions(JSON.parse(json)));
        });
    },
    projectTaskSortWrite(_json: string): string {
        return submit(async () => { throw new Error('INVALID_INPUT: Project task sort writes require a durable host journal'); });
    },
    projectTaskSortRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectTaskSortOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectTaskSortPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectTaskSort(JSON.parse(json)));
        });
    },
    projectTaskSortValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectTaskSort(JSON.parse(json))));
    },
    projectTaskSortCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectTaskSort(JSON.parse(json))));
    },
    focusSavedFilterOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getFocusSavedFilterOptions(JSON.parse(json)));
        });
    },
    focusSavedFilterWrite(_json: string): string {
        return submit(async () => { throw new Error('INVALID_INPUT: Focus saved filter writes require a durable host journal'); });
    },
    focusSavedFilterRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeFocusSavedFilterOutcome(JSON.parse(json)));
        });
    },
    focusSavedFilterPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareFocusSavedFilter(JSON.parse(json)));
        });
    },
    focusSavedFilterValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedFocusSavedFilter(JSON.parse(json))));
    },
    focusSavedFilterCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedFocusSavedFilter(JSON.parse(json))));
    },
    focusOrderOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getFocusOrderOptions(JSON.parse(json)));
        });
    },
    focusOrderWrite(_json: string): string {
        return submit(async () => { throw new Error('INVALID_INPUT: Focus order writes require a durable host journal'); });
    },
    focusOrderRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeFocusOrderOutcome(JSON.parse(json)));
        });
    },
    focusOrderPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareFocusOrder(JSON.parse(json)));
        });
    },
    focusOrderValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedFocusOrder(JSON.parse(json))));
    },
    focusOrderCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedFocusOrder(JSON.parse(json))));
    },
    projectTaskOrderWrite(_json: string): string {
        return submit(async () => { throw new Error('INVALID_INPUT: Project task order writes require a durable host journal'); });
    },
    projectTaskOrderRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectTaskOrderOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectTaskOrderPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectTaskOrder(JSON.parse(json)));
        });
    },
    projectTaskOrderValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectTaskOrder(JSON.parse(json))));
    },
    projectTaskOrderCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectTaskOrder(JSON.parse(json))));
    },
    projectNotesEditOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectNotesEditOptions(JSON.parse(json)));
        });
    },
    projectNotesDraftDirection(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectNotesDraftDirection(JSON.parse(json)));
        });
    },
    projectNotesWriteRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectNotesWriteOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectNotesWritePrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectNotesWrite(JSON.parse(json)));
        });
    },
    projectNotesWriteValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectNotesWrite(JSON.parse(json))));
    },
    projectNotesWriteCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectNotesWrite(JSON.parse(json))));
    },
    projectTagsEditOptions(id: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectTagsEditOptions({ projectId: id }));
        });
    },
    projectTagsWriteRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectTagsWriteOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectTagsWritePrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectTagsWrite(JSON.parse(json)));
        });
    },
    projectTagsWriteValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectTagsWrite(JSON.parse(json))));
    },
    projectTagsWriteCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectTagsWrite(JSON.parse(json))));
    },
    projectStatusOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectStatusOptions(JSON.parse(json)));
        });
    },
    projectStatusRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectStatusOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectStatusPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectStatus(JSON.parse(json)));
        });
    },
    projectStatusValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectStatus(JSON.parse(json))));
    },
    projectStatusCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectStatus(JSON.parse(json))));
    },
    projectDateOptions(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectDateOptions(JSON.parse(json)));
        });
    },
    projectDateRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectDateOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectDatePrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectDate(JSON.parse(json)));
        });
    },
    projectDateValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectDate(JSON.parse(json))));
    },
    projectDateCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectDate(JSON.parse(json))));
    },
    projectAreaOptions(id: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectAreaOptions({ projectId: id }));
        });
    },
    projectAreaRetryOutcome(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.probeProjectAreaOutcome(JSON.parse(json)));
        });
    },
    /** Private iOS preparation and commit; Swift owns the durable journal. */
    projectAreaPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareProjectArea(JSON.parse(json)));
        });
    },
    projectAreaValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedProjectArea(JSON.parse(json))));
    },
    projectAreaCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedProjectArea(JSON.parse(json))));
    },
    /** Core refuses a stale `revision`; Kotlin then reads the project again from offset 0. */
    projectDetail(id: string, offset: number, limit: number, revision: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectDetail({ projectId: id, offset, limit, revision: revision || undefined }));
        });
    },
    projectNotes(id: string, offset: number, limit: number, revision: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getProjectNotes({ projectId: id, offset, limit, revision: revision || undefined }));
        });
    },
    /** `json` is `{ id, base, patch }`, passed to core unchanged: the status menu and the Restore and Next swipes. */
    update(json: string): string {
        return submit(async () => taskResult('update', await contract.updateTask(JSON.parse(json))));
    },
    /** `json` is the editor's `{ id, base, patch, checklist? }` (draft fields and the edited checklist), passed to core's saveTaskDraft unchanged. */
    saveDraft(json: string): string {
        return submit(async () => taskResult('saveTaskDraft', await contract.saveTaskDraft(JSON.parse(json))));
    },
    /** One static Calendar preference intent; exact before/desired values survive journal replay. */
    calendarPreference(json: string): string {
        return submit(async () => unwrap(await contract.setCalendarPreference(JSON.parse(json))));
    },
    /** Read-only RN Calendar composer transport. */
    calendarComposerOpen(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(contract.openCalendarComposer(JSON.parse(json))); });
    },
    calendarComposerEdit(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(contract.editCalendarComposer(JSON.parse(json))); });
    },
    /** Private pure preparation, persisted by the iOS host before any task write. */
    calendarComposerPrepare(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(await contract.prepareCalendarComposerSave(JSON.parse(json))); });
    },
    /** Private immutable authority check; safe before boot and terminal cleanup. */
    calendarComposerValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedCalendarComposerSave(JSON.parse(json))));
    },
    calendarComposerCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedCalendarComposerSave(JSON.parse(json))));
    },
    /** New Calendar task/project is one frozen, atomic publication. */
    calendarComposerCreatePrepare(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(await contract.prepareCalendarComposerCreate(JSON.parse(json))); });
    },
    calendarComposerCreateValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedCalendarComposerCreate(JSON.parse(json))));
    },
    calendarComposerCreateCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedCalendarComposerCreate(JSON.parse(json))));
    },
    /** Private native Board preparation: no store writes before the host journals it. */
    boardPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareBoardAction(JSON.parse(json)));
        });
    },
    /** Private immutable journal check; safe before boot and during terminal cleanup. */
    boardValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedBoardAction(JSON.parse(json))));
    },
    /** Only the exact frozen Trash/Duplicate envelope is replayable. */
    boardCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedBoardAction(JSON.parse(json))));
    },
    /** Private native date preparation freezes raw schedule changes before journaling. */
    draftPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareTaskDraftSave(JSON.parse(json)));
        });
    },
    /** Commit only the exact prepared date envelope; recovery never prepares again. */
    draftCommit(json: string): string {
        return submit(async () => taskResult('saveTaskDraft', await contract.commitPreparedTaskDraftSave(JSON.parse(json))));
    },
    /** Pure checklist edit and field model; only the host's prepared save writes. */
    checklistEdit(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(contract.editTaskChecklist(JSON.parse(json))); });
    },
    checklistSavePrepare(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(await contract.prepareTaskChecklistSave(JSON.parse(json))); });
    },
    checklistResetPrepare(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(await contract.prepareTaskChecklistReset(JSON.parse(json))); });
    },
    checklistPreparedValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedTaskChecklistWrite(JSON.parse(json))));
    },
    checklistPreparedCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedTaskChecklistWrite(JSON.parse(json))));
    },
    /** The capture popup (RN's quick capture sheet): an empty draft with the starting options. */
    captureOpen(): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.openQuickCapture());
        });
    },
    /** `json` is `{ text, options, picker? }`, passed to core unchanged. */
    captureView(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getQuickCaptureView(JSON.parse(json)));
        });
    },
    /** `json` is `{ text, options, edit, picker? }`: one control's edit. Nothing is written. */
    captureEdit(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.editQuickCapture(JSON.parse(json)));
        });
    },
    /** `json` is `{ text, options, captureId, openAfterSave }`. Reusing captureId retries: the draft is written at most once. */
    captureSubmit(json: string): string {
        return submit(async () => taskResult('quickCapture', await contract.submitQuickCapture(JSON.parse(json))));
    },
    /** Read-only final creation rows; native journals this result before commit. */
    capturePrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.prepareQuickCapture(JSON.parse(json)));
        });
    },
    /** The exact prepared journal; retries never reparse text or current defaults. */
    captureCommit(json: string): string {
        return submit(async () => taskResult('quickCapture', await contract.commitPreparedQuickCapture(JSON.parse(json))));
    },
    /** Mind Sweep guide and its literal one-task Inbox add. The iOS host journals preparation before commit. */
    mindSweepGuide(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(contract.getMindSweepGuide(JSON.parse(json))); });
    },
    mindSweepPrepare(json: string): string {
        return submit(async () => { requireSaved(); return unwrap(contract.prepareMindSweepAdd(JSON.parse(json))); });
    },
    mindSweepValidate(json: string): string {
        return submit(async () => unwrap(contract.validatePreparedMindSweepAdd(JSON.parse(json))));
    },
    mindSweepCommit(json: string): string {
        return submit(async () => unwrap(await contract.commitPreparedMindSweepAdd(JSON.parse(json))));
    },
    /** The recovery snapshot before a several-lines capture; `{ snapshot: null }` in sandbox mode. */
    captureSnapshot(): string {
        return submit(async () => ({ snapshot: unwrap(await contract.createQuickCaptureSnapshot()) }));
    },
    /** `json` is `{ text, options, captureIds, snapshotFileName }`: one task per line, in one write. */
    captureLines(json: string): string {
        return submit(async () => taskResult('quickCaptureLines', await contract.submitQuickCaptureLines(JSON.parse(json))));
    },
    /** `json` is `{ picker, query, text, options, requestId }`: the project or area picker's search, chosen or created. */
    capturePicker(json: string): string {
        return submit(async () => taskResult('quickCapturePicker', await contract.submitQuickCapturePickerQuery(JSON.parse(json))));
    },
    complete(id: string): string {
        return submit(async () => taskResult('complete', await contract.completeTask({ id })));
    },
    /** A target state, so an exact retry re-sends the same target. A `{ blocked }` reply wrote nothing. */
    taskFocus(id: string, focused: boolean): string {
        return submit(async () => taskResult('taskFocus', await contract.setTaskFocus({ id, focused })));
    },
    projectFocus(id: string, focused: boolean): string {
        return submit(async () => taskResult('projectFocus', await contract.setProjectFocus({ id, focused })));
    },
    /** `areaId` "" is no area. Core dedupes a retry by `requestId` within this process. */
    createProject(title: string, areaId: string, requestId: string): string {
        return submit(async () => taskResult('createProject', await contract.createProject({ title, areaId: areaId || null, requestId })));
    },
    areaFilter(): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getAreaFilter());
        });
    },
    /** `json` is one of getAreaFilter's `next` selections, passed to core unchanged. */
    setAreaFilter(json: string): string {
        return submit(async () => taskResult('areaFilter', await contract.setAreaFilter(JSON.parse(json))));
    },
    /**
     * `json` is `{ query, filters, limit }`, passed to core's searchTasks unchanged; the reply echoes the trimmed query.
     * `filters: null` (the screen before any filter change) is core's DEFAULT_GLOBAL_SEARCH_FILTERS.
     */
    search(json: string): string {
        return submit(async () => {
            requireSaved();
            const input = JSON.parse(json);
            return unwrap(await contract.searchTasks({ ...input, filters: input.filters ?? DEFAULT_GLOBAL_SEARCH_FILTERS }));
        });
    },
    /** `json` is `{ query, name, requestId }`. Core saves one search per query, so a retry never adds a second. */
    saveSearch(json: string): string {
        return submit(async () => taskResult('saveSearch', await contract.saveSearch(JSON.parse(json))));
    },
    /** Core's startInboxProcessing in RN's per-device mode ('guided' or 'quick'). */
    inboxStart(mode: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.startInboxProcessing({ mode: mode as 'guided' | 'quick' }));
        });
    },
    /** `json` is `{ sessionId, taskId, step, edit?, mode? }`: one control's edit, passed to core unchanged. */
    inboxStep(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.getInboxProcessingStep(JSON.parse(json)));
        });
    },
    /** `json` is `{ sessionId, taskId, step, decision, requestId }`. Core answers a repeated request without writing again. */
    inboxCommit(json: string): string {
        return submit(async () => taskResult('inboxCommit', await contract.commitInboxProcessingStep(JSON.parse(json))));
    },
    /** `json` is `{ sessionId, taskId, requestId }`, the header's Skip. */
    inboxSkip(json: string): string {
        return submit(async () => taskResult('inboxSkip', await contract.skipInboxProcessingTask(JSON.parse(json))));
    },
    /** iOS journals the exact prepared envelope before calling the private commit. */
    inboxCommitPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.inboxCommitPrepare(JSON.parse(json)));
        });
    },
    inboxSkipPrepare(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.inboxSkipPrepare(JSON.parse(json)));
        });
    },
    inboxPreparedValidate(json: string): string {
        return submit(async () => unwrap(contract.inboxPreparedValidate(JSON.parse(json))));
    },
    inboxPreparedCommit(json: string): string {
        return submit(async () => unwrap(await contract.inboxPreparedCommit(JSON.parse(json))));
    },
    inboxAfterCommit(json: string): string {
        return submit(async () => {
            requireSaved();
            return unwrap(contract.inboxAfterCommit(JSON.parse(json)));
        });
    },
    /** Closes the session; it writes nothing. Core answers null; Kotlin reads an object. */
    inboxEnd(sessionId: string): string {
        return submit(async () => {
            unwrap(contract.endInboxProcessing({ sessionId }));
            return {};
        });
    },
    /** `name` is one of MENU_READS; `json` is that method's input. A read waits for an owed save, as every read does. */
    menuRead(name: string, json: string): string {
        return submit(async () => {
            // The More sheet is navigation: it opens while a retry is owed (an empty sheet looked broken on the phone,
            // 09-26); each destination's own read still waits for the retry and shows its banner.
            if (name !== 'more') requireSaved();
            const read = MENU_READS[name];
            if (!read) throw new Error(`INVALID_INPUT: no menu read ${name}`);
            return unwrap(read(JSON.parse(json) as never));
        });
    },
    /** Debug builds only: runNetCheck against check-net-device.mjs's server on `port`. */
    netCheck(port: string): string {
        return submit(async () => runNetCheck(port));
    },
    /** Debug builds only: runNetDeadline, which CoreHost runs past a short deadline. */
    netDeadline(port: string, mode: string): string {
        return submit(async (signal) => runNetDeadline(port, mode, signal));
    },
    /**
     * CoreHost's deadline for operation `idText` passed: every open fetch rejects and new host calls are refused (until
     * CoreHost resumes them), and the operation's signal fires, so it can drain before the host reports the failure.
     */
    cancel(idText: string): null {
        (globalThis.__cancelHostCalls as (message: string) => void)('The host operation timed out');
        pending.get(Number(idText))?.controller.abort(Object.assign(new Error('The host operation timed out'), { name: 'AbortError' }));
        return null;
    },
    /** `name` is one of MENU_COMMANDS; `json` is that command's input. Its request or capture UUID makes a retry exact. */
    menuCommand(name: string, json: string): string {
        return submit(async () => {
            const command = MENU_COMMANDS[name as MenuCommand];
            if (!command) throw new Error(`INVALID_INPUT: no menu command ${name}`);
            return taskResult(name as MenuCommand, await command(JSON.parse(json) as never));
        });
    },
};
