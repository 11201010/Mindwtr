import { assertConnectionAllowed, SYNC_LOCAL_INSECURE_URL_OPTIONS } from '@mindwtr/core';

// One home for the request options, shared with core's mobile sync service.
export { getMobileCloudRequestOptions, getMobileWebDavRequestOptions } from '@mindwtr/core/mobile-sync-utils';

const WEBDAV_HTTPS_ERROR =
  'WebDAV requires HTTPS for public URLs (HTTP allowed for localhost, private IPs, and local hostnames).';

/**
 * The cleartext guard core runs inside every `webdav*` call. Mobile's expo-file-system
 * uploader talks to the server directly, so it never reaches that guard — without this it
 * would stream Basic credentials and the file's bytes in the clear (SEC-10a). Android's
 * `cleartextTrafficPermitted="true"` is load-bearing for private-IP WebDAV (#663), so this
 * JS check is the enforcement point, not the platform config.
 */
export const assertMobileWebdavConnection = (url: string, allowInsecureHttp?: boolean): void => {
  assertConnectionAllowed(url, WEBDAV_HTTPS_ERROR, {
    ...SYNC_LOCAL_INSECURE_URL_OPTIONS,
    allowInsecureHttp: allowInsecureHttp === true,
  });
};
