package tech.dongdongbh.mindwtr.androidwidget

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Invisible trampoline behind the widget rows' one mutable PendingIntent
 * template: the row's fill-in data says what to do. An app deep link opens
 * MainActivity; `mindwtr-widget://task/<taskId>` opens the task sheet and
 * `mindwtr-widget://checkoff/<taskId>` toggles the task's pending check-off
 * during the short Undo window. An activity (not a receiver) so the launch is never a
 * background activity start. Finishes inside onCreate.
 */
class WidgetTapActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val data = intent?.data
    when {
      data == null -> Unit
      data.scheme == CHECKOFF_SCHEME && data.host == PEEK_HOST -> {
        // The row's own id, but it still arrives through a mutable fill-in
        // intent, so it only opens the sheet when the payload still lists it.
        val taskId = data.lastPathSegment?.trim().orEmpty()
        val item = WidgetPayloadStore.read(this).itemFor(taskId)
        if (item == null) startActivity(WidgetRenderer.appIntent(this, WidgetPayloadStore.read(this).focusUri))
        else startActivity(
          Intent(this, TaskPeekActivity::class.java)
            .putExtra(TaskPeekActivity.EXTRA_TASK_ID, taskId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      }
      data.scheme == CHECKOFF_SCHEME && data.host == CHECKOFF_HOST -> {
        val taskId = data.lastPathSegment?.trim().orEmpty()
        if (taskId.isNotEmpty()) {
          when (CheckoffStore.tapAction(this, taskId)) {
            CheckoffStore.TapAction.TOGGLE_PENDING -> {
              CheckoffStore.toggle(this, taskId)
              WidgetRenderer.refreshAll(this)
            }
            // A stale tap after the durable queue boundary may only reconcile
            // presentation; it must never remove the queued command.
            CheckoffStore.TapAction.RECONCILE -> CheckoffStore.reconcileFromInteraction(this)
            CheckoffStore.TapAction.NO_OP -> Unit
          }
        }
      }
      data.scheme == "mindwtr" -> startActivity(WidgetRenderer.appIntent(this, data.toString()))
    }
    finish()
  }

  companion object {
    const val CHECKOFF_SCHEME = "mindwtr-widget"
    const val CHECKOFF_HOST = "checkoff"
    const val PEEK_HOST = "task"

    fun checkoffUri(taskId: String): String = "$CHECKOFF_SCHEME://$CHECKOFF_HOST/${android.net.Uri.encode(taskId)}"

    fun peekUri(taskId: String): String = "$CHECKOFF_SCHEME://$PEEK_HOST/${android.net.Uri.encode(taskId)}"
  }
}
