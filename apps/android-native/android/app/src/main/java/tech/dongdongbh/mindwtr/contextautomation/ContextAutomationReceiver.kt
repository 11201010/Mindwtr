package tech.dongdongbh.mindwtr.contextautomation

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import tech.dongdongbh.mindwtr.pilot.CoreJob
import tech.dongdongbh.mindwtr.pilot.CoreWork

private const val ACTIVATE_CONTEXT_ACTION = "tech.dongdongbh.mindwtr.action.ACTIVATE_CONTEXT"
private const val DEACTIVATE_CONTEXT_ACTION = "tech.dongdongbh.mindwtr.action.DEACTIVATE_CONTEXT"

/**
 * RN's context automation receiver (apps/mobile/modules/context-automation), under RN's class name so an automation that names
 * the component keeps working after the upgrade. Its intent reading ([ContextAutomationPayload], below) is RN's, kept equal by
 * check-boot-gates.mjs. Where RN starts its headless JS task, this starts CoreWork, which asks core (runContextAutomation) for
 * the notification to post; a deactivation goes too, and core answers it with none, as in RN.
 */
class ContextAutomationReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    // Another app's extras that do not unparcel (a class this app lacks, on Android 12 and older) end here, not in a crash.
    val payload = runCatching { ContextAutomationPayload.fromIntent(intent) }.getOrNull() ?: return
    CoreWork.enqueue(context.applicationContext, CoreJob.CONTEXT, mapOf("action" to payload.action, "context" to payload.context))
  }
}

private data class ContextAutomationPayload(
  val action: String,
  val context: String
) {
  companion object {
    fun fromIntent(intent: Intent?): ContextAutomationPayload? {
      val contextAction = when (intent?.action) {
        ACTIVATE_CONTEXT_ACTION -> "activate"
        DEACTIVATE_CONTEXT_ACTION -> "deactivate"
        else -> return null
      }

      fun clean(value: String?): String? {
        val trimmed = value?.trim().orEmpty()
        return if (trimmed.isBlank()) null else trimmed
      }

      val data = intent.data
      val ignoredPathSegments = setOf("context", "contexts", "activate", "deactivate")
      val pathContext = data?.pathSegments
        ?.filter { segment -> !ignoredPathSegments.contains(segment) }
        ?.joinToString("/")
      val hostContext = data?.host?.takeIf { host -> host != "context" && host != "contexts" }
      val rawContext = clean(intent.getStringExtra("context"))
        ?: clean(intent.getStringExtra("name"))
        ?: clean(intent.getStringExtra("token"))
        ?: clean(intent.getStringExtra(Intent.EXTRA_TEXT))
        ?: clean(data?.getQueryParameter("context"))
        ?: clean(data?.getQueryParameter("name"))
        ?: clean(data?.getQueryParameter("token"))
        ?: clean(pathContext)
        ?: clean(hostContext)
        ?: return null

      return ContextAutomationPayload(contextAction, rawContext)
    }
  }
}
