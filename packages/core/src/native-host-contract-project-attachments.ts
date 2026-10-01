import { planAttachmentLinkBatch } from './attachment-editor-model';
import type { NativeHostResult } from './native-host-contract';
import { readNativeAttachments } from './native-host-contract-attachments';
import { taskEditValuesEqual } from './json-value-equality';
import { detach, exact, iso, record, validProject } from './native-host-contract-project-shared';
import { isNativeJsonWithinBytes } from './native-host-contract-task-view';
import { requestRowId } from './native-request-receipts';
import { ensureDeviceId } from './store-helpers';
import { useTaskStore } from './store';
import { projectAttachmentWriteEffect, sameProjectSqliteRow } from './store-projects/project-actions';
import type { PreparedProjectAttachmentWrite, ProjectAttachmentIntent } from './store-types';
import type { Attachment, Project } from './types';

export type NativeProjectAttachmentWriteToken = { title: string; status: Project['status']; attachments: Attachment[] | null;
    rev: number | null; revBy: string | null; updatedAt: string };
export type NativeProjectAttachmentWriteRequest = { requestId: string; projectId: string;
    intent: ProjectAttachmentIntent; expected: NativeProjectAttachmentWriteToken };
export type NativeProjectAttachmentWriteResult = { id: string; attachmentIds: string[] };
export type NativePreparedProjectAttachmentWrite = PreparedProjectAttachmentWrite & { version: 1;
    request: NativeProjectAttachmentWriteRequest; result: NativeProjectAttachmentWriteResult };
export type NativeProjectAttachmentWritePreparation = { kind: 'noop'; result: NativeProjectAttachmentWriteResult }
    | { kind: 'blocked'; result: { blocked: '' } }
    | { kind: 'refused'; result: { message: string } }
    | { kind: 'prepared'; prepared: NativePreparedProjectAttachmentWrite };

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const same = taskEditValuesEqual;
const fail = (code: 'INVALID_INPUT' | 'STALE_REVISION' | 'SAVE_FAILED', message: string): NativeHostResult<never> =>
    ({ ok: false, error: { code, message } });
const id = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 500;
const token = (project: Project): NativeProjectAttachmentWriteToken => ({
    title: project.title, status: project.status, attachments: project.attachments ?? null,
    rev: project.rev ?? null, revBy: project.revBy ?? null, updatedAt: project.updatedAt,
});
const validToken = (value: unknown): value is NativeProjectAttachmentWriteToken => record(value)
    && exact(value, ['title', 'status', 'attachments', 'rev', 'revBy', 'updatedAt'])
    && typeof value.title === 'string' && value.title.length <= 100_000
    && ['active', 'someday', 'waiting', 'archived'].includes(String(value.status))
    && (value.attachments === null || readNativeAttachments(value.attachments) !== null)
    && (value.rev === null || typeof value.rev === 'number' && Number.isSafeInteger(value.rev) && value.rev >= 0)
    && (value.revBy === null || typeof value.revBy === 'string' && value.revBy.length <= 500)
    && iso(value.updatedAt);
const validIntent = (value: unknown): value is ProjectAttachmentIntent => record(value)
    && (value.kind === 'add' && exact(value, ['kind', 'text'])
        && typeof value.text === 'string' && value.text.length <= 100_000
        || value.kind === 'remove' && exact(value, ['kind', 'attachmentId']) && id(value.attachmentId));
const readRequest = (value: unknown): NativeProjectAttachmentWriteRequest | null => {
    const input = detach<Record<string, unknown>>(value);
    return input && exact(input, ['requestId', 'projectId', 'intent', 'expected'])
        && typeof input.requestId === 'string' && UUID.test(input.requestId)
        && id(input.projectId) && validIntent(input.intent) && validToken(input.expected)
        ? input as NativeProjectAttachmentWriteRequest : null;
};
const validAttachmentProject = (value: unknown, projectId: string): value is Project => {
    if (!record(value)) return false;
    // Keep raw SQLite-null columns in the frozen row; normalize only for validation.
    const normalized = { ...value, areaId: value.areaId ?? undefined, areaTitle: value.areaTitle ?? undefined,
        startDate: value.startDate ?? undefined, dueDate: value.dueDate ?? undefined,
        reviewAt: value.reviewAt ?? undefined, supportNotes: value.supportNotes ?? undefined,
        cancelledAt: value.cancelledAt ?? undefined, rev: value.rev ?? undefined,
        revBy: value.revBy ?? undefined, attachments: value.attachments ?? undefined,
        deletedAt: value.deletedAt ?? undefined, purgedAt: value.purgedAt ?? undefined };
    return validProject(normalized, projectId)
        && (value.attachments === undefined || value.attachments === null
            || readNativeAttachments(value.attachments) !== null);
};
const addedIds = (request: NativeProjectAttachmentWriteRequest, now: string): string[] | null => {
    if (request.intent.kind === 'remove') return [request.intent.attachmentId];
    let index = 0;
    const batch = planAttachmentLinkBatch(request.intent.text, {
        newId: () => requestRowId(request.requestId, `link:${index++}`), now, t: (key) => key,
    });
    return batch.kind === 'add' ? batch.added.map((attachment) => attachment.id) : null;
};

/** Pure validation for a cold journal, before mutable store or SQL checks. */
const readPrepared = (value: unknown): NativePreparedProjectAttachmentWrite | null => {
    const envelope = detach<Record<string, unknown>>(value);
    if (!envelope || !exact(envelope, ['request', 'prepared']) || !record(envelope.prepared)) return null;
    const request = readRequest(envelope.request);
    const raw = envelope.prepared;
    if (!request || !exact(raw, ['version', 'request', 'scope', 'effect', 'deviceIdBefore',
        'deviceIdToInitialize', 'updateAt', 'result']) || raw.version !== 1 || !same(raw.request, request)
        || !record(raw.scope) || !exact(raw.scope, ['project']) || !record(raw.scope.project)
        || !record(raw.effect) || !exact(raw.effect, ['project']) || !record(raw.effect.project)
        || !exact(raw.effect.project, ['before', 'after'])
        || !(raw.deviceIdBefore === null || id(raw.deviceIdBefore))
        || (raw.deviceIdBefore === null
            ? typeof raw.deviceIdToInitialize !== 'string' || !UUID.test(raw.deviceIdToInitialize)
            : raw.deviceIdToInitialize !== null)
        || !iso(raw.updateAt) || !record(raw.result) || !exact(raw.result, ['id', 'attachmentIds'])
        || raw.result.id !== request.projectId || !Array.isArray(raw.result.attachmentIds)
        || raw.result.attachmentIds.length > 1_000 || !raw.result.attachmentIds.every(id)) return null;
    try {
        const prepared = raw as unknown as NativePreparedProjectAttachmentWrite;
        const before = prepared.scope.project;
        const ids = addedIds(request, prepared.updateAt);
        if (!ids || !same(prepared.result.attachmentIds, ids)
            || !validAttachmentProject(before, request.projectId)
            || !validAttachmentProject(prepared.effect.project.before, request.projectId)
            || !validAttachmentProject(prepared.effect.project.after, request.projectId)
            || before.status === 'archived' || !same(token(before), request.expected)
            || !same(before, prepared.effect.project.before)) return null;
        const planned = projectAttachmentWriteEffect(before, request.intent, ids,
            prepared.deviceIdBefore ?? prepared.deviceIdToInitialize!, prepared.updateAt);
        return planned && planned.project.after.rev! > (before.rev ?? 0)
            && same(planned, prepared.effect) && !sameProjectSqliteRow(before, planned.project.after)
            ? prepared : null;
    } catch { return null; }
};

export function createProjectAttachmentWriteMethods(deps: {
    readiness: () => NativeHostResult<null>;
    save: () => Promise<NativeHostResult<null>>;
    revision: () => string;
    t: () => (key: string) => string;
}) {
    return {
        getProjectAttachmentEditOptions(input: { projectId: string }): NativeHostResult<{ revision: string;
            project: { id: string } & NativeProjectAttachmentWriteToken; canEdit: boolean }> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            if (!input || !id(input.projectId)) return fail('INVALID_INPUT', 'A Project ID is required');
            const project = useTaskStore.getState()._projectsById.get(input.projectId);
            if (!project || project.deletedAt || project.purgedAt)
                return fail('STALE_REVISION', 'Project is unavailable; refresh before editing links');
            const expected = token(project);
            const value = { revision: deps.revision(), project: { id: project.id, ...expected },
                canEdit: project.status !== 'archived' };
            return validToken(expected) && isNativeJsonWithinBytes(value) ? { ok: true, value }
                : fail('INVALID_INPUT', 'Project links exceed the bounded native response');
        },

        probeProjectAttachmentWriteOutcome(input: NativeProjectAttachmentWriteRequest): NativeHostResult<NativeProjectAttachmentWriteResult> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            return readRequest(input) ? fail('STALE_REVISION', 'Project link outcome is unknown; refresh before trying again')
                : fail('INVALID_INPUT', 'A bounded Project link request is required');
        },

        prepareProjectAttachmentWrite(input: NativeProjectAttachmentWriteRequest): NativeHostResult<NativeProjectAttachmentWritePreparation> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const request = readRequest(input);
            if (!request) return fail('INVALID_INPUT', 'A bounded Project link request is required');
            const state = useTaskStore.getState();
            const project = state._projectsById.get(request.projectId);
            if (!project || project.deletedAt || project.purgedAt || !same(token(project), request.expected))
                return fail('STALE_REVISION', 'Project changed; refresh before editing links');
            if (project.status === 'archived')
                return { ok: true, value: { kind: 'blocked', result: { blocked: '' } } };
            const updateAt = new Date().toISOString();
            let ids: string[];
            if (request.intent.kind === 'add') {
                let index = 0;
                const batch = planAttachmentLinkBatch(request.intent.text, {
                    newId: () => requestRowId(request.requestId, `link:${index++}`), now: updateAt, t: deps.t(),
                });
                if (batch.kind === 'nothing')
                    return { ok: true, value: { kind: 'noop', result: { id: project.id, attachmentIds: [] } } };
                if (batch.kind === 'refused') return { ok: true, value: { kind: 'refused', result: { message: batch.message } } };
                ids = batch.added.map((row) => row.id);
                if (ids.some((candidate) => project.attachments?.some((row) => row.id === candidate)))
                    return fail('STALE_REVISION', 'Project link ID is already in use');
            } else {
                const { attachmentId } = request.intent;
                const target = project.attachments?.find((row) => row.id === attachmentId);
                if (!target || target.deletedAt)
                    return { ok: true, value: { kind: 'noop', result: { id: project.id, attachmentIds: [] } } };
                if (target.kind !== 'link') return fail('INVALID_INPUT', 'Only a Project link can be removed');
                ids = [target.id];
            }
            const device = ensureDeviceId(state.settings);
            const effect = projectAttachmentWriteEffect(project, request.intent, ids, device.deviceId, updateAt);
            if (!effect || effect.project.after.rev! <= (project.rev ?? 0))
                return fail('STALE_REVISION', 'Project link revision cannot advance');
            const prepared: NativePreparedProjectAttachmentWrite = { version: 1, request,
                scope: { project }, effect,
                deviceIdBefore: state.settings.deviceId ?? null,
                deviceIdToInitialize: device.updated ? device.deviceId : null,
                updateAt, result: { id: project.id, attachmentIds: ids } };
            const frozen = detach<NativePreparedProjectAttachmentWrite>(JSON.parse(JSON.stringify(prepared)));
            return frozen && readPrepared({ request, prepared: frozen })
                ? { ok: true, value: { kind: 'prepared', prepared: frozen } }
                : fail('INVALID_INPUT', 'Project link edit exceeds the bounded journal');
        },

        validatePreparedProjectAttachmentWrite(input: { request: NativeProjectAttachmentWriteRequest;
            prepared: NativePreparedProjectAttachmentWrite }): NativeHostResult<NativeProjectAttachmentWriteResult> {
            const prepared = readPrepared(input);
            return prepared ? { ok: true, value: prepared.result }
                : fail('INVALID_INPUT', 'Prepared Project link request or journal does not match');
        },

        async commitPreparedProjectAttachmentWrite(input: { request: NativeProjectAttachmentWriteRequest;
            prepared: NativePreparedProjectAttachmentWrite }): Promise<NativeHostResult<NativeProjectAttachmentWriteResult>> {
            const ready = deps.readiness();
            if (!ready.ok) return ready;
            const prepared = readPrepared(input);
            if (!prepared) return fail('INVALID_INPUT', 'Prepared Project link request or journal does not match');
            const applied = await useTaskStore.getState().commitPreparedProjectAttachmentWrite(prepared);
            if (!applied.success) return fail('STALE_REVISION', 'Prepared Project link edit conflicts with current data');
            try {
                if (useTaskStore.getState().persistenceFailure) await useTaskStore.getState().retryPersistence();
            } catch { return fail('SAVE_FAILED', 'Could not save Project links'); }
            const saved = await deps.save();
            return saved.ok ? { ok: true, value: prepared.result } : fail('SAVE_FAILED', 'Could not save Project links');
        },
    };
}
