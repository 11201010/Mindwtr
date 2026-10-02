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

    @Test fun aDiscardSettlesTheDraftOnlyWhenNoSaveIsOwed() {
        assertTrue(discardSettles(settle = true, saveOwed = false, attachmentsRead = true, readOnly = false))
        // Review fix 2: a save still owed owns the draft's new copies; they settle when it lands, never on the close.
        assertFalse(discardSettles(settle = true, saveOwed = true, attachmentsRead = true, readOnly = false))
        assertFalse(discardSettles(settle = false, saveOwed = false, attachmentsRead = true, readOnly = false))
        assertFalse(discardSettles(settle = true, saveOwed = false, attachmentsRead = false, readOnly = false))
        assertFalse(discardSettles(settle = true, saveOwed = false, attachmentsRead = true, readOnly = true))
    }

    @Test fun aSavesSettlementCommitsTheListTheSaveWroteNotTheDraft() {
        // The draft held A's stale download; the save merged in the newer A a sync installed meanwhile.
        val half = JSONObject().put("base", org.json.JSONArray("[$a]")).put("value", org.json.JSONArray("[$aDownloaded,$b]"))
        val saved = JSONObject().put("taskRevision", "r2").put("attachmentsBase", org.json.JSONArray("[$a,$b]"))
        val input = savedSettlement("t1", half, saved)
        assertTrue(input.getJSONArray("committed").toString() == saved.getJSONArray("attachmentsBase").toString())
        assertTrue(input.getString("taskRevision") == "r2" && input.getString("taskId") == "t1")
        assertTrue(input.getJSONArray("draft").toString() == half.getJSONArray("value").toString())
    }

    @Test fun aTaskLinkFieldIsTouchedOnBlurAndAProjectsIsNot() {
        // Review fix 5: RN's task link field shows "Required" once it lost focus blank; RN's project sheet has no such line.
        assertTrue(LinkSheet(AttachmentOwner("task", "t1")).blurred().touched)
        assertFalse(LinkSheet(AttachmentOwner("project", "p1")).blurred().touched)
    }
}
