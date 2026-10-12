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
        // The provider's SIZE column said 1 byte (RN's 7b7201ab6): the copy counts what it reads and stops past the limit.
        val out = File(folder.root, "stage")
        val refused = runCatching { copyBounded(ByteArrayInputStream(ByteArray(101)), out, 100) }.exceptionOrNull()
        assertTrue(refused is TransferTooLarge)
        copyBounded(ByteArrayInputStream(ByteArray(100)), out, 100)
        assertEquals(100L, out.length())
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
    private fun listed() = if (record.isFile) JSONObject(record.readText()).getJSONArray("pending").let { list -> List(list.length()) { list.getString(it) } } else emptyList()

    @Test fun aFailedFolderWriteDeletesTheDocumentItCreated() {
        val deleted = mutableListOf<String>()
        val failure = runCatching {
            writeExportDocument(record, create = { "content://doc/1" }, write = { assertEquals(listOf("content://doc/1"), listed()); throw IOException("provider") },
                delete = { deleted += it; true }, exists = { true })
        }.exceptionOrNull()
        assertTrue(failure is IOException)
        assertEquals(listOf("content://doc/1"), deleted)
        assertTrue(listed().isEmpty())
    }

    @Test fun aRefusedCreateLeavesNothingToDelete() {
        val deleted = mutableListOf<String>()
        assertTrue(runCatching { writeExportDocument(record, create = { throw IOException("refused") }, write = {}, delete = { deleted += it; true }, exists = { true }) }.isFailure)
        assertTrue(deleted.isEmpty())
        assertFalse(record.exists())
    }

    @Test fun aCompletedWriteLeavesNothingListed() {
        writeExportDocument(record, create = { "content://doc/2" }, write = {}, delete = { error("not deleted") }, exists = { true })
        assertFalse(record.exists())
        assertNull(cleanupExportRecord(record, delete = { error("nothing to clean") }, exists = { true }))
    }

    // D1a review P1-3: a finished document whose URI cannot leave the list is deleted now and the export fails; no later start
    // deletes a backup this export reported as written.
    @Test fun aFinishedWriteWhoseRecordCannotChangeFailsInsteadOfLeavingATrap() {
        val deleted = mutableListOf<String>()
        val failure = runCatching {
            writeExportDocument(record, create = { "content://doc/5" }, write = { folder.root.setWritable(false) },
                delete = { deleted += it; true }, exists = { true })
        }.exceptionOrNull()
        folder.root.setWritable(true)
        assertTrue(failure is IOException)
        assertEquals(listOf("content://doc/5"), deleted)
    }

    // D1a review P2-9: the record a death leaves is the production writer's own, taken at the moment of the death.
    @Test fun aDeathMidWriteIsCleanedAtTheNextStart() {
        val atDeath = File(folder.root, "at-death.json")
        writeExportDocument(record, create = { "content://doc/3" }, write = { record.copyTo(atDeath) }, delete = { error("not deleted") }, exists = { true })
        val deleted = mutableListOf<String>()
        assertEquals("deleted", cleanupExportRecord(atDeath, delete = { deleted += it; true }, exists = { true }))
        assertEquals(listOf("content://doc/3"), deleted)
        assertFalse(atDeath.exists())
    }

    // D1a review P2-4: a provider that refused or cannot say keeps the entry, through a later export, until the document is gone.
    @Test fun anEntryLeavesOnlyOnceItsDocumentIsGone() {
        writeExportDocument(record, create = { "content://doc/half" }, write = { record.copyTo(File(folder.root, "keep.json")) }, delete = { true }, exists = { true })
        File(folder.root, "keep.json").copyTo(record, overwrite = true)
        assertEquals("kept", cleanupExportRecord(record, delete = { throw SecurityException("provider gone") }, exists = { null }))
        assertEquals("kept", cleanupExportRecord(record, delete = { false }, exists = { true }))
        writeExportDocument(record, create = { "content://doc/next" }, write = {}, delete = { true }, exists = { true })
        assertEquals(listOf("content://doc/half"), listed())
        assertEquals("deleted", cleanupExportRecord(record, delete = { false }, exists = { false }))
        assertTrue(listed().isEmpty())
    }

    // D1a review P2-4: the record cannot be written before the first byte; the created document goes at once.
    @Test fun aRecordThatCannotBeWrittenDeletesTheNewDocument() {
        val deleted = mutableListOf<String>()
        val failure = runCatching {
            writeExportDocument(record, create = { folder.root.setWritable(false); "content://doc/6" }, write = { error("never written") },
                delete = { deleted += it; true }, exists = { true })
        }.exceptionOrNull()
        folder.root.setWritable(true)
        assertTrue(failure is IOException)
        assertEquals(listOf("content://doc/6"), deleted)
    }
}
