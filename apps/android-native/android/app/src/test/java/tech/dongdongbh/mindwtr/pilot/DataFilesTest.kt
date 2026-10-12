package tech.dongdongbh.mindwtr.pilot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException

/** Pass D1a's Data files: the bounded stage copy, strict UTF-8, the folder write's two guards and the interrupted-export cleanup. */
class DataFilesTest {
    @get:Rule val folder = TemporaryFolder()

    @Test fun theCopyCountsItsOwnBytesWhateverTheProviderSaid() {
        // The provider's SIZE column said 1 byte (RN's 7b7201ab6): the copy counts what it reads and stops past the production limit.
        val out = File(folder.root, "stage")
        val limit = stageLimit()
        assertEquals(DataTransferLimits.LIMIT_BYTES, limit)
        val refused = runCatching { copyBounded(ByteArrayInputStream(ByteArray((limit + 1).toInt())), out, limit) }.exceptionOrNull()
        assertTrue(refused is TransferTooLarge)
        copyBounded(ByteArrayInputStream(ByteArray(100)), out, limit)
        assertEquals(100L, out.length())
    }

    // D1a review P2-9: the production admission runs before any decode; an oversized copy is refused even when it is not UTF-8.
    @Test fun aStagedCopyIsAdmittedWithTheLibraryBeforeItIsDecoded() {
        val file = File(folder.root, "staged")
        val library = 4L * 1024 * 1024
        file.writeBytes(ByteArray((DataTransferLimits.LIMIT_BYTES - library + 1).toInt()) { 0xff.toByte() })
        assertTrue(runCatching { readStaged(file, library) }.exceptionOrNull() is TransferTooLarge)
        file.writeText("{}")
        assertEquals("{}", readStaged(file, library))
        assertTrue(runCatching { admitTransfer(DataTransferLimits.LIMIT_BYTES - library + 1, library) }.exceptionOrNull() is TransferTooLarge)
        admitTransfer(DataTransferLimits.LIMIT_BYTES - library, library)
    }

    // D1a review P2-8: a start sweeps every staged copy no open question owns, a partial one too.
    @Test fun theStartSweepKeepsOnlyLiveStagedCopies() {
        val dir = File(folder.root, "backup-import")
        val live = StagedCopies.create(dir).apply { writeText("{}") }
        val orphan = File(dir, "11111111-1111-4111-8111-111111111111").apply { writeText("{\"tasks\":[") }
        StagedCopies.sweep(dir)
        assertTrue(live.isFile)
        assertFalse(orphan.exists())
        StagedCopies.release(live)
        assertFalse(live.exists())
    }

    // D1a review P2-7: a leftover that did not commit says so, with core's reason, under RN's failure title.
    @Test fun aLeftoverThatDidNotCommitShowsItsReason() {
        val stale = leftoverFailure(JSONObject().put("operation", "merge").put("outcome", "stale").put("error", "STALE_REVISION: Local data changed after backup preparation"))
        assertEquals("settings.mergeBackupFailed", stale.titleKey)
        assertEquals("Local data changed after backup preparation", stale.message)
        val unresolved = leftoverFailure(JSONObject().put("operation", "replace").put("outcome", "refused").put("error", "INVALID_INPUT: Backup operation files do not match"))
        assertEquals("settings.backupMobile.restoreFailed", unresolved.titleKey)
        assertEquals("Backup operation files do not match", unresolved.message)
    }

    @Test fun invalidUtf8IsRefusedNotReplaced() {
        val file = File(folder.root, "backup.json")
        file.writeBytes(byteArrayOf(0x7b, 0xff.toByte(), 0x7d))
        assertNull(utf8(file))
        file.writeText("{\"title\":\"日本語 🦉\"}")
        assertEquals("{\"title\":\"日本語 🦉\"}", utf8(file))
    }

    private val record get() = File(folder.root, "export-pending.json")
    private val tree = "content://tree/primary%3ADownload"
    private fun listed() = if (record.isFile) JSONObject(record.readText()).getJSONArray("pending").let { list ->
        List(list.length()) { list.getJSONObject(it).let { entry -> entry.optString("uri").ifEmpty { "name:" + entry.optString("name") } } }
    } else emptyList()
    /** The production writer with this test's folder: [create] makes the document, the rest as given. */
    private fun export(name: String, create: () -> String, write: (String) -> Unit = {}, delete: (String) -> Boolean = { true }, exists: (String) -> Boolean? = { true }) =
        writeExportDocument(record, tree, name, create, write, delete, exists)
    /** A later process's start: it cleans what this one listed. */
    private fun nextStart(delete: (String) -> Boolean = { true }, exists: (String) -> Boolean? = { true }, find: (String, String) -> String? = { _, _ -> null }) =
        cleanupExportRecord(record, delete, exists, find, owner = "next-start")

    @Test fun theDocumentIsListedBeforeItExistsAndWhileItIsWritten() {
        export("b.json", create = { assertEquals(listOf("name:b.json"), listed()); "content://doc/1" }, write = { assertEquals(listOf("content://doc/1"), listed()) })
        assertTrue(listed().isEmpty())
        assertNull(nextStart(delete = { error("nothing to clean") }))
    }

    @Test fun aFailedFolderWriteDeletesTheDocumentItCreated() {
        val deleted = mutableListOf<String>()
        val failure = runCatching { export("b.json", create = { "content://doc/1" }, write = { throw IOException("provider") }, delete = { deleted += it; true }) }.exceptionOrNull()
        assertTrue(failure is IOException)
        assertEquals(listOf("content://doc/1"), deleted)
        assertTrue(listed().isEmpty())
    }

    // D1a review P1-3: a finished document whose URI cannot leave the list is deleted now and the export fails; no later start
    // deletes a backup this export reported as written.
    @Test fun aFinishedWriteWhoseRecordCannotChangeFailsInsteadOfLeavingATrap() {
        val deleted = mutableListOf<String>()
        val failure = runCatching { export("b.json", create = { "content://doc/5" }, write = { folder.root.setWritable(false) }, delete = { deleted += it; true }) }.exceptionOrNull()
        folder.root.setWritable(true)
        assertTrue(failure is IOException)
        assertEquals(listOf("content://doc/5"), deleted)
    }

    // D1a review P2-9: the record a death leaves is the production writer's own, taken at the moment of the death.
    @Test fun aDeathMidWriteIsCleanedAtTheNextStart() {
        val atDeath = File(folder.root, "at-death.json")
        export("b.json", create = { "content://doc/3" }, write = { record.copyTo(atDeath) })
        atDeath.copyTo(record, overwrite = true)
        val deleted = mutableListOf<String>()
        assertEquals("deleted", nextStart(delete = { deleted += it; true }))
        assertEquals(listOf("content://doc/3"), deleted)
        assertTrue(listed().isEmpty())
    }

    // D1a review 2: the record an older build wrote, `{ uri }`, keeps its cleanup.
    @Test fun theOlderOneDocumentRecordIsCleaned() {
        record.writeText("{\"uri\":\"content://doc/old\"}")
        val deleted = mutableListOf<String>()
        assertEquals("deleted", nextStart(delete = { deleted += it; true }))
        assertEquals(listOf("content://doc/old"), deleted)
        assertTrue(listed().isEmpty())
    }

    // D1a review P2-4: a provider that refused or cannot say keeps the entry, through a later export, until the document is gone.
    @Test fun anEntryLeavesOnlyOnceItsDocumentIsGone() {
        val atDeath = File(folder.root, "at-death.json")
        export("half.json", create = { "content://doc/half" }, write = { record.copyTo(atDeath) })
        atDeath.copyTo(record, overwrite = true)
        assertEquals("kept", nextStart(delete = { throw SecurityException("provider gone") }, exists = { null }))
        assertEquals("kept", nextStart(delete = { false }, exists = { true }))
        export("next.json", create = { "content://doc/next" })
        assertEquals(listOf("content://doc/half"), listed())
        assertEquals("deleted", nextStart(delete = { false }, exists = { false }))
        assertTrue(listed().isEmpty())
    }

    // D1a review 2 (#4): the list cannot be written before the document exists, so nothing is created.
    @Test fun noDocumentIsCreatedWhenItsEntryCannotBeListed() {
        folder.root.setWritable(false)
        val failure = runCatching { export("b.json", create = { error("never created") }) }.exceptionOrNull()
        folder.root.setWritable(true)
        assertTrue(failure is IOException)
    }

    // D1a review 2 (#4): created, then its URI cannot be listed and the provider refuses the delete: the entry by name stays, and
    // the next start finds the document by its name and deletes it.
    @Test fun aDocumentWhoseUriNeverReachedTheListIsFoundByName() {
        val failure = runCatching {
            export("lost.json", create = { folder.root.setWritable(false); "content://doc/lost" }, delete = { false }, exists = { true })
        }.exceptionOrNull()
        folder.root.setWritable(true)
        assertTrue(failure is IOException)
        assertEquals(listOf("name:lost.json"), listed())
        val deleted = mutableListOf<String>()
        assertEquals("deleted", nextStart(delete = { deleted += it; true }, find = { folderUri, name -> assertEquals(tree, folderUri); if (name == "lost.json") "content://doc/lost" else null }))
        assertEquals(listOf("content://doc/lost"), deleted)
        assertTrue(listed().isEmpty())
    }

    // An entry by name whose document was never created leaves at once; one whose folder cannot be listed stays.
    @Test fun aNameEntryLeavesOnlyWhenTheFolderSaysSo() {
        record.writeText(JSONObject().put("pending", org.json.JSONArray().put(JSONObject().put("tree", tree).put("name", "x.json"))).toString())
        assertEquals("kept", nextStart(find = { _, _ -> throw IOException("cannot list") }))
        assertEquals("deleted", nextStart(find = { _, _ -> null }))
        assertTrue(listed().isEmpty())
    }

    // D1a review 2: a start's cleanup that read an empty list never writes over an export listed meanwhile.
    @Test fun anEmptyCleanupLeavesAnExportListedMeanwhile() {
        record.writeText("{\"pending\":[]}")
        val writing = java.util.concurrent.CountDownLatch(1)
        val export = Thread { export("busy.json", create = { "content://doc/busy" }, write = { writing.await(2, java.util.concurrent.TimeUnit.SECONDS) }) }
        exportCleanupPause = {
            export.start()
            val deadline = System.currentTimeMillis() + 2_000
            while (listed() != listOf("content://doc/busy") && System.currentTimeMillis() < deadline) Thread.sleep(10)
        }
        try {
            assertNull(nextStart())
            assertEquals(listOf("content://doc/busy"), listed())
        } finally {
            exportCleanupPause = {}
            writing.countDown()
            export.join(2_000)
        }
    }

    // This process's own entries belong to an export still running here: its start's cleanup leaves them.
    @Test fun aCleanupNeverTouchesThisProcesssRunningExport() {
        val writing = java.util.concurrent.CountDownLatch(1)
        val listedNow = java.util.concurrent.CountDownLatch(1)
        val export = Thread { export("busy.json", create = { "content://doc/busy" }, write = { listedNow.countDown(); writing.await(2, java.util.concurrent.TimeUnit.SECONDS) }) }.apply { start() }
        try {
            assertTrue(listedNow.await(2, java.util.concurrent.TimeUnit.SECONDS))
            assertNull(cleanupExportRecord(record, delete = { error("must not delete") }, exists = { true }, find = { _, _ -> null }))
            assertEquals(listOf("content://doc/busy"), listed())
        } finally {
            writing.countDown()
            export.join(2_000)
        }
    }
}
