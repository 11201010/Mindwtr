package tech.dongdongbh.mindwtr.pilot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
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

    @Test fun invalidUtf8IsRefusedNotReplaced() {
        val file = File(folder.root, "backup.json")
        file.writeBytes(byteArrayOf(0x7b, 0xff.toByte(), 0x7d))
        assertNull(utf8(file))
        file.writeText("{\"title\":\"日本語 🦉\"}")
        assertEquals("{\"title\":\"日本語 🦉\"}", utf8(file))
    }

    @Test fun aFailedFolderWriteDeletesTheDocumentItCreated() {
        val record = File(folder.root, "export-pending.json")
        val deleted = mutableListOf<String>()
        val failure = runCatching {
            writeExportDocument(record, create = { "content://doc/1" }, write = { assertTrue(record.isFile); throw IOException("provider") },
                delete = { deleted += it; true })
        }.exceptionOrNull()
        assertTrue(failure is IOException)
        assertEquals(listOf("content://doc/1"), deleted)
        assertFalse(record.exists())
    }

    @Test fun aRefusedCreateLeavesNothingToDelete() {
        val record = File(folder.root, "export-pending.json")
        val deleted = mutableListOf<String>()
        assertTrue(runCatching { writeExportDocument(record, create = { throw IOException("refused") }, write = {}, delete = { deleted += it; true }) }.isFailure)
        assertTrue(deleted.isEmpty())
        assertFalse(record.exists())
    }

    @Test fun aCompletedWriteLeavesNoRecord() {
        val record = File(folder.root, "export-pending.json")
        writeExportDocument(record, create = { "content://doc/2" }, write = {}, delete = { error("not deleted") })
        assertFalse(record.exists())
        assertNull(cleanupExportRecord(record) { error("nothing to clean") })
    }

    @Test fun aDeathMidWriteIsCleanedAtTheNextStart() {
        val record = File(folder.root, "export-pending.json")
        // The process died inside write: the record stays on disk.
        runCatching { writeExportDocument(record, create = { "content://doc/3" }, write = { throw ThreadDeath() }, delete = { false }) }
        record.writeText("{\"uri\":\"content://doc/3\"}")
        val deleted = mutableListOf<String>()
        assertEquals("deleted", cleanupExportRecord(record) { deleted += it; true })
        assertEquals(listOf("content://doc/3"), deleted)
        assertFalse(record.exists())
        record.writeText("{\"uri\":\"content://doc/4\"}")
        assertEquals("gone", cleanupExportRecord(record) { false })
    }
}
