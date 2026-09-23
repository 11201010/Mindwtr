// adb helpers shared by the native Android device checks. Every call goes to
// one serial. UI input happens only while `pkg` is in front, and a launch
// happens only from the launcher or `pkg` itself.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export class Stopped extends Error {}

// The last connected device, for failure evidence.
let evidenceDevice;
/**
 * Saves a screenshot and the uiautomator XML of the phone as it is now to
 * /home/dd/.mindwtr-harness/failures/<script>-<timestamp>/ and prints the path.
 * It never throws: evidence must not hide the failure it records.
 */
export const saveEvidence = () => {
    if (!evidenceDevice) return undefined;
    const script = basename(process.argv[1] ?? 'device', '.mjs');
    const dir = `/home/dd/.mindwtr-harness/failures/${script}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
        mkdirSync(dir, { recursive: true });
        try { writeFileSync(`${dir}/screen.png`, evidenceDevice.adbRaw('exec-out', 'screencap', '-p')); } catch { /* device gone */ }
        try {
            evidenceDevice.sh(`uiautomator dump ${evidenceDevice.uiFile}`);
            writeFileSync(`${dir}/ui.xml`, evidenceDevice.adbRaw('exec-out', 'cat', evidenceDevice.uiFile));
        } catch { /* hierarchy unavailable */ }
        console.error(`failure evidence: ${dir}`);
        return dir;
    } catch {
        return undefined;
    }
};
/** Fails the check: saves evidence first. Scripts' catch blocks save it for any other error (see `evidenced`). */
export const fail = (message) => {
    const error = new Error(message);
    error.evidence = saveEvidence();
    throw error;
};
/** For a script's catch: evidence for a failure that did not come through fail(). */
export const evidenced = (error) => {
    if (!(error instanceof Stopped) && !error?.evidence) saveEvidence();
};
export const check = (condition, message) => { if (!condition) fail(message); console.log(`ok - ${message}`); };

const decode = (value) => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export const field = (nodes) => nodes.find((node) => node.class === 'android.widget.EditText');
export const box = (node) => node.bounds.match(/\d+/g).map(Number);
// A Compose button's label is a child node; the enabled state is on the clickable node around it.
export const button = (nodes, label) => {
    const labelNode = nodes.find((node) => node.text === label || node['content-desc'] === label);
    if (!labelNode) return undefined;
    const [x1, y1, x2, y2] = box(labelNode);
    return nodes.filter((node) => node.clickable === 'true').filter((node) => {
        const [left, top, right, bottom] = box(node);
        return left <= x1 && top <= y1 && right >= x2 && bottom >= y2;
    }).sort((a, b) => {
        const area = (node) => { const [l, t, r, bt] = box(node); return (r - l) * (bt - t); };
        return area(a) - area(b);
    })[0];
};
/**
 * The tab labelled [name]: the smallest focusable node around a label with that text. A Compose
 * tab is selectable, and the header above the list can show the same word, so only a label
 * inside a focusable node counts.
 */
export const tab = (nodes, name) => {
    const area = (node) => { const [l, t, r, b] = box(node); return (r - l) * (b - t); };
    for (const label of nodes.filter((node) => node.text === name && node.class === 'android.widget.TextView')) {
        const [x1, y1, x2, y2] = box(label);
        const found = nodes.filter((node) => node.focusable === 'true').filter((node) => {
            const [l, t, r, b] = box(node);
            return l <= x1 && t <= y1 && r >= x2 && b >= y2;
        }).sort((a, b) => area(a) - area(b))[0];
        if (found) return found;
    }
    return undefined;
};
export const tabSelected = (nodes, name) => tab(nodes, name)?.selected === 'true';
/** The capture field's text, "" when the capture sheet is closed (a saved capture closes it, as in RN). */
export const draftText = (nodes) => field(nodes)?.text ?? '';
export const hasText = (nodes, text) => nodes.some((node) => node.text === text && node.class !== 'android.widget.EditText');
/** The message of a failed boot: the app then shows only this text, tagged for tests, and no command control. */
export const bootFailure = (nodes) => nodes.find((node) => /(^|\/)boot-failure$/.test(node['resource-id'] ?? ''))?.text;
/** Task rows with a Done button fully inside the list: core's `common.done` label, then the title. */
export const doneButtons = (nodes) => {
    const list = nodes.find((node) => node.scrollable === 'true');
    const [, top, , bottom] = list ? box(list) : [0, 0, 0, Infinity];
    return nodes.filter((node) => node['content-desc']?.startsWith('Done ')).filter((node) => {
        const [, t, , b] = box(node);
        return t >= top && b <= bottom;
    });
};

export function connect({ serial, pkg, uiFile, adb = process.env.ADB ?? '/home/dd/Android/Sdk/platform-tools/adb' }) {
    const adbRaw = (...args) => execFileSync(adb, ['-s', serial, ...args], { maxBuffer: 64 << 20 });
    const sh = (command) => adbRaw('shell', command).toString('utf8').replace(/\r/g, '').trim();
    evidenceDevice = { adbRaw, sh, uiFile };
    const home = sh('cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME')
        .split('\n').pop().split('/')[0];
    const front = () => sh('dumpsys activity activities').split('\n')
        .find((line) => /topResumedActivity|mResumedActivity/.test(line)) ?? '';
    const requireAppFront = () => {
        if (!front().includes(`${pkg}/`)) throw new Stopped(`${pkg} is not in front: ${front().trim()}`);
    };
    const launch = (activity) => {
        const current = front();
        if (!current.includes(`${pkg}/`) && !current.includes(`${home}/`)) {
            throw new Stopped(`another app is in front; not launching over it: ${current.trim()}`);
        }
        sh(`am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${activity}`);
    };
    const pid = () => { try { return sh(`pidof ${pkg}`); } catch { return ''; } };
    const logs = (processId, tag) => adbRaw('logcat', '-d', `--pid=${processId}`, '-s', `${tag}:*`).toString('utf8');
    const screen = async () => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
                sh(`uiautomator dump ${uiFile}`);
                const xml = adbRaw('exec-out', 'cat', uiFile).toString('utf8');
                if (xml.includes('<hierarchy')) {
                    return [...xml.matchAll(/<node [^>]*>/g)].map(([tag]) => Object.fromEntries(
                        [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, decode(value)]),
                    ));
                }
            } catch { /* the hierarchy is briefly unavailable during recreation */ }
            await sleep(500);
        }
        return fail('uiautomator dump failed');
    };
    const waitFor = async (description, predicate, timeoutMs = 30_000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const nodes = await screen();
            if (predicate(nodes)) return nodes;
            await sleep(500);
        }
        return fail(`timed out waiting for ${description}`);
    };
    const tap = async (node) => {
        requireAppFront();
        const [x1, y1, x2, y2] = box(node);
        sh(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
        await sleep(400);
    };
    /** Swipes the app's list one step: 'up' scrolls toward the top. A list that fits is not scrollable: same hierarchy. */
    const swipe = async (nodes, direction) => {
        const list = nodes.find((node) => node.scrollable === 'true');
        if (!list) return nodes;
        requireAppFront();
        const [x1, y1, x2, y2] = box(list);
        const x = Math.round((x1 + x2) / 2);
        const [low, high] = [Math.round(y2 - (y2 - y1) * 0.15), Math.round(y1 + (y2 - y1) * 0.15)];
        // A moderate drag: a fast one flings past rows on a short (landscape) list.
        sh(`input swipe ${x} ${direction === 'up' ? high : low} ${x} ${direction === 'up' ? low : high} 500`);
        await sleep(400);
        return screen();
    };
    const signature = (nodes) => nodes.map((node) => `${node.text}|${node['content-desc']}|${node.bounds}`).join('\n');
    /** Scrolls the list to its first item (the Inbox count line is a list item). */
    const toTop = async () => {
        let nodes = await screen();
        for (let step = 0; step < 60; step += 1) {
            const next = await swipe(nodes, 'up');
            if (signature(next) === signature(nodes)) return next;
            nodes = next;
        }
        return nodes;
    };
    /** Opens RN's quick capture sheet from the center tab button (core's `nav.addTask`), unless a field already shows. */
    const openCapture = async () => {
        let nodes = await screen();
        if (field(nodes)) return nodes;
        // The count line ("Inbox · N") is the list's first item: start from the top so the
        // capture's new count is on screen when it lands. At the top already, this is one drag.
        if (!nodes.some((node) => /^.+ · \d+$/.test(node.text ?? ''))) nodes = await toTop();
        await tap(button(nodes, 'Add Task') ?? fail('no Add Task button on screen'));
        return waitFor('the capture sheet', (current) => Boolean(field(current)), 10_000);
    };
    const type = async (title) => {
        const nodes = await openCapture();
        await tap(field(nodes) ?? fail('no text field on screen'));
        requireAppFront();
        sh(`input text ${title}`);
        await waitFor(`the draft ${title} in the field`, (nodes) => field(nodes)?.text === title, 10_000);
    };
    /**
     * Scrolls the app's list until a row reads [text]: back to the top first (an earlier
     * step may have left the list scrolled past the row), then forward. The list grows with every run.
     */
    const reveal = async (text, swipes = 150) => {
        let nodes = await screen();
        for (const towardTop of [true, false]) {
            for (let step = 0; step < swipes && !hasText(nodes, text); step += 1) {
                let next = await swipe(nodes, towardTop ? 'up' : 'down');
                if (signature(next) === signature(nodes)) {
                    // At the bottom of a paged list: load the next window (core's `common.more`) and keep going.
                    const more = towardTop ? undefined : button(next, 'More');
                    if (!more || more.enabled !== 'true') break;
                    requireAppFront();
                    const [l, t, r, b] = box(more);
                    sh(`input tap ${Math.round((l + r) / 2)} ${Math.round((t + b) / 2)}`);
                    await sleep(1500);
                    next = await screen();
                }
                nodes = next;
            }
            if (hasText(nodes, text)) break;
        }
        return nodes;
    };
    /** Exact bytes of one app-private file (run-as, so the app must be debuggable). */
    const pull = (remote, local) => writeFileSync(local, adbRaw('exec-out', 'run-as', pkg, 'cat', remote));
    return { adbRaw, sh, home, front, requireAppFront, launch, pid, logs, screen, waitFor, tap, openCapture, type, swipe, signature, toTop, reveal, pull };
}
