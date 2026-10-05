import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareNativeAttachmentDraftAdd, prepareNativeAttachmentDraftAddV2,
    validateNativeAttachmentDraftBegin, validateNativeAttachmentDraftBeginV2,
    validateNativeAttachmentDraftLineage, validateNativeAttachmentDraftLineageV2,
    completeNativeAttachmentDraftAdd, type NativeAttachmentDraftPrepared,
    type NativeAttachmentDraftLineageInputV2, type NativeAttachmentDraftPrepareInputV2 } from './native-attachment-draft';
import * as upload from './attachment-validation';
import type { Attachment } from './types';

const AT = '2026-10-05T00:00:00.000Z';
const ID = '11111111-1111-4111-8111-111111111111';
const NEXT = '22222222-2222-4222-8222-222222222222';
const ROOT = 'file:///owned/documents/attachments/';
const file: Attachment = { id: 'saved-file', kind: 'file', title: 'Saved', uri: ROOT + 'saved.pdf',
    size: 2, createdAt: AT, updatedAt: AT };
const link: Attachment = { id: 'saved-link', kind: 'link', title: 'Link', uri: 'https://example.test', createdAt: AT, updatedAt: AT };
const ports = () => ({ assertEditable: vi.fn(), t: (key: string) => key });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const opening = () => JSON.stringify({ version: 2, taskID: 'task', attachmentsOwned: true,
    attachmentsBase: [file, link], attachments: [file, link], raw: { title: 'Opening', note: '', scheduleEdits: [] } });
const edit = (json: string, fields: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(json), ...fields });
const input = (patch: Partial<NativeAttachmentDraftPrepareInputV2> = {}): NativeAttachmentDraftPrepareInputV2 => ({
    version: 2, taskID: 'task', initialPayloadJSON: opening(), beforePayloadJSON: opening(), priorAdditions: [],
    managedDirectoryURI: ROOT, requestId: ID, picked: { uri: 'file:///cache/picked.pdf', name: 'Picked.pdf', mimeType: null, size: null },
    measuredSize: 3, ...patch,
});
const lineage = (value: NativeAttachmentDraftPrepareInputV2): NativeAttachmentDraftLineageInputV2 => {
    const { requestId: _id, picked: _picked, measuredSize: _size, ...result } = value;
    return result;
};
async function prepared(value = input()): Promise<NativeAttachmentDraftPrepared> {
    const result = await prepareNativeAttachmentDraftAddV2(value, ports());
    if (result.kind !== 'prepared') throw new Error('Fixture refused');
    return result;
}

describe('v2 attachment history with ordinary editor checkpoints', () => {
    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

    it('begins with exact opaque bytes and unchanged attachment lists', () => {
        const payloadJSON = ` \n${opening()}\n`, deps = ports();
        expect(validateNativeAttachmentDraftBeginV2({ taskID: 'task', payloadJSON }, deps))
            .toEqual({ version: 2, taskID: 'task', payloadJSON });
        expect(deps.assertEditable).toHaveBeenCalledExactlyOnceWith('task');
    });

    it('preserves ordinary edits before, between and after Adds without rebuilding history', async () => {
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(AT);
        const first = await prepared(input({ beforePayloadJSON: edit(opening(), { raw: { title: 'First edit', pending: '保留' } }) }));
        const nextBefore = edit(first.afterPayloadJSON, { raw: { title: 'Second edit', tokens: '@pending' }, checklist: ['opaque'] });
        vi.setSystemTime('2026-10-06T00:00:00.000Z');
        const second = await prepared(input({ requestId: NEXT, beforePayloadJSON: nextBefore, priorAdditions: [first] }));
        const latest = ` \n${edit(second.afterPayloadJSON, { raw: { title: 'Newest', note: 'Unresolved input' } })}\n`;
        const frozen = copy([first, second]);
        const policy = vi.spyOn(upload, 'validateAttachmentForUpload').mockRejectedValue(new Error('No historical policy'));
        expect(validateNativeAttachmentDraftLineageV2(lineage(input({ beforePayloadJSON: latest, priorAdditions: [first, second] }))))
            .toEqual({ version: 2, taskID: 'task', payloadJSON: latest });
        expect([first, second]).toEqual(frozen);
        expect(first.attachment.createdAt).toBe(AT);
        expect(JSON.parse(second.afterPayloadJSON)).toEqual({ ...JSON.parse(nextBefore),
            attachments: [...JSON.parse(nextBefore).attachments, second.attachment] });
        expect(policy).not.toHaveBeenCalled();
    });

    it('keeps v1 byte-chain and version admission sealed', async () => {
        const first = await prepared();
        const value = input({ requestId: NEXT, priorAdditions: [first], beforePayloadJSON: edit(first.afterPayloadJSON, { raw: { title: 'Changed' } }) });
        await expect(prepareNativeAttachmentDraftAdd(value, ports())).rejects.toThrow('INVALID_INPUT');
        await expect(prepareNativeAttachmentDraftAdd({ ...value, version: 1 }, ports())).rejects.toThrow('INVALID_INPUT');
        expect(() => validateNativeAttachmentDraftLineage({ ...lineage(value), version: 1 })).toThrow('INVALID_INPUT');
        expect(() => validateNativeAttachmentDraftLineage(lineage(value))).toThrow('INVALID_INPUT');
        await expect(prepareNativeAttachmentDraftAddV2({ ...input(), version: 1 }, ports())).rejects.toThrow('INVALID_INPUT');
        expect(() => validateNativeAttachmentDraftLineageV2({ ...lineage(input()), version: 1 })).toThrow('INVALID_INPUT');
    });

    it('refuses initial URL edits that the unchanged v1 Begin permits', () => {
        const value = JSON.parse(opening()); value.attachments[1].title = 'Changed link';
        const request = { taskID: 'task', payloadJSON: JSON.stringify(value) };
        expect(validateNativeAttachmentDraftBegin(request, ports()).version).toBe(1);
        expect(() => validateNativeAttachmentDraftBeginV2(request, ports())).toThrow('INVALID_INPUT');
    });

    it.each(['remove', 'reorder', 'title', 'uri', 'tombstone', 'base', 'extraFile', 'extraLink', 'task', 'owned'])(
        'refuses attachment projection drift after Add: %s', async (kind) => {
            const first = await prepared(), current = JSON.parse(first.afterPayloadJSON);
            if (kind === 'remove') current.attachments.pop();
            if (kind === 'reorder') current.attachments.reverse();
            if (kind === 'title') current.attachments[0].title = 'Changed';
            if (kind === 'uri') current.attachments[2].uri = ROOT + 'other.pdf';
            if (kind === 'tombstone') current.attachments[2].deletedAt = AT;
            if (kind === 'base') current.attachmentsBase[0].title = 'Changed base';
            if (kind === 'extraFile') current.attachments.push({ ...file, id: 'foreign' });
            if (kind === 'extraLink') current.attachments.push({ ...link, id: 'foreign-link' });
            if (kind === 'task') current.taskID = 'other';
            if (kind === 'owned') current.attachmentsOwned = false;
            const value = input({ requestId: NEXT, priorAdditions: [first], beforePayloadJSON: JSON.stringify(current) });
            expect(() => validateNativeAttachmentDraftLineageV2(lineage(value))).toThrow('INVALID_INPUT');
            await expect(prepareNativeAttachmentDraftAddV2(value, ports())).rejects.toThrow('INVALID_INPUT');
        });

    it.each(['missing', 'duplicate', 'root', 'beforeList', 'frozenOrdinary', 'frozenMetadata', 'initialBase'])(
        'refuses altered frozen history: %s', async (kind) => {
            const first = await prepared();
            const value = copy(input({ requestId: NEXT, priorAdditions: [first], beforePayloadJSON: first.afterPayloadJSON }));
            const prior = value.priorAdditions[0] as unknown as Record<string, unknown>;
            if (kind === 'missing') value.priorAdditions = [];
            if (kind === 'duplicate') value.priorAdditions = [first, first];
            if (kind === 'root') value.managedDirectoryURI = 'file:///other/attachments/';
            if (kind === 'beforeList') prior.beforePayloadJSON = edit(first.beforePayloadJSON, { attachments: [] });
            if (kind === 'frozenOrdinary') prior.afterPayloadJSON = edit(first.afterPayloadJSON, { raw: { title: 'Not the frozen append' } });
            if (kind === 'frozenMetadata') (prior.attachment as Record<string, unknown>).title = 'Changed metadata';
            if (kind === 'initialBase') value.initialPayloadJSON = edit(opening(), { attachmentsBase: [], attachments: [] });
            expect(() => validateNativeAttachmentDraftLineageV2(lineage(value))).toThrow('INVALID_INPUT');
        });

    it('uses the existing frozen per-operation completion unchanged', async () => {
        const result = await prepared(input({ beforePayloadJSON: edit(opening(), { raw: { note: 'Keep exact' } }) }));
        expect(await completeNativeAttachmentDraftAdd({ prepared: result }, ports())).toMatchObject({
            version: 1, kind: 'added', requestId: ID, afterPayloadJSON: result.afterPayloadJSON, attachment: result.attachment,
        });
    });

    it('captures caller input before awaiting current upload policy', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const original = upload.validateAttachmentForUpload;
        vi.spyOn(upload, 'validateAttachmentForUpload').mockImplementation(async (...args) => { await gate; return original(...args); });
        const value = input(), frozen = copy(value);
        const pending = prepareNativeAttachmentDraftAddV2(value, ports());
        value.beforePayloadJSON = edit(opening(), { raw: { title: 'Later caller mutation' } });
        value.picked = { ...value.picked, name: 'Later name' };
        release();
        const result = await pending;
        expect(result).toMatchObject({ kind: 'prepared', beforePayloadJSON: frozen.beforePayloadJSON,
            attachment: { title: 'Picked.pdf' } });
    });

    it.each(['getter', 'sparse', 'iterator', 'tooMany'])('rejects unsafe history arrays without calling accessors: %s', async (kind) => {
        const first = await prepared(), getter = vi.fn(() => first);
        const additions: NativeAttachmentDraftPrepared[] = [];
        if (kind === 'getter') Object.defineProperty(additions, '0', { get: getter, enumerable: true });
        if (kind === 'sparse') additions.length = 1;
        if (kind === 'iterator') { additions.push(first); Object.defineProperty(additions, Symbol.iterator, { get: getter }); }
        if (kind === 'tooMany') additions.push(...Array(129).fill(first));
        const value = lineage(input({ priorAdditions: additions, beforePayloadJSON: first.afterPayloadJSON }));
        expect(() => validateNativeAttachmentDraftLineageV2(value)).toThrow('INVALID_INPUT');
        expect(() => validateNativeAttachmentDraftLineage({ ...value, version: 1 })).toThrow('INVALID_INPUT');
        expect(getter).not.toHaveBeenCalled();
    });

    it.each(['unknown', 'bytes', 'overflow', 'malformed'])('refuses malformed or unbounded latest payload: %s', (kind) => {
        const value = lineage(input());
        if (kind === 'unknown') Object.assign(value, { ownership: true });
        if (kind === 'bytes') value.beforePayloadJSON = edit(opening(), { raw: '界'.repeat(350_000) });
        if (kind === 'overflow') value.beforePayloadJSON = opening().replace(/}$/, ',"rawNumber":1e400}');
        if (kind === 'malformed') value.beforePayloadJSON = '{broken';
        expect(() => validateNativeAttachmentDraftLineageV2(value)).toThrow('INVALID_INPUT');
    });
});
