import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({
    entryPoints: [resolve(app, 'bundle/host-entry.ts')],
    outfile: resolve(app, 'android/app/src/main/assets/core-host.js'),
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    banner: { js: readFileSync(resolve(app, 'bundle/host-polyfills.js'), 'utf8') },
});
