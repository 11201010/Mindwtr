package tech.dongdongbh.mindwtr.pilot

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** A reminder's Done and Snooze, and a reschedule, as CoreWork jobs: after recovery and the drain, through core's journaled commands. */
class ReminderJobTest {
    private val events = mutableListOf<String>()
    private var recovered = true
    private var doneFailure: Throwable? = null
    private val lines = mutableListOf<String>()

    private val calls = object : CoreJob.Calls {
        override fun recover(): Boolean { events += "recover"; return recovered }
        override fun drain(): Boolean { events += "drain"; return true }
        override fun contextAutomation(json: String): JSONObject = error("no context job here")
        override fun reminders(mode: String): JSONObject { events += "reminders $mode"; return JSONObject() }
        override fun reminderDone(requestId: String, taskId: String): JSONObject {
            events += "done $requestId $taskId"
            doneFailure?.let { throw it }
            return JSONObject().put("changed", true)
        }
        override fun reminderSnooze(json: String): JSONObject {
            val input = JSONObject(json)
            events += "snooze ${input.getString("requestId")} ${input.getLong("requestedAt")} ${input.getJSONObject("details").getString("title")}"
            return JSONObject().put("id", 1_073_741_900).put("key", "snooze:${input.getString("requestId")}")
        }
    }

    private fun run(job: String, input: Map<String, String?>) = CoreJob.run(job, input,
        boot = { events += "boot"; calls },
        post = { events += "post" },
        refreshWidgets = { events += "widgets" },
        log = { message, fields -> lines += "$message ${fields.optString("job")} ${fields.optString("outcome")} ${fields.optString("error")}".trim() },
        schedule = { events += "schedule ${it.getInt("id")} ${it.getString("key")}" })

    @Test fun doneCompletesThroughCoreThenPlansTheAlarmsAgain() {
        assertEquals(CoreJob.Outcome.Success, run(CoreJob.REMINDER_DONE, mapOf("requestId" to "r1", "taskId" to "t1")))
        assertEquals(listOf("boot", "recover", "drain", "done r1 t1", "reminders cycle", "widgets"), events)
    }

    @Test fun doneWaitsForRecoveryAndKeepsItsRequestForTheRetry() {
        recovered = false
        assertEquals(CoreJob.Outcome.Retry, run(CoreJob.REMINDER_DONE, mapOf("requestId" to "r1", "taskId" to "t1")))
        recovered = true
        doneFailure = IllegalStateException("SAVE_FAILED: disk full")
        assertEquals(CoreJob.Outcome.Retry, run(CoreJob.REMINDER_DONE, mapOf("requestId" to "r1", "taskId" to "t1")))
        doneFailure = null
        assertEquals(CoreJob.Outcome.Success, run(CoreJob.REMINDER_DONE, mapOf("requestId" to "r1", "taskId" to "t1")))
        // Every try sends the same request, so core's receipt makes the write happen once.
        assertEquals(2, events.count { it == "done r1 t1" })
    }

    @Test fun aRefusedDoneNeverRetries() {
        doneFailure = IllegalStateException("INVALID_INPUT: A request UUID and a task ID are required")
        assertEquals(CoreJob.Outcome.Failure, run(CoreJob.REMINDER_DONE, mapOf("requestId" to "r1", "taskId" to "")))
        assertEquals(listOf("Native Android core work reminderDone failure INVALID_INPUT"), lines)
    }

    @Test fun snoozeSendsTheTapTimeWithItsRequestAndMakesCoresAlarm() {
        val details = JSONObject().put("title", "Pay rent").put("snooze_interval", 10).toString()
        assertEquals(CoreJob.Outcome.Success, run(CoreJob.REMINDER_SNOOZE, mapOf("requestId" to "r2", "requestedAt" to "1790000000000", "details" to details)))
        assertEquals(listOf("boot", "recover", "drain", "snooze r2 1790000000000 Pay rent", "schedule 1073741900 snooze:r2", "widgets"), events)
    }

    @Test fun aRescheduleRunsCoresPlanInItsMode() {
        assertEquals(CoreJob.Outcome.Success, run(CoreJob.REMINDERS, mapOf("mode" to "rebuild")))
        assertEquals(listOf("boot", "recover", "drain", "reminders rebuild", "widgets"), events)
    }
}
