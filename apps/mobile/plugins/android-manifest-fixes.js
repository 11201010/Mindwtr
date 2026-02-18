const { withAndroidManifest } = require('@expo/config-plugins');

const MLKIT_ACTIVITY = 'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity';
const MAIN_ACTIVITY = '.MainActivity';
const GMS_MODULE_DEPENDENCIES_SERVICE = 'com.google.android.gms.metadata.ModuleDependencies';
const PERMISSIONS_TO_REMOVE = [
  'android.permission.CAMERA',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
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
    if (!application.$) {
      application.$ = {};
    }
    application.$['android:resizeableActivity'] = 'true';

    const existingSupportsScreens = manifest.manifest['supports-screens']?.[0]?.$ ?? {};
    manifest.manifest['supports-screens'] = [
      {
        $: {
          ...existingSupportsScreens,
          'android:smallScreens': 'true',
          'android:normalScreens': 'true',
          'android:largeScreens': 'true',
          'android:xlargeScreens': 'true',
          'android:anyDensity': 'true',
          'android:resizeable': 'true',
        },
      },
    ];

    if (!Array.isArray(application.activity)) {
      application.activity = [];
    }

    let didUpdateMainActivity = false;
    let didUpdateMlkit = false;
    application.activity.forEach((activity) => {
      if (activity.$ && activity.$['android:name'] === MAIN_ACTIVITY) {
        // Explicitly allow both portrait and landscape on tablets/Chromebooks.
        activity.$['android:screenOrientation'] = 'fullUser';
        activity.$['android:resizeableActivity'] = 'true';
        didUpdateMainActivity = true;
      }
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

    if (!didUpdateMainActivity) {
      application.activity.push({
        $: {
          'android:name': MAIN_ACTIVITY,
          'android:screenOrientation': 'fullUser',
          'android:resizeableActivity': 'true',
          'tools:node': 'merge',
        },
      });
    }

    if (!didUpdateMlkit && application.activity.length > 0) {
      application.activity.push({
        $: {
          'android:name': MLKIT_ACTIVITY,
          'tools:remove': 'android:screenOrientation',
        },
      });
    }

    if (!Array.isArray(manifest.manifest['uses-permission'])) {
      manifest.manifest['uses-permission'] = [];
    }
    const permissions = manifest.manifest['uses-permission'];
    PERMISSIONS_TO_REMOVE.forEach((permissionName) => {
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
    }

    return config;
  });
};
