package tech.dongdongbh.mindwtr.pilot.core

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** The pending-captures queue port's Kotlin side: list, read and delete, only under the app's files and cache folders. */
class HostFilesTest {
    @get:Rule val folder = TemporaryFolder()

    private val synced = mutableListOf<String>()
    private val filesDir get() = File(folder.root, "files")
    private val cacheDir get() = File(folder.root, "cache")
    private fun open() = HostFiles(filesDir, cacheDir, syncDirectory = { synced += it.name })
    private fun queue() = File(filesDir, "pending-captures").apply { mkdirs() }

    @Test fun aFolderThatDoesNotExistListsAsNull() {
        assertEquals("null", open().list("files/pending-captures"))
    }

    @Test fun aFolderListsItsFileNamesOnly() {
        queue().resolve("b.json").writeText("{}")
        queue().resolve("a.json").writeText("{}")
        queue().resolve("a.tmp").writeText("{")
        queue().resolve("nested").mkdirs()
        assertEquals(listOf("a.json", "a.tmp", "b.json"), JSONArray(open().list("files/pending-captures")).toList().sorted())
    }

    @Test fun aFileReadsAsItsTextExactly() {
        queue().resolve("a.json").writeText("""{"id":"1","title":"Grüße ✓ 😀"}""")
        assertEquals("""{"id":"1","title":"Grüße ✓ 😀"}""", open().readText("files/pending-captures/a.json"))
    }

    @Test fun aDeleteIsOnDiskBeforeItReturns() {
        queue().resolve("a.json").writeText("{}")
        open().delete("files/pending-captures/a.json")
        assertFalse(queue().resolve("a.json").exists())
        // Its folder is synced after the delete, so a power cut cannot bring the item back.
        assertEquals(listOf("pending-captures"), synced)
    }

    @Test fun aFileAlreadyGoneIsNoError() {
        open().delete("files/pending-captures/gone.json")
        assertEquals(emptyList<String>(), synced)
    }

    @Test fun theCacheFolderIsReachableToo() {
        File(cacheDir, "x").apply { mkdirs() }.resolve("a.txt").writeText("cached")
        assertEquals("cached", open().readText("cache/x/a.txt"))
    }

    @Test fun noPathLeavesTheAppFolders() {
        File(folder.root, "outside.json").writeText("secret")
        queue()
        val files = open()
        for (path in listOf("files/../outside.json", "files/pending-captures/../../outside.json", "databases/RKStorage", "/etc/hosts", "files", "")) {
            assertThrows(path, IllegalArgumentException::class.java) { files.readText(path) }
            assertThrows(path, IllegalArgumentException::class.java) { files.delete(path) }
            assertThrows(path, IllegalArgumentException::class.java) { files.list(path) }
        }
        assertEquals("secret", File(folder.root, "outside.json").readText())
    }

    private fun JSONArray.toList() = List(length()) { getString(it) }
}
