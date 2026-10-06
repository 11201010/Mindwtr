package tech.dongdongbh.mindwtr.pilot.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** When core's stricter legacy-import preflight (host-entry legacyCheck) must pass before the RN database opens (audit C). */
class LegacyPreflightTest {
    private fun needed(jsonAhead: Boolean = false, reconciled: Boolean = false, backup: Boolean = false, database: Boolean = true) =
        LegacyRnStoreGuard.preflightNeeded(jsonAhead, reconciled, backup, database)

    @Test fun theJsonAheadMarkerAlwaysNeedsIt() {
        assertTrue(needed(jsonAhead = true))
        assertTrue(needed(jsonAhead = true, reconciled = true, backup = true))
        // Core refuses a marker with no backup: nothing would recover the writes it marks.
        assertTrue(needed(jsonAhead = true, reconciled = true))
    }

    @Test fun aBackupTheImportStillReadsNeedsIt() {
        assertTrue(needed(backup = true))
        assertTrue(needed(backup = true, reconciled = true, database = false))
    }

    @Test fun aFinishedImportOrNoBackupOpensAtOnce() {
        assertFalse(needed(backup = true, reconciled = true))
        assertFalse(needed())
        assertFalse(needed(database = false))
        assertFalse(needed(reconciled = true))
    }
}
