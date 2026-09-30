import { normalizeClockTimeInput } from './date';
import { FOCUS_TASK_LIMIT_OPTIONS } from './focus-utils';
import { buildGtdSettingsModel, buildGtdSettingsUpdate, GTD_DEFAULT_AREA_ACTIVE_OPTION, isGtdSettingStored,
    type GtdSettingsEdit, type GtdSettingsModel } from './gtd-settings-model';
import { taskEditValuesEqual } from './json-value-equality';
import { compareAreasByOrder } from './task-utils';
import { revisionsToken } from './native-request-receipts';
import { readAreaDurableData, createAreaSaveGuard } from './native-host-contract-area-durable';
import type { NativeHostResult } from './native-host-contract';
import { detach, exact, record } from './native-host-contract-project-shared';
import { isNativeJsonWithinBytes } from './native-host-contract-task-view';
import { useTaskStore } from './store';
import { gtdWorkflowNestedPath, gtdWorkflowWitness, timestampAtLeastAfter,
    gtdWorkflowTargetArea,
    type GtdWorkflowType, type GtdWorkflowDirectType, type GtdWorkflowReviewType, type GtdWorkflowInboxType,
    type GtdWorkflowWitness, type GtdWorkflowDirectWitness,
    type GtdWorkflowReviewWitness, type GtdWorkflowInboxWitness,
    type GtdWorkflowAreaWitness, type GtdWorkflowTargetArea } from './store-settings';
import { ensureDeviceId } from './store-helpers';
import type { AppData, AppSettings, Area } from './types';

export type { GtdWorkflowType, GtdWorkflowWitness } from './store-settings';
export type GtdWorkflowEdit = Extract<GtdSettingsEdit,
    { type: GtdWorkflowDirectType | 'defaultArea' }> | { type: GtdWorkflowReviewType | GtdWorkflowInboxType; value: boolean };
export type NativeGtdWorkflowRequest = { requestId: string; edit: GtdWorkflowEdit;
    expected: GtdWorkflowWitness };
export type NativeGtdWorkflowResult = { type: GtdWorkflowType; value: string | number | boolean; changed: boolean };
export type NativePreparedGtdWorkflow = { version: 1; request: NativeGtdWorkflowRequest;
    preparedAt: string; deviceIdBefore: string | null; deviceIdToInitialize: string | null;
    after: { value: string | number | boolean; stamp: string }; result: NativeGtdWorkflowResult;
    targetArea?: GtdWorkflowTargetArea | null };
export type NativeGtdWorkflowOptions = { hub: GtdSettingsModel['hub'];
    expected: Record<GtdWorkflowDirectType, GtdWorkflowDirectWitness> };
export type NativeGtdReviewOptions = { review: GtdSettingsModel['review'];
    expected: Record<GtdWorkflowReviewType, GtdWorkflowReviewWitness> };
export type NativeGtdInboxOptions = { inbox: GtdSettingsModel['inbox'];
    expected: Record<GtdWorkflowInboxType, GtdWorkflowInboxWitness> };
export type NativeGtdCaptureAreaOptions = { capture: Pick<GtdSettingsModel['capture'], 'title' | 'description' | 'defaultArea'>;
    expected: GtdWorkflowAreaWitness; offset: number; total: number; revision: string };
export type NativeGtdWorkflowPreparation = { kind: 'noop'; result: NativeGtdWorkflowResult }
    | { kind: 'prepared'; prepared: NativePreparedGtdWorkflow };
export type NativeGtdWorkflowDraft = { valid: true; value: string } | { valid: false; value: null };

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const TYPES: GtdWorkflowDirectType[] = ['defaultScheduleTime', 'focusTaskLimit', 'defaultProjectFlowMode'];
const REVIEW_TYPES: GtdWorkflowReviewType[] = ['dailyReviewFocusStep', 'weeklyReviewContextStep'];
const INBOX_TYPES: GtdWorkflowInboxType[] = ['inboxTwoMinute', 'inboxProjectFirst', 'inboxContextStep', 'inboxSchedule'];
const isReview = (type: GtdWorkflowType): type is GtdWorkflowReviewType =>
    type === 'dailyReviewFocusStep' || type === 'weeklyReviewContextStep';
const isInbox = (type: GtdWorkflowType): type is GtdWorkflowInboxType =>
    type === 'inboxTwoMinute' || type === 'inboxProjectFirst'
        || type === 'inboxContextStep' || type === 'inboxSchedule';
const isNested = (type: GtdWorkflowType): type is GtdWorkflowReviewType | GtdWorkflowInboxType =>
    isReview(type) || isInbox(type);
const same = taskEditValuesEqual;
const bounded = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length <= max;
const iso = (value: unknown): value is string => bounded(value, 40)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fail = (code: 'INVALID_INPUT' | 'STALE_REVISION' | 'SAVE_FAILED', message: string): NativeHostResult<never> =>
    ({ ok: false, error: { code, message } });

const validEdit = (value: unknown): value is GtdWorkflowEdit => {
    if (!record(value) || !exact(value, ['type', 'value'])) return false;
    switch (value.type) {
        case 'defaultScheduleTime':
            return bounded(value.value, 50) && normalizeClockTimeInput(value.value) === value.value;
        case 'focusTaskLimit':
            return FOCUS_TASK_LIMIT_OPTIONS.includes(value.value as never);
        case 'defaultProjectFlowMode':
            return value.value === 'parallel' || value.value === 'sequential';
        case 'defaultArea':
            return bounded(value.value);
        case 'dailyReviewFocusStep':
        case 'weeklyReviewContextStep':
        case 'inboxTwoMinute':
        case 'inboxProjectFirst':
        case 'inboxContextStep':
        case 'inboxSchedule':
            return typeof value.value === 'boolean';
        default: return false;
    }
};

const validWitness = (value: unknown, type: GtdWorkflowType): value is GtdWorkflowWitness =>
    record(value) && exact(value, type === 'defaultArea'
        ? ['modePresent', 'mode', 'idPresent', 'id', 'stampPresent', 'stamp'] : isNested(type)
        ? ['parentPresent', 'present', 'value', 'stampPresent', 'stamp']
        : ['present', 'value', 'stampPresent', 'stamp'])
    && typeof value.stampPresent === 'boolean'
    && (type === 'defaultArea'
        ? typeof value.modePresent === 'boolean' && typeof value.idPresent === 'boolean'
            && (value.modePresent ? value.mode === null || bounded(value.mode) : value.mode === null)
            && (value.idPresent ? value.id === null || bounded(value.id) : value.id === null)
        : typeof value.present === 'boolean'
    && (!isNested(type) || typeof value.parentPresent === 'boolean'
        && (value.parentPresent || !value.present))
    && (value.present ? isNested(type) ? typeof value.value === 'boolean' : type === 'focusTaskLimit'
        ? typeof value.value === 'number' && Number.isSafeInteger(value.value) && Math.abs(value.value) <= 1_000_000
        : bounded(value.value) : value.value === null))
    && (value.stampPresent ? iso(value.stamp) : value.stamp === null);

const validTargetArea = (value: unknown): value is GtdWorkflowTargetArea => record(value)
    && exact(value, ['id', 'createdAt', 'updatedAt', 'revPresent', 'rev', 'revByPresent', 'revBy'])
    && bounded(value.id) && value.id.length > 0
    && bounded(value.createdAt) && value.createdAt.length > 0
    && bounded(value.updatedAt) && value.updatedAt.length > 0
    && typeof value.revPresent === 'boolean' && typeof value.revByPresent === 'boolean'
    && (value.revPresent ? typeof value.rev === 'number' && Number.isSafeInteger(value.rev) && value.rev >= 0 : value.rev === null)
    && (value.revByPresent ? bounded(value.revBy) : value.revBy === null);

const readRequest = (input: unknown): NativeGtdWorkflowRequest | null => {
    if (!isNativeJsonWithinBytes(input, 8192)) return null;
    const request = detach<Record<string, unknown>>(input);
    return request && exact(request, ['requestId', 'edit', 'expected'])
        && typeof request.requestId === 'string' && UUID.test(request.requestId)
        && validEdit(request.edit) && validWitness(request.expected, request.edit.type)
        ? request as NativeGtdWorkflowRequest : null;
};

const plannedStamp = (preparedAt: string, witness: GtdWorkflowWitness) =>
    timestampAtLeastAfter(preparedAt, witness.stamp ?? undefined);
const settingsByWitness = (edit: GtdWorkflowEdit, witness: GtdWorkflowWitness): AppSettings => {
    if (edit.type === 'defaultArea') {
        const pair = witness as GtdWorkflowAreaWitness;
        return { gtd: { ...(pair.modePresent ? { defaultAreaMode: pair.mode } : {}),
            ...(pair.idPresent ? { defaultAreaId: pair.id } : {}) } } as AppSettings;
    }
    if (isNested(edit.type)) {
        const { field, parent } = gtdWorkflowNestedPath(edit.type);
        const nested = witness as GtdWorkflowReviewWitness;
        return { gtd: { [parent]: nested.parentPresent
            ? (nested.present ? { [field]: nested.value } : {}) : undefined } } as AppSettings;
    }
    const direct = witness as GtdWorkflowDirectWitness;
    return { gtd: direct.present ? { [edit.type]: direct.value } : {} } as AppSettings;
};
const storedByWitness = (edit: GtdWorkflowEdit, witness: GtdWorkflowWitness): boolean =>
    isGtdSettingStored(settingsByWitness(edit, witness), edit);
const nestedOfferedByWitness = (edit: GtdWorkflowEdit, witness: GtdWorkflowWitness): boolean => {
    if (!isNested(edit.type)) return true;
    const model = buildGtdSettingsModel({ settings: settingsByWitness(edit, witness), areas: [],
        taskOpenMode: 'automatic', t: (key) => key });
    const offered = isReview(edit.type)
        ? edit.type === 'dailyReviewFocusStep' ? model.review.dailyFocusStep.edit : model.review.weeklyContextStep.edit
        : edit.type === 'inboxTwoMinute' ? model.inbox.twoMinute.edit
            : edit.type === 'inboxProjectFirst' ? model.inbox.projectFirst.edit
                : edit.type === 'inboxContextStep' ? model.inbox.contextStep.edit : model.inbox.schedule.edit;
    return same(offered, edit);
};

/** Pure validation of the frozen edit and its scalar/group receipt before storage opens. */
const readPrepared = (input: unknown): NativePreparedGtdWorkflow | null => {
    if (!isNativeJsonWithinBytes(input, 8192)) return null;
    const envelope = detach<Record<string, unknown>>(input);
    if (!envelope || !exact(envelope, ['request', 'prepared']) || !record(envelope.prepared)) return null;
    const request = readRequest(envelope.request);
    const prepared = envelope.prepared;
    if (!request || !exact(prepared, request.edit.type === 'defaultArea'
        ? ['version', 'request', 'preparedAt', 'deviceIdBefore', 'deviceIdToInitialize', 'after', 'result', 'targetArea']
        : ['version', 'request', 'preparedAt', 'deviceIdBefore', 'deviceIdToInitialize', 'after', 'result']) || prepared.version !== 1
        || !same(prepared.request, request) || !iso(prepared.preparedAt)
        || !(prepared.deviceIdBefore === null || bounded(prepared.deviceIdBefore) && Boolean(prepared.deviceIdBefore))
        || (prepared.deviceIdBefore === null ? !UUID.test(String(prepared.deviceIdToInitialize))
            : prepared.deviceIdToInitialize !== null)
        || !record(prepared.after) || !exact(prepared.after, ['value', 'stamp'])
        || !same(prepared.after.value, request.edit.value)
        || prepared.after.stamp !== plannedStamp(prepared.preparedAt, request.expected)
        || !record(prepared.result) || !exact(prepared.result, ['type', 'value', 'changed'])
        || !same(prepared.result, { type: request.edit.type, value: request.edit.value, changed: true })
        || storedByWitness(request.edit, request.expected)
        || !nestedOfferedByWitness(request.edit, request.expected)
        || request.edit.type === 'defaultArea' && (request.edit.value === ''
            || request.edit.value === GTD_DEFAULT_AREA_ACTIVE_OPTION
            ? prepared.targetArea !== null
            : !validTargetArea(prepared.targetArea) || prepared.targetArea.id !== request.edit.value)) return null;
    return prepared as NativePreparedGtdWorkflow;
};

export function createGtdWorkflowMethods(deps: { readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>; t: () => (key: string) => string }) {
    const saves = createAreaSaveGuard(deps.save);
    const resultFor = (edit: GtdWorkflowEdit, changed: boolean): NativeGtdWorkflowResult =>
        ({ type: edit.type, value: edit.value, changed });
    const hubFor = (data: AppData): GtdSettingsModel['hub'] => {
        // The full shared model also builds six unavailable subpages. Keep their
        // malformed legacy siblings out of this hub-only display projection;
        // the raw saved Settings object remains the write authority.
        const gtd = data.settings.gtd;
        const display = { ...data.settings, gtd: { defaultScheduleTime: gtd?.defaultScheduleTime,
            focusTaskLimit: gtd?.focusTaskLimit, defaultProjectFlowMode: gtd?.defaultProjectFlowMode } };
        return buildGtdSettingsModel({ settings: display, areas: [],
            taskOpenMode: 'automatic', t: deps.t() }).hub;
    };
    const reviewFor = (data: AppData): GtdSettingsModel['review'] => {
        // Only the two Review fields are display inputs; other legacy GTD
        // subpages stay out of this read while raw Settings remains authority.
        const gtd = data.settings.gtd;
        const display = { ...data.settings, gtd: {
            dailyReview: { includeFocusStep: gtd?.dailyReview?.includeFocusStep },
            weeklyReview: { includeContextStep: gtd?.weeklyReview?.includeContextStep },
        } };
        return buildGtdSettingsModel({ settings: display, areas: [],
            taskOpenMode: 'automatic', t: deps.t() }).review;
    };
    const inboxFor = (data: AppData): GtdSettingsModel['inbox'] => {
        const inbox = data.settings.gtd?.inboxProcessing;
        const display = { ...data.settings, gtd: { inboxProcessing: {
            twoMinuteEnabled: inbox?.twoMinuteEnabled, projectFirst: inbox?.projectFirst,
            contextStepEnabled: inbox?.contextStepEnabled, scheduleEnabled: inbox?.scheduleEnabled,
        } } };
        return buildGtdSettingsModel({ settings: display, areas: [],
            taskOpenMode: 'automatic', t: deps.t() }).inbox;
    };
    const captureFor = (data: AppData): GtdSettingsModel['capture'] => {
        const gtd = data.settings.gtd;
        const display = { gtd: { defaultAreaMode: gtd?.defaultAreaMode,
            defaultAreaId: gtd?.defaultAreaId } } as AppSettings;
        return buildGtdSettingsModel({ settings: display, areas: data.areas ?? [],
            taskOpenMode: 'automatic', t: deps.t() }).capture;
    };
    const orderedLiveAreas = (data: AppData): Area[] => [...(data.areas ?? [])]
        .filter((area) => !area.deletedAt).sort(compareAreasByOrder);
    const areaRevision = (areas: readonly Area[]): string => revisionsToken(areas.map((area) =>
        JSON.stringify([area.id, area.name, area.order, area.createdAt, area.updatedAt, area.rev ?? null, area.revBy ?? null])));
    return {
        async getGtdCaptureAreaOptions(input: unknown): Promise<NativeHostResult<NativeGtdCaptureAreaOptions>> {
            const ready = deps.readiness(); if (!ready.ok) return ready;
            if (!record(input) || !exact(input, input.revision === undefined
                ? ['offset', 'limit'] : ['offset', 'limit', 'revision'])
                || !Number.isSafeInteger(input.offset) || (input.offset as number) < 0
                || !Number.isSafeInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 100
                || (input.offset as number) > 0 && (!bounded(input.revision, 100) || !input.revision)
                || input.revision !== undefined && (!bounded(input.revision, 100) || !input.revision)
                || !isNativeJsonWithinBytes(input, 8192))
                return fail('INVALID_INPUT', 'A bounded GTD Capture area page is required');
            const read = await readAreaDurableData(); if (!read.ok) return read;
            const snapshot = read.value.authority.snapshot;
            const expected = gtdWorkflowWitness(snapshot.settings, 'defaultArea');
            if (!expected) return fail('INVALID_INPUT', 'Saved Default Area has an unsupported value');
            const areas = orderedLiveAreas(snapshot);
            if (areas.some((area) => !gtdWorkflowTargetArea(area) || !bounded(area.name)))
                return fail('INVALID_INPUT', 'Saved Area choices have an unsupported value');
            const revision = areaRevision(areas);
            if (input.revision !== undefined && input.revision !== revision)
                return fail('STALE_REVISION', 'Area choices changed; reopen Default Area');
            const capture = captureFor(snapshot);
            const options = capture.defaultArea.options;
            const offset = input.offset as number;
            const limit = input.limit as number;
            const value = { capture: { title: capture.title, description: capture.description,
                defaultArea: { ...capture.defaultArea, options: options.slice(offset, offset + limit) } },
                expected, offset, total: options.length, revision };
            return isNativeJsonWithinBytes(value, 262_144) ? { ok: true, value }
                : fail('INVALID_INPUT', 'GTD Capture area page exceeds the bounded response');
        },
        async getGtdWorkflowOptions(input: unknown): Promise<NativeHostResult<NativeGtdWorkflowOptions>> {
            const ready = deps.readiness(); if (!ready.ok) return ready;
            if (!record(input) || !exact(input, [])) return fail('INVALID_INPUT', 'GTD options take an empty object');
            const read = await readAreaDurableData(); if (!read.ok) return read;
            const snapshot = read.value.authority.snapshot;
            const expected = {} as Record<GtdWorkflowDirectType, GtdWorkflowDirectWitness>;
            for (const type of TYPES) {
                const witness = gtdWorkflowWitness(snapshot.settings, type);
                if (!witness) return fail('INVALID_INPUT', `Saved ${type} GTD default has an unsupported value`);
                expected[type] = witness;
            }
            const value = { hub: hubFor(snapshot), expected };
            return isNativeJsonWithinBytes(value, 2_000_000) ? { ok: true, value }
                : fail('INVALID_INPUT', 'GTD options exceed the bounded response');
        },
        async getGtdReviewOptions(input: unknown): Promise<NativeHostResult<NativeGtdReviewOptions>> {
            const ready = deps.readiness(); if (!ready.ok) return ready;
            if (!record(input) || !exact(input, [])) return fail('INVALID_INPUT', 'GTD Review options take an empty object');
            const read = await readAreaDurableData(); if (!read.ok) return read;
            const snapshot = read.value.authority.snapshot;
            const expected = {} as Record<GtdWorkflowReviewType, GtdWorkflowReviewWitness>;
            for (const type of REVIEW_TYPES) {
                const witness = gtdWorkflowWitness(snapshot.settings, type);
                if (!witness) return fail('INVALID_INPUT', `Saved ${type} GTD Review step has an unsupported value`);
                expected[type] = witness;
            }
            const value = { review: reviewFor(snapshot), expected };
            return isNativeJsonWithinBytes(value, 2_000_000) ? { ok: true, value }
                : fail('INVALID_INPUT', 'GTD Review options exceed the bounded response');
        },
        async getGtdInboxOptions(input: unknown): Promise<NativeHostResult<NativeGtdInboxOptions>> {
            const ready = deps.readiness(); if (!ready.ok) return ready;
            if (!record(input) || !exact(input, [])) return fail('INVALID_INPUT', 'GTD Inbox options take an empty object');
            const read = await readAreaDurableData(); if (!read.ok) return read;
            const snapshot = read.value.authority.snapshot;
            const expected = {} as Record<GtdWorkflowInboxType, GtdWorkflowInboxWitness>;
            for (const type of INBOX_TYPES) {
                const witness = gtdWorkflowWitness(snapshot.settings, type);
                if (!witness) return fail('INVALID_INPUT', `Saved ${type} GTD Inbox step has an unsupported value`);
                expected[type] = witness;
            }
            const value = { inbox: inboxFor(snapshot), expected };
            return isNativeJsonWithinBytes(value, 2_000_000) ? { ok: true, value }
                : fail('INVALID_INPUT', 'GTD Inbox options exceed the bounded response');
        },
        normalizeGtdWorkflowDraft(input: unknown): NativeHostResult<NativeGtdWorkflowDraft> {
            if (!record(input) || !exact(input, ['value']) || !bounded(input.value, 50))
                return fail('INVALID_INPUT', 'A bounded GTD time draft is required');
            const value = normalizeClockTimeInput(input.value);
            return { ok: true, value: value === null ? { valid: false, value: null } : { valid: true, value } };
        },
        probeGtdWorkflowOutcome(input: unknown): NativeHostResult<NativeGtdWorkflowResult> {
            const ready = deps.readiness(); if (!ready.ok) return ready;
            return readRequest(input) ? fail('STALE_REVISION', 'GTD workflow outcome is unknown; refresh GTD')
                : fail('INVALID_INPUT', 'A bounded GTD workflow request is required');
        },
        async prepareGtdWorkflow(input: unknown): Promise<NativeHostResult<NativeGtdWorkflowPreparation>> {
            const ready = deps.readiness(); if (!ready.ok) return ready;
            const request = readRequest(input);
            if (!request) return fail('INVALID_INPUT', 'A bounded GTD workflow request is required');
            const preparedAt = new Date().toISOString();
            const read = await readAreaDurableData(); if (!read.ok) return read;
            const settings = read.value.authority.snapshot.settings;
            const current = gtdWorkflowWitness(settings, request.edit.type);
            if (!current || !same(current, request.expected)
                || (settings.deviceId ?? null) !== (read.value.authority.state.settings.deviceId ?? null))
                return fail('STALE_REVISION', 'GTD workflow default changed; refresh GTD');
            let targetArea: GtdWorkflowTargetArea | null = null;
            if (request.edit.type === 'defaultArea') {
                const selected = request.edit.value;
                const areas = orderedLiveAreas(read.value.authority.snapshot);
                if (areas.some((area) => !gtdWorkflowTargetArea(area) || !bounded(area.name)))
                    return fail('INVALID_INPUT', 'Saved Area choices have an unsupported value');
                const capture = captureFor(read.value.authority.snapshot);
                if (!capture.defaultArea.options.some((option) => same(option.edit, request.edit)))
                    return fail('INVALID_INPUT', 'GTD Capture area choice is unavailable');
                if (selected !== '' && selected !== GTD_DEFAULT_AREA_ACTIVE_OPTION) {
                    targetArea = gtdWorkflowTargetArea(areas.find((area) => area.id === selected));
                    if (!targetArea) return fail('STALE_REVISION', 'Selected Area changed; refresh Capture');
                }
            }
            if (isGtdSettingStored(settings, request.edit))
                return { ok: true, value: { kind: 'noop', result: resultFor(request.edit, false) } };
            if (isReview(request.edit.type)) {
                const review = reviewFor(read.value.authority.snapshot);
                const toggle = request.edit.type === 'dailyReviewFocusStep'
                    ? review.dailyFocusStep : review.weeklyContextStep;
                if (!same(toggle.edit, request.edit))
                    return fail('INVALID_INPUT', 'GTD Review choice is unavailable');
            } else if (isInbox(request.edit.type)) {
                const inbox = inboxFor(read.value.authority.snapshot);
                const toggle = request.edit.type === 'inboxTwoMinute' ? inbox.twoMinute
                    : request.edit.type === 'inboxProjectFirst' ? inbox.projectFirst
                        : request.edit.type === 'inboxContextStep' ? inbox.contextStep : inbox.schedule;
                if (!same(toggle.edit, request.edit))
                    return fail('INVALID_INPUT', 'GTD Inbox choice is unavailable');
            } else {
                const hub = hubFor(read.value.authority.snapshot);
                if (request.edit.type === 'focusTaskLimit'
                    && !hub.focusTaskLimit.options.some((option) => same(option.edit, request.edit))
                    || request.edit.type === 'defaultProjectFlowMode'
                        && !hub.defaultProjectFlowMode.options.some((option) => same(option.edit, request.edit)))
                    return fail('INVALID_INPUT', 'GTD workflow choice is unavailable');
            }
            const update = buildGtdSettingsUpdate(settings, request.edit);
            if (!update) return fail('INVALID_INPUT', 'GTD workflow default cannot be saved');
            const device = ensureDeviceId(settings);
            const prepared: NativePreparedGtdWorkflow = { version: 1, request, preparedAt,
                deviceIdBefore: settings.deviceId ?? null,
                deviceIdToInitialize: device.updated ? device.deviceId : null,
                after: { value: request.edit.value, stamp: plannedStamp(preparedAt, request.expected) },
                result: resultFor(request.edit, true),
                ...(request.edit.type === 'defaultArea' ? { targetArea } : {}) };
            const frozen = detach<NativePreparedGtdWorkflow>(prepared);
            return frozen && readPrepared({ request, prepared: frozen })
                ? { ok: true, value: { kind: 'prepared', prepared: frozen } }
                : fail('INVALID_INPUT', 'GTD workflow default exceeds the bounded journal');
        },
        validatePreparedGtdWorkflow(input: unknown): NativeHostResult<NativeGtdWorkflowResult> {
            const prepared = readPrepared(input);
            return prepared ? { ok: true, value: prepared.result }
                : fail('INVALID_INPUT', 'Prepared GTD workflow default does not match the request');
        },
        async commitPreparedGtdWorkflow(input: unknown): Promise<NativeHostResult<NativeGtdWorkflowResult>> {
            const ready = deps.readiness(); if (!ready.ok) return ready;
            const prepared = readPrepared(input);
            if (!prepared) return fail('INVALID_INPUT', 'Prepared GTD workflow default does not match the request');
            const read = await readAreaDurableData(true); if (!read.ok) return read;
            if (!saves.mayApply(prepared, read.value.adapter))
                return fail('SAVE_FAILED', 'GTD workflow default has an unresolved persistence failure');
            const applied = await useTaskStore.getState().commitPreparedGtdWorkflow(prepared, read.value.authority);
            if (!applied.success) return fail('STALE_REVISION', applied.error ?? 'GTD workflow default changed; refresh GTD');
            const saved = await saves.finish(prepared, read.value.adapter,
                applied.outcome === 'replayed', read.value.authority.saveBoundary);
            return saved.ok ? { ok: true, value: prepared.result } : saved;
        },
    };
}
