package tech.dongdongbh.mindwtr.androidwidget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CheckoffStoreTest {
  @Test
  fun aSecondTapInsideTheWindowUndoesThePendingCheckoff() {
    val once = CheckoffStore.toggled(emptyMap(), "t1", 1_000L)
    assertEquals(mapOf("t1" to 1_000L), once)

    val undone = CheckoffStore.toggled(once, "t1", 2_000L)
    assertTrue(undone.isEmpty())
  }

  @Test
  fun aFailedPendingCheckPreservesTheDurableUncheckedStateAcrossRestart() {
    val before = emptyMap<String, Long>()
    val durable = before

    val result = CheckoffStore.toggledDurably(durable, "t1", 1_000L) { false }
    val afterRestart = durable

    assertFalse(result.persisted)
    assertFalse(result.isPending)
    assertEquals(before, result.state)
    assertFalse(afterRestart.containsKey("t1"))
  }

  @Test
  fun aFailedPendingUndoPreservesTheDurableCheckedStateAcrossRestart() {
    val before = mapOf("t1" to 1_000L)
    val durable = before

    val result = CheckoffStore.toggledDurably(durable, "t1", 2_000L) { false }
    val afterRestart = durable

    assertFalse(result.persisted)
    assertTrue(result.isPending)
    assertEquals(before, result.state)
    assertEquals(before, afterRestart)
  }

  @Test
  fun aCommittedTapIsRefreshOnly() {
    assertEquals(CheckoffStore.TapAction.RECONCILE, CheckoffStore.tapAction(isCommitted = true))
    assertEquals(CheckoffStore.TapAction.TOGGLE_PENDING, CheckoffStore.tapAction(isCommitted = false))
  }

  @Test
  fun undoClosesAtTheTimeBoundaryEvenBeforeADeferredSweepRuns() {
    assertEquals(
      CheckoffStore.TapAction.TOGGLE_PENDING,
      CheckoffStore.tapAction(isCommitted = false, pendingSince = 1_000L, now = 3_999L),
    )
    assertEquals(
      CheckoffStore.TapAction.RECONCILE,
      CheckoffStore.tapAction(isCommitted = false, pendingSince = 1_000L, now = 4_000L),
    )
  }

  @Test
  fun committedIdsSurviveOnlyWhileThePayloadStillListsThem() {
    val committed = mapOf("queued" to "a.json", "ingested" to "b.json")
    assertEquals(mapOf("queued" to "a.json"), CheckoffStore.pruned(committed, setOf("queued", "other")))
    assertEquals(emptyMap<String, String>(), CheckoffStore.pruned(committed, emptySet()))
  }

  @Test
  fun onlyEntriesOlderThanTheWindowExpire() {
    val pending = mapOf("old" to 0L, "fresh" to 2_500L, "edge" to 1_000L)

    assertEquals(listOf("edge", "old"), CheckoffStore.expired(pending, 4_000L, CheckoffStore.UNDO_WINDOW_MS))
    assertEquals(emptyList<String>(), CheckoffStore.expired(pending, 1_500L, CheckoffStore.UNDO_WINDOW_MS))
  }

  @Test
  fun aQueueFailureLeavesTheCheckoffVisibleAndRetryable() {
    val pending = mapOf("failed" to 0L)

    val failed = CheckoffStore.swept(pending, emptyMap(), 4_000L) { _, _ -> throw java.io.IOException("disk full") }

    assertEquals(pending, failed.pending)
    assertTrue(failed.committed.isEmpty())
    assertEquals(0, failed.newlyCommitted)

    val retried = CheckoffStore.swept(failed.pending, failed.committed, 4_001L) { _, _ -> "queued.json" }
    assertTrue(retried.pending.isEmpty())
    assertEquals(mapOf("failed" to "queued.json"), retried.committed)
    assertEquals(1, retried.newlyCommitted)
  }

  @Test
  fun aRepeatedSweepNeverQueuesAnAlreadyCommittedCheckoffAgain() {
    val first = CheckoffStore.swept(mapOf("task" to 0L), emptyMap(), 4_000L) { _, _ -> "queued.json" }
    val second = CheckoffStore.swept(first.pending, first.committed, 4_001L) { _, _ ->
      throw AssertionError("repeat sweep must not enqueue")
    }

    assertTrue(second.pending.isEmpty())
    assertEquals(mapOf("task" to "queued.json"), second.committed)
    assertEquals(0, second.newlyCommitted)
  }

  @Test
  fun aFailedPartialRefreshRemainsEligibleWithoutRequeueingTheCompletion() {
    assertTrue(CheckoffStore.shouldRefresh(newlyCommitted = 0, queuedRefresh = 1))
    assertTrue(!CheckoffStore.shouldRefresh(newlyCommitted = 0, queuedRefresh = 0))
  }

  @Test
  fun automaticFastFailureRetriesAreBounded() {
    assertEquals(1, CheckoffStore.nextFastRetry(0))
    assertEquals(2, CheckoffStore.nextFastRetry(1))
    assertEquals(null, CheckoffStore.nextFastRetry(2))
    assertEquals(null, CheckoffStore.nextFastRetry(20))
  }
}
