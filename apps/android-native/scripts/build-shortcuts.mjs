// RN's app shortcuts for the native app, one resource set per build type: the XML and strings of
// apps/mobile/plugins/android-app-shortcuts.js (its own builder, so the ids, capabilities and labels stay RN's), with two
// changes. RN's mindwtr:/// links use the build's scheme (the development build's mindwtr-native-dev, so RN's app on the
// same phone keeps mindwtr://), and Add task, which opens the widget module's QuickCaptureActivity (not in this app until
// the widget pass), opens the capture popup through RN's own system capture link, <scheme>:///capture-quick.
// Usage: node build-shortcuts.mjs <out dir> <build type>=<scheme> ...
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { __testables: rn } = require('../../mobile/plugins/android-app-shortcuts.js');
const QUICK_CAPTURE = /\n( *)<intent\n\1 {2}android:action="android\.intent\.action\.VIEW"\n\1 {2}android:targetPackage="PACKAGE"\n\1 {2}android:targetClass="tech\.dongdongbh\.mindwtr\.androidwidget\.QuickCaptureActivity" \/>/g;

export function buildShortcuts(scheme) {
    if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) throw new Error(`invalid scheme ${scheme}`);
    const source = rn.buildShortcutsXml('PACKAGE');
    const links = source.match(/mindwtr:\/\/\//g)?.length ?? 0;
    if ((source.match(QUICK_CAPTURE) ?? []).length !== 1) throw new Error('RN\'s Add task shortcut no longer opens QuickCaptureActivity as expected');
    const xml = source
        .replace(QUICK_CAPTURE, (_match, indent) => `\n${indent}<intent\n${indent}  android:action="android.intent.action.VIEW"\n${indent}  android:data="mindwtr:///capture-quick" />`)
        .replaceAll('mindwtr:///', `${scheme}:///`);
    if (xml.includes('PACKAGE') || (xml.match(new RegExp(`${scheme.replace(/[.+]/g, '\\$&')}:///`, 'g'))?.length ?? 0) !== links + 1) {
        throw new Error('shortcut links were not all moved to the build\'s scheme');
    }
    return { xml, strings: rn.SHORTCUTS_STRINGS_XML };
}

const [out, ...variants] = process.argv.slice(2);
if (import.meta.url === pathToFileURL(process.argv[1]).href && (!out || variants.length === 0)) {
    throw new Error('usage: build-shortcuts.mjs <out dir> <build type>=<scheme> ...');
}
for (const variant of import.meta.url === pathToFileURL(process.argv[1]).href ? variants : []) {
    const [type, scheme] = variant.split('=');
    const { xml, strings } = buildShortcuts(scheme);
    const res = resolve(out, type, 'res');
    mkdirSync(resolve(res, 'xml'), { recursive: true });
    mkdirSync(resolve(res, 'values'), { recursive: true });
    writeFileSync(resolve(res, 'xml', 'mindwtr_shortcuts.xml'), xml);
    writeFileSync(resolve(res, 'values', 'mindwtr_shortcuts_strings.xml'), strings);
}
