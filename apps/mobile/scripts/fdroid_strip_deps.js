#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const removeDeps = ['expo-dev-client', 'expo-notifications'];
let changed = false;

for (const dep of removeDeps) {
  if (pkg.dependencies && dep in pkg.dependencies) {
    delete pkg.dependencies[dep];
    changed = true;
  }
  if (pkg.devDependencies && dep in pkg.devDependencies) {
    delete pkg.devDependencies[dep];
    changed = true;
  }
}

if (pkg.dependencies && pkg.dependencies['@mindwtr/core'] === 'workspace:*') {
  pkg.dependencies['@mindwtr/core'] = 'file:../../packages/core';
  changed = true;
  console.log('[fdroid] rewrote @mindwtr/core to file:../../packages/core for npm compatibility');
}

if (changed) {
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log('[fdroid] stripped deps:', removeDeps.join(', '));
} else {
  console.log('[fdroid] no deps to strip');
}

const coreDep = pkg.dependencies?.['@mindwtr/core'];
if (typeof coreDep === 'string' && coreDep.startsWith('workspace:')) {
  throw new Error('[fdroid] @mindwtr/core still uses workspace:*; npm install will fail in non-workspace environments');
}
