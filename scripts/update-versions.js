const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];
if (!newVersion) {
    console.error('Usage: node update-versions.js <version>');
    process.exit(1);
}

const files = [
    'package.json',
    'apps/desktop/package.json',
    'apps/mobile/package.json',
    'apps/cloud/package.json',
    'apps/mcp-server/package.json',
    'packages/core/package.json',
    'apps/mobile/app.json',
    'apps/desktop/src-tauri/tauri.conf.json'
];

console.log(`Updating versions to ${newVersion}...\n`);

files.forEach(file => {
    const filePath = path.resolve(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const json = JSON.parse(content);

            let updated = false;

            // Handle standard package.json
            if (json.version) {
                console.log(`Updating ${file} version from ${json.version} to ${newVersion}`);
                json.version = newVersion;
                updated = true;
            }

            // Handle app.json (Expo)
            if (json.expo && json.expo.version) {
                console.log(`Updating ${file} (expo) version from ${json.expo.version} to ${newVersion}`);
                json.expo.version = newVersion;
                updated = true;
            }

            if (updated) {
                fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
            } else {
                console.warn(`Warning: No version field found in ${file}`);
            }
        } catch (e) {
            console.error(`Error processing ${file}: ${e.message}`);
            process.exit(1);
        }
    } else {
        console.warn(`Warning: File not found: ${file}`);
    }
});

console.log('\nRunning bun install to update lockfile...');
try {
    require('child_process').execSync('bun install', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
} catch (e) {
    console.error(`Error running bun install: ${e.message}`);
    process.exit(1);
}

console.log('\nVersion update complete.');
