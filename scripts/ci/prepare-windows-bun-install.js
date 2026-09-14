'use strict';

const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const QUERY_STRING_PATCH_KEY = 'query-string@7.1.3';
const QUERY_STRING_PATCH_FILE = 'patches/query-string@7.1.3.patch';
const QUERY_STRING_LOCK_ENTRY =
  `    "${QUERY_STRING_PATCH_KEY}": "${QUERY_STRING_PATCH_FILE}",`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removePackageEntry(file) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const patchedDependencies = manifest.patchedDependencies;
  if (
    !patchedDependencies
    || patchedDependencies[QUERY_STRING_PATCH_KEY] !== QUERY_STRING_PATCH_FILE
  ) {
    throw new Error(`Expected the query-string patchedDependencies entry in ${file}`);
  }
  delete patchedDependencies[QUERY_STRING_PATCH_KEY];
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

function removeLockEntry(file) {
  const source = readFileSync(file, 'utf8');
  const linePattern = new RegExp(`^${escapeRegExp(QUERY_STRING_LOCK_ENTRY)}\\r?$`, 'gm');
  const matches = source.match(linePattern) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one query-string patchedDependencies entry in ${file}, found ${matches.length}`,
    );
  }

  const next = source.replace(
    new RegExp(`^${escapeRegExp(QUERY_STRING_LOCK_ENTRY)}\\r?\\n`, 'm'),
    '',
  );
  writeFileSync(file, next);
}

function prepareWindowsBunInstall(root = process.cwd()) {
  removePackageEntry(join(root, 'package.json'));
  removeLockEntry(join(root, 'bun.lock'));
  console.log(
    'Disabled Bun automatic query-string patching for this Windows install; the mobile postinstall applies and verifies the same compatibility patch.',
  );
}

if (require.main === module) {
  prepareWindowsBunInstall();
}

module.exports = { prepareWindowsBunInstall };
