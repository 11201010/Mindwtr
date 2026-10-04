package tech.dongdongbh.mindwtr.pilot.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * HostIo's answers after the host shuts down (review S4b 3): nothing of any kind is queued (a secret read's value, a derived key,
 * a fetch body), the engine takes nothing, and answers waiting at the close are dropped, a held one and a taken body included.
 */
class HostAnswersTest {
    @Test fun answersPassInOrderWithTheirBodies() {
        val answers = HostAnswers()
        assertTrue(answers.add(HostAnswers.Answer("""{"id":"1","value":"secret"}""")))
        assertTrue(answers.add(HostAnswers.Answer("""{"id":"2","body":true}""", "Ym9keQ==")))
        answers.await(0)
        assertEquals("""{"id":"1","value":"secret"}""", answers.next()?.json)
        assertEquals("", answers.body())
        assertEquals("""{"id":"2","body":true}""", answers.next()?.json)
        assertEquals("Ym9keQ==", answers.body())
        assertNull(answers.next())
    }

    @Test fun afterCloseNothingIsQueuedOrTakenAndWaitingAnswersAreDropped() {
        val answers = HostAnswers()
        answers.add(HostAnswers.Answer("""{"id":"1","value":"held secret"}"""))
        answers.add(HostAnswers.Answer("""{"id":"2","body":true}""", "a2V5"))
        answers.add(HostAnswers.Answer("""{"id":"3","value":"queued secret"}"""))
        answers.await(0)
        answers.next()
        // Answer 2's body is taken-but-unread, answer 3 waits in the queue when the host closes.
        answers.close()
        assertTrue(answers.closed)
        assertEquals("", answers.body())
        answers.await(0)
        assertNull(answers.next())
        // A secret read (or any call) that ends after the close finds no queue.
        assertFalse(answers.add(HostAnswers.Answer("""{"id":"4","value":"late secret"}""")))
        assertNull(answers.next())
        assertEquals(0, answers.size)
    }
}
