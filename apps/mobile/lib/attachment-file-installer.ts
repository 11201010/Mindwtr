import { requireNativeModule } from 'expo-modules-core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AttachmentFileInstallerUnavailableError,
  createMobileAttachmentInstaller,
  type MobileAttachmentInstaller,
  type NativeAttachmentFileInstaller,
} from '@mindwtr/core/mobile-attachment-installer';
import { logInfo } from './app-log';

// The installer's policy — argument checks, result parsing and File Sync's publication
// reservations — lives in core (`packages/core/src/mobile-attachment-installer.ts`) so the
// native app reuses the same Kotlin installer under the same rules. This module binds it to the
// Expo native module, AsyncStorage and the app log; the core object is made on first use, and
// the native module is loaded on first call.

export { AttachmentFileInstallerUnavailableError };
export type {
  AttachmentFileExpectedGeneration,
  AttachmentFileHashSnapshot,
  AttachmentFileInstallResult,
  FileSyncAttachmentPublicationReservation,
  ImmutableAttachmentFilePublishResult,
} from '@mindwtr/core/mobile-attachment-installer';

let installer: MobileAttachmentInstaller | null = null;

const mobileAttachmentInstaller = (): MobileAttachmentInstaller => {
  if (installer) return installer;
  installer = createMobileAttachmentInstaller({
    loadNativeModule: () => requireNativeModule<NativeAttachmentFileInstaller>('AttachmentFileInstaller'),
    storage: {
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      removeItem: (key) => AsyncStorage.removeItem(key),
    },
    log: { info: (message, context) => logInfo(message, context) },
  });
  return installer;
};

type Installer = MobileAttachmentInstaller;

/** Recover only exact private publication namespaces previously reserved in
 * device-local state. The shared folder is deliberately never scanned. */
export const recoverFileSyncAttachmentPublications: Installer['recoverFileSyncAttachmentPublications'] = (...args) => (
  mobileAttachmentInstaller().recoverFileSyncAttachmentPublications(...args)
);
/** Persist exact ownership before native code creates the private stage. */
export const reserveFileSyncAttachmentPublication: Installer['reserveFileSyncAttachmentPublication'] = (...args) => (
  mobileAttachmentInstaller().reserveFileSyncAttachmentPublication(...args)
);
/** Bind the durable reservation to the exact fully-written inode before native
 * publication. Recovery never deletes an unclaimed or replaced pathname. */
export const claimFileSyncAttachmentPublication: Installer['claimFileSyncAttachmentPublication'] = (...args) => (
  mobileAttachmentInstaller().claimFileSyncAttachmentPublication(...args)
);
export const completeFileSyncAttachmentPublication: Installer['completeFileSyncAttachmentPublication'] = (...args) => (
  mobileAttachmentInstaller().completeFileSyncAttachmentPublication(...args)
);
export const abandonFileSyncAttachmentPublication: Installer['abandonFileSyncAttachmentPublication'] = (...args) => (
  mobileAttachmentInstaller().abandonFileSyncAttachmentPublication(...args)
);
export const retainFileSyncAttachmentPublicationForInvalidTarget: Installer['retainFileSyncAttachmentPublicationForInvalidTarget'] = (...args) => (
  mobileAttachmentInstaller().retainFileSyncAttachmentPublicationForInvalidTarget(...args)
);
/** Clear bounded-collision history only after the canonical target has been
 * independently verified as the requested immutable generation. */
export const clearFileSyncAttachmentPublicationRecovery: Installer['clearFileSyncAttachmentPublicationRecovery'] = (...args) => (
  mobileAttachmentInstaller().clearFileSyncAttachmentPublicationRecovery(...args)
);
export const installAttachmentFileGeneration: Installer['installAttachmentFileGeneration'] = (...args) => (
  mobileAttachmentInstaller().installAttachmentFileGeneration(...args)
);
/** Hash a managed canonical attachment in native code without materializing its
 * bytes in JS. */
export const hashAttachmentFileGeneration: Installer['hashAttachmentFileGeneration'] = (...args) => (
  mobileAttachmentInstaller().hashAttachmentFileGeneration(...args)
);
/** Publish an immutable File Sync generation from a verified same-directory
 * stage with create-no-replace semantics. */
export const publishImmutableAttachmentFileGeneration: Installer['publishImmutableAttachmentFileGeneration'] = (...args) => (
  mobileAttachmentInstaller().publishImmutableAttachmentFileGeneration(...args)
);
