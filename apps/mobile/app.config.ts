import type { ConfigContext, ExpoConfig } from 'expo/config';

type PluginEntry = NonNullable<ExpoConfig['plugins']>[number];

const isFossBuild = process.env.FOSS_BUILD === '1' || process.env.FOSS_BUILD === 'true';

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  const plugins: PluginEntry[] = Array.isArray(base.plugins) ? [...base.plugins] : [];
  const fossPluginBlocklist = new Set(['expo-notifications']);
  const filteredPlugins = isFossBuild
    ? plugins.filter((plugin) => {
        if (typeof plugin === 'string') {
          return !fossPluginBlocklist.has(plugin);
        }
        if (Array.isArray(plugin)) {
          if (plugin.length === 0) return true;
          const name = plugin[0];
          return typeof name === 'string' ? !fossPluginBlocklist.has(name) : true;
        }
        return true;
      })
    : plugins;

  const android = base.android ? { ...base.android } : undefined;
  if (android && Array.isArray(android.permissions)) {
    android.permissions = isFossBuild
      ? android.permissions.filter((permission) => permission !== 'POST_NOTIFICATIONS')
      : android.permissions;
  }

  const extra = {
    ...(base.extra ?? {}),
    isFossBuild,
  };

  return {
    ...base,
    android,
    plugins: filteredPlugins,
    extra,
  };
};
