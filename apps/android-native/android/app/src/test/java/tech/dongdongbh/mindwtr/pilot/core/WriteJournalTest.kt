package tech.dongdongbh.mindwtr.pilot.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** The journal's file rules: order, the atomic write, drop and keep, and moving damaged entries aside. */
class WriteJournalTest {
    @get:Rule val folder = TemporaryFolder()

    /** Each directory sync, with the journal's files at that moment. */
    private val syncs = mutableListOf<List<String>>()
    private val logged = mutableListOf<String>()

    private fun open(dir: File = File(folder.root, "journal")) =
        WriteJournal(dir, syncDirectory = { syncs += names(it) }, log = { logged += it })

    private fun names(dir: File) = dir.listFiles().orEmpty().filter { it.isFile }.map { it.name }.sorted()

    private fun bulk(requestId: String) = """{"list":"inbox","action":{"type":"moveTasks","taskIds":["a"],"taskRevisions":{"a":"1:x:t"}},"requestId":"$requestId"}"""

    @Test fun entriesKeepTheirOrderAcrossAReopen() {
        val journal = open()
        journal.append("complete", listOf("task-1", "3:dev:2026"))
        journal.append("menuCommand", listOf("bulkAction", bulk("r-1")))
        journal.append("taskFocus", listOf("task-2", true, "4:dev:2026"))
        val reopened = open()
        assertEquals(listOf("complete", "menuCommand", "taskFocus"), reopened.pending().map { it.method })
        assertEquals(listOf("task-2", true, "4:dev:2026"), reopened.pending()[2].args)
        // The exact request, requestId included, is what goes back to the engine.
        assertEquals(listOf("bulkAction", bulk("r-1")), reopened.pending()[1].args)
        // A later entry sorts after every entry already on disk.
        reopened.append("update", listOf("""{"id":"t"}"""))
        assertEquals(listOf("complete", "menuCommand", "taskFocus", "update"), open().pending().map { it.method })
    }

    @Test fun anEntryIsDurableBeforeAppendReturns() {
        val dir = File(folder.root, "journal")
        val entry = open(dir).append("complete", listOf("task-1", "3:dev:2026"))!!
        // Written whole under a temporary name, synced, renamed into place, then the directory synced: the last
        // directory sync already sees the entry under its final name, and no temporary file is left.
        assertTrue(entry.file.exists())
        assertEquals(listOf(entry.file.name), syncs.last())
        assertEquals(listOf(entry.file.name), names(dir))
        assertEquals(entry.text, entry.file.readText())
    }

    @Test fun aWriteCutShortIsNeverAnEntry() {
        val dir = File(folder.root, "journal").apply { mkdirs() }
        // A process that died after writing the temporary file but before the rename never sent that request.
        File(dir, "0000000000000001.json.tmp").writeText("""{"method":"compl""")
        val journal = open(dir)
        assertEquals(emptyList<WriteJournal.Entry>(), journal.pending())
        assertEquals(emptyList<String>(), names(dir))
        assertTrue(logged.any { it.contains("partial=1") })
    }

    @Test fun anyFinalReplyDropsTheEntry() {
        val journal = open()
        for (error in listOf(null, "STALE_REVISION: changed", "INVALID_INPUT: no", "TASK_NOT_FOUND: gone", "NOT_FOUND: gone", "ACTION_FAILED: refused")) {
            val entry = journal.append("complete", listOf("task-1", "rev-$error"))!!
            journal.settle(entry, error)
            assertFalse("$error drops the entry", entry.file.exists())
        }
        assertEquals(emptyList<WriteJournal.Entry>(), open().pending())
    }

    @Test fun saveFailedKeepsTheEntryAndItsRetryReusesIt() {
        val journal = open()
        val entry = journal.append("menuCommand", listOf("bulkAction", bulk("r-2")))!!
        journal.settle(entry, "SAVE_FAILED: disk full")
        assertTrue(entry.file.exists())
        // The owed retry sends the same request: no second entry, so no second replay.
        val again = journal.append("menuCommand", listOf("bulkAction", bulk("r-2")))!!
        assertSame(entry, again)
        assertEquals(1, File(folder.root, "journal").listFiles()!!.count { it.isFile })
        journal.settle(again, null)
        assertFalse(entry.file.exists())
        assertEquals(emptyList<WriteJournal.Entry>(), open().pending())
    }

    @Test fun damagedOrUnknownEntriesMoveAsideAndAreNeverReplayed() {
        val dir = File(folder.root, "journal").apply { mkdirs() }
        val good = open(dir).append("complete", listOf("task-1", "3:dev:2026"))!!
        val damaged = mapOf(
            "0000000000000002.json" to "not json",
            "0000000000000003.json" to """{"method":"boot","args":["",""]}""",
            "0000000000000004.json" to """{"method":"complete","args":[{"id":"x"}]}""",
            "0000000000000005.json" to """{"method":"complete"}""",
            "stray.json" to """{"method":"complete","args":["a","b"]}""",
        )
        for ((name, text) in damaged) File(dir, name).writeText(text)
        val journal = open(dir)
        assertEquals(listOf(good.text), journal.pending().map { it.text })
        val aside = File(dir, WriteJournal.ASIDE)
        // Kept as they were, never deleted.
        for ((name, text) in damaged) assertEquals(text, File(aside, name).readText())
        assertEquals(listOf(good.file.name), names(dir))
        assertTrue(logged.any { it.contains("aside=5") })
        // A second damaged entry of the same name never replaces the first one set aside.
        File(dir, "0000000000000002.json").writeText("also not json")
        open(dir)
        assertEquals(setOf("not json", "also not json"), aside.listFiles()!!.filter { it.name.startsWith("0000000000000002.json") }.map { it.readText() }.toSet())
    }

    @Test fun onlyWriteMethodsAreJournaled() {
        val journal = open()
        for (read in listOf("boot", "focus", "menuRead", "language", "captureSnapshot")) {
            val refused = runCatching { journal.append(read, listOf("x")) }.exceptionOrNull()
            assertTrue("$read is not a write", refused is IllegalArgumentException)
        }
        assertEquals(emptyList<WriteJournal.Entry>(), journal.pending())
    }

    @Test fun onlySaveFailedKeeps() {
        assertTrue(WriteJournal.keeps("SAVE_FAILED: Injected commit failure"))
        for (error in listOf(null, "STALE_REVISION: x", "INVALID_INPUT: x", "ACTION_FAILED: x", "Incomplete tasks load")) assertFalse(WriteJournal.keeps(error))
    }
}
