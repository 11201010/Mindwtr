import { describe, expect, it } from 'vitest';
import {
    describeAttachmentUriForLog,
    findTaskDraftAttachmentForIdentity,
    mergeTaskDraftAttachments,
    planAttachmentOpen,
    resolveAttachmentViewMimeType,
} from './attachment-editor-model';
import { getAttachmentDownloadIdentity, hasAttachmentDownloadIdentity } from './mobile-attachment-availability';
import type { Attachment } from './types';

const AT = '2026-09-01T00:00:00.000Z';
const file = (id: string, fields: Partial<Attachment> = {}): Attachment => ({
    id, kind: 'file', title: `${id}.pdf`, uri: `file:///a/${id}.pdf`, createdAt: AT, updatedAt: AT, ...fields,
});
const t = (key: string) => key;

describe('attachment editor model', () => {
    it('saves only what the editor changed over the stored list', () => {
        const kept = file('kept');
        const edited = file('edited');
        const base = [kept, edited];
        const stored = [{ ...kept, cloudKey: 'attachments/kept.pdf' }, edited, file('from-sync')];
        const value = [{ ...kept }, { ...edited, deletedAt: AT }, file('added')];
        expect(mergeTaskDraftAttachments(stored, base, value)).toEqual([
            stored[0], { ...edited, deletedAt: AT }, stored[2], file('added'),
        ]);
        expect(mergeTaskDraftAttachments(stored, base, base)).toEqual(stored);
    });

    it('saves exactly the editor\'s list when nothing changed the stored task meanwhile, as React Native replaces it', () => {
        const base = [file('a'), file('b', { cloudKey: 'attachments/b.pdf' })];
        const value = [{ ...base[0], deletedAt: AT, updatedAt: AT }, { ...base[1], uri: 'file:///x/b.pdf', localStatus: 'available' as const }, file('new')];
        expect(mergeTaskDraftAttachments(base, base, value)).toEqual(value);
    });

    it('keeps a removal sync recorded after the editor opened, even when the editor downloaded that file', () => {
        const before = file('f', { cloudKey: 'attachments/f.pdf', uri: '', localStatus: 'missing' });
        const downloaded = { ...before, uri: 'file:///x/f.pdf', localStatus: 'available' as const };
        const tombstone = { ...before, deletedAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' };
        expect(mergeTaskDraftAttachments([tombstone], [before], [downloaded])).toEqual([tombstone]);
    });

    it('keeps a newer cloudKey, content revision and upload flag, and applies only the fields the editor changed', () => {
        const before = file('f', { pendingContentUpload: true });
        const uploaded = { ...before, cloudKey: 'attachments/f.pdf', contentRev: 2, pendingContentUpload: false };
        const removed = { ...before, deletedAt: AT, updatedAt: '2026-09-03T00:00:00.000Z' };
        expect(mergeTaskDraftAttachments([uploaded], [before], [removed])).toEqual([
            { ...uploaded, deletedAt: AT, updatedAt: '2026-09-03T00:00:00.000Z' },
        ]);
        const link: Attachment = { id: 'l', kind: 'link', title: 'Old', uri: 'https://a.example', createdAt: AT, updatedAt: AT };
        const elsewhere = { ...link, uri: 'https://b.example' };
        expect(mergeTaskDraftAttachments([elsewhere], [link], [{ ...link, title: 'New' }])).toEqual([{ ...elsewhere, title: 'New' }]);
    });

    it('drops a download made for content sync has since replaced: the bytes belong to the old content', () => {
        const before = file('f', { cloudKey: 'attachments/f.pdf', contentRev: 1, uri: '', localStatus: 'missing' });
        const downloaded = { ...before, uri: 'file:///x/f.pdf', localStatus: 'available' as const, fileHash: 'a'.repeat(64) };
        const replaced = { ...before, contentRev: 2, fileHash: 'b'.repeat(64) };
        expect(mergeTaskDraftAttachments([replaced], [before], [downloaded])).toEqual([replaced]);
        // A terminal mark for the old content (cloudKey cleared, removed) is dropped too.
        const unrecoverable = { ...before, cloudKey: undefined, deletedAt: AT };
        expect(mergeTaskDraftAttachments([replaced], [before], [unrecoverable])).toEqual([replaced]);
    });

    it('never re-adds a record storage no longer has, and appends only attachments new to the editor', () => {
        const gone = file('gone');
        expect(mergeTaskDraftAttachments([], [gone], [{ ...gone, title: 'renamed' }, file('new')])).toEqual([file('new')]);
    });

    it('names a URI in a log by its scheme and extension only', () => {
        expect(describeAttachmentUriForLog('https://user:hunter2@example.com/private/report.pdf?token=abc')).toBe('https:.pdf');
        expect(describeAttachmentUriForLog('content://com.android.providers/document/secret-name.docx')).toBe('content:.docx');
        expect(describeAttachmentUriForLog('/Users/me/Taxes 2026')).toBe('path:');
        expect(describeAttachmentUriForLog('')).toBe('none');
    });

    it('checks a synced draft attachment against the saved task only when the editor has one', () => {
        const synced = file('synced', { cloudKey: 'attachments/synced.pdf', contentRev: 1 });
        const identity = getAttachmentDownloadIdentity(synced);
        const find = (stored: () => Attachment | undefined | null) => findTaskDraftAttachmentForIdentity({
            draft: [synced], stored, attachmentId: 'synced', identity, has: hasAttachmentDownloadIdentity,
        });
        expect(find(() => null)).toBe(synced);
        expect(find(() => synced)).toBe(synced);
        expect(find(() => ({ ...synced, contentRev: 2 }))).toBeNull();
        expect(find(() => undefined)).toBeNull();
    });

    it('plans a file open with the MIME type Android\'s viewer needs, and audio only where a player exists', () => {
        expect(planAttachmentOpen(file('doc'), { audio: true, t })).toEqual({
            kind: 'file', uri: 'file:///a/doc.pdf', mimeType: null, viewMimeType: 'application/pdf',
        });
        const memo = file('memo', { title: 'memo.m4a', uri: 'file:///a/memo.m4a' });
        expect(planAttachmentOpen(memo, { audio: true, t })).toEqual({ kind: 'audio', attachment: memo });
        expect(planAttachmentOpen(memo, { audio: false, t })).toMatchObject({ kind: 'file', viewMimeType: '*/*' });
        expect(resolveAttachmentViewMimeType('file:///a/x.unknown', ' text/plain ')).toBe('text/plain');
    });
});
