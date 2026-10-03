package tech.dongdongbh.mindwtr.pilot

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.Operation
import androidx.work.OneTimeWorkRequest
import androidx.work.Operation
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import tech.dongdongbh.mindwtr.pilot.core.debugProperty
import java.util.concurrent.TimeUnit

/**
 * CoreWork (D7): a WorkManager job that runs one named core job ([CoreJob]) while the app may be closed: the capture intent's
 * queue drain, a context trigger's notification, a reminder's Done or Snooze, the reminders planned again. It runs in the app's process on this process's one host: a running app's own,
 * or one this job boots with the app's boot order (ProcessCoreHost: validated load, journal replay, queue drain). Never in
 * another process: two hosts on one database reject each other's writes.
 */
class CoreWork(context: Context, params: WorkerParameters) : Worker(context, params) {
    companion object {
        private const val JOB = "job"
        /**
         * Drains share one queue, so a new request replaces a waiting one (a drain waiting out a retry's back-off starts again
         * now); one in flight goes on to its end, and the new one runs anyway, so a file written meanwhile is never missed.
         * Core runs one drain at a time.
         */
        private const val INGEST_WORK = "mindwtr-core-ingest"

        /**
         * Queues job [job] with [input] to run now, expedited where Android runs expedited work without a foreground notification
         * (Android 12+). Debug builds only: `debug.mindwtr.native.core_work_delay_ms` holds it back that long, so
         * check-runner-device.mjs can run it through JobScheduler (`cmd jobscheduler run -f`).
         */
        fun enqueue(context: Context, job: String, input: Map<String, String> = emptyMap()): Operation = enqueue(context, job, input, ExistingWorkPolicy.REPLACE)

        /**
         * Job [job] from a receiver whose process may end once it returns (a notification's button, a reboot): the receiver stays
         * alive (goAsync) until WorkManager stored the job, and only then [done] runs (the notification goes). A job WorkManager did
         * not store leaves the notification for another tap.
         */
        fun enqueueDurably(receiver: BroadcastReceiver, context: Context, job: String, input: Map<String, String>, done: () -> Unit = {}) {
            val pending = receiver.goAsync()
            DurableQueue.run(
                queue = { settle ->
                    val operation = enqueue(context, job, input)
                    operation.result.addListener({ settle(runCatching { operation.result.get() }.exceptionOrNull()) }, Runnable::run)
                },
                done = done,
                finish = pending::finish,
                failed = {
                    Log.w(CoreHost.TAG, "Native Android core work not queued job=$job", it)
                    // Every caller is a reminder receiver: the next plan's summary line reports it.
                    runCatching { ReminderReceiverCounts.of(context).add(ReminderReceiverCounts.NOT_QUEUED) }
                },
            )
        }

        /**
         * A drain that did not finish, retried as the ingest job (ProcessCoreHost.recovered). KEEP: a drain job already waiting or
         * running (this boot may be its own) retries with its back-off instead.
         */
        fun retryDrain(context: Context) = enqueue(context, CoreJob.INGEST, emptyMap(), ExistingWorkPolicy.KEEP)

        private fun enqueue(context: Context, job: String, input: Map<String, String>, policy: ExistingWorkPolicy): Operation {
            val delayMs = debugProperty("core_work_delay_ms").toLongOrNull() ?: 0L
            val request = OneTimeWorkRequest.Builder(CoreWork::class.java)
                .setInputData(Data.Builder().putAll(input + (JOB to job)).build())
                .apply {
                    if (delayMs > 0) setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                    else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                }
                .build()
            val work = WorkManager.getInstance(context)
            val requestId = input["requestId"]
            return when {
                job == CoreJob.INGEST -> work.enqueueUniqueWork(INGEST_WORK, policy, request)
                // A reminder's Done or Snooze: a second tap on the same notification is the same request, queued once.
                requestId != null -> work.enqueueUniqueWork("mindwtr-core-$job-$requestId", ExistingWorkPolicy.KEEP, request)
                else -> work.enqueue(request)
            }
        }
    }

    override fun doWork(): Result {
        val app = applicationContext as Application
        val input = inputData.keyValueMap.filterKeys { it != JOB }.mapValues { it.value as? String }
        var booted: CoreHost? = null
        // Core's logger (logcat, and RN's diagnostics log while Debug logging is on) once the host is up; logcat before.
        val log: (String, JSONObject) -> Unit = { message, fields ->
            booted.let { host -> if (host != null) host.logLine(message, fields) else Log.i(CoreHost.TAG, "$message $fields") }
        }
        val outcome = CoreJob.run(inputData.getString(JOB), input,
            boot = {
                // The language chosen in this app's Settings, as the screens boot with it (InboxViewModel).
                val language = app.getSharedPreferences(DEVICE_PREFS, Context.MODE_PRIVATE).getString(LANGUAGE_KEY, null)
                val host = ProcessCoreHost.get(app, language).also { booted = it }
                object : CoreJob.Calls {
                    override fun recover() = ProcessCoreHost.recover(host)
                    override fun drain() = ProcessCoreHost.recovered(app, host)
                    override fun contextAutomation(json: String) = host.contextAutomation(json)
                    override fun reminders(mode: String, key: String) = host.remindersCycle(mode, key)
                    override fun reminderDone(requestId: String, taskId: String) = host.reminderDone(requestId, taskId)
                    override fun reminderSnooze(json: String) = host.reminderSnooze(json)
                }
            },
            post = { details ->
                val shown = CoreNotifications.post(app, details)
                log("Native Android notification", JSONObject().put("kind", details.optJSONObject("data")?.optString("kind") ?: JSONObject.NULL)
                    .put("outcome", if (shown) "posted" else "blocked"))
            },
            // What the job stored reaches the home-screen widgets before the job ends.
            refreshWidgets = { runCatching { booted?.refreshWidgets() }.onFailure { Log.w(CoreHost.TAG, "Native Android widget refresh failed", it) } },
            log = log)
        return when (outcome) {
            CoreJob.Outcome.Success -> Result.success()
            CoreJob.Outcome.Retry -> Result.retry()
            CoreJob.Outcome.Failure -> Result.failure()
        }
    }
}

/**
 * A receiver's job handed to CoreWork (CoreWork.enqueueDurably; JVM-tested: ReminderJobTest): [queue] enqueues it and calls its
 * argument once WorkManager answered (null: stored). [done] runs only once stored, [failed] otherwise, then [finish] (the receiver's
 * end), once, whatever happened.
 */
internal object DurableQueue {
    fun run(queue: ((Throwable?) -> Unit) -> Unit, done: () -> Unit, finish: () -> Unit, failed: (Throwable) -> Unit) {
        val settled = java.util.concurrent.atomic.AtomicBoolean(false)
        val settle = { failure: Throwable? ->
            if (settled.compareAndSet(false, true)) {
                try {
                    if (failure == null) done() else failed(failure)
                } finally {
                    finish()
                }
            }
        }
        try {
            queue(settle)
        } catch (failure: Throwable) {
            settle(failure)
        }
    }
}
