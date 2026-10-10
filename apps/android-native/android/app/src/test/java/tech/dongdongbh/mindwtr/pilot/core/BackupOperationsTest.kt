package tech.dongdongbh.mindwtr.pilot.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** Pass D1a's operation files (design §4.2-4.3): publish, the identity check before every send, cleanup, protection, the result record. */
class BackupOperationsTest {
    @get:Rule val folder = TemporaryFolder()
    private val snapshots get() = File(folder.root, "snapshots").apply { mkdirs() }
    private fun ops(maxPlanBytes: Long = Long.MAX_VALUE) = BackupOperations(File(folder.root, "ops"), snapshots, syncDirectory = {}, maxPlanBytes = maxPlanBytes)
    private val a = "11111111-1111-4111-8111-111111111111"
    private val b = "22222222-2222-4222-8222-222222222222"
    private val name = "data.2026-08-09T12-34-05.123.snapshot.json"
    private fun snapshot(text: String = "{\"tasks\":[]}") = File(snapshots, name).apply { writeText(text) }

    private fun refused(work: () -> Unit) = runCatching(work).exceptionOrNull() is BackupOperations.Mismatch

    @Test fun aPublishedPlanReadsBackExactly() {
        snapshot()
        val ref = ops().publish(a, "merge", "{\"plan\":1}", name, wrote = true)
        assertEquals("{\"plan\":1}", ops().plan(ref, name))
        assertEquals("merge", ops().mode(ref))
        assertTrue(JSONObject(ref).getInt("byteCount") <= 8192)
    }

    @Test fun swappedManifestsOrPlansAreRefused() {
        snapshot()
        val refA = ops().publish(a, "merge", "{\"plan\":\"a\"}", name, wrote = true)
        val refB = ops().publish(b, "merge", "{\"plan\":\"b\"}", name, wrote = true)
        val root = File(folder.root, "ops")
        // B's plan under A: A's manifest no longer matches its plan.
        File(root, "$b/plan.json").copyTo(File(root, "$a/plan.json"), overwrite = true)
        assertTrue(refused { ops().plan(refA, name) })
        // B's manifest under A: A's reference no longer matches its manifest.
        File(root, "$b/manifest.json").copyTo(File(root, "$a/manifest.json"), overwrite = true)
        assertTrue(refused { ops().plan(refA, name) })
        assertEquals("{\"plan\":\"b\"}", ops().plan(refB, name))
        // Another snapshot name than the journal's.
        assertTrue(refused { ops().plan(refB, "data.2026-08-09T12-34-06.000.snapshot.json") })
    }

    @Test fun aMissingOrTornPlanAndAChangedSnapshotAreRefused() {
        snapshot()
        val ref = ops().publish(a, "replace", "{\"plan\":1}", name, wrote = true)
        File(snapshots, name).writeText("{\"tasks\":[1]}")
        assertTrue(refused { ops().plan(ref, name) })
        snapshot()
        assertEquals("{\"plan\":1}", ops().plan(ref, name))
        File(folder.root, "ops/$a/plan.json").delete()
        assertTrue(refused { ops().plan(ref, name) })
        // A death mid-publish: the plan's pending file is there, the manifest never was.
        val torn = runCatching { ops().publish(b, "merge", "{\"plan\":2}", name, wrote = false) { error("killed") } }
        assertTrue(torn.isFailure)
        assertTrue(refused { ops().plan(JSONObject().put("id", b).put("sha256", "0".repeat(64)).put("byteCount", 10).toString(), name) })
    }

    @Test fun aRestoreReadsAnExistingSnapshotWithoutCheckingItsBytes() {
        val ref = ops().publish(a, "restore", "{\"plan\":1}", name, wrote = false)
        assertEquals("{\"plan\":1}", ops().plan(ref, name))
    }

    @Test fun aPlanPastTheLimitIsNeverRead() {
        val ref = ops().publish(a, "merge", "x".repeat(100), name, wrote = false)
        assertTrue(refused { ops(maxPlanBytes = 50).plan(ref, name) })
    }

    @Test fun cleanupKeepsOnlyTheJournalsOperations() {
        snapshot()
        ops().publish(a, "merge", "{}", name, wrote = true)
        ops().publish(b, "merge", "{}", name, wrote = false)
        ops().cleanup(setOf(b))
        assertFalse(File(folder.root, "ops/$a").exists())
        assertTrue(File(folder.root, "ops/$b/manifest.json").isFile)
    }

    @Test fun openOperationsAndTheResultProtectTheirSnapshots() {
        ops().publish(a, "merge", "{}", name, wrote = false)
        val undo = "data.2026-08-09T12-34-06.000.snapshot.json"
        ops().writeResult(JSONObject().put("requestId", b).put("outcome", "committed").put("undoSnapshot", undo))
        assertEquals(setOf(name, undo), ops().protectedNames())
        ops().discard(a)
        assertEquals(setOf(undo), ops().protectedNames())
    }

    @Test fun theResultRecordGoesOnlyForItsOwnRequest() {
        ops().writeResult(JSONObject().put("requestId", a).put("outcome", "committed"))
        ops().clearResult(b)
        assertEquals(a, ops().result()!!.getString("requestId"))
        ops().clearResult(a)
        assertNull(ops().result())
    }
}
