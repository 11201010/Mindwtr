import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

type EnvironmentVariable = { name: string; isSecret?: boolean };

test('registry manifest marks every token environment variable secret', () => {
    const manifestPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { packages: { environmentVariables?: EnvironmentVariable[] }[] };
    const tokens = manifest.packages
        .flatMap((entry) => entry.environmentVariables ?? [])
        .filter((variable) => variable.name.endsWith('_TOKEN'));
    expect(tokens.map((variable) => variable.name)).toContain('MINDWTR_MCP_CLOUD_TOKEN');
    expect(tokens.filter((variable) => variable.isSecret !== true).map((variable) => variable.name)).toEqual([]);
});
