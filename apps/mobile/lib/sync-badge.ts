import { resolveSyncBadgeState, type SyncBadgeState } from '@mindwtr/core/sync-settings-model';

export type MobileSyncActivityState = 'idle' | 'syncing';
export type MobileSyncBadgeState = SyncBadgeState;

export const MOBILE_SYNC_BADGE_COLORS: Record<Exclude<MobileSyncBadgeState, 'hidden'>, string> = {
    syncing: '#F59E0B',
    healthy: '#22C55E',
    attention: '#EF4444',
};

// The rule lives in core (sync-settings-model.ts) so the native app draws the same badge.
export const resolveMobileSyncBadgeState = resolveSyncBadgeState;
