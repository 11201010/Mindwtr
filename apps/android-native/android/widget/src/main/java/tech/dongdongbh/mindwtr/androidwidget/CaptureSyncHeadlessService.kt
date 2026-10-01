package tech.dongdongbh.mindwtr.androidwidget

import android.content.Context
import android.content.SharedPreferences
import android.util.Log

/**
 * Native: RN's CaptureSyncHeadlessService woke React Native's JS to import the pending-captures queue (#1257). Here the app's
 * CoreWork stores the queue, through the hook the app sets at process start ([install], MindwtrApplication). RN's dialog
 * (QuickCaptureActivity, compiled as it is) calls [start] where it started RN's service; the capture intent receiver calls it
 * once a capture is queued; and a widget check-off RN's CheckoffStore commits to the queue calls it too: the hook watches
 * CheckoffStore's committed record, which RN's sweep writes only after the queue file is on disk. A missing or failing hook
 * loses nothing: the file stays queued, and the next app start drains it.
 */
object CaptureSyncHeadlessService {
  private const val TAG = "Mindwtr"
  @Volatile private var queued: ((Context) -> Unit)? = null
  // SharedPreferences keeps its listeners weakly: this keeps the one watching CheckoffStore's committed record.
  private var committed: Pair<SharedPreferences, SharedPreferences.OnSharedPreferenceChangeListener>? = null

  /** Sets the app's hook ([queued], null to remove it); called once per process before any widget component runs. */
  @Synchronized
  fun install(context: Context, queued: ((Context) -> Unit)?) {
    val app = context.applicationContext
    this.queued = queued
    committed?.let { (prefs, listener) -> prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    committed = null
    if (queued == null) return
    val prefs = app.getSharedPreferences(CheckoffStore.COMMITTED_PREFS_NAME, Context.MODE_PRIVATE)
    // A key written (not one a prune removed, nor a clear's null key): a check-off's completion is on disk in the queue.
    val listener = SharedPreferences.OnSharedPreferenceChangeListener { changed, key -> if (key != null && changed.contains(key)) start(app) }
    prefs.registerOnSharedPreferenceChangeListener(listener)
    committed = prefs to listener
  }

  /** Call once a pending-captures file is on disk. */
  fun start(context: Context) {
    val hook = queued ?: return
    try {
      hook(context.applicationContext)
    } catch (error: RuntimeException) {
      // The capture is already queued; the app imports it the next time it opens.
      Log.w(TAG, "capture sync start refused: ${error.javaClass.simpleName}")
    }
  }
}
