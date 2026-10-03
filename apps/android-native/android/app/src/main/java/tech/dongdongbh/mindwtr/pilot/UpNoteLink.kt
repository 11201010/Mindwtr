package tech.dongdongbh.mindwtr.pilot

import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri

/** An explicit handoff attempt; injected boundaries keep the original string intact and test missing handlers. */
internal fun attemptUpNoteLink(original: String, open: (String) -> Unit, failed: (String) -> Unit): Boolean? {
    if (!original.startsWith("upnote://", ignoreCase = true)) return null
    return try { open(original); true } catch (_: Exception) { failed(original); false }
}

internal fun openUpNoteLink(context: Context, original: String, t: (String) -> String, diagnostic: (String) -> Unit): Boolean? {
    val result = attemptUpNoteLink(original,
        open = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) },
        failed = { exact ->
            AlertDialog.Builder(context).setTitle(t("common.error")).setMessage(t("markdown.openLinkFailed"))
                .setPositiveButton(t("markdown.copyLink")) { _, _ ->
                    try {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.setPrimaryClip(ClipData.newPlainText("", exact))
                    } catch (_: Exception) {
                        AlertDialog.Builder(context).setTitle(t("common.error")).setMessage(t("markdown.copyLinkFailed"))
                            .setPositiveButton(t("common.ok"), null).show()
                    }
                }.setNegativeButton(t("common.cancel"), null).show()
        })
    if (result != null) diagnostic(if (result) "opened" else "failed")
    return result
}
