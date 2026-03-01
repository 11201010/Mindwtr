const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const applyGradleCompatPatch = (filePath) => {
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

const applyAlarmPendingIntentPatch = (filePath) => {
  if (!fs.existsSync(filePath)) return false;

  const original = fs.readFileSync(filePath, 'utf8');
  let next = original;

  const helperMarker = '    private NotificationManager getNotificationManager() {';
  if (!next.includes('getUpdateCurrentImmutableFlags()') && next.includes(helperMarker)) {
    next = next.replace(
      helperMarker,
      `    private int getImmutableFlag() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return PendingIntent.FLAG_IMMUTABLE;
        }
        return 0;
    }

    private int getUpdateCurrentImmutableFlags() {
        return PendingIntent.FLAG_UPDATE_CURRENT | getImmutableFlag();
    }

${helperMarker}`
    );
  }

  next = next.replace(
    /PendingIntent\.getBroadcast\(([^;]*?),\s*PendingIntent\.FLAG_UPDATE_CURRENT\)/g,
    'PendingIntent.getBroadcast($1, getUpdateCurrentImmutableFlags())'
  );
  next = next.replace(
    /PendingIntent\.getActivity\(([^;]*?),\s*PendingIntent\.FLAG_UPDATE_CURRENT\)/g,
    'PendingIntent.getActivity($1, getUpdateCurrentImmutableFlags())'
  );
  next = next.replace(
    /PendingIntent\.getBroadcast\(([^;]*?),\s*0\)/g,
    'PendingIntent.getBroadcast($1, getImmutableFlag())'
  );
  next = next.replace(
    /PendingIntent\.getActivity\(([^;]*?),\s*0\)/g,
    'PendingIntent.getActivity($1, getImmutableFlag())'
  );

  if (next === original) return false;
  fs.writeFileSync(filePath, next);
  return true;
};

module.exports = function withAlarmNotificationGradlePatch(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const gradleCandidates = [
        path.join(projectRoot, 'node_modules', 'react-native-alarm-notification', 'android', 'build.gradle'),
        path.join(projectRoot, '..', '..', 'node_modules', 'react-native-alarm-notification', 'android', 'build.gradle'),
      ];
      const javaCandidates = [
        path.join(projectRoot, 'node_modules', 'react-native-alarm-notification', 'android', 'src', 'main', 'java', 'com', 'emekalites', 'react', 'alarm', 'notification', 'AlarmUtil.java'),
        path.join(projectRoot, '..', '..', 'node_modules', 'react-native-alarm-notification', 'android', 'src', 'main', 'java', 'com', 'emekalites', 'react', 'alarm', 'notification', 'AlarmUtil.java'),
      ];

      for (const candidate of gradleCandidates) {
        if (applyGradleCompatPatch(candidate)) {
          // eslint-disable-next-line no-console
          console.log(`[alarm-gradle-patch] patched ${candidate}`);
          break;
        }
      }

      for (const candidate of javaCandidates) {
        if (applyAlarmPendingIntentPatch(candidate)) {
          // eslint-disable-next-line no-console
          console.log(`[alarm-pending-intent-patch] patched ${candidate}`);
          break;
        }
      }
      return cfg;
    },
  ]);
};
