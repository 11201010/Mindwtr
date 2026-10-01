// RN's home-screen widgets and Quick Settings tile for the native app, one set per build type: the manifest entries, the
// appwidget-provider XML, the picker previews, strings and dialog theme, the legacy `<applicationId>.widget.TasksWidget` class and
// `quicksettings.CaptureTileService`, all from apps/mobile/plugins/android-widget.js's and android-quick-settings-tile.js's own
// builders with RN's props (app.json). The plugins' own write steps (their withDangerousMod) are repeated here in their order;
// every file's text is the builders'. Two changes, both for the native app's identity: the tile's class keeps RN's release name
// (tech.dongdongbh.mindwtr.quicksettings) in every build type, so its manifest name is absolute (RN's is relative to RN's
// namespace), and its `R` is this app's (tech.dongdongbh.mindwtr.pilot.R), which holds the tile's strings and icon.
// Usage: node build-widgets.mjs <out dir> <build type>=<applicationId>:<label> ...
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const mobile = resolve(import.meta.dirname, '../../mobile');
const widget = require(resolve(mobile, 'plugins/android-widget.js')).__testables;
const tile = require(resolve(mobile, 'plugins/android-quick-settings-tile.js')).__testables;
const { buildWidgetPreviewXml } = require(resolve(mobile, 'plugins/android-widget-preview.js'));
const { compactWidgetLocales, compactWidgetValuesDirectory } = require(resolve(mobile, 'plugins/android-widget-locales.js'));
const { Builder } = require('xml2js');

/** RN's tile package (inventory: the user's added tile is stored under this class name). */
export const TILE_PACKAGE = 'tech.dongdongbh.mindwtr';
const APP_R = 'tech.dongdongbh.mindwtr.pilot.R';

/** RN's plugin props from app.json, with this build's launcher [label] (RN's dev variant relabels them the same way). */
export function widgetProps(label) {
    const app = JSON.parse(readFileSync(resolve(mobile, 'app.json'), 'utf8')).expo;
    const entry = app.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === './plugins/android-widget');
    return { ...entry[1], label };
}

/** The manifest the plugins write, as one build type's overlay: RN's widget components and the tile, nothing else. */
export function buildManifest(applicationId, label) {
    const manifest = { manifest: { $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' }, application: [{}] } };
    widget.ensureWidgetComponents(manifest, widgetProps(label), applicationId);
    tile.ensureCaptureTileService(manifest);
    const service = manifest.manifest.application[0].service.find((entry) => entry.$['android:name'] === '.quicksettings.CaptureTileService');
    service.$['android:name'] = `${TILE_PACKAGE}.quicksettings.CaptureTileService`;
    return new Builder({ renderOpts: { pretty: true, indent: '    ' }, xmldec: { version: '1.0', encoding: 'utf-8' } }).buildObject(manifest);
}

/** RN's tile source for [TILE_PACKAGE], its `R` this app's. */
export function buildTileSource() {
    const source = tile.buildCaptureTileServiceSource(TILE_PACKAGE);
    const rnR = `import ${TILE_PACKAGE}.R\n`;
    if (source.split(rnR).length !== 2) throw new Error('RN\'s tile no longer imports its R as expected');
    return source.replace(rnR, `import ${APP_R}\n`);
}

/** Writes one build type's files under [root]: AndroidManifest.xml, res/ and java/. */
export function writeWidgets(root, applicationId, label) {
    rmSync(root, { recursive: true, force: true });
    const res = resolve(root, 'res');
    const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
    write(resolve(root, 'AndroidManifest.xml'), buildManifest(applicationId, label));
    // android-widget.js's withDangerousMod, in its order.
    const props = widget.resolveProps(widgetProps(label));
    const kinds = widget.buildWidgetKinds(props);
    for (const kind of [...kinds, widget.buildLegacyTasksWidgetKind(props, applicationId)]) {
        write(resolve(res, 'xml', `${kind.infoResource}.xml`), widget.buildWidgetInfoXml(kind));
    }
    const nativeLayouts = resolve(mobile, 'modules/android-widget/android/src/main/res/layout');
    for (const kind of kinds) {
        write(resolve(res, 'layout', `${kind.layout}_preview.xml`), buildWidgetPreviewXml(kind, (name) => readFileSync(resolve(nativeLayouts, `${name}.xml`), 'utf8')));
    }
    write(resolve(res, 'values', 'mindwtr_widget_strings.xml'), widget.buildWidgetStringsXml(kinds));
    for (const locale of Object.keys(compactWidgetLocales)) {
        const values = locale === 'en' ? 'values' : compactWidgetValuesDirectory(locale);
        write(resolve(res, values, 'mindwtr_compact_widget_strings.xml'), widget.buildCompactWidgetStringsXml(props.label, locale));
    }
    write(resolve(res, 'values', 'mindwtr_widget_styles.xml'), widget.buildWidgetStylesXml());
    for (const kind of kinds) {
        mkdirSync(resolve(res, 'drawable'), { recursive: true });
        copyFileSync(resolve(mobile, kind.previewImage), resolve(res, 'drawable', `${kind.layout}_preview.png`));
    }
    write(resolve(root, 'java', ...applicationId.split('.'), 'widget', 'TasksWidget.java'), widget.buildLegacyTasksWidgetSource(applicationId));
    // android-quick-settings-tile.js's withDangerousMod.
    write(resolve(root, 'java', ...TILE_PACKAGE.split('.'), 'quicksettings', 'CaptureTileService.kt'), buildTileSource());
    write(resolve(res, 'values', 'mindwtr_quick_settings_tile_strings.xml'), tile.buildTileStringsXml());
    write(resolve(res, 'drawable', 'ic_quick_settings_capture.xml'), tile.buildTileIconXml());
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [out, ...variants] = process.argv.slice(2);
    if (!out || variants.length === 0) throw new Error('usage: build-widgets.mjs <out dir> <build type>=<applicationId>:<label> ...');
    for (const variant of variants) {
        const [, type, applicationId, label] = /^([^=]+)=([^:]+):(.+)$/.exec(variant) ?? [];
        if (!type) throw new Error(`invalid variant ${variant}`);
        writeWidgets(resolve(out, type), applicationId, label);
    }
}
