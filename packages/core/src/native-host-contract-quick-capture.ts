/**
 * The native host contract for the capture popup: React Native's quick capture
 * sheet, the one the tab bar's center + opens. Kept in its own file and spread
 * into createNativeHostContract; every view and save comes from
 * quick-capture-model.ts, the module React Native's popup calls.
 *
 * The host keeps the typed text and the options, and sends both with every
 * call. The contract keeps the popup's one parse-options bag, as React Native
 * does: openQuickCapture rebuilds it, and so does every capture that lands, so
 * capture 2 of an "Add another" burst knows a context capture 1 created. Reads
 * in between reuse it, so the preview and the save cannot disagree; a sync that
 * lands mid-draft stays unknown until the next rebuild, as on mobile.
 *
 * Only functions read this module's imports from native-host-contract.ts, so
 * the import cycle between the two files is safe.
 */
import type { DateFormatter } from './date';
import { resolveCaptureAreaQuery, resolveCaptureProjectQuery } from './capture';
import { safeParseDate } from './date';
import type { TranslateFn } from './i18n';
import { NATIVE_HOST_CONTRACT_VERSION, NATIVE_HOST_MAX_WINDOW, type NativeHostResult } from './native-host-contract';
import { createNativeRequestReceipts } from './native-request-receipts';
import { buildQuickAddParseOptions, type QuickAddParseOptions } from './quick-add';
import {
    applyQuickCaptureEdit,
    buildQuickCaptureAreaPicker,
    buildQuickCaptureContextPicker,
    buildQuickCapturePriorityPicker,
    buildQuickCaptureProjectPicker,
    buildQuickCaptureView,
    createQuickCaptureOptions,
    getQuickCaptureBulkConfirm,
    getQuickCaptureContextChoices,
    planQuickCaptureSave,
    QUICK_CAPTURE_PRIORITY_OPTIONS,
    resolveQuickCaptureDefaultAreaId,
    saveQuickCapture,
    saveQuickCaptureBulk,
    type QuickCaptureContext,
    type QuickCaptureEdit,
    type QuickCaptureNotice,
    type QuickCaptureOptions,
    type QuickCaptureSaved,
    type QuickCaptureView,
} from './quick-capture-model';
import { isSelectableProjectForTaskAssignment } from './project-utils';
import { resolveFeatureFlags } from './resolve-feature-flags';
import { useTaskStore } from './store';
import type { TaskPriority } from './types';

type NativeHostErrorCode = Extract<NativeHostResult<never>, { ok: false }>['error']['code'];

export type QuickCaptureDeps = {
    readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>;
    /** Data plus display revision: tasks, projects, settings, language and the minute. */
    revision: (now: Date) => string;
    t: () => TranslateFn;
    /** The user's date formatting (createDateFormatter); the only formatter this block uses. */
    formatDate: () => DateFormatter;
    requestIdPattern: RegExp;
};

export type NativeQuickCapturePickerKind = 'project' | 'area' | 'context' | 'priority';
type Windowed<T extends { items: unknown[] }> = Omit<T, 'items'> & { items: T['items']; total: number };
type ProjectPicker = ReturnType<typeof buildQuickCaptureProjectPicker>;
type AreaPicker = ReturnType<typeof buildQuickCaptureAreaPicker>;
type ContextPicker = ReturnType<typeof buildQuickCaptureContextPicker>;
type PriorityPicker = ReturnType<typeof buildQuickCapturePriorityPicker>;

/** The open picker. Lists hold the first NATIVE_HOST_MAX_WINDOW matches; `total` counts them all. */
export type NativeQuickCapturePicker =
    | ({ kind: 'project'; query: string } & Windowed<ProjectPicker>)
    | ({ kind: 'area'; query: string } & Windowed<AreaPicker>)
    | ({ kind: 'context'; query: string } & Windowed<ContextPicker>)
    | ({ kind: 'priority' } & PriorityPicker);

export type NativeQuickCaptureView = QuickCaptureView & {
    version: typeof NATIVE_HOST_CONTRACT_VERSION;
    /** Changes with the data, settings, language and minute. */
    revision: string;
    picker: NativeQuickCapturePicker | null;
};

/** Which picker to show, with its search text. The priority picker has none. */
export type NativeQuickCapturePickerInput = { kind: NativeQuickCapturePickerKind; query?: string };

export type NativeQuickCaptureSubmitResult =
    | (Omit<QuickCaptureSaved, 'highlightTaskId'> & {
        /** "Add another": the draft to show next (empty text, fresh options that keep Add another on). */
        reset: { text: string; options: QuickCaptureOptions } | null;
    })
    /** Nothing was written: show the notice and keep the draft. A new attempt needs a new capture ID. */
    | { kind: 'refused'; notice: QuickCaptureNotice }
    /** Several lines: ask with this text, then send submitQuickCaptureLines with one capture ID per line. */
    | { kind: 'confirmLines'; confirm: ReturnType<typeof getQuickCaptureBulkConfirm>; lineCount: number };

export type NativeQuickCaptureLinesResult = { kind: 'saved'; taskIds: string[] } | { kind: 'refused'; notice: QuickCaptureNotice };

const fail = (code: NativeHostErrorCode, message: string): NativeHostResult<never> => ({ ok: false, error: { code, message } });
const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);
const isText = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length <= max;
const TEXT_LIMIT = 100_000;
const NOTE_LIMIT = 500_000;
const isInstant = (value: unknown) => value === null || (isText(value, 64) && safeParseDate(value) !== null);
const isId = (value: unknown) => value === null || (isText(value) && value.length > 0);

const OPTION_CHECKS: Record<keyof QuickCaptureOptions, (value: unknown) => boolean> = {
    note: (value) => isText(value, NOTE_LIMIT),
    dueDate: isInstant,
    dueDateHasTime: (value) => typeof value === 'boolean',
    startTime: isInstant,
    contexts: (value) => Array.isArray(value) && value.length <= 1000 && value.every((entry) => isText(entry) && entry.trim().length > 0),
    projectId: isId,
    areaId: isId,
    priority: (value) => value === null || QUICK_CAPTURE_PRIORITY_OPTIONS.includes(value as TaskPriority),
    focus: (value) => typeof value === 'boolean',
    addAnother: (value) => typeof value === 'boolean',
};

/** Every field, each valid. With Priorities off the priority is cleared, as the popup clears it. */
const readOptions = (value: unknown): QuickCaptureOptions | null => {
    if (!isObjectRecord(value)) return null;
    const keys = Object.keys(OPTION_CHECKS) as (keyof QuickCaptureOptions)[];
    if (Object.keys(value).length !== keys.length || !keys.every((key) => key in value && OPTION_CHECKS[key](value[key]))) return null;
    const options = { ...value, contexts: [...(value.contexts as string[])] } as QuickCaptureOptions;
    return resolveFeatureFlags(useTaskStore.getState().settings).priorities ? options : { ...options, priority: null };
};

const isEdit = (edit: unknown): edit is QuickCaptureEdit => {
    if (!isObjectRecord(edit)) return false;
    const state = useTaskStore.getState();
    switch (edit.type) {
        case 'setNote':
            return isText(edit.value, NOTE_LIMIT);
        case 'selectProject': {
            if (edit.projectId === null) return true;
            const project = typeof edit.projectId === 'string' ? state._projectsById.get(edit.projectId) : undefined;
            return Boolean(project && isSelectableProjectForTaskAssignment(project));
        }
        case 'selectArea':
            return edit.areaId === null || state.areas.some((area) => area.id === edit.areaId && !area.deletedAt);
        case 'toggleContext':
        case 'removeContext':
            return isText(edit.value) && edit.value.trim().length > 0;
        case 'addContexts':
            return isText(edit.query, 10_000);
        case 'setPriority':
            return resolveFeatureFlags(state.settings).priorities
                && (edit.priority === null || QUICK_CAPTURE_PRIORITY_OPTIONS.includes(edit.priority as TaskPriority));
        case 'setAddAnother':
            return typeof edit.value === 'boolean';
        case 'setDueDay':
            return isText(edit.day, 10);
        case 'setDueTime':
            return isText(edit.time, 5);
        case 'resetProject':
        case 'clearContexts':
        case 'toggleFocus':
        case 'clearDueDate':
        case 'clearDueTime':
            return true;
        default:
            return false;
    }
};

const PICKERS = new Set<string>(['project', 'area', 'context', 'priority']);
const readPicker = (value: unknown): NativeQuickCapturePickerInput | null | false => {
    if (value === undefined || value === null) return null;
    if (!isObjectRecord(value) || !PICKERS.has(value.kind as string) || (value.query !== undefined && !isText(value.query, 10_000))) return false;
    if (value.kind === 'priority' && value.query !== undefined) return false;
    return { kind: value.kind as NativeQuickCapturePickerKind, query: value.query as string | undefined };
};

const windowed = <T extends { items: unknown[] }>(picker: T): Windowed<T> => ({
    ...picker,
    items: picker.items.slice(0, NATIVE_HOST_MAX_WINDOW) as T['items'],
    total: picker.items.length,
});

export function createQuickCaptureMethods(deps: QuickCaptureDeps) {
    // The popup's one parse-options bag; see the module comment.
    let parseOptions: QuickAddParseOptions | null = null;
    const rebuildParseOptions = () => {
        const state = useTaskStore.getState();
        parseOptions = buildQuickAddParseOptions(state.settings, state);
        return parseOptions;
    };

    const writeFailure = (message: string | undefined): NativeHostResult<never> => {
        const failure = useTaskStore.getState().persistenceFailure;
        return fail(failure ? 'SAVE_FAILED' : 'ACTION_FAILED', failure?.message ?? message ?? 'Write failed');
    };
    const caught = (error: unknown) => writeFailure(error instanceof Error ? error.message : String(error));
    /** Makes every write so far durable: retries a failed save, then flushes. */
    const durableSave = async (): Promise<NativeHostResult<null>> => {
        try {
            if (useTaskStore.getState().persistenceFailure) await useTaskStore.getState().retryPersistence();
        } catch (error) {
            return fail('SAVE_FAILED', error instanceof Error ? error.message : String(error));
        }
        return deps.save();
    };
    // Captures, batches and picker creates retry exactly through the shared helper.
    const receipts = createNativeRequestReceipts({ save: durableSave });

    const context = (now = new Date()): QuickCaptureContext => {
        const state = useTaskStore.getState();
        return {
            settings: state.settings,
            projects: state.projects,
            areas: state.areas,
            parseOptions: parseOptions ?? rebuildParseOptions(),
            focusedCount: state.getFocusedCount(),
            defaultAreaId: resolveQuickCaptureDefaultAreaId(state.settings, state.areas),
            t: deps.t(),
            formatDate: deps.formatDate(),
            now,
        };
    };
    const contextChoices = () => getQuickCaptureContextChoices(useTaskStore.getState().tasks);
    const freshOptions = (addAnother: boolean) => {
        const state = useTaskStore.getState();
        return createQuickCaptureOptions({
            projects: state.projects,
            defaultAreaId: resolveQuickCaptureDefaultAreaId(state.settings, state.areas),
            addAnother,
        });
    };

    const view = (text: string, options: QuickCaptureOptions, picker: NativeQuickCapturePickerInput | null): NativeHostResult<NativeQuickCaptureView> => {
        const ctx = context();
        const built = buildQuickCaptureView(text, options, ctx);
        let shown: NativeQuickCapturePicker | null = null;
        if (picker?.kind === 'project') shown = { kind: 'project', query: picker.query ?? '', ...windowed(buildQuickCaptureProjectPicker(options, ctx, picker.query ?? '')) };
        if (picker?.kind === 'area') shown = { kind: 'area', query: picker.query ?? '', ...windowed(buildQuickCaptureAreaPicker(options, ctx, picker.query ?? '')) };
        if (picker?.kind === 'context') {
            shown = { kind: 'context', query: picker.query ?? '', ...windowed(buildQuickCaptureContextPicker(options, ctx, picker.query ?? '', contextChoices())) };
        }
        if (picker?.kind === 'priority') {
            if (!built.priority) return fail('INVALID_INPUT', 'The priority picker is off while Priorities are off');
            shown = { kind: 'priority', ...buildQuickCapturePriorityPicker(options, ctx) };
        }
        return {
            ok: true,
            value: { ...built, version: NATIVE_HOST_CONTRACT_VERSION, revision: deps.revision(ctx.now), picker: shown },
        };
    };

    /** The shared input checks: readiness, text and options. */
    const readDraft = (input: unknown): NativeHostResult<{ text: string; options: QuickCaptureOptions }> => {
        const ready = deps.readiness();
        if (!ready.ok) return ready;
        if (!isObjectRecord(input) || !isText(input.text, TEXT_LIMIT)) return fail('INVALID_INPUT', 'text is required');
        const options = readOptions(input.options);
        if (!options) return fail('INVALID_INPUT', 'options must hold every capture option with a valid value');
        return { ok: true, value: { text: input.text, options } };
    };

    return {
        /**
         * Open the popup: rebuilds the known-token bag and returns an empty draft
         * with the starting options (the default area). Apply the stored "Add
         * another" preference with a setAddAnother edit, as mobile does.
         */
        openQuickCapture(): NativeHostResult<NativeQuickCaptureView> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            rebuildParseOptions();
            return view('', freshOptions(false), null);
        },

        /** The popup for this text and these options; `picker` adds the open picker for its search text. */
        getQuickCaptureView(input: { text: string; options: QuickCaptureOptions; picker?: NativeQuickCapturePickerInput }): NativeHostResult<NativeQuickCaptureView> {
            const draft = readDraft(input);
            if (!draft.ok) return draft;
            const picker = readPicker(input.picker);
            if (picker === false) return fail('INVALID_INPUT', 'picker must be project, area, context or priority');
            return view(draft.value.text, draft.value.options, picker);
        },

        /**
         * Apply a control's edit (every control in the view carries its own) and
         * return the popup after it. Nothing is written. A refused edit (focus at
         * the limit) returns the notice mobile shows and the options unchanged.
         */
        editQuickCapture(input: {
            text: string;
            options: QuickCaptureOptions;
            edit: QuickCaptureEdit;
            picker?: NativeQuickCapturePickerInput;
        }): NativeHostResult<{ view: NativeQuickCaptureView; notice: QuickCaptureNotice | null }> {
            const draft = readDraft(input);
            if (!draft.ok) return draft;
            const picker = readPicker(input.picker);
            if (picker === false) return fail('INVALID_INPUT', 'picker must be project, area, context or priority');
            if (!isEdit(input.edit)) return fail('INVALID_INPUT', 'edit is not a valid capture edit');
            const ctx = context();
            const edited = applyQuickCaptureEdit(draft.value.options, input.edit, {
                ...ctx,
                contextChoices: input.edit.type === 'addContexts' ? contextChoices() : undefined,
            });
            if (!edited) return fail('INVALID_INPUT', 'edit is not a valid capture edit');
            const shown = view(draft.value.text, edited.options, picker);
            if (!shown.ok) return shown;
            return { ok: true, value: { view: shown.value, notice: edited.notice } };
        },

        /**
         * Save the draft as mobile's Save does (`openAfterSave`: Save and edit).
         * On SAVE_FAILED or ACTION_FAILED mobile shows `failureNotices.save`;
         * reuse `captureId` to retry: the same draft is written at most once, and
         * after a restart the task that captureId created answers the retry.
         * Several lines return `confirmLines` and write nothing.
         */
        async submitQuickCapture(input: {
            text: string;
            options: QuickCaptureOptions;
            captureId: string;
            openAfterSave?: boolean;
        }): Promise<NativeHostResult<NativeQuickCaptureSubmitResult>> {
            const draft = readDraft(input);
            if (!draft.ok) return draft;
            if (input.openAfterSave !== undefined && typeof input.openAfterSave !== 'boolean') {
                return fail('INVALID_INPUT', 'openAfterSave must be a boolean');
            }
            const { text, options } = draft.value;
            const plan = planQuickCaptureSave(text);
            if (plan.kind === 'empty') return fail('INVALID_INPUT', 'Type something to capture');
            if (plan.kind === 'bulk') {
                return { ok: true, value: { kind: 'confirmLines', confirm: getQuickCaptureBulkConfirm(plan.lines, deps.t()), lineCount: plan.lines.length } };
            }
            const openAfterSave = input.openAfterSave === true;
            return receipts.run<NativeQuickCaptureSubmitResult>(
                input.captureId,
                JSON.stringify(['capture', text, options, openAfterSave]),
                async () => {
                    const saved = (taskId: string, projectId: string | undefined): NativeHostResult<NativeQuickCaptureSubmitResult> => {
                        rebuildParseOptions();
                        const next = openAfterSave ? 'open' : options.addAnother ? 'addAnother' : 'close';
                        return {
                            ok: true,
                            value: { kind: 'saved', taskId, projectId, next, reset: next === 'addAnother' ? { text: '', options: freshOptions(true) } : null },
                        };
                    };
                    // After a restart the receipt is gone: the task this captureId created answers the retry.
                    const existing = useTaskStore.getState()._allTasks.find((task) => task.id === input.captureId.toLowerCase());
                    if (existing) return saved(existing.id, existing.projectId);
                    try {
                        const outcome = await saveQuickCapture({
                            text: plan.text,
                            options,
                            context: context(),
                            actions: {
                                addProject: (title, color, props) => useTaskStore.getState().addProject(title, color, props),
                                addTask: (title, props) => useTaskStore.getState().addTask(title, props, { captureId: input.captureId }),
                            },
                            openAfterSave,
                        });
                        if (outcome.kind === 'refused') {
                            return outcome.reason === 'write-failed'
                                ? writeFailure(outcome.error)
                                : { ok: true, value: { kind: 'refused', notice: outcome.notice } };
                        }
                        if (!outcome.taskId) return writeFailure('Task creation failed');
                        return saved(outcome.taskId, outcome.projectId);
                    } catch (error) {
                        return caught(error);
                    }
                },
            );
        },

        /**
         * Create one task per line after the confirmLines question, in one store
         * write, as mobile's "Create tasks" does; the popup then closes. Send one
         * capture UUID per line; reuse them to retry (mobile shows
         * `failureNotices.lines` on a failure). A line with a date command it
         * cannot read refuses the whole batch. Mobile first saves a recovery
         * snapshot; this contract takes none.
         */
        async submitQuickCaptureLines(input: {
            text: string;
            options: QuickCaptureOptions;
            captureIds: string[];
        }): Promise<NativeHostResult<NativeQuickCaptureLinesResult>> {
            const draft = readDraft(input);
            if (!draft.ok) return draft;
            const plan = planQuickCaptureSave(draft.value.text);
            if (plan.kind !== 'bulk') return fail('INVALID_INPUT', 'text must hold several lines');
            const ids = input.captureIds;
            if (!Array.isArray(ids) || ids.length !== plan.lines.length
                || !ids.every((id) => typeof id === 'string' && deps.requestIdPattern.test(id))
                || new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) {
                return fail('INVALID_INPUT', 'Send one distinct capture UUID per line');
            }
            return receipts.run<NativeQuickCaptureLinesResult>(ids[0], JSON.stringify(['lines', draft.value.text, draft.value.options, ids]), async () => {
                try {
                    const outcome = await saveQuickCaptureBulk({
                        lines: plan.lines,
                        options: draft.value.options,
                        context: context(),
                        actions: {
                            addProject: (title, color, props) => useTaskStore.getState().addProject(title, color, props),
                            addTasks: (items) => useTaskStore.getState().addTasks(items),
                        },
                        captureIds: ids,
                    });
                    if (outcome.kind === 'refused') return { ok: true, value: outcome };
                    if (outcome.kind !== 'saved') return writeFailure('Could not create all tasks');
                    rebuildParseOptions();
                    return { ok: true, value: { kind: 'saved', taskIds: ids.map((id) => id.toLowerCase()) } };
                } catch (error) {
                    return caught(error);
                }
            });
        },

        /**
         * Submit the project or area picker's search: choose the one with that
         * exact name, or create it, as the picker's "Create" row does. Returns the
         * options with it chosen; close the picker and read the view. Reuse
         * `requestId` to retry.
         */
        async submitQuickCapturePickerQuery(input: {
            picker: 'project' | 'area';
            query: string;
            text: string;
            options: QuickCaptureOptions;
            requestId: string;
        }): Promise<NativeHostResult<{ options: QuickCaptureOptions; created: boolean }>> {
            const draft = readDraft(input);
            if (!draft.ok) return draft;
            if ((input.picker !== 'project' && input.picker !== 'area') || !isText(input.query, 500) || !input.query.trim()) {
                return fail('INVALID_INPUT', 'A project or area picker and its search text are required');
            }
            const { text, options } = draft.value;
            const { picker, query } = input;
            // The same edit the picker's rows send.
            const choose = (id: string, created: boolean): NativeHostResult<{ options: QuickCaptureOptions; created: boolean }> => {
                const edit: QuickCaptureEdit = picker === 'project' ? { type: 'selectProject', projectId: id } : { type: 'selectArea', areaId: id };
                return { ok: true, value: { options: applyQuickCaptureEdit(options, edit, context())!.options, created } };
            };
            return receipts.run<{ options: QuickCaptureOptions; created: boolean }>(input.requestId, JSON.stringify(['picker', picker, query, text, options]), async () => {
                const state = useTaskStore.getState();
                try {
                    if (picker === 'project') {
                        const resolution = resolveCaptureProjectQuery(state.projects, query, options.areaId);
                        if (resolution.kind === 'select') return choose(resolution.project.id, false);
                        if (resolution.kind === 'empty') return fail('INVALID_INPUT', 'A search text is required');
                        const { title, color, initialProps } = resolution.projectToCreate;
                        const created = await state.addProject(title, color, initialProps);
                        return created ? choose(created.id, true) : writeFailure(useTaskStore.getState().error ?? 'Project creation failed');
                    }
                    const resolution = resolveCaptureAreaQuery(state.areas, query);
                    if (resolution.kind === 'select') return choose(resolution.area.id, false);
                    if (resolution.kind === 'empty') return fail('INVALID_INPUT', 'A search text is required');
                    const created = await state.addArea(resolution.areaToCreate.name, { color: resolution.areaToCreate.color });
                    return created ? choose(created.id, true) : writeFailure(useTaskStore.getState().error ?? 'Area creation failed');
                } catch (error) {
                    return caught(error);
                }
            });
        },
    };
}
