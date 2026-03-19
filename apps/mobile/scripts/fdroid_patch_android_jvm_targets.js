#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const mobileRoot = path.join(__dirname, '..');
const nodeModulesRoot = path.join(mobileRoot, 'node_modules');

const TOOLCHAIN_REPLACEMENTS = new Map([
  [
    'node_modules/@react-native/gradle-plugin/settings-plugin/build.gradle.kts',
    [['jvmToolchain(17)', 'jvmToolchain(org.gradle.api.JavaVersion.current().majorVersion.toInt())']],
  ],
  [
    'node_modules/@react-native/gradle-plugin/shared/build.gradle.kts',
    [['jvmToolchain(17)', 'jvmToolchain(org.gradle.api.JavaVersion.current().majorVersion.toInt())']],
  ],
  [
    'node_modules/@react-native/gradle-plugin/shared-testutil/build.gradle.kts',
    [['jvmToolchain(17)', 'jvmToolchain(org.gradle.api.JavaVersion.current().majorVersion.toInt())']],
  ],
  [
    'node_modules/@react-native/gradle-plugin/react-native-gradle-plugin/build.gradle.kts',
    [['jvmToolchain(17)', 'jvmToolchain(org.gradle.api.JavaVersion.current().majorVersion.toInt())']],
  ],
  [
    'node_modules/@react-native/gradle-plugin/react-native-gradle-plugin/src/main/kotlin/com/facebook/react/utils/JdkConfiguratorUtils.kt',
    [[
      'project.kotlinExtension.jvmToolchain(17)',
      'project.kotlinExtension.jvmToolchain(JavaVersion.current().majorVersion.toInt())',
    ]],
  ],
  [
    'node_modules/react-native/ReactAndroid/build.gradle.kts',
    [['jvmToolchain(17)', 'jvmToolchain(org.gradle.api.JavaVersion.current().majorVersion.toInt())']],
  ],
]);

const EXPLICIT_ANDROID_OVERRIDES = [
  'node_modules/react-native-safe-area-context/android/build.gradle',
  'node_modules/react-native-screens/android/build.gradle',
  'node_modules/react-native-gesture-handler/android/build.gradle',
];

const FDROID_JAVA17_MARKER = '// F-Droid: force Java/Kotlin Android modules to target JVM 17.';
const FDROID_JAVA17_SNIPPET =
  `${FDROID_JAVA17_MARKER}\n` +
  'android {\n' +
  '    compileOptions {\n' +
  '        sourceCompatibility JavaVersion.VERSION_17\n' +
  '        targetCompatibility JavaVersion.VERSION_17\n' +
  '    }\n' +
  '    kotlinOptions {\n' +
  '        jvmTarget = JavaVersion.VERSION_17.toString()\n' +
  '    }\n' +
  '}\n';

function readText(relativePath) {
  return fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8');
}

function writeText(relativePath, text) {
  fs.writeFileSync(path.join(mobileRoot, relativePath), text);
}

function replaceRequired(relativePath, replacements) {
  let text = readText(relativePath);
  const original = text;

  for (const [oldText, newText] of replacements) {
    text = text.replaceAll(oldText, newText);
  }

  if (text === original) {
    throw new Error(`[fdroid] expected patch target not found: ${relativePath}`);
  }

  writeText(relativePath, text);
}

function appendJava17Override(relativePath) {
  let text = readText(relativePath);
  if (text.includes(FDROID_JAVA17_MARKER)) {
    return false;
  }

  text = text.replace(/\r\n/g, '\n').trimEnd() + `\n\n${FDROID_JAVA17_SNIPPET}`;
  writeText(relativePath, text);
  return true;
}

function listPackageDirs() {
  const packageDirs = [];
  for (const entry of fs.readdirSync(nodeModulesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nodeModulesRoot, entry.name);
      for (const scopedEntry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) {
          packageDirs.push(path.join(scopeDir, scopedEntry.name));
        }
      }
    } else {
      packageDirs.push(path.join(nodeModulesRoot, entry.name));
    }
  }
  return packageDirs;
}

function hasKotlinSources(sourceDir) {
  if (!fs.existsSync(sourceDir)) {
    return false;
  }

  const stack = [sourceDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.kt')) {
        return true;
      }
    }
  }

  return false;
}

function listExpoAndroidModulesWithKotlin() {
  return listPackageDirs()
    .filter((packageDir) => {
      const packageName = path.relative(nodeModulesRoot, packageDir).replaceAll(path.sep, '/');
      const leafName = path.basename(packageDir);
      if (!(leafName === 'expo' || leafName.startsWith('expo-'))) {
        return false;
      }

      const buildGradle = path.join(packageDir, 'android', 'build.gradle');
      const sourceDir = path.join(packageDir, 'android', 'src');
      return fs.existsSync(buildGradle) && hasKotlinSources(sourceDir);
    })
    .map((packageDir) => path.relative(mobileRoot, path.join(packageDir, 'android', 'build.gradle')).replaceAll(path.sep, '/'))
    .sort();
}

const changed = [];

for (const [relativePath, replacements] of TOOLCHAIN_REPLACEMENTS.entries()) {
  replaceRequired(relativePath, replacements);
  changed.push(relativePath);
}

for (const relativePath of [...EXPLICIT_ANDROID_OVERRIDES, ...listExpoAndroidModulesWithKotlin()]) {
  if (appendJava17Override(relativePath)) {
    changed.push(relativePath);
  }
}

console.log('[fdroid] patched Android JVM targets:');
changed.forEach((relativePath) => console.log(`- ${relativePath}`));
