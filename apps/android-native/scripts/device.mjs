// adb helpers shared by the native Android device checks. Every call goes to
// one serial. UI input happens only while `pkg` is in front, and a launch
// happens only from the launcher or `pkg` itself.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

export class Stopped extends Error {}
export const fail = (message) => { throw new Error(message); };
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
export const hasText = (nodes, text) => nodes.some((node) => node.text === text && node.class !== 'android.widget.EditText');

export function connect({ serial, pkg, uiFile, adb = process.env.ADB ?? '/home/dd/Android/Sdk/platform-tools/adb' }) {
    const adbRaw = (...args) => execFileSync(adb, ['-s', serial, ...args], { maxBuffer: 64 << 20 });
    const sh = (command) => adbRaw('shell', command).toString('utf8').replace(/\r/g, '').trim();
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
    const type = async (title) => {
        await tap(field(await screen()));
        requireAppFront();
        sh(`input text ${title}`);
        await waitFor(`the draft ${title} in the field`, (nodes) => field(nodes)?.text === title, 10_000);
    };
    /** Exact bytes of one app-private file (run-as, so the app must be debuggable). */
    const pull = (remote, local) => writeFileSync(local, adbRaw('exec-out', 'run-as', pkg, 'cat', remote));
    return { adbRaw, sh, home, front, requireAppFront, launch, pid, logs, screen, waitFor, tap, type, pull };
}
