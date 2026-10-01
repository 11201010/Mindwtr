package tech.dongdongbh.mindwtr.pilot

import org.json.JSONObject

/**
 * One CoreWork run (CoreWork.kt), apart from Android: [boot] hands over this process's host (ProcessCoreHost.get, whose boot
 * is the app's own: validated load, journal replay, queue drain), then recovery in the same order (an owed journal replay,
 * then the drain it held back), then the one named job runs on it, then the widgets refresh (a hook for the widgets pass).
 * JVM-tested (CoreJobTest).
 */
internal object CoreJob {
    /** Drain the pending-captures queue (the capture intent's items). */
    const val INGEST = "ingest"
    /** An automation trigger's notification (the ACTIVATE_CONTEXT and DEACTIVATE_CONTEXT broadcasts): `action` and `context`. */
    const val CONTEXT = "context"
    /** Core's reminder plan applied again (Reminders.kt's reschedule receiver): `mode` "cycle", or "rebuild" to remake every alarm. */
    const val REMINDERS = "reminders"
    /** A reminder's Done: `requestId` (made when the notification was posted) and `taskId`; then the plan again. */
    const val REMINDER_DONE = "reminderDone"
    /** A reminder's Snooze: `requestId`, `requestedAt` (the tap's time, ms), `details` (the fired alarm's) and `channelName`. */
    const val REMINDER_SNOOZE = "reminderSnooze"
    private val JOBS = setOf(INGEST, CONTEXT, REMINDERS, REMINDER_DONE, REMINDER_SNOOZE)

    enum class Outcome { Success, Retry, Failure }

    const val LINE = "Native Android core work"

    /** The host calls a job makes. */
    interface Calls {
        /** ProcessCoreHost.recover on this host: an owed journal replay sent again; false while anything stays owed. */
        fun recover(): Boolean
        /** ProcessCoreHost.recovered on this host (the drain, then sync); false while the queue must wait or the drain failed. */
        fun drain(): Boolean
        /** Core's runContextAutomation with [json] (`{ action, context }`): `{ notification }`, null for none. */
        fun contextAutomation(json: String): JSONObject
        /** Core's reminder plan applied now ([mode] "cycle" or "rebuild"). */
        fun reminders(mode: String): JSONObject = throw UnsupportedOperationException("reminders")
        /** Core's completeReminderTask, journaled under [requestId]. */
        fun reminderDone(requestId: String, taskId: String): JSONObject = throw UnsupportedOperationException("reminderDone")
        /** Core's snoozeReminder with [json] (`{ requestId, requestedAt, details }`), journaled: the alarm to make, with the channel's name. */
        fun reminderSnooze(json: String): JSONObject = throw UnsupportedOperationException("reminderSnooze")
    }

    /**
     * Runs job [name] with [input]. Every job waits for recovery and the drain: while either cannot finish, the job retries
     * later (the files stay queued, and a trigger posts nothing from unfinished state). A trigger that core then fails never
     * retries: a late notification would describe a moment that has passed, and RN's headless task does not retry either.
     * A reminder's Done and Snooze are journaled core commands whose request UUID makes every try the same request, so they retry
     * until core answers, unless core refuses the input itself (INVALID_INPUT). Snooze makes the alarm core answers ([schedule]), the
     * same alarm on every try; Done plans the alarms again, as the store changed.
     * [log] gets one line per run, its fields apart (the job, its outcome, a failure's code: never a task's words).
     */
    fun run(name: String?, input: Map<String, String?>, boot: () -> Calls, post: (JSONObject) -> Unit, refreshWidgets: () -> Unit,
            log: (String, JSONObject) -> Unit, schedule: (JSONObject) -> Unit = {}): Outcome {
        val line = JSONObject().put("job", name ?: JSONObject.NULL)
        if (name !in JOBS) {
            log(LINE, line.put("outcome", "unknown"))
            return Outcome.Failure
        }
        var recovered = false
        val outcome = try {
            val host = boot()
            if (!host.recover() || !host.drain()) Outcome.Retry
            else when (name) {
                INGEST -> Outcome.Success
                REMINDERS -> {
                    host.reminders(input["mode"] ?: "cycle")
                    Outcome.Success
                }
                REMINDER_DONE -> {
                    host.reminderDone(input["requestId"].orEmpty(), input["taskId"].orEmpty())
                    host.reminders("cycle")
                    Outcome.Success
                }
                REMINDER_SNOOZE -> {
                    val request = JSONObject().put("requestId", input["requestId"].orEmpty())
                        .put("requestedAt", input["requestedAt"]?.toLongOrNull() ?: JSONObject.NULL)
                        .put("details", input["details"]?.let(::JSONObject) ?: JSONObject.NULL)
                    schedule(host.reminderSnooze(request.toString()).put("channelName", input["channelName"].orEmpty()))
                    Outcome.Success
                }
                else -> {
                    recovered = true
                    val trigger = JSONObject().put("action", input["action"] ?: JSONObject.NULL).put("context", input["context"] ?: JSONObject.NULL)
                    host.contextAutomation(trigger.toString()).optJSONObject("notification")?.let(post)
                    Outcome.Success
                }
            }
        } catch (failure: Throwable) {
            line.put("error", (failure.message ?: failure.javaClass.simpleName).substringBefore(':'))
            val refused = failure.message?.startsWith("INVALID_INPUT") == true
            if (recovered || refused) Outcome.Failure else Outcome.Retry
        }
        log(LINE, line.put("outcome", outcome.name.lowercase()))
        if (outcome == Outcome.Success) refreshWidgets()
        return outcome
    }
}
