package tech.dongdongbh.mindwtr.androidwidget

import org.junit.Assert.assertEquals
import org.junit.Test

class PendingCheckoffStoreTest {
  @Test
  fun pendingStateRoundTripsDeterministically() {
    val pending = linkedMapOf("later" to 2_000L, "first" to 1_000L)

    val encoded = PendingCheckoffStore.encode(pending)

    assertEquals(mapOf("first" to 1_000L, "later" to 2_000L), PendingCheckoffStore.decode(encoded))
    assertEquals(encoded, PendingCheckoffStore.encode(PendingCheckoffStore.decode(encoded)))
  }

  @Test(expected = java.io.IOException::class)
  fun malformedPendingStateIsRejectedRatherThanReplaced() {
    PendingCheckoffStore.decode("""{"version":1,"pending":[{"id":"task"}]}""")
  }

  @Test
  fun anAtomicStateAlwaysOutranksLegacyPreferences() {
    var migrations = 0

    val state = PendingCheckoffStore.resolveInitialState(
      atomic = mapOf("atomic" to 2_000L),
      legacy = mapOf("legacy" to 1_000L),
      persistLegacy = { migrations += 1 },
    )

    assertEquals(mapOf("atomic" to 2_000L), state)
    assertEquals(0, migrations)
  }

  @Test
  fun legacyPreferencesMigrateOnceWhenTheAtomicStateIsAbsent() {
    var migrated: Map<String, Long>? = null
    val legacy = mapOf("legacy" to 1_000L)

    val state = PendingCheckoffStore.resolveInitialState(null, legacy) { migrated = it }

    assertEquals(legacy, state)
    assertEquals(legacy, migrated)
  }
}
