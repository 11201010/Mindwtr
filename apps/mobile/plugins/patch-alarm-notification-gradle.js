const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const applyCompatPatch = (filePath) => {
  if (!fs.existsSync(filePath)) return false;

  const original = fs.readFileSync(filePath, 'utf8');
  let next = original;

  // Removed in modern Gradle.
  next = next.replace(/^\s*apply plugin: 'maven'\s*$/gm, '');

  // AGP 8 expects modern compileSdk DSL.
  next = next.replace(
    "compileSdkVersion safeExtGet('compileSdkVersion', DEFAULT_COMPILE_SDK_VERSION)",
    "compileSdk safeExtGet('compileSdkVersion', DEFAULT_COMPILE_SDK_VERSION)"
  );

  // Legacy publishing tasks rely on deprecated configurations (e.g. compile).
  const marker = 'afterEvaluate { project ->';
  const markerIndex = next.indexOf(marker);
  if (markerIndex >= 0) {
    next = `${next.slice(0, markerIndex).trimEnd()}\n\n// Legacy publishing tasks removed for modern Gradle compatibility.\n`;
  }

  if (next === original) return false;
  fs.writeFileSync(filePath, next);
  return true;
};

module.exports = function withAlarmNotificationGradlePatch(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const candidates = [
        path.join(projectRoot, 'node_modules', 'react-native-alarm-notification', 'android', 'build.gradle'),
        path.join(projectRoot, '..', '..', 'node_modules', 'react-native-alarm-notification', 'android', 'build.gradle'),
      ];

      for (const candidate of candidates) {
        if (applyCompatPatch(candidate)) {
          // eslint-disable-next-line no-console
          console.log(`[alarm-gradle-patch] patched ${candidate}`);
          break;
        }
      }
      return cfg;
    },
  ]);
};

