import { build } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const android = resolve(app, '../android-native/bundle');
mkdirSync(resolve(app, 'Resources'), { recursive: true });
await build({
    entryPoints: [resolve(android, 'host-entry.ts')],
    outfile: resolve(app, 'Resources/core-host.js'),
    bundle: true,
    alias: { '@mindwtr/core': resolve(app, '../../packages/core/src/index.ts') },
    tsconfigRaw: {},
    format: 'iife',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    banner: { js: `globalThis.__mindwtrHostPlatform = 'ios';\n${readFileSync(resolve(app, 'bundle/jsc-preflight.js'), 'utf8')}\n${readFileSync(resolve(android, 'host-polyfills.js'), 'utf8')}` },
});
