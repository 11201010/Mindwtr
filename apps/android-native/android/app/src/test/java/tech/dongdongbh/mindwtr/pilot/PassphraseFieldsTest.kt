package tech.dongdongbh.mindwtr.pilot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The encryption card's passphrase fields against core's limit (native-host-contract-settings-sync.ts
 * SYNC_ENCRYPTION_PASSPHRASE_MAX_LENGTH): a longer edit is refused, never cut to fit, and while it stands no submit runs, so a
 * change never runs with a shorter passphrase than the one the user typed.
 */
class PassphraseFieldsTest {
    @Test fun anEditPastTheLimitIsRefusedAndBlocksSubmit() {
        val fields = PassphraseFields()
        assertTrue(fields.type("next", "x".repeat(1000), 1000))
        assertTrue(fields.submittable)
        assertFalse(fields.type("next", "x".repeat(1001), 1000))
        // The field keeps what core took; it is never cut to the limit behind the user's back.
        assertEquals("x".repeat(1000), fields.texts["next"])
        assertFalse(fields.submittable)
        // Another field's edit does not lift it; only an edit core takes in that field does.
        assertTrue(fields.type("confirm", "y", 1000))
        assertFalse(fields.submittable)
        assertTrue(fields.type("next", "x".repeat(999), 1000))
        assertTrue(fields.submittable)
    }

    @Test fun aGeneratedPassphraseFillsBothNewFieldsAndClearingForgetsEverything() {
        val fields = PassphraseFields()
        assertFalse(fields.type("confirm", "z".repeat(1001), 1000))
        fields.generated("acid tremble anchor velvet orbit")
        assertEquals(mapOf("next" to "acid tremble anchor velvet orbit", "confirm" to "acid tremble anchor velvet orbit"), fields.texts)
        assertTrue(fields.submittable)
        assertFalse(fields.type("current", "c".repeat(2000), 1000))
        fields.clear()
        assertEquals(emptyMap<String, String>(), fields.texts)
        assertTrue(fields.submittable)
    }
}
