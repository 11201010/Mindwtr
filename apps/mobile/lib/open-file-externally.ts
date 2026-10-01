import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import { resolveAttachmentViewMimeType } from '@mindwtr/core';

import { getContentUriAsync } from './file-system';

// The ACTION_VIEW MIME type (stored, else from the extension, else */*) is core's rule.
const resolveViewMimeType = (uri: string, mimeType?: string): string => resolveAttachmentViewMimeType(uri, mimeType);

/**
 * Opens a local file in an Android viewer app via ACTION_VIEW. The share sheet
 * (ACTION_SEND) only reaches send/save targets — PDF and document VIEWERS
 * register for ACTION_VIEW — so opening attachments through sharing read as
 * "I can only save it, not open it" (feedback 29f56873). Returns false on
 * non-Android platforms and when no installed app can view the type, so the
 * caller can fall back to its existing share-sheet path.
 */
export async function tryOpenWithAndroidViewer(uri: string, mimeType?: string): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
        const contentUri = await getContentUriAsync(uri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            // FLAG_GRANT_READ_URI_PERMISSION — the viewer cannot read the
            // app-private file without an explicit read grant on the URI.
            flags: 1,
            type: resolveViewMimeType(uri, mimeType),
        });
        return true;
    } catch {
        // No viewer installed for this type, or the URI grant failed — the
        // caller's share sheet is still a way out.
        return false;
    }
}

export const __openFileExternallyTestUtils = { resolveViewMimeType };
