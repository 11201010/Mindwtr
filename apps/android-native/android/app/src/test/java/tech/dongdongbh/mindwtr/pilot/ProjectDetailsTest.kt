package tech.dongdongbh.mindwtr.pilot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Project details' write order and keeping (review PD 2), the edits a close stores (PD 1), and late replies (PD 3). */
class ProjectDetailsTest {
    /** A write that cannot start (another action runs, a retry is owed) waits in order; none is dropped, and one runs at a time. */
    @Test fun writesWaitInOrderAndNoneIsDropped() {
        var busy = true
        val started = mutableListOf<String>()
        val finish = mutableListOf<() -> Unit>()
        val queue = WriteQueue<String> { item, done -> if (busy) false else { started += item; finish += done; true } }
        queue.add("title")
        queue.add("notes")
        assertEquals(emptyList<String>(), started)
        assertTrue(queue.waiting)
        busy = false
        queue.pump()
        assertEquals(listOf("title"), started)
        // One at a time: the next waits for the first to finish.
        queue.pump()
        assertEquals(listOf("title"), started)
        finish.removeAt(0)()
        assertEquals(listOf("title", "notes"), started)
        finish.removeAt(0)()
        assertFalse(queue.waiting)
    }
}
