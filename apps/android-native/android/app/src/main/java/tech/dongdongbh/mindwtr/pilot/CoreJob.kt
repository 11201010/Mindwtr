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

    enum class Outcome { Success, Retry, Failure }

    const val LINE = "Native Android core work"

    /** The host calls a job makes. */
    interface Calls {
        /** ProcessCoreHost.recover on this host: an owed journal replay sent again; false while anything stays owed. */
        fun recover(): Boolean
        /** ProcessCoreHost.drain on this host; false while the queue must wait (an owed save's retry comes first). */
        fun drain(): Boolean
        /** Core's runContextAutomation with [json] (`{ action, context }`): `{ notification }`, null for none. */
        fun contextAutomation(json: String): JSONObject
    }

    /**
     * Runs job [name] with [input]. Every job waits for recovery and the drain: while either cannot finish, the job retries
     * later (the files stay queued, and a trigger posts nothing from unfinished state). A trigger that core then fails never
     * retries: a late notification would describe a moment that has passed, and RN's headless task does not retry either.
     * [log] gets one line per run, its fields apart (the job, its outcome, a failure's code: never a task's words).
     */
    fun run(name: String?, input: Map<String, String?>, boot: () -> Calls, post: (JSONObject) -> Unit, refreshWidgets: () -> Unit,
            log: (String, JSONObject) -> Unit): Outcome {
        val line = JSONObject().put("job", name ?: JSONObject.NULL)
        if (name != INGEST && name != CONTEXT) {
            log(LINE, line.put("outcome", "unknown"))
            return Outcome.Failure
        }
        var recovered = false
        val outcome = try {
            val host = boot()
            if (!host.recover() || !host.drain()) Outcome.Retry
            else when (name) {
                INGEST -> Outcome.Success
                else -> {
                    recovered = true
                    val trigger = JSONObject().put("action", input["action"] ?: JSONObject.NULL).put("context", input["context"] ?: JSONObject.NULL)
                    host.contextAutomation(trigger.toString()).optJSONObject("notification")?.let(post)
                    Outcome.Success
                }
            }
        } catch (failure: Throwable) {
            line.put("error", (failure.message ?: failure.javaClass.simpleName).substringBefore(':'))
            if (recovered) Outcome.Failure else Outcome.Retry
        }
        log(LINE, line.put("outcome", outcome.name.lowercase()))
        if (outcome == Outcome.Success) refreshWidgets()
        return outcome
    }
}
