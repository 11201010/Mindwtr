package tech.dongdongbh.mindwtr.androidwidget

import android.app.Activity
import android.os.Bundle

/**
 * Invisible trampoline behind the widget rows' one mutable PendingIntent
 * template: the row's fill-in data says what to do. An app deep link opens
 * MainActivity; `mindwtr-widget://checkoff/<taskId>` toggles the task's
 * pending check-off, and undoes it once the completion is queued. An activity (not a receiver) so the launch is never a
 * background activity start. Finishes inside onCreate.
 */
class WidgetTapActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val data = intent?.data
    when {
      data == null -> Unit
      data.scheme == CHECKOFF_SCHEME && data.host == CHECKOFF_HOST -> {
        val taskId = data.lastPathSegment?.trim().orEmpty()
        if (taskId.isNotEmpty()) {
          // Already queued: the ring takes it back off the queue. Only an
          // activity may redraw a collection widget (a background Handler
          // breaks every later update on Android 16).
          if (CheckoffStore.isCommitted(this, taskId)) CheckoffStore.undo(this, taskId)
          else CheckoffStore.toggle(this, taskId)
          WidgetRenderer.refreshAll(this)
        }
      }
      data.scheme == "mindwtr" -> startActivity(WidgetRenderer.appIntent(this, data.toString()))
    }
    finish()
  }

  companion object {
    const val CHECKOFF_SCHEME = "mindwtr-widget"
    const val CHECKOFF_HOST = "checkoff"

    fun checkoffUri(taskId: String): String = "$CHECKOFF_SCHEME://$CHECKOFF_HOST/${android.net.Uri.encode(taskId)}"
  }
}
