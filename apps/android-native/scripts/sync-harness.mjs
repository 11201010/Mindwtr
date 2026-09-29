// Local sync servers and a second device on this computer, for check-sync-device.mjs (and its --dry-run, which plays the
// phone with a second device too). Nothing here reaches a real server.
//
// - serveWebdav: a WebDAV folder in memory with strong ETags and RN's conditional writes (If-Match, If-None-Match: *,
//   412), Basic auth, and two faults a check can switch on: `failWrites` (a PUT of the sync document answers 500) and
//   `down` (every request answers 503, as a server that went away behind a proxy).
// - startCloud: the real self-hosted Mindwtr cloud (apps/cloud) under Bun, with one token and a scratch data folder.
// - hostDevice: the real native bundle (core-host.js) in a Node VM, on node:sqlite, an in-memory RKStorage and secret
//   store, and node:http for its fetch: core running as a second device, bound exactly as the Android host binds it.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';

// ---- WebDAV ----

export const serveWebdav = ({ port, username, password }) => new Promise((ready) => {
    const files = new Map();
    let version = 0;
    const state = { files, requests: [], failWrites: 0, down: false };
    const authorized = (req) => req.headers.authorization === `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
            state.requests.push(`${req.method} ${path}`);
            const answer = (status, headers = {}, data = '') => {
                res.writeHead(status, headers);
                res.end(req.method === 'HEAD' ? undefined : data);
            };
            if (state.down) return answer(503, { 'Content-Type': 'text/plain' }, 'down');
            if (!authorized(req)) return answer(401, { 'WWW-Authenticate': 'Basic realm="mindwtr-test"' });
            const file = files.get(path);
            const ifMatch = req.headers['if-match'];
            const ifNoneMatch = req.headers['if-none-match'];
            const preconditionFails = () => (ifMatch !== undefined && (!file || file.dir || ifMatch !== file.etag))
                || (ifNoneMatch === '*' && file !== undefined);
            switch (req.method) {
                case 'GET':
                case 'HEAD':
                    if (!file || file.dir) return answer(404);
                    return answer(200, { ETag: file.etag, 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.body.length) }, file.body);
                case 'PUT': {
                    if (preconditionFails()) return answer(412);
                    if (state.failWrites > 0 && path.endsWith('/data.json')) {
                        state.failWrites -= 1;
                        return answer(500, { 'Content-Type': 'text/plain' }, 'write failed');
                    }
                    const etag = `"${++version}-${createHash('sha1').update(body).digest('hex').slice(0, 12)}"`;
                    files.set(path, { body, etag });
                    return answer(file ? 204 : 201, { ETag: etag });
                }
                case 'DELETE':
                    if (!file) return answer(404);
                    if (preconditionFails()) return answer(412);
                    files.delete(path);
                    return answer(204);
                case 'MKCOL':
                    if (file) return answer(405);
                    files.set(path, { dir: true });
                    return answer(201);
                case 'PROPFIND': {
                    const prefix = path.endsWith('/') ? path : `${path}/`;
                    const entries = [...files].filter(([name]) => name === path || (name.startsWith(prefix) && !name.slice(prefix.length).includes('/')));
                    if (entries.length === 0 && path !== '/') return answer(404);
                    const xml = `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${entries.map(([name, entry]) => (
                        `<d:response><d:href>${encodeURI(name)}</d:href><d:propstat><d:prop>${entry.dir ? '<d:resourcetype><d:collection/></d:resourcetype>'
                            : `<d:resourcetype/><d:getetag>${entry.etag}</d:getetag><d:getcontentlength>${entry.body.length}</d:getcontentlength>`}</d:prop>`
                        + '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'
                    )).join('')}</d:multistatus>`;
                    return answer(207, { 'Content-Type': 'application/xml; charset=utf-8' }, xml);
                }
                default:
                    return answer(405);
            }
        });
    });
    server.listen(port, '127.0.0.1', () => ready({ server, state, close: () => new Promise((done) => server.close(done)) }));
});

/** The sync document the WebDAV folder holds now, parsed; null when there is none. */
export const webdavDocument = (dav, folder) => {
    const file = dav.state.files.get(`${folder}/data.json`);
    return file && !file.dir ? JSON.parse(file.body.toString('utf8')) : null;
};

// ---- The self-hosted cloud ----

/** apps/cloud under Bun on 127.0.0.1:[port], allowing only [token], its data under [dataDir]. */
export const startCloud = async ({ repo, port, token, dataDir }) => {
    mkdirSync(dataDir, { recursive: true });
    const child = spawn(process.env.BUN ?? 'bun', ['run', resolve(repo, 'apps/cloud/src/server.ts'), '--port', String(port), '--host', '127.0.0.1'], {
        cwd: resolve(repo, 'apps/cloud'),
        env: { ...process.env, MINDWTR_CLOUD_AUTH_TOKENS: token, MINDWTR_CLOUD_DATA_DIR: dataDir, NODE_ENV: 'development' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    for (let tries = 0; tries < 100; tries += 1) {
        if (/cloud server listening/.test(output)) {
            return { child, output: () => output, stop: () => new Promise((done) => { child.once('exit', done); child.kill('SIGTERM'); }) };
        }
        if (child.exitCode !== null) throw new Error(`cloud server exited: ${output}`);
        await sleep(100);
    }
    child.kill('SIGTERM');
    throw new Error(`cloud server did not start: ${output}`);
};

// ---- A second device: the native bundle in a Node VM ----

/**
 * core-host.js as the Android host runs it, with Node standing in for its Kotlin bridges: SqliteBridge (node:sqlite, one
 * connection), RnKeyValue (a Map), SecretStore (a Map), HostIo's fetch (node:http, OkHttp's redirect rules, whole bodies
 * only), and CoreHost's pumps: [call] waits on its own operation as callAsync does; an idle pump runs timers and settles
 * answers between calls, as CoreHost's does.
 */
export const hostDevice = async ({ bundle, name, log = () => {} }) => {
    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(':memory:');
    const keyValue = new Map();
    const secrets = new Map();
    const answers = [];
    const events = [];
    const lines = [];
    let taken = '';
    let ids = 0;
    const controllers = new Map();
    const params = (json) => JSON.parse(json).map((value) => (typeof value === 'boolean' ? Number(value) : value));
    const guarded = (work) => (...args) => {
        try { return work(...args); } catch (error) { return `!MindwtrNativeError:${error.message}`; }
    };
    const bridge = {
        sqlRun: guarded((sql, json) => { database.prepare(sql).all(...params(json)); return null; }),
        sqlAll: guarded((sql, json) => JSON.stringify(database.prepare(sql).all(...params(json)))),
        sqlExec: guarded((sql) => { database.exec(sql); return null; }),
        nowMs: () => performance.now(),
        randomBytes: (n) => JSON.stringify([...Array(n)].map(() => Math.floor(Math.random() * 256))),
        log: (line) => { lines.push(String(line)); log(`${name}: ${line}`); },
        collationKey: (text) => text,
        rnStateCommit: () => null,
        logFile: () => '',
        kvGet: (key) => JSON.stringify([keyValue.get(key) ?? null]),
        kvSet: (key, value) => { keyValue.set(key, value); return null; },
        kvRemove: (key) => { keyValue.delete(key); return null; },
        kvMultiGet: (json) => JSON.stringify(JSON.parse(json).map((key) => [key, keyValue.get(key) ?? null])),
        kvMultiSet: (json) => { for (const [key, value] of JSON.parse(json)) keyValue.set(key, value); return null; },
        kvMultiRemove: (json) => { for (const key of JSON.parse(json)) keyValue.delete(key); return null; },
        hostEvent: (json) => { events.push(JSON.parse(json)); return null; },
        netFetch(json) {
            const request = JSON.parse(json);
            const id = String(++ids);
            const controller = new AbortController();
            controllers.set(id, controller);
            let body = request.text !== undefined ? Buffer.from(request.text) : request.base64 !== undefined ? Buffer.from(request.base64, 'base64') : undefined;
            const send = (url, method, hops) => new Promise((done, failed) => {
                const req = httpRequest(url, { method, headers: Object.fromEntries(request.headers), signal: controller.signal }, (res) => {
                    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                        res.resume();
                        if (request.redirect === 'error') return failed(Object.assign(new Error('fetch failed: unexpected redirect'), { own: true }));
                        if (request.redirect === 'follow' && hops < 20) {
                            if (res.statusCode < 307 && method !== 'PROPFIND') { method = 'GET'; body = undefined; }
                            return send(new URL(res.headers.location, url).toString(), method, hops + 1).then(done, failed);
                        }
                    }
                    const chunks = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('error', failed);
                    res.on('end', () => {
                        if (!res.complete) return failed(new Error('unexpected end of stream'));
                        try {
                            let bytes = Buffer.concat(chunks);
                            const bodiless = method === 'HEAD' || res.statusCode === 204 || res.statusCode === 304 || res.headers['content-length'] === '0';
                            if (!bodiless && res.headers['content-encoding'] === 'gzip') bytes = gunzipSync(bytes);
                            done({ id, status: res.statusCode, statusText: res.statusMessage, url, redirected: hops > 0,
                                headers: Object.entries(res.headers).map(([header, value]) => [header, String(value)]), base64: bytes.toString('base64') });
                        } catch (error) { failed(error); }
                    });
                });
                req.on('error', failed);
                req.end(method === 'GET' || method === 'HEAD' ? undefined : body);
            });
            send(request.url, request.method, 0)
                .catch((error) => ({ id, error: error.own ? error.message : controller.signal.aborted ? 'Request cancelled' : `Network request failed: ${error.message}` }))
                .then(({ base64, ...answer }) => answers.push(base64 === undefined ? { json: JSON.stringify(answer) } : { json: JSON.stringify({ ...answer, body: true }), body: base64 }));
            return id;
        },
        netAbort(id) { controllers.get(id)?.abort(); return null; },
        secretCall(json) {
            const { op, key, value } = JSON.parse(json);
            const id = String(++ids);
            if (op === 'set') secrets.set(key, value);
            if (op === 'delete') secrets.delete(key);
            setTimeout(() => answers.push({ json: JSON.stringify({ id, value: op === 'get' ? secrets.get(key) ?? null : null }) }), 2);
            return id;
        },
        ioNext: () => {
            const next = answers.shift();
            taken = next?.body ?? '';
            return next?.json ?? '';
        },
        ioBody: () => taken,
    };
    const context = vm.createContext({ console: {}, Intl: undefined, __mindwtrNative: bridge });
    vm.runInContext(readFileSync(bundle, 'utf8'), context);
    const host = context.MindwtrHost;
    // CoreHost's idle pump, and callAsync's wait on one operation.
    const pump = setInterval(() => { try { context.__pumpTimers(); } catch (error) { log(`${name}: pump ${error}`); } }, 10);
    const call = async (method, ...args) => {
        const id = host[method](...args);
        for (const deadline = Date.now() + 10 * 60_000; Date.now() < deadline; await sleep(5)) {
            context.__pumpTimers();
            const answer = host.poll(id);
            if (answer) {
                const reply = JSON.parse(answer);
                if (!reply.ok) throw new Error(reply.error);
                return reply.value;
            }
        }
        throw new Error(`${name}: ${method} timed out`);
    };
    const device = {
        name, keyValue, secrets, events, lines,
        call,
        stop: () => { clearInterval(pump); database.close(); },
        /** Boots on an empty database, reports the network online, and starts sync as ProcessCoreHost does. */
        async boot() {
            await call('boot', '', '', '');
            await call('language', 'en', 'en-US');
            await call('syncNetwork', JSON.stringify({ isConnected: true, isInternetReachable: true }));
            return call('syncStart', 'active');
        },
        /** A Sync screen command (CoreHost.syncCommand). */
        sync: (command, input = {}) => call('menuCommand', command, JSON.stringify(input)),
        view: (draft = {}) => call('menuRead', 'syncSettings', JSON.stringify({ draft })),
        /** RN's quick capture: one new Inbox task titled [title]. */
        async capture(title) {
            const opened = await call('captureOpen');
            return call('captureSubmit', JSON.stringify({ text: title, options: opened.options, captureId: randomUUID(), openAfterSave: false }));
        },
        /** Every Inbox title (the first 100). */
        async titles() {
            const page = await call('window', 0, 100, '');
            return page.rows.map((row) => row.title);
        },
        /** Configures [kind] ('webdav' or 'selfhosted') from the Sync screen as a user does: choose, fill, Save. */
        async configure(kind, fields) {
            await device.sync('openSyncSettings');
            await device.sync('selectSyncBackend', { requestId: randomUUID(), option: kind });
            const view = await device.view();
            return device.sync('saveSyncBackend', { requestId: randomUUID(), revision: view.configRevision, [kind === 'webdav' ? 'webdav' : 'selfHosted']: fields });
        },
        async syncNow(kind, fields) {
            const view = await device.view();
            return device.sync('syncNow', { requestId: randomUUID(), revision: view.configRevision, [kind === 'webdav' ? 'webdav' : 'selfHosted']: fields });
        },
    };
    return device;
};

export const newTitle = (prefix) => `${prefix} ✓ Grüße 😀 ${randomUUID().slice(0, 8)}`;
