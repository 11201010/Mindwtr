import { normalizeClockTimeInput } from './date';
import { FOCUS_TASK_LIMIT_OPTIONS } from './focus-utils';
import { buildGtdSettingsModel, buildGtdSettingsUpdate, isGtdSettingStored,
    type GtdSettingsEdit, type GtdSettingsModel } from './gtd-settings-model';
import { taskEditValuesEqual } from './json-value-equality';
import { readAreaDurableData, createAreaSaveGuard } from './native-host-contract-area-durable';
import type { NativeHostResult } from './native-host-contract';
import { detach, exact, record } from './native-host-contract-project-shared';
import { isNativeJsonWithinBytes } from './native-host-contract-task-view';
import { useTaskStore } from './store';
import { gtdWorkflowWitness, timestampAtLeastAfter,
    type GtdWorkflowType, type GtdWorkflowWitness } from './store-settings';
import { ensureDeviceId } from './store-helpers';
import type { AppData, AppSettings } from './types';

export type { GtdWorkflowType, GtdWorkflowWitness } from './store-settings';
export type GtdWorkflowEdit = Extract<GtdSettingsEdit,
    { type: 'defaultScheduleTime' | 'focusTaskLimit' | 'defaultProjectFlowMode' }>;
export type NativeGtdWorkflowRequest = { requestId: string; edit: GtdWorkflowEdit;
    expected: GtdWorkflowWitness };
export type NativeGtdWorkflowResult = { type: GtdWorkflowType; value: string | number; changed: boolean };
export type NativePreparedGtdWorkflow = { version: 1; request: NativeGtdWorkflowRequest;
    preparedAt: string; deviceIdBefore: string | null; deviceIdToInitialize: string | null;
    after: { value: string | number; stamp: string }; result: NativeGtdWorkflowResult };
export type NativeGtdWorkflowOptions = { hub: GtdSettingsModel['hub'];
    expected: Record<GtdWorkflowType, GtdWorkflowWitness> };
export type NativeGtdWorkflowPreparation = { kind: 'noop'; result: NativeGtdWorkflowResult }
    | { kind: 'prepared'; prepared: NativePreparedGtdWorkflow };
export type NativeGtdWorkflowDraft = { valid: true; value: string } | { valid: false; value: null };

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const TYPES: GtdWorkflowType[] = ['defaultScheduleTime', 'focusTaskLimit', 'defaultProjectFlowMode'];
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
        default: return false;
    }
};

const validWitness = (value: unknown, type: GtdWorkflowType): value is GtdWorkflowWitness =>
    record(value) && exact(value, ['present', 'value', 'stampPresent', 'stamp'])
    && typeof value.present === 'boolean' && typeof value.stampPresent === 'boolean'
    && (value.present ? type === 'focusTaskLimit'
        ? typeof value.value === 'number' && Number.isSafeInteger(value.value) && Math.abs(value.value) <= 1_000_000
        : bounded(value.value) : value.value === null)
    && (value.stampPresent ? iso(value.stamp) : value.stamp === null);

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
const storedByWitness = (edit: GtdWorkflowEdit, witness: GtdWorkflowWitness): boolean =>
    isGtdSettingStored({ gtd: witness.present ? { [edit.type]: witness.value } : {} } as AppSettings, edit);

/** Pure validation of the frozen edit and its scalar/group receipt before storage opens. */
const readPrepared = (input: unknown): NativePreparedGtdWorkflow | null => {
    if (!isNativeJsonWithinBytes(input, 8192)) return null;
    const envelope = detach<Record<string, unknown>>(input);
    if (!envelope || !exact(envelope, ['request', 'prepared']) || !record(envelope.prepared)) return null;
    const request = readRequest(envelope.request);
    const prepared = envelope.prepared;
    if (!request || !exact(prepared, ['version', 'request', 'preparedAt', 'deviceIdBefore',
        'deviceIdToInitialize', 'after', 'result']) || prepared.version !== 1
        || !same(prepared.request, request) || !iso(prepared.preparedAt)
        || !(prepared.deviceIdBefore === null || bounded(prepared.deviceIdBefore) && Boolean(prepared.deviceIdBefore))
        || (prepared.deviceIdBefore === null ? !UUID.test(String(prepared.deviceIdToInitialize))
            : prepared.deviceIdToInitialize !== null)
        || !record(prepared.after) || !exact(prepared.after, ['value', 'stamp'])
        || !same(prepared.after.value, request.edit.value)
        || prepared.after.stamp !== plannedStamp(prepared.preparedAt, request.expected)
        || !record(prepared.result) || !exact(prepared.result, ['type', 'value', 'changed'])
        || !same(prepared.result, { type: request.edit.type, value: request.edit.value, changed: true })
        || storedByWitness(request.edit, request.expected)) return null;
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
    return {
        async getGtdWorkflowOptions(input: unknown): Promise<NativeHostResult<NativeGtdWorkflowOptions>> {
            const ready = deps.readiness(); if (!ready.ok) return ready;
            if (!record(input) || !exact(input, [])) return fail('INVALID_INPUT', 'GTD options take an empty object');
            const read = await readAreaDurableData(); if (!read.ok) return read;
            const snapshot = read.value.authority.snapshot;
            const expected = {} as Record<GtdWorkflowType, GtdWorkflowWitness>;
            for (const type of TYPES) {
                const witness = gtdWorkflowWitness(snapshot.settings, type);
                if (!witness) return fail('INVALID_INPUT', `Saved ${type} GTD default has an unsupported value`);
                expected[type] = witness;
            }
            const value = { hub: hubFor(snapshot), expected };
            return isNativeJsonWithinBytes(value, 2_000_000) ? { ok: true, value }
                : fail('INVALID_INPUT', 'GTD options exceed the bounded response');
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
            const hub = hubFor(read.value.authority.snapshot);
            if (request.edit.type === 'focusTaskLimit'
                && !hub.focusTaskLimit.options.some((option) => same(option.edit, request.edit))
                || request.edit.type === 'defaultProjectFlowMode'
                    && !hub.defaultProjectFlowMode.options.some((option) => same(option.edit, request.edit)))
                return fail('INVALID_INPUT', 'GTD workflow choice is unavailable');
            if (isGtdSettingStored(settings, request.edit))
                return { ok: true, value: { kind: 'noop', result: resultFor(request.edit, false) } };
            const update = buildGtdSettingsUpdate(settings, request.edit);
            if (!update) return fail('INVALID_INPUT', 'GTD workflow default cannot be saved');
            const device = ensureDeviceId(settings);
            const prepared: NativePreparedGtdWorkflow = { version: 1, request, preparedAt,
                deviceIdBefore: settings.deviceId ?? null,
                deviceIdToInitialize: device.updated ? device.deviceId : null,
                after: { value: request.edit.value, stamp: plannedStamp(preparedAt, request.expected) },
                result: resultFor(request.edit, true) };
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
