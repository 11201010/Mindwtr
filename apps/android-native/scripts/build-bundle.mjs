import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(app, 'android/app/src/main/assets/core-host.js');
await build({
    entryPoints: [resolve(app, 'bundle/host-entry.ts')],
    outfile,
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    banner: { js: readFileSync(resolve(app, 'bundle/host-polyfills.js'), 'utf8') },
});
// The SHA-256 of the exact bundle bytes: the key of the app's bytecode cache (BytecodeCache.kt), written with the bundle.
writeFileSync(`${outfile}.sha256`, `${createHash('sha256').update(readFileSync(outfile)).digest('hex')}\n`);
