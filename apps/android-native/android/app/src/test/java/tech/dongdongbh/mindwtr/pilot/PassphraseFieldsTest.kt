package tech.dongdongbh.mindwtr.pilot

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * The encryption card's passphrase fields against core's limit (native-host-contract-settings-sync.ts
 * SYNC_ENCRYPTION_PASSPHRASE_MAX_LENGTH) and core's answers: a longer edit is refused, never cut to fit, an edit core refuses
 * stands refused too, and while either stands no submit runs, so a change never runs with a passphrase other than the one the
 * user typed.
 */
class PassphraseFieldsTest {
    private val tooLong = "A passphrase can be at most 1,000 characters."
    private fun submit(flow: String) = JSONObject().put("type", "submit").put("flow", flow)

    @Test fun anEditPastTheLimitIsRefusedAndBlocksSubmit() {
        val fields = PassphraseFields()
        assertNotNull(fields.type("next", "x".repeat(1000), 1000, tooLong))
        assertTrue(fields.submittable)
        assertNull(fields.type("next", "x".repeat(1001), 1000, tooLong))
        // The field keeps what core took; it is never cut to the limit behind the user's back.
        assertEquals("x".repeat(1000), fields.texts["next"])
        assertFalse(fields.submittable)
        assertEquals(tooLong, fields.admit(submit("enable")))
        // Another field's edit does not lift it; only an edit core takes in that field does.
        assertNotNull(fields.type("confirm", "y", 1000, tooLong))
        assertFalse(fields.submittable)
        assertNotNull(fields.type("next", "x".repeat(999), 1000, tooLong))
        assertTrue(fields.submittable)
    }

    @Test fun anEditCoreRefusesBlocksSubmitUntilCoreTakesALaterOne() {
        val fields = PassphraseFields()
        // Core's `typed` command failed (say the card's update failed while storage reloaded): core still holds the older text.
        val first = fields.type("next", "correct horse", 1000, tooLong)!!
        fields.settled("next", first, "Storage is busy")
        assertFalse(fields.submittable)
        assertEquals("Storage is busy", fields.admit(submit("change")))
        // A later edit core takes lifts it; an older edit's answer arriving after it changes nothing.
        val second = fields.type("next", "correct horse battery", 1000, tooLong)!!
        val third = fields.type("next", "correct horse battery staple", 1000, tooLong)!!
        fields.settled("next", second, "Storage is busy")
        fields.settled("next", third, null)
        assertTrue(fields.submittable)
        fields.settled("next", second, "Storage is busy")
        assertTrue(fields.submittable)
        // An edit past the limit after one still in flight stays refused when that one's answer comes.
        val fourth = fields.type("next", "ok", 1000, tooLong)!!
        assertNull(fields.type("next", "x".repeat(1001), 1000, tooLong))
        fields.settled("next", fourth, null)
        assertEquals(tooLong, fields.admit(submit("change")))
    }

    @Test fun changingFlowDropsARefusalSoAbandonIsNeverBlocked() {
        val fields = PassphraseFields()
        // The retry flow's field was refused; the user gives up and opens Abandon setup.
        fields.settled("current", fields.type("current", "p", 1000, tooLong)!!, "Storage is busy")
        assertFalse(fields.submittable)
        // Abandon asks for no passphrase, so a refusal never blocks it, even one still standing.
        assertNull(fields.admit(submit("abandon")))
        assertNull(fields.admit(JSONObject().put("type", "open").put("flow", "abandon")))
        assertTrue(fields.submittable)
        assertEquals(emptyMap<String, String>(), fields.texts)
        // The same for Cancel and Retry: each starts a flow afresh.
        assertNull(fields.type("next", "x".repeat(1001), 1000, tooLong))
        assertNull(fields.admit(JSONObject().put("type", "cancel")))
        assertTrue(fields.submittable)
        assertNull(fields.type("next", "x".repeat(1001), 1000, tooLong))
        assertNull(fields.admit(JSONObject().put("type", "retry")))
        assertTrue(fields.submittable)
    }

    @Test fun aGeneratedPassphraseFillsBothNewFieldsAndClearingForgetsEverything() {
        val fields = PassphraseFields()
        assertNull(fields.type("confirm", "z".repeat(1001), 1000, tooLong))
        val pending = fields.type("next", "typed before generate", 1000, tooLong)!!
        fields.generated("acid tremble anchor velvet orbit")
        assertEquals(mapOf("next" to "acid tremble anchor velvet orbit", "confirm" to "acid tremble anchor velvet orbit"), fields.texts)
        assertTrue(fields.submittable)
        // Core's answer to an edit typed before Generate does not undo Generate.
        fields.settled("next", pending, "Storage is busy")
        assertTrue(fields.submittable)
        assertNull(fields.type("current", "c".repeat(2000), 1000, tooLong))
        fields.clear()
        assertEquals(emptyMap<String, String>(), fields.texts)
        assertTrue(fields.submittable)
    }
}
