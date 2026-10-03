// Sync encryption helpers shared by check-encryption-dry-run.mjs and check-encryption-device.mjs: the encryption card as core
// draws it, a WebDAV folder's files told apart by the MWENC1 magic, and the card's flows run as the Sync screen sends them.
import { randomUUID } from 'node:crypto';

const MAGIC = Buffer.from('MWENC1');

/** The Sync screen view's encryption card (core's rows), or null while the backend cannot encrypt. */
export const encryptionCard = (view) => view?.encryption ?? null;

/** Every file under [folder] in a serveWebdav folder: `encrypted` (MWENC1), `plain` (anything else), with a fingerprint of all. */
export const remoteArtifacts = (dav, folder) => {
    const all = [...dav.state.files].filter(([path, file]) => path.startsWith(`${folder}/`) && !file.dir)
        .map(([path, file]) => ({ path, body: file.body, etag: file.etag, text: file.body.toString('utf8'), encrypted: file.body.subarray(0, 6).equals(MAGIC) }));
    return {
        all,
        encrypted: all.filter((file) => file.encrypted),
        plain: all.filter((file) => !file.encrypted),
        fingerprint: all.map((file) => `${file.path}=${file.etag}`).sort().join('\n'),
    };
};

/**
 * Runs one card flow on a hostDevice as the screen does: open it (unless [options.open] is false), type each field, submit with
 * a request UUID. Returns the submit's reply, or `{ error }` when core refused it.
 */
export const runEncryption = async (device, flow, fields, options = {}) => {
    const action = (input) => device.sync('runSyncEncryptionAction', input);
    if (options.open !== false) await action({ action: { type: 'open', flow } });
    for (const [field, value] of Object.entries(fields)) await action({ action: { type: 'typed', field, value } });
    return action({ requestId: randomUUID(), action: { type: 'submit', flow } }).catch((error) => ({ error: error.message }));
};
