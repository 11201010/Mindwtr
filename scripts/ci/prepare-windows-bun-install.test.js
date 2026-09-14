import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prepareModule from './prepare-windows-bun-install.js';

const { prepareWindowsBunInstall } = prepareModule;
const packageEntry = '    "query-string@7.1.3": "patches/query-string@7.1.3.patch"';
const lockEntry = `${packageEntry},`;

test('Windows install preparation removes only the duplicate Bun patch entry', () => {
  const directory = mkdtempSync(join(tmpdir(), 'windows-bun-install-'));
  try {
    mkdirSync(directory, { recursive: true });
    const packagePath = join(directory, 'package.json');
    const lockPath = join(directory, 'bun.lock');
    const packageSource = `{\n  "patchedDependencies": {\n    "other@1.0.0": "patches/other.patch",\n${packageEntry}\n  }\n}\n`;
    const lockSource = `{\r\n  "patchedDependencies": {\r\n${lockEntry}\r\n    "other@1.0.0": "patches/other.patch",\r\n  },\r\n}\r\n`;
    writeFileSync(packagePath, packageSource);
    writeFileSync(lockPath, lockSource);

    prepareWindowsBunInstall(directory);

    expect(readFileSync(packagePath, 'utf8')).not.toContain('query-string@7.1.3');
    expect(readFileSync(lockPath, 'utf8')).not.toContain('query-string@7.1.3');
    expect(readFileSync(packagePath, 'utf8')).toContain('other@1.0.0');
    expect(readFileSync(lockPath, 'utf8')).toContain('other@1.0.0');
    expect(() => prepareWindowsBunInstall(directory)).toThrow(
      'Expected the query-string patchedDependencies entry',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
