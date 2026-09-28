// The commit protocol lives in core (mobile-sync-configuration-transaction.ts) so the native
// app commits a proven sync configuration exactly as this app does.
export {
    commitProvenMobileSyncConfiguration,
    MobileSyncConfigurationTransactionError,
    type MobileSyncConfigurationTransactionDependencies,
} from '@mindwtr/core/mobile-sync-configuration-transaction';
