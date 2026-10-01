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
