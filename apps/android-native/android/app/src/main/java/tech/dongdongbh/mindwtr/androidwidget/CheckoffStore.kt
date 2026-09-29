package tech.dongdongbh.mindwtr.androidwidget

/**
 * The one constant of RN's CheckoffStore.kt that RN's PendingCaptureWriter.kt (compiled in as it is) names. The widgets pass
 * brings RN's whole CheckoffStore.kt and deletes this file; check-boot-gates.mjs keeps the value RN's until then.
 */
object CheckoffStore {
    const val UNDO_WINDOW_MS = 3_000L
}
