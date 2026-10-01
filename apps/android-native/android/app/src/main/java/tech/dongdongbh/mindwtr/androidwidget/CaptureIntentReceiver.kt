package tech.dongdongbh.mindwtr.androidwidget

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import tech.dongdongbh.mindwtr.pilot.CoreJob // native
import tech.dongdongbh.mindwtr.pilot.CoreWork // native

/**
 * Token-protected automation entry point. It never starts the app or writes its
 * database; a valid request only publishes one pending-capture file.
 *
 * Native: RN's receiver (apps/mobile/modules/android-widget), under RN's class
 * name so an automation that names the component keeps working after the
 * upgrade. The lines marked `native` are the only change (check-boot-gates.mjs
 * keeps the rest RN's): a queued capture starts CoreWork, which stores it now
 * through the app's one core host.
 */
class CaptureIntentReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val ordered = isOrderedBroadcast
    if (ordered) setResultCode(Activity.RESULT_CANCELED)
    if (intent.action != CaptureIntentProcessor.ACTION) return
    val extras = CaptureIntentExtrasReader.read(intent::getStringExtra) ?: return
    val text = extras.text
    val token = extras.token
    if (text.length > PendingCaptureWriter.MAX_TITLE_LENGTH) return
    if (!CaptureIntentConfig.isValidToken(token)) return
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return

    val pendingResult = goAsync()
    try {
      executor.execute {
        try {
          val appContext = context.applicationContext
          val queued = CaptureIntentProcessor.process(
            intent.action,
            mapOf(
              CaptureIntentProcessor.EXTRA_TEXT to text,
              CaptureIntentProcessor.EXTRA_TOKEN to token,
            ),
            CaptureIntentConfigStore.read(appContext),
          ) { title ->
            PendingCaptureWriter.writeCaptureIntent(appContext.filesDir, title) != null
          }
          if (queued && ordered) pendingResult.resultCode = Activity.RESULT_OK
          // The file is on disk: a failed start leaves it for the next app start. // native
          if (queued) runCatching { CoreWork.enqueue(appContext, CoreJob.INGEST) } // native
        } catch (_: Exception) {
          // Fail closed. Broadcasts have no result channel, and private text or
          // tokens must never enter logs.
        } finally {
          pendingResult.finish()
        }
      }
    } catch (_: RejectedExecutionException) {
      pendingResult.finish()
    }
  }

  companion object {
    // One short internal-storage write per job, with a bounded queue so a noisy
    // sender cannot create unbounded process memory pressure.
    private val executor = ThreadPoolExecutor(
      1,
      1,
      30L,
      TimeUnit.SECONDS,
      ArrayBlockingQueue(32),
      { runnable -> Thread(runnable, "mindwtr-capture-intent").apply { isDaemon = true } },
      ThreadPoolExecutor.AbortPolicy(),
    ).apply { allowCoreThreadTimeOut(true) }
  }
}
