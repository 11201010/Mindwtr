package tech.dongdongbh.mindwtr.pilot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
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
        val asked = InboxStepKey("s1", "t1", "actionable")
        assertEquals(asked, InboxStepKey("s1", "t1", "actionable"))
        // Process Inbox closed and opened again on the same task: a new session.
        assertNotEquals(asked, InboxStepKey("s2", "t1", "actionable"))
        assertNotEquals(asked, InboxStepKey("s1", "t1", "decisions"))
    }

    @Test fun theCaptureScreensQuestionIsKeyedByItsSession() {
        assertNotEquals(captureCopilotKey("one", """{"title":"Call"}"""), captureCopilotKey("two", """{"title":"Call"}"""))
        assertEquals(null, captureCopilotKey("one", null))
    }
}
