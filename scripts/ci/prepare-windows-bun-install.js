'use strict';

const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const QUERY_STRING_PATCH_ENTRY =
  '    "query-string@7.1.3": "patches/query-string@7.1.3.patch",';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeExactLine(file) {
  const source = readFileSync(file, 'utf8');
  const linePattern = new RegExp(`^${escapeRegExp(QUERY_STRING_PATCH_ENTRY)}\\r?$`, 'gm');
  const matches = source.match(linePattern) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one query-string patchedDependencies entry in ${file}, found ${matches.length}`,
    );
  }

  const next = source.replace(
    new RegExp(`^${escapeRegExp(QUERY_STRING_PATCH_ENTRY)}\\r?\\n`, 'm'),
    '',
  );
  writeFileSync(file, next);
}

function prepareWindowsBunInstall(root = process.cwd()) {
  removeExactLine(join(root, 'package.json'));
  removeExactLine(join(root, 'bun.lock'));
  console.log(
    'Disabled Bun automatic query-string patching for this Windows install; the mobile postinstall applies and verifies the same compatibility patch.',
  );
}

if (require.main === module) {
  prepareWindowsBunInstall();
}

module.exports = { prepareWindowsBunInstall };
