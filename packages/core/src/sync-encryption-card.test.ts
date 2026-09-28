import { describe, expect, it } from 'vitest';
import { createSyncEncryptionCard, type SyncEncryptionCardHost } from './sync-encryption-card';
import { SyncEncryptionCleanupDeferredError, isSyncEncryptionCleanupDeferredError } from './sync-encryption-service';

function setup(overrides: Partial<SyncEncryptionCardHost> = {}) {
    const calls: unknown[][] = [];
    let state: 'off' | 'enabled' | 'remote-encrypted-no-key' = 'off';
    const host: SyncEncryptionCardHost = {
        getStatus: async () => ({ state }),
        isBackendPending: async () => false,
        enable: async (passphrase) => { calls.push(['enable', passphrase]); state = 'enabled'; },
        change: async () => undefined,
        disable: async () => { state = 'off'; },
        provide: async (passphrase) => (passphrase === 'right' ? 'ok' : 'wrong-passphrase'),
        decline: async () => undefined,
        isCleanupDeferredError: (error): error is Error & { cleanupKind?: string } => isSyncEncryptionCleanupDeferredError(error),
        randomBytes: (length) => new Uint8Array(length).fill(3),
        appData: () => null,
        logSettingsError: () => undefined,
        ...overrides,
    };
    return { card: createSyncEncryptionCard(host), calls, setState: (next: typeof state) => { state = next; } };
}

describe('sync encryption card', () => {
    it('refuses two different passphrases before anything runs, and enables with the typed one', async () => {
        const { card, calls } = setup();
        await card.refresh().done;
        card.openFlow('enable');
        card.setField('next', 'one');
        card.setField('confirm', 'two');
        await card.submitEnable();
        expect(card.getState()).toMatchObject({ error: 'mismatch', flow: 'enable' });
        expect(calls).toEqual([]);
        card.setField('confirm', 'one');
        expect(card.getState().error).toBeNull();
        await card.submitEnable();
        expect(calls).toEqual([['enable', 'one']]);
        expect(card.getState()).toMatchObject({ state: 'enabled', flow: 'none', nextPassphrase: '', confirmPassphrase: '', busy: false });
    });

    it('fills both new-passphrase fields from the generator and shows them', async () => {
        const { card } = setup();
        await card.refresh().done;
        card.openFlow('enable');
        card.generate();
        const { nextPassphrase, confirmPassphrase, revealed, generated } = card.getState();
        expect(nextPassphrase.split(' ').length).toBeGreaterThan(3);
        expect(confirmPassphrase).toBe(nextPassphrase);
        expect({ revealed, generated }).toEqual({ revealed: true, generated: true });
    });

    it('closes a committed transition whose cleanup was deferred, with the file-lock warning', async () => {
        const { card } = setup({
            enable: async () => { throw new SyncEncryptionCleanupDeferredError(undefined, new Error('lock'), 0, 'file-lock'); },
        });
        await card.refresh().done;
        card.openFlow('enable');
        card.setField('next', 'p');
        card.setField('confirm', 'p');
        await card.submitEnable();
        expect(card.getState()).toMatchObject({ flow: 'none', error: null, warning: 'file-cleanup-deferred' });
    });

    it('re-prompts a wrong unlock passphrase and never reports a failed state read as off', async () => {
        const { card, setState } = setup();
        setState('remote-encrypted-no-key');
        await card.refresh().done;
        card.openFlow('unlock');
        card.setField('current', 'wrong');
        await card.submitUnlock();
        expect(card.getState()).toMatchObject({ flow: 'unlock', error: 'wrong-passphrase', state: 'remote-encrypted-no-key' });

        const failing = setup({ getStatus: async () => { throw new Error('unreadable'); } });
        await failing.card.refresh().done;
        expect(failing.card.getState()).toMatchObject({ state: null, stateUnavailable: true });
    });
});
