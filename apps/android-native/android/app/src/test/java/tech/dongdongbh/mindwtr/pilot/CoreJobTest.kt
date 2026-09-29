package tech.dongdongbh.mindwtr.pilot

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** One CoreWork run: the host's boot first (the app's boot order), then the one named job, then the widgets' refresh. */
class CoreJobTest {
    private val events = mutableListOf<String>()
    private var drained = true
    private var notification: JSONObject? = JSONObject().put("title", "@home next action")
    private var bootFailure: Throwable? = null
    private var jobFailure: Throwable? = null

    private val calls = object : CoreJob.Calls {
        override fun drain(): Boolean {
            events += "drain"
            jobFailure?.let { throw it }
            return drained
        }
        override fun contextAutomation(json: String): JSONObject {
            JSONObject(json).let { events += "context ${it.getString("action")} ${it.getString("context")}" }
            jobFailure?.let { throw it }
            return JSONObject().put("notification", notification ?: JSONObject.NULL)
        }
    }

    private fun run(job: String?, input: Map<String, String?> = emptyMap()) = CoreJob.run(job, input,
        boot = { events += "boot"; bootFailure?.let { throw it }; calls },
        post = { events += "post ${it.getString("title")}" },
        refreshWidgets = { events += "widgets" },
        log = { message, fields -> lines += "$message ${fields.optString("job")} ${fields.optString("outcome")} ${fields.optString("error")}".trim() })

    private val lines = mutableListOf<String>()

    @Test fun theHostBootsBeforeTheJobAndWidgetsRefreshAfterIt() {
        assertEquals(CoreJob.Outcome.Success, run(CoreJob.INGEST))
        assertEquals(listOf("boot", "drain", "widgets"), events)
    }

    @Test fun aDrainThatMustWaitRetriesLater() {
        drained = false
        assertEquals(CoreJob.Outcome.Retry, run(CoreJob.INGEST))
        assertEquals(listOf("boot", "drain"), events)
    }

    @Test fun aFailedDrainRetriesLater() {
        jobFailure = IllegalStateException("Core ingest timed out")
        assertEquals(CoreJob.Outcome.Retry, run(CoreJob.INGEST))
        assertEquals(listOf("boot", "drain"), events)
    }

    @Test fun eachRunLogsOneLineWithItsJobOutcomeAndOnlyAFailuresCode() {
        run(CoreJob.INGEST)
        jobFailure = IllegalStateException("SAVE_FAILED: Buy milk for Anna")
        run(CoreJob.INGEST)
        run("sync")
        assertEquals(listOf("Native Android core work ingest success", "Native Android core work ingest retry SAVE_FAILED",
            "Native Android core work sync unknown"), lines)
    }

    @Test fun aBootThatFailsRunsNoJob() {
        bootFailure = IllegalStateException("Incomplete tasks load")
        assertEquals(CoreJob.Outcome.Retry, run(CoreJob.INGEST))
        assertEquals(CoreJob.Outcome.Failure, run(CoreJob.CONTEXT, mapOf("action" to "activate", "context" to "@home")))
        assertEquals(listOf("boot", "boot"), events)
    }

    @Test fun aContextTriggerPostsCoresNotification() {
        assertEquals(CoreJob.Outcome.Success, run(CoreJob.CONTEXT, mapOf("action" to "activate", "context" to "@home")))
        assertEquals(listOf("boot", "context activate @home", "post @home next action", "widgets"), events)
    }

    @Test fun aTriggerCoreAnswersWithNoNotificationPostsNothing() {
        notification = null
        assertEquals(CoreJob.Outcome.Success, run(CoreJob.CONTEXT, mapOf("action" to "deactivate", "context" to "@home")))
        assertEquals(listOf("boot", "context deactivate @home", "widgets"), events)
    }

    @Test fun aFailedTriggerIsNotRetried() {
        jobFailure = IllegalStateException("Core contextAutomation timed out")
        // A late notification would describe a moment that has passed: RN's headless task does not retry either.
        assertEquals(CoreJob.Outcome.Failure, run(CoreJob.CONTEXT, mapOf("action" to "activate", "context" to "@home")))
        assertEquals(listOf("boot", "context activate @home"), events)
    }

    @Test fun anUnknownJobBootsNothing() {
        assertEquals(CoreJob.Outcome.Failure, run("sync"))
        assertEquals(CoreJob.Outcome.Failure, run(null))
        assertEquals(emptyList<String>(), events)
    }
}
