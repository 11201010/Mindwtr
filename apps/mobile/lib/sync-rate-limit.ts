// The WebDAV cooldown lives in core (sync-rate-limit.ts) so every host applies the same one.
export {
    createWebdavSyncRateLimitController,
    WEBDAV_SYNC_COOLDOWN_MS,
    type WebdavSyncRateLimitController,
} from '@mindwtr/core';
