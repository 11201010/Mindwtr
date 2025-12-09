const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [workspaceRoot];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Handle bun's symlink structure
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

// 4. Custom resolver to handle workspace packages and problematic modules
config.resolver.resolveRequest = (context, moduleName, platform) => {
    // Mock whatwg-url-without-unicode which doesn't work well in React Native
    if (moduleName === 'whatwg-url-without-unicode') {
        return {
            filePath: path.resolve(projectRoot, 'whatwg-url-mock.js'),
            type: 'sourceFile',
        };
    }

    // Handle @focus-gtd/core workspace package
    if (moduleName === '@focus-gtd/core' || moduleName.startsWith('@focus-gtd/core/')) {
        const corePath = path.resolve(workspaceRoot, 'packages/core/src/index.ts');
        return {
            filePath: corePath,
            type: 'sourceFile',
        };
    }

    return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
