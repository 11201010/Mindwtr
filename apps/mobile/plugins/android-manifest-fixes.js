const { withAndroidManifest } = require('@expo/config-plugins');

const MLKIT_ACTIVITY = 'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity';
const GMS_MODULE_DEPENDENCIES_SERVICE = 'com.google.android.gms.metadata.ModuleDependencies';
const FOSS_PERMISSIONS_TO_REMOVE = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];
const isFossBuild = process.env.FOSS_BUILD === '1' || process.env.FOSS_BUILD === 'true';

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
    if (!application) {
      return config;
    }

    if (!Array.isArray(application.activity)) {
      application.activity = [];
    }

    let didUpdateMlkit = false;
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
        didUpdateMlkit = true;
      }
    });

    if (!didUpdateMlkit && application.activity.length > 0) {
      application.activity.push({
        $: {
          'android:name': MLKIT_ACTIVITY,
          'tools:remove': 'android:screenOrientation',
        },
      });
    }

    if (isFossBuild) {
      if (!Array.isArray(application.service)) {
        application.service = [];
      }

      let didMarkForRemoval = false;
      application.service.forEach((service) => {
        if (service?.$?.['android:name'] === GMS_MODULE_DEPENDENCIES_SERVICE) {
          service.$['tools:node'] = 'remove';
          didMarkForRemoval = true;
        }
      });

      if (!didMarkForRemoval) {
        application.service.push({
          $: {
            'android:name': GMS_MODULE_DEPENDENCIES_SERVICE,
            'tools:node': 'remove',
          },
        });
      }

      if (!Array.isArray(manifest.manifest['uses-permission'])) {
        manifest.manifest['uses-permission'] = [];
      }
      const permissions = manifest.manifest['uses-permission'];
      FOSS_PERMISSIONS_TO_REMOVE.forEach((permissionName) => {
        const existingPermission = permissions.find(
          (permission) => permission?.$?.['android:name'] === permissionName
        );
        if (existingPermission?.$) {
          existingPermission.$['tools:node'] = 'remove';
          return;
        }
        permissions.push({
          $: {
            'android:name': permissionName,
            'tools:node': 'remove',
          },
        });
      });
    }

    return config;
  });
};
