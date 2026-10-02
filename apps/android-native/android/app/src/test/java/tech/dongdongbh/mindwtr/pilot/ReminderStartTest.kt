package tech.dongdongbh.mindwtr.pilot

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** The reminder alarms' start on the process's host (ProcessCoreHost), and what a resume does before and after it. */
class ReminderStartTest {
    private val events = mutableListOf<String>()
    private var startFailure: Throwable? = null
    private val start = ReminderStart<String>(
        start = { host -> events += "start $host"; startFailure?.let { throw it }; JSONObject().put("ask", true) },
        cycle = { host -> events += "cycle $host" },
    )

    @Test fun aResumeBeforeTheBootStartedTheRemindersDoesNothing() {
        start.resume()
        assertEquals(emptyList<String>(), events)
    }

    @Test fun aResumeAfterAFailedStartStartsAgainThenEachLaterResumePlansOnce() {
        startFailure = IllegalStateException("plan failed")
        assertThrows(IllegalStateException::class.java) { start.start("host") }
        assertEquals(null, start.reply)
        startFailure = null
        start.resume()
        assertEquals(true, start.reply?.optBoolean("ask"))
        start.resume()
        start.start("host")
        assertEquals(listOf("start host", "start host", "cycle host"), events)
    }
}
