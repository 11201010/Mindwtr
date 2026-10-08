package tech.dongdongbh.mindwtr.pilot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Settings › Calendar's visits (C3 review): an open that ends after Back counts for nothing, and the next visit opens afresh. */
class CalendarVisitTest {
    @Test fun anOpenThatEndsAfterTheScreenLeftCountsForNothing() {
        val visits = CalendarVisit()
        val first = visits.current
        visits.leave()
        assertFalse(visits.opened(first))
        assertFalse(visits.isOpen)
        assertFalse(visits.isCurrent(first))
    }

    @Test fun theNextVisitOpensAfresh() {
        val visits = CalendarVisit()
        val first = visits.current
        assertTrue(visits.opened(first))
        assertTrue(visits.isOpen)
        visits.leave()
        assertFalse(visits.isOpen)
        val second = visits.current
        assertEquals(first + 1, second)
        assertTrue(visits.opened(second))
        assertTrue(visits.isCurrent(second))
    }
}
