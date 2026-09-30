import { build } from 'esbuild';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(app, 'android/app/src/main/assets/core-host.js');
// MINDWTR_TRACE_MODULES=1 (startup measurement builds only): a trace section per module while the bundle initializes, so a
// Perfetto trace shows which modules' top-level code costs the most, and core's startup phases log their durations. The step function closes one module's section and
// opens the next; the end of host-entry.ts closes the last and turns it off, so a module loaded later (a locale) traces nothing.
const traceModules = process.env.MINDWTR_TRACE_MODULES === '1';
const repo = resolve(app, '../..');
const moduleTrace = {
    name: 'module-trace',
    setup(build) {
        build.onLoad({ filter: /\.(ts|tsx|js|mjs|cjs)$/ }, (args) => {
            if (args.path.endsWith('host-polyfills.js')) return undefined;
            const name = relative(repo, args.path).replace(/^.*node_modules\//, 'npm:');
            const marker = `globalThis.__mwTraceModule && globalThis.__mwTraceModule(${JSON.stringify(`mod:${name}`.slice(0, 120))});\n`;
            const loader = args.path.endsWith('.tsx') ? 'tsx' : args.path.endsWith('.ts') ? 'ts' : 'js';
            return { contents: marker + readFileSync(args.path, 'utf8'), loader, resolveDir: dirname(args.path) };
        });
    },
};
const traceBanner = `(function (g) {
    // Core's own startup phases (startup-profiler.ts) go to the log too, with their durations.
    g.__MINDWTR_STARTUP_PROFILING__ = true;
    var open = false;
    g.__mwTraceModule = function (name) {
        var bridge = g.__mindwtrNative;
        if (!bridge || typeof bridge.trace !== 'function') return;
        if (open) bridge.trace('');
        open = name !== '';
        if (open) bridge.trace(name); else g.__mwTraceModule = undefined;
    };
}(globalThis));
`;
const result = await build({
    entryPoints: [resolve(app, 'bundle/host-entry.ts')],
    outfile,
    write: false,
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    banner: { js: readFileSync(resolve(app, 'bundle/host-polyfills.js'), 'utf8') + (traceModules ? traceBanner : '') },
    plugins: traceModules ? [moduleTrace] : [],
});
// The bundle's first line is the SHA-256 of the rest: the key of the app's bytecode cache (BytecodeCache.kt). Both go in one
// file, written under a name of its own and renamed into place, so a bundle and a hash from two builds can never pair up
// (verify-bundle.mjs checks every variant's packaged copy).
const body = result.outputFiles[0].contents;
const temporary = `${outfile}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
writeFileSync(temporary, Buffer.concat([Buffer.from(`//mindwtr-bundle-sha256:${createHash('sha256').update(body).digest('hex')}\n`), body]), { flag: 'wx' });
renameSync(temporary, outfile);
rmSync(`${outfile}.sha256`, { force: true }); // the old separate hash file
