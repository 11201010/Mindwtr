import { describe, expect, it } from 'vitest';
import {
    buildSyncConflictLines,
    buildSyncHistoryLines,
    buildSyncPreferencesUpdate,
    formatSyncClockSkew,
    getSyncBackendGroups,
    getSyncBackendOptions,
    getSyncFailureMessage,
    getSyncFolderLabel,
    getSyncLastErrorText,
    getSyncLastStatusLine,
    getSyncPreferenceValues,
    getSyncSelfHostedFormState,
    getSyncWebDavFormState,
    isSyncBackendOptionSelected,
    isValidSyncHttpUrl,
    resolveSyncBackendSelection,
} from './sync-settings-model';
import type { MergeStats } from './sync-types';

const t = (key: string) => key;
const entities = { tasks: [{ id: 't1', title: 'Report' }], projects: [], sections: [], areas: [], people: [] };

describe('sync settings model', () => {
    it('offers Dropbox only on builds that are not FOSS, and iCloud only where CloudKit runs', () => {
        const options = (isFossBuild: boolean, supportsCloudKit: boolean) => getSyncBackendOptions(getSyncBackendGroups({ t, isFossBuild, supportsCloudKit }));
        expect(options(false, false)).toEqual(['off', 'dropbox', 'file', 'webdav', 'selfhosted']);
        expect(options(true, false)).toEqual(['off', 'file', 'webdav', 'selfhosted']);
        expect(options(false, true)).toEqual(['off', 'dropbox', 'cloudkit', 'file', 'webdav', 'selfhosted']);
    });

    it('shows a FOSS build\'s cloud backend as self-hosted and never as Dropbox, which cannot encrypt there', () => {
        const selection = resolveSyncBackendSelection({ syncBackend: 'cloud', cloudProvider: 'dropbox', isFossBuild: true, supportsCloudKit: false });
        expect(isSyncBackendOptionSelected('selfhosted', 'cloud', selection)).toBe(true);
        expect(isSyncBackendOptionSelected('dropbox', 'cloud', selection)).toBe(false);
        expect(selection.isEncryptionCapableBackend).toBe(false);
        expect(resolveSyncBackendSelection({ syncBackend: 'cloud', cloudProvider: 'dropbox', isFossBuild: false, supportsCloudKit: false })
            .isEncryptionCapableBackend).toBe(true);
    });

    it('checks the forms as React Native does: http(s) URLs, and an empty token allowed', () => {
        expect(isValidSyncHttpUrl('ftp://x')).toBe(false);
        expect(getSyncWebDavFormState('')).toEqual({ urlError: false, canUseActions: false });
        expect(getSyncWebDavFormState('nas.local')).toEqual({ urlError: true, canUseActions: false });
        const token = (value: string) => value.length >= 20;
        expect(getSyncSelfHostedFormState('https://c', '', token)).toEqual({ urlError: false, tokenError: false, canUseActions: true });
        expect(getSyncSelfHostedFormState('https://c', 'short', token)).toEqual({ urlError: false, tokenError: true, canUseActions: false });
    });

    it('names the cause of a failure, and keeps the detail of one it cannot classify (#1151)', () => {
        expect(getSyncFailureMessage(new Error('HTTP 401 Unauthorized'), t)).toBe('settings.syncFailureAuth');
        expect(getSyncFailureMessage(new Error('boom'), t)).toBe('settings.syncFailureGeneric\nboom');
        expect(getSyncLastErrorText('SYNC_FILE_LOCK_UNAVAILABLE: busy', t)).toBe('settings.syncFileLockUnavailable');
        expect(getSyncLastErrorText('HTTP 503', t)).toBe('HTTP 503');
    });

    it('formats the last sync line and the history with the host\'s dates', () => {
        const date = (iso: string) => `<${iso}>`;
        expect(getSyncLastStatusLine({ lastSyncStatus: 'error' }, t, date)).toBe('settings.lastSyncNeversettings.syncStatusFailedSuffix');
        expect(getSyncLastStatusLine({ lastSyncAt: 'A', lastSyncStatus: 'conflict' }, t, date)).toBe('<A>settings.syncStatusConflictsSuffix');
        const entry = { at: 'B', status: 'error' as const, conflicts: 0, conflictIds: [], maxClockSkewMs: 1500, timestampAdjustments: 0, error: 'HTTP 503' };
        expect(buildSyncHistoryLines(Array(7).fill(entry), t, date)).toHaveLength(5);
        expect(buildSyncHistoryLines([entry], t, date)).toEqual(['<B> • settings.lastSyncError • settings.lastSyncSkew: 1.5 s • HTTP 503']);
        expect(formatSyncClockSkew(90_000)).toBe('1.5 min');
    });

    it('names conflicts by their row title, else by ID, and counts the ones not listed', () => {
        const sample = (id: string) => ({
            id, winner: 'local', reasons: ['revision'], hasRevision: true, timeDiffMs: 0, localUpdatedAt: '', incomingUpdatedAt: '',
            localRev: 1, incomingRev: 1, localComparableHash: '', incomingComparableHash: '', diffKeys: [],
        });
        const stats = {
            tasks: { conflicts: 8, conflictIds: [], conflictSamples: ['t1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7'].map(sample) },
            projects: {}, sections: {}, areas: {},
        } as unknown as MergeStats;
        const lines = buildSyncConflictLines(stats, entities, t);
        expect(lines[0]).toBe('“Report” — kept this device\'s version');
        expect(lines[1]).toBe('“x2” — kept this device\'s version');
        expect(lines).toHaveLength(7);
        expect(lines[6]).toBe('+2 more resolved conflicts');
    });

    it('syncs GTD settings unless turned off, and writes one option without dropping the others', () => {
        expect(getSyncPreferenceValues(undefined)).toMatchObject({ gtd: true, appearance: false });
        expect(buildSyncPreferencesUpdate({ gtd: false, ai: true }, { appearance: true })).toEqual({ syncPreferences: { gtd: false, ai: true, appearance: true } });
    });

    it('names an Android document by its own name, not its percent-encoded document ID', () => {
        const document = 'content://com.android.externalstorage.documents/tree/primary%3ASync/document/primary%3ASync%2Fdata.json';
        expect(getSyncFolderLabel(document, t)).toBe('data.json');
        expect(getSyncFolderLabel('content://com.android.externalstorage.documents/tree/primary%3AMy%20Sync', t)).toBe('My Sync');
        expect(getSyncFolderLabel('file:///var/mobile/Containers/Shared/Sync/data.json', t)).toBe('data.json');
        expect(getSyncFolderLabel(null, t)).toBe('common.notSet');
    });
});
