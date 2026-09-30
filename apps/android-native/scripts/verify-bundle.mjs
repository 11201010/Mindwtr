// node verify-bundle.mjs <core-host.js>: exits 1 unless the bundle's first line is the SHA-256 of the rest of the file
// (build-bundle.mjs writes both in one file). Gradle runs it on every variant's merged assets, so a bundle whose hash line
// came from another build fails the build instead of shipping.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
let bundle;
try { bundle = readFileSync(file); } catch (error) { console.error(`verify-bundle: cannot read ${file}: ${error.message}`); process.exit(1); }
const newline = bundle.indexOf(10);
const key = /^\/\/mindwtr-bundle-sha256:([0-9a-f]{64})$/.exec(bundle.subarray(0, Math.max(newline, 0)).toString('utf8'))?.[1];
const body = createHash('sha256').update(bundle.subarray(newline + 1)).digest('hex');
if (!key || key !== body) {
    console.error(`verify-bundle: ${file} ${key ? `carries hash ${key} but its body hashes to ${body}` : 'has no hash line'}`);
    process.exit(1);
}
