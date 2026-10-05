import { afterEach, describe, expect, it, vi } from 'vitest';
import { addPickedAttachment } from './attachment-editor-model';
import * as validation from './attachment-validation';
import { getManagedAttachmentFileName } from './mobile-attachment-files';
import { completeNativeAttachmentDraftAdd, prepareNativeAttachmentDraftAdd, validateNativeAttachmentDraftBegin,
    type NativeAttachmentDraftDependencies, type NativeAttachmentDraftPrepared, type NativeAttachmentDraftPrepareInput } from './native-attachment-draft';
import type { Attachment } from './types';

const AT = '2026-10-05T00:00:00.000Z';
const LATER = '2026-10-06T00:00:00.000Z';
const TASK = 'saved-task';
const ROOT = 'file:///owned/documents/attachments/';
const ID = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';
const t = (key: string) => `translated:${key}`;
const deps = (): NativeAttachmentDraftDependencies => ({ assertEditable: vi.fn(), t });
type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
    : T extends object ? { -readonly [Field in keyof T]: Mutable<T[Field]> } : T;
const copy = <T>(value: T): Mutable<T> => JSON.parse(JSON.stringify(value)) as Mutable<T>;
const oldFile = (id = 'old-file'): Attachment => ({ id, kind: 'file', title: 'Old.PDF', uri: 'file:///old/file.pdf',
    mimeType: 'application/pdf', size: 7, createdAt: AT, updatedAt: AT, localStatus: 'available' });
const opening = () => {
    const file = oldFile();
    const link: Attachment = { id: 'old-link', kind: 'link', title: 'Old link', uri: 'https://example.test/old', createdAt: AT, updatedAt: AT };
    const tombstone = { ...oldFile('deleted-file'), deletedAt: AT };
    return { version: 2, taskID: TASK, attachmentsOwned: true,
        attachmentsBase: [file, link, tombstone],
        attachments: [{ ...file }, { ...link, title: 'New link', uri: 'https://example.test/new', updatedAt: LATER }, { ...tombstone }],
        title: 'Uncommitted title', checklist: [{ id: 'check', title: 'Uncommitted item', isCompleted: true }],
        scheduleBase: { dueDate: 'raw/no normalization', startTime: null }, tags: ['@raw'],
        unknownEditorField: { nested: [{ untouched: '文', value: null }], raw: 'exact/raw' } };
};
const initial = () => JSON.stringify(opening());
const input = (fields: Partial<NativeAttachmentDraftPrepareInput> = {}): NativeAttachmentDraftPrepareInput => {
    const payload = initial();
    return { version: 1, taskID: TASK, initialPayloadJSON: payload, beforePayloadJSON: payload, priorAdditions: [],
        requestId: ID, picked: { uri: 'file:///cache/source.pdf', name: 'Report.PDF', mimeType: 'application/pdf', size: 99 },
        measuredSize: 3, managedDirectoryURI: ROOT, ...fields };
};
const prepare = async (value = input(), ports = deps()): Promise<NativeAttachmentDraftPrepared> => {
    const result = await prepareNativeAttachmentDraftAdd(value, ports);
    expect(result.kind).toBe('prepared');
    if (result.kind !== 'prepared') throw new Error('Expected preparation');
    return result;
};
const next = (previous: NativeAttachmentDraftPrepared[], fields: Partial<NativeAttachmentDraftPrepareInput> = {}) => input({
    beforePayloadJSON: previous.at(-1)!.afterPayloadJSON, priorAdditions: previous, requestId: SECOND, ...fields,
});
const refused = (work: Promise<unknown>) => expect(work).rejects.toThrow(/^INVALID_INPUT$/);

describe('native attachment Add projection foundation', () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it('Begin returns the exact original string and preserves existing URL-only draft edits', () => {
        const payloadJSON = ` \n${initial()}\n `, ports = deps();
        expect(validateNativeAttachmentDraftBegin({ taskID: TASK, payloadJSON }, ports)).toEqual({ version: 1, taskID: TASK, payloadJSON });
        expect(ports.assertEditable).toHaveBeenCalledExactlyOnceWith(TASK);
    });

    it.each([
        (value: ReturnType<typeof opening>) => { value.attachments[0].title = 'Forged file title'; },
        (value: ReturnType<typeof opening>) => { value.attachments.splice(0, 1); },
        (value: ReturnType<typeof opening>) => { value.attachments.push(oldFile('new-file')); },
        (value: ReturnType<typeof opening>) => { value.attachments[0].uri = 'file:///replaced'; },
        (value: ReturnType<typeof opening>) => { value.attachmentsOwned = false; },
        (value: ReturnType<typeof opening>) => { value.taskID = 'different-task'; },
    ])('Begin refuses file-half mutation or a forged editor envelope %#', (mutate) => {
        const value = opening(); mutate(value);
        expect(() => validateNativeAttachmentDraftBegin({ taskID: TASK, payloadJSON: JSON.stringify(value) }, deps())).toThrow(/^INVALID_INPUT$/);
    });

    it.each([
        { taskID: TASK, payloadJSON: initial(), ownership: true },
        { taskID: '', payloadJSON: initial() }, { taskID: '界'.repeat(167), payloadJSON: initial() },
        { taskID: TASK, payloadJSON: '{broken' }, { taskID: TASK, payloadJSON: '[]' },
        { taskID: TASK, payloadJSON: JSON.stringify({ ...opening(), version: 1 }) },
        { taskID: TASK, payloadJSON: initial().replace(/}$/, ',"unknownOverflow":1e400}') },
        { taskID: TASK, payloadJSON: JSON.stringify({ ...opening(), raw: '界'.repeat(350_000) }) },
    ])('Begin rejects malformed or byte-unbounded input %#', (value) => {
        expect(() => validateNativeAttachmentDraftBegin(value, deps())).toThrow(/^INVALID_INPUT$/);
    });

    it('projects exactly one rehomed RN attachment and preserves every other editor field', async () => {
        vi.useFakeTimers(); vi.setSystemTime(AT);
        const request = input(), ports = deps(), result = await prepare(request, ports);
        expect(Object.keys(result).sort()).toEqual(['version', 'kind', 'taskID', 'requestId', 'picked', 'measuredSize',
            'managedDirectoryURI', 'beforePayloadJSON', 'afterPayloadJSON', 'prepared', 'targetURI', 'attachment'].sort());
        expect(result.targetURI).toBe(`${ROOT}${ID}.pdf`);
        expect(result.prepared).toEqual({ kind: 'prepared', attachment: { id: ID, kind: 'file', title: 'Report.PDF',
            uri: request.picked.uri, mimeType: 'application/pdf', size: 3, createdAt: AT, updatedAt: AT, localStatus: 'available' } });
        expect(result.attachment).toEqual({ ...result.prepared.attachment, uri: result.targetURI });
        expect(JSON.parse(result.afterPayloadJSON)).toEqual({ ...opening(), attachments: [...opening().attachments, result.attachment] });
        expect(result.beforePayloadJSON).toBe(request.beforePayloadJSON);
        expect(ports.assertEditable).toHaveBeenCalledTimes(2);
        expect(request).toEqual(input());
    });

    it('replays serialized metadata unchanged after clocks advance, without UUID generation or copy ports', async () => {
        vi.useFakeTimers(); vi.setSystemTime(AT);
        const prepared = copy(await prepare()), retained = copy(prepared);
        vi.setSystemTime(LATER);
        const ports = deps();
        const first = await completeNativeAttachmentDraftAdd({ prepared }, ports);
        const second = await completeNativeAttachmentDraftAdd({ prepared: copy(prepared) }, ports);
        expect(first).toEqual(second);
        expect(first).toEqual({ version: 1, kind: 'added', taskID: TASK, requestId: ID,
            afterPayloadJSON: prepared.afterPayloadJSON, attachment: prepared.attachment });
        expect(prepared).toEqual(retained);
        expect(first).toMatchObject({ attachment: { id: ID, createdAt: AT, updatedAt: AT } });
    });

    it('preserves ordered two-and-three-Add lineage including prior frozen metadata and file records', async () => {
        vi.useFakeTimers(); vi.setSystemTime(AT);
        const first = copy(await prepare()); vi.setSystemTime(LATER);
        const second = copy(await prepare(next([first])));
        const third = await prepare(next([first, second], { requestId: THIRD }));
        expect(second.beforePayloadJSON).toBe(first.afterPayloadJSON);
        expect(third.beforePayloadJSON).toBe(second.afterPayloadJSON);
        expect(JSON.parse(third.afterPayloadJSON).attachments).toEqual([...opening().attachments, first.attachment, second.attachment, third.attachment]);
        expect(first.attachment.createdAt).toBe(AT);
        expect(second.attachment.createdAt).toBe(LATER);
        expect(JSON.parse(third.afterPayloadJSON).attachmentsBase).toEqual(opening().attachmentsBase);
    });

    it.each(['root', 'task', 'request', 'before', 'projection', 'old-file', 'extra-record'])('refuses forged prior lineage: %s', async (field) => {
        const first = copy(await prepare()), value = next([first]);
        if (field === 'root') value.managedDirectoryURI = 'file:///different/attachments/';
        if (field === 'task') value.taskID = 'different-task';
        if (field === 'request') value.requestId = first.requestId;
        if (field === 'before') value.beforePayloadJSON = initial();
        if (field === 'projection') first.afterPayloadJSON = JSON.stringify({ ...JSON.parse(first.afterPayloadJSON), title: 'Forged title' });
        if (field === 'old-file') {
            const payload = JSON.parse(first.afterPayloadJSON); payload.attachments[0].uri = 'file:///changed';
            first.afterPayloadJSON = JSON.stringify(payload); value.beforePayloadJSON = first.afterPayloadJSON;
        }
        if (field === 'extra-record') {
            const payload = JSON.parse(first.afterPayloadJSON); payload.attachments.push(oldFile('forged'));
            first.afterPayloadJSON = JSON.stringify(payload); value.beforePayloadJSON = first.afterPayloadJSON;
        }
        await refused(prepareNativeAttachmentDraftAdd(value, deps()));
    });

    it('requires exact opaque chain strings while comparing unrelated payload property order semantically', async () => {
        const first = copy(await prepare());
        const reordered = Object.fromEntries(Object.entries(JSON.parse(first.afterPayloadJSON)).reverse());
        first.afterPayloadJSON = JSON.stringify(reordered);
        expect((await prepare(next([first]))).beforePayloadJSON).toBe(first.afterPayloadJSON);
        await refused(prepareNativeAttachmentDraftAdd(next([first], { beforePayloadJSON: ` ${first.afterPayloadJSON}` }), deps()));
    });

    it.each([
        { measuredSize: 50 * 1024 * 1024 + 1, picked: { uri: 'file:///cache/source', name: 'file', mimeType: null, size: 0 }, message: 'attachments.fileTooLarge' },
        { measuredSize: 1, picked: { uri: 'file:///cache/source', name: 'file', mimeType: ' APPLICATION/X-EXECUTABLE ', size: 0 }, message: 'attachments.invalidFileType' },
    ])('uses RN refusal policy with authoritative measured size: $message', async ({ measuredSize, picked, message }) => {
        const ports = deps();
        expect(await prepareNativeAttachmentDraftAdd(input({ measuredSize, picked }), ports)).toEqual({ kind: 'refused', message: t(message) });
        expect(ports.assertEditable).toHaveBeenCalledTimes(2);
    });

    it('ignores an oversized advisory picker size and keeps null MIME absent across serialization', async () => {
        const result = await prepare(input({ picked: { uri: 'file:///cache/no-extension', name: '', mimeType: null, size: 100_000_000 }, measuredSize: 0 }));
        expect(result.attachment.title).toBe('file');
        expect(result.attachment.size).toBe(0);
        expect(result.prepared.attachment).not.toHaveProperty('mimeType');
        expect(result.attachment).not.toHaveProperty('mimeType');
        expect((await completeNativeAttachmentDraftAdd({ prepared: copy(result) }, deps())).kind).toBe('added');
    });

    it('returns RN unchanged-URI refusal at Prepare and defensive Complete', async () => {
        const source = `${ROOT}${ID}.pdf`;
        expect(await prepareNativeAttachmentDraftAdd(input({ picked: { uri: source, name: 'Report.PDF', mimeType: 'application/pdf', size: 3 } }), deps()))
            .toEqual({ kind: 'refused', message: t('attachments.fileNotReadable') });
        const frozen = copy(await prepare());
        frozen.picked = { ...frozen.picked, uri: frozen.targetURI };
        frozen.prepared.attachment = { ...frozen.prepared.attachment, uri: frozen.targetURI };
        expect(await completeNativeAttachmentDraftAdd({ prepared: frozen }, deps())).toEqual({ kind: 'refused', message: t('attachments.fileNotReadable') });
    });

    it('captures caller fields and dependencies before asynchronous upload validation', async () => {
        vi.useFakeTimers(); vi.setSystemTime(AT);
        const value = input(), ports = deps(), original = copy(value);
        const pending = prepareNativeAttachmentDraftAdd(value, ports);
        value.picked = { uri: 'file:///changed', name: 'Changed', mimeType: 'text/plain', size: 90 };
        value.taskID = 'changed-task'; value.requestId = SECOND; value.managedDirectoryURI = 'file:///changed/';
        value.beforePayloadJSON = '{}'; value.priorAdditions = [copy({}) as NativeAttachmentDraftPrepared];
        ports.t = () => 'replacement'; ports.assertEditable = () => { throw new Error('replacement authority'); };
        const result = await pending;
        expect(result).toMatchObject({ kind: 'prepared', taskID: original.taskID, requestId: original.requestId,
            picked: original.picked, beforePayloadJSON: original.beforePayloadJSON, managedDirectoryURI: original.managedDirectoryURI });
    });

    it('propagates authoritative readonly rejection before and after Prepare validation', async () => {
        const readonly = new Error('controlled readonly');
        const before = deps(); before.assertEditable = () => { throw readonly; };
        await expect(prepareNativeAttachmentDraftAdd(input(), before)).rejects.toBe(readonly);
        const after = deps(); after.assertEditable = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw readonly; });
        await expect(prepareNativeAttachmentDraftAdd(input(), after)).rejects.toBe(readonly);
    });

    it('captures mutable Complete input before awaited validation and preserves its opaque after string', async () => {
        const frozen = copy(await prepare()), original = copy(frozen), ports = deps();
        const pending = completeNativeAttachmentDraftAdd({ prepared: frozen }, ports);
        frozen.afterPayloadJSON = '{}'; frozen.attachment.title = 'Changed';
        frozen.prepared.attachment.uri = 'file:///changed';
        ports.assertEditable = () => { throw new Error('replacement authority'); };
        const result = await pending;
        expect(result).toEqual({ version: 1, kind: 'added', taskID: original.taskID, requestId: original.requestId,
            afterPayloadJSON: original.afterPayloadJSON, attachment: original.attachment });
    });

    it('rejects getters and non-JSON envelope fields without reading a caller getter', async () => {
        const getter = vi.fn(() => input().picked);
        const value = input(); Object.defineProperty(value, 'picked', { get: getter, enumerable: true });
        await refused(prepareNativeAttachmentDraftAdd(value, deps()));
        expect(getter).not.toHaveBeenCalled();
        const symbol = { ...input(), [Symbol('ownership')]: true };
        await refused(prepareNativeAttachmentDraftAdd(symbol, deps()));
        const hidden = input(); Object.defineProperty(hidden, 'ownership', { value: true });
        await refused(prepareNativeAttachmentDraftAdd(hidden, deps()));
    });

    it.each([1, 2, 3])('rechecks editable authority at Complete boundary %i', async (boundary) => {
        const prepared = await prepare(), readonly = new Error('controlled readonly');
        let calls = 0;
        const ports = deps(); ports.assertEditable = () => { if (++calls === boundary) throw readonly; };
        await expect(completeNativeAttachmentDraftAdd({ prepared }, ports)).rejects.toBe(readonly);
        expect(calls).toBe(boundary);
    });

    it('applies current shared upload policy at Complete without revalidating historical lineage', async () => {
        const historical = copy(await prepare(input({ picked: { uri: 'file:///cache/historical.pdf', name: 'Historical.PDF', mimeType: 'application/historical', size: 3 } })));
        const actual = validation.validateAttachmentForUpload;
        vi.spyOn(validation, 'validateAttachmentForUpload').mockImplementation(async (attachment, bytes, config) => (
            attachment.mimeType === 'application/historical' ? { valid: false, error: 'mime_type_blocked' } : actual(attachment, bytes, config)
        ));
        const nextPrepared = await prepare(next([historical]));
        expect(JSON.parse(nextPrepared.afterPayloadJSON).attachments).toContainEqual(historical.attachment);
        await refused(completeNativeAttachmentDraftAdd({ prepared: historical }, deps()));
    });

    it.each(['title', 'mime', 'source', 'size', 'stamp', 'id', 'target', 'root', 'projection', 'deleted', 'cloud', 'unknown'])('rejects a forged current frozen record: %s', async (field) => {
        const frozen = copy(await prepare());
        const mutable = frozen as unknown as { [key: string]: unknown; prepared: { attachment: Record<string, unknown> }; attachment: Record<string, unknown> };
        if (field === 'title') mutable.prepared.attachment.title = 'Forged';
        if (field === 'mime') mutable.prepared.attachment.mimeType = 'text/plain';
        if (field === 'source') mutable.prepared.attachment.uri = 'file:///changed';
        if (field === 'size') mutable.prepared.attachment.size = 999;
        if (field === 'stamp') mutable.prepared.attachment.updatedAt = LATER;
        if (field === 'id') mutable.prepared.attachment.id = SECOND;
        if (field === 'target') mutable.targetURI = `${ROOT}${SECOND}.pdf`;
        if (field === 'root') mutable.managedDirectoryURI = 'file:///other/';
        if (field === 'projection') mutable.afterPayloadJSON = initial();
        if (field === 'deleted') mutable.attachment.deletedAt = AT;
        if (field === 'cloud') mutable.prepared.attachment.cloudKey = 'unsupported';
        if (field === 'unknown') mutable.unprovenOwnership = true;
        await refused(completeNativeAttachmentDraftAdd({ prepared: frozen }, deps()));
    });

    it('matches actual RN Add under the same fixed clock and completed-copy adapter', async () => {
        vi.useFakeTimers(); vi.setSystemTime(AT);
        const request = input(), frozen = await prepare(request);
        const direct = await addPickedAttachment({ source: 'file', asset: { ...request.picked, size: request.measuredSize }, newId: () => ID, t,
            persist: async (attachment) => ({ ...attachment, uri: ROOT + getManagedAttachmentFileName(attachment),
                size: request.measuredSize, localStatus: 'available' }) });
        const completed = await completeNativeAttachmentDraftAdd({ prepared: copy(frozen) }, deps());
        expect(completed.kind).toBe('added');
        if (completed.kind !== 'added') throw new Error('Expected completion');
        expect(copy({ kind: completed.kind, attachment: completed.attachment })).toEqual(copy(direct));
    });

    it.each(['file://host/path/', 'file:///a/../attachments/', 'file:///a/%2e%2e/attachments/',
        'file:///a/%2F..%2Fattachments/', 'file:///a/?query', 'file:///a/#fragment', 'file:///a', 'https://example.test/a/'])('refuses an unsafe or incomplete managed directory URI: %s', async (managedDirectoryURI) => {
        await refused(prepareNativeAttachmentDraftAdd(input({ managedDirectoryURI }), deps()));
    });

    it.each(['file://name:secret@host/source', 'file:///cache/../source', 'file:///cache/%2e/source', 'file:///cache/source?secret',
        'file:///cache/source#fragment', 'file:///cache/so\turce', 'file:///cache/space name',
        'content://source', 'relative', `file:///cache/${'x'.repeat(16 * 1024)}`])('refuses an unsafe source URI before RN preparation: %s', async (uri) => {
        await refused(prepareNativeAttachmentDraftAdd(input({ picked: { ...input().picked, uri } }), deps()));
    });

    it.each([
        { version: 2 }, { requestId: 'A1111111-1111-4111-8111-111111111111' }, { measuredSize: -1 }, { measuredSize: Number.MAX_SAFE_INTEGER + 1 },
        { picked: { ...input().picked, size: Number.POSITIVE_INFINITY } },
        { picked: { ...input().picked, name: 'x'.repeat(100_001) } }, { picked: { ...input().picked, mimeType: 'x'.repeat(501) } },
        { priorAdditions: Array(129).fill({}) }, { picked: { ...input().picked, owned: true } }, { unprovenOwnership: true },
    ])('rejects strict envelope/metadata bounds %#', async (fields) => {
        await refused(prepareNativeAttachmentDraftAdd({ ...input(), ...fields }, deps()));
    });

    it('rejects request IDs already present in the initial file or URL half', async () => {
        const value = opening(); value.attachmentsBase[0].id = ID; value.attachments[0].id = ID;
        const payloadJSON = JSON.stringify(value);
        await refused(prepareNativeAttachmentDraftAdd(input({ initialPayloadJSON: payloadJSON, beforePayloadJSON: payloadJSON }), deps()));
    });

    it('enforces 1000 attachment records while admitting the final legal append', async () => {
        const fixture = (count: number) => {
            const attachments = Array.from({ length: count }, (_, index) => oldFile(`old-${index}`));
            return JSON.stringify({ version: 2, taskID: TASK, attachmentsOwned: true, attachmentsBase: attachments, attachments });
        };
        const full = fixture(1_000);
        expect(validateNativeAttachmentDraftBegin({ taskID: TASK, payloadJSON: full }, deps()).payloadJSON).toBe(full);
        await refused(prepareNativeAttachmentDraftAdd(input({ initialPayloadJSON: full, beforePayloadJSON: full }), deps()));
        const final = fixture(999), result = await prepare(input({ initialPayloadJSON: final, beforePayloadJSON: final }));
        expect(JSON.parse(result.afterPayloadJSON).attachments).toHaveLength(1_000);
        expect(() => validateNativeAttachmentDraftBegin({ taskID: TASK, payloadJSON: fixture(1_001) }, deps())).toThrow(/^INVALID_INPUT$/);
    });

    it('refuses after-payload and complete frozen-result byte overflow', async () => {
        const value = { version: 2, taskID: TASK, attachmentsOwned: true, attachmentsBase: [], attachments: [], raw: '' };
        value.raw = 'x'.repeat(1_000_000 - JSON.stringify(value).length);
        const atLimit = JSON.stringify(value);
        expect(Buffer.byteLength(atLimit)).toBe(1_000_000);
        expect(validateNativeAttachmentDraftBegin({ taskID: TASK, payloadJSON: atLimit }, deps()).payloadJSON).toBe(atLimit);
        await refused(prepareNativeAttachmentDraftAdd(input({ initialPayloadJSON: atLimit, beforePayloadJSON: atLimit }), deps()));
        value.raw = 'x'.repeat(870_000);
        const near = JSON.stringify(value);
        await refused(prepareNativeAttachmentDraftAdd(input({ initialPayloadJSON: near, beforePayloadJSON: near,
            picked: { ...input().picked, name: 'x'.repeat(100_000) } }), deps()));
    });

    it('rejects an aggregate over 8 MiB before parsing any prior lineage', async () => {
        const prior = copy(await prepare());
        prior.beforePayloadJSON = 'x'.repeat(700_000); prior.afterPayloadJSON = 'y'.repeat(700_000);
        const ports = deps();
        const parse = vi.spyOn(JSON, 'parse');
        await refused(prepareNativeAttachmentDraftAdd(input({ priorAdditions: Array(7).fill(prior) }), ports));
        expect(ports.assertEditable).not.toHaveBeenCalled();
        expect(parse).not.toHaveBeenCalledWith(prior.beforePayloadJSON, expect.anything());
        expect(parse).not.toHaveBeenCalledWith(prior.afterPayloadJSON, expect.anything());
    });

    it('never accepts an external copy callback or authority flag at Complete', async () => {
        const prepared = await prepare(), callback = vi.fn();
        await refused(completeNativeAttachmentDraftAdd({ prepared, persist: callback }, deps()));
        await refused(completeNativeAttachmentDraftAdd({ prepared, published: true }, deps()));
        expect(callback).not.toHaveBeenCalled();
    });
});
