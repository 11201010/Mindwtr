package tech.dongdongbh.mindwtr.pilot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.json.JSONObject
import org.junit.Test

/** AIRules.kt: review C1 5 (obsolete requests are cancelled), 6 (an Inbox answer stays with its session) and 7 (capture dedupe). */
class AIRulesTest {
    private val cancelled = mutableListOf<String>()
    private val slots = AIRequestSlots<String> { cancelled += it }

    @Test fun aNewRequestInAScopeCancelsTheOneBefore() {
        slots.start("copilot", "a")
        slots.start("copilot", "b")
        assertEquals(listOf("a"), cancelled)
        assertTrue(slots.wanted("copilot", "b"))
        assertFalse(slots.wanted("copilot", "a"))
    }

    @Test fun closingAScopeCancelsItsRequestAndAnAnsweredOneIsNotCancelled() {
        slots.start("editor", "clarify")
        slots.start("copilot", "chips")
        slots.finished("copilot", "chips")
        slots.cancel("editor", "copilot")
        assertEquals(listOf("clarify"), cancelled)
    }

    @Test fun anOlderAnswerNeverFreesTheNewerRequestsScope() {
        slots.start("review", "first")
        slots.start("review", "second")
        slots.finished("review", "first")
        assertTrue(slots.wanted("review", "second"))
    }

    @Test fun anInboxAnswerBelongsToItsSessionAndStep() {
        fun flow(session: String, step: String) = InboxProcessing(session, JSONObject().put("taskId", "t1").put("step", step))
        val asked = InboxStepKey.of(flow("s1", "actionable"))
        assertEquals(asked, InboxStepKey.of(flow("s1", "actionable")))
        // Process Inbox closed and opened again on the same task and step: a new session, so the old answer is not taken.
        assertNotEquals(asked, InboxStepKey.of(flow("s2", "actionable")))
        assertNotEquals(asked, InboxStepKey.of(flow("s1", "decisions")))
        assertEquals(null, InboxStepKey.of(null))
    }

    @Test fun theCaptureScreensQuestionIsKeyedByItsSession() {
        assertNotEquals(captureCopilotKey("one", """{"title":"Call"}"""), captureCopilotKey("two", """{"title":"Call"}"""))
        assertEquals(null, captureCopilotKey("one", null))
    }
}
