package tech.dongdongbh.mindwtr.pilot

import org.json.JSONObject

/**
 * One CoreWork run (CoreWork.kt), apart from Android: [boot] hands over this process's host (ProcessCoreHost.get, whose boot
 * is the app's own: validated load, journal replay, queue drain), then the one named job runs on it, then the widgets refresh
 * (a hook for the widgets pass). JVM-tested (CoreJobTest).
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
        /** ProcessCoreHost.drain on this host; false while the queue must wait (an owed save's retry comes first). */
        fun drain(): Boolean
        /** Core's runContextAutomation with [json] (`{ action, context }`): `{ notification }`, null for none. */
        fun contextAutomation(json: String): JSONObject
    }

    /**
     * Runs job [name] with [input]. A drain that cannot finish retries later (its files stay queued). A trigger never retries:
     * a late notification would describe a moment that has passed, and RN's headless task does not retry either. [log] gets one
     * line per run, its fields apart (the job, its outcome, a failure's code: never a task's words).
     */
    fun run(name: String?, input: Map<String, String?>, boot: () -> Calls, post: (JSONObject) -> Unit, refreshWidgets: () -> Unit,
            log: (String, JSONObject) -> Unit): Outcome {
        val line = JSONObject().put("job", name ?: JSONObject.NULL)
        if (name != INGEST && name != CONTEXT) {
            log(LINE, line.put("outcome", "unknown"))
            return Outcome.Failure
        }
        val failed = if (name == INGEST) Outcome.Retry else Outcome.Failure
        val outcome = try {
            val host = boot()
            when (name) {
                INGEST -> if (host.drain()) Outcome.Success else Outcome.Retry
                else -> {
                    val trigger = JSONObject().put("action", input["action"] ?: JSONObject.NULL).put("context", input["context"] ?: JSONObject.NULL)
                    host.contextAutomation(trigger.toString()).optJSONObject("notification")?.let(post)
                    Outcome.Success
                }
            }
        } catch (failure: Throwable) {
            line.put("error", (failure.message ?: failure.javaClass.simpleName).substringBefore(':'))
            failed
        }
        log(LINE, line.put("outcome", outcome.name.lowercase()))
        if (outcome == Outcome.Success) refreshWidgets()
        return outcome
    }
}
