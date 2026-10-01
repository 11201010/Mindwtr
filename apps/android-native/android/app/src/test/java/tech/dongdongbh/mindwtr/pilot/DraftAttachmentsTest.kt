package tech.dongdongbh.mindwtr.pilot

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A task draft's attachment command answers for the list it was sent; the editor applies it only to that same list. */
class DraftAttachmentsTest {
    private val a = """{"id":"a","kind":"file","title":"A.pdf","uri":"","localStatus":"missing","createdAt":"t","updatedAt":"t"}"""
    private val aDownloaded = """{"id":"a","kind":"file","title":"A.pdf","uri":"file:///f/attachments/a.pdf","localStatus":"available","createdAt":"t","updatedAt":"t"}"""
    private val b = """{"id":"b","kind":"link","title":"B","uri":"https://b.example","createdAt":"t","updatedAt":"t"}"""

    @Test fun anAnswerForAListTheDraftNoLongerHoldsIsSentAgain() {
        // Download A and Remove B: the Remove was sent with A missing; A's download landed in the draft first.
        val sent = "[$a,$b]"
        val now = "[$aDownloaded,$b]"
        val removed = JSONObject().put("kind", "saved").put("attachments", org.json.JSONArray("[$a,${b.dropLast(1)},\"deletedAt\":\"t\"}]"))
        assertTrue(draftMoved(sent, now, removed))
        // Sent again on the draft as it is now, the answer keeps A's local fields: it applies.
        assertFalse(draftMoved(now, now, removed))
    }

    @Test fun aRefusalOrAnUnchangedDraftNeverResends() {
        assertFalse(draftMoved("[$a]", "[$aDownloaded]", JSONObject().put("kind", "refused").put("message", "no")))
        assertFalse(draftMoved("[$a]", "[$a]", JSONObject().put("kind", "saved")))
    }
}
