// One home for the request options and the streamed uploader's cleartext guard
// (`assertMobileWebdavConnection`, SEC-10a), shared with core's mobile sync service and
// attachment passes.
export {
  assertMobileWebdavConnection,
  getMobileCloudRequestOptions,
  getMobileWebDavRequestOptions,
} from '@mindwtr/core/mobile-sync-utils';
