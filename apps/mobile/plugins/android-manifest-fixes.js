const { withAndroidManifest } = require('@expo/config-plugins');

const MLKIT_ACTIVITY = 'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity';

module.exports = function withAndroidManifestFixes(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    if (!manifest.manifest.$) {
      manifest.manifest.$ = {};
    }
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    const application = manifest.manifest.application?.[0];
    if (!application?.activity) {
      return config;
    }

    application.activity.forEach((activity) => {
      if (activity.$ && activity.$['android:name'] === MLKIT_ACTIVITY) {
        // Remove forced orientation for large screens.
        delete activity.$['android:screenOrientation'];
        const existingRemove = activity.$['tools:remove'];
        if (existingRemove) {
          activity.$['tools:remove'] = Array.isArray(existingRemove)
            ? [...existingRemove, 'android:screenOrientation']
            : `${existingRemove},android:screenOrientation`;
        } else {
          activity.$['tools:remove'] = 'android:screenOrientation';
        }
      }
    });

    return config;
  });
};
