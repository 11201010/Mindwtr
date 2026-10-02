package tech.dongdongbh.mindwtr.pilot

import org.junit.Assert.assertEquals
import org.junit.Test

/** After a finished journal replay: the queue drain, then sync. Any drain that did not finish holds the rest back and retries. */
class StartOrderTest {
    private val events = mutableListOf<String>()

    private fun run(drain: StartOrder.Drain) = StartOrder.afterReplay({ events += "drain"; drain },
        owe = { events += "owe ${it.substringBefore(':')}" }, retryLater = { events += "retry" }, startSync = { events += "sync" })

    @Test fun aFinishedDrainStartsSync() {
        assertEquals(true, run(StartOrder.Drain.Done))
        assertEquals(listOf("drain", "sync"), events)
    }

    @Test fun anOwedDrainHoldsSyncAndTheScreensBackAndRetries() {
        assertEquals(false, run(StartOrder.Drain.Failed("SAVE_FAILED: 1 queued item(s) stored but not yet saved, recorded or removed")))
        assertEquals(listOf("drain", "owe SAVE_FAILED", "retry"), events)
    }

    @Test fun aDrainThatLeftItemsQueuedHoldsTheRestBackToo() {
        assertEquals(false, run(StartOrder.Drain.Failed("ACTION_FAILED: 1 queued item(s) left for a later drain")))
        assertEquals(listOf("drain", "owe ACTION_FAILED", "retry"), events)
    }

    @Test fun aStorageOrTimeoutFailureHoldsTheRestBackToo() {
        assertEquals(false, run(StartOrder.Drain.Failed("NOT_READY: the store is not loaded")))
        assertEquals(false, run(StartOrder.Drain.Failed("Core ingest timed out")))
        assertEquals(listOf("drain", "owe NOT_READY", "retry", "drain", "owe Core ingest timed out", "retry"), events)
    }

    @Test fun aDrainWaitingBehindAnotherOwedCommandRetriesWithoutReplacingIt() {
        assertEquals(false, run(StartOrder.Drain.Waiting))
        assertEquals(listOf("drain", "retry"), events)
    }

    @Test fun aDrainWhoseCheckOffSweepFailedStartsSyncKeepsTheScreensAndRetries() {
        assertEquals(false, run(StartOrder.Drain.Unswept))
        assertEquals(listOf("drain", "sync", "retry"), events)
    }
}
