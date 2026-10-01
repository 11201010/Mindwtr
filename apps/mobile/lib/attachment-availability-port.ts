import type { Attachment, AttachmentAvailabilityPort } from '@mindwtr/core';

import {
    ensureAttachmentAvailableDetailed,
    getAttachmentAvailabilityPatch,
    getAttachmentDownloadIdentity,
    getAttachmentUnrecoverablePatch,
    hasAttachmentDownloadIdentity,
} from './attachment-sync-availability';

// The on-demand download and its identity rules, as core's attachment editor model asks for
// them (resolveAttachmentAvailability). Each binding calls the import when used, so tests that
// replace attachment-sync-availability still reach their mocks.
export const attachmentAvailabilityPort: AttachmentAvailabilityPort = {
    ensureAttachmentAvailableDetailed: (attachment) => ensureAttachmentAvailableDetailed(attachment),
    getAttachmentDownloadIdentity: (attachment) => getAttachmentDownloadIdentity(attachment),
    hasAttachmentDownloadIdentity: (attachment, identity): attachment is Attachment => hasAttachmentDownloadIdentity(attachment, identity),
    getAttachmentAvailabilityPatch: (current, resolved) => getAttachmentAvailabilityPatch(current, resolved),
    getAttachmentUnrecoverablePatch: (resolved) => getAttachmentUnrecoverablePatch(resolved),
};
