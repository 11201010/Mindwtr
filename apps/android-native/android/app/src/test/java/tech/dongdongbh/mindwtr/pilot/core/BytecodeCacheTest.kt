package tech.dongdongbh.mindwtr.pilot.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.RandomAccessFile

/** The bytecode cache runs bytecode only for its exact bundle and engine, whole and unchanged; every other case runs the source. */
class BytecodeCacheTest {
    @get:Rule val folder = TemporaryFolder()

    private val bundle = "a".repeat(64)
    private val otherBundle = "b".repeat(64)
    private val bytecode = ByteArray(10_000) { (it * 31).toByte() }
    private val syncs = mutableListOf<File>()

    private fun file() = File(folder.root, "core-host.qjsc")
    private fun cache(engine: String = "3.2.0", file: File = file()) = BytecodeCache(file, engine, syncDirectory = { syncs += it })

    @Test fun aWrittenCacheIsReadBackForItsBundleAndEngine() {
        assertTrue(cache().write(bundle, bytecode))
        val read = cache().read(bundle)
        assertEquals("hit", read.outcome)
        assertArrayEquals(bytecode, read.bytecode)
        // Synced into place: the directory after the rename, and no temporary file left.
        assertEquals(listOf(folder.root), syncs)
        assertEquals(listOf("core-host.qjsc"), folder.root.list()!!.toList())
    }

    @Test fun noFileRunsTheSource() {
        assertMiss("absent", cache().read(bundle))
    }

    @Test fun anotherBundlesCacheNeverRuns() {
        cache().write(otherBundle, bytecode)
        assertMiss("stale-bundle", cache().read(bundle))
    }

    @Test fun anotherEngineVersionsCacheNeverRuns() {
        cache(engine = "3.1.0").write(bundle, bytecode)
        assertMiss("other-engine", cache(engine = "3.2.0").read(bundle))
    }

    @Test fun changedBytecodeFailsItsChecksum() {
        cache().write(bundle, bytecode)
        RandomAccessFile(file(), "rw").use { raw ->
            raw.seek(raw.length() - 100)
            val byte = raw.read()
            raw.seek(raw.length() - 100)
            raw.write(byte xor 0xff)
        }
        assertMiss("corrupt", cache().read(bundle))
    }

    @Test fun aDamagedHeaderNeverRuns() {
        cache().write(bundle, bytecode)
        RandomAccessFile(file(), "rw").use { it.write('X'.code) }
        assertMiss("corrupt", cache().read(bundle))
    }

    @Test fun aShortOrLongFileNeverRuns() {
        cache().write(bundle, bytecode)
        val whole = file().readBytes()
        file().writeBytes(whole.copyOf(whole.size - 1))
        assertMiss("truncated", cache().read(bundle))
        // Cut inside the header too.
        file().writeBytes(whole.copyOf(20))
        assertMiss("truncated", cache().read(bundle))
        // Bytes after the bytecode are not part of any write.
        file().writeBytes(whole + byteArrayOf(0))
        assertMiss("truncated", cache().read(bundle))
    }

    @Test fun anUnreadableFileRunsTheSource() {
        // A directory where the file should be: reading it fails, and that is a miss, never an exception.
        assertTrue(file().mkdir())
        assertTrue(cache().read(bundle).outcome.startsWith("error:"))
    }

    @Test fun aFailedWriteLeavesNoCacheAndDoesNotThrow() {
        // The cache's directory is missing: the temporary file cannot be made.
        val missing = cache(file = File(folder.root, "gone/core-host.qjsc"))
        assertFalse(missing.write(bundle, bytecode))
        assertMiss("absent", missing.read(bundle))
        // The rename cannot replace a directory: the temporary file is removed and nothing is under the cache's name.
        assertTrue(file().mkdir())
        assertFalse(cache().write(bundle, bytecode))
        assertEquals(listOf("core-host.qjsc"), folder.root.list()!!.toList())
        assertTrue(file().isDirectory)
    }

    @Test fun aFailedDirectorySyncIsAFailedWrite() {
        val failing = BytecodeCache(file(), "3.2.0", syncDirectory = { error("fsync failed") })
        assertFalse(failing.write(bundle, bytecode))
    }

    @Test fun anotherWritersTemporaryFileIsNeverShared() {
        // Writer A is mid-write on a temporary file (its stream still open) when writer B writes and publishes. With one shared
        // temporary name, B would truncate A's file, rename it into place, and A's later bytes would land in the published cache.
        val other = File(folder.root, "core-host.qjsc.tmp")
        java.io.FileOutputStream(other).use { writerA ->
            writerA.write("A's first bytes".toByteArray())
            assertTrue(cache().write(bundle, bytecode))
            writerA.write(ByteArray(4096) { 1 })
        }
        assertArrayEquals(bytecode, cache().read(bundle).bytecode)
        assertTrue(other.readBytes().copyOf(15).contentEquals("A's first bytes".toByteArray()))
    }

    @Test fun twoWritersAtOnceLeaveOneWholeCache() {
        val second = ByteArray(20_000) { (it * 7).toByte() }
        val writers = listOf(bytecode, second).map { payload -> Thread { repeat(20) { cache().write(bundle, payload) } } }
        writers.forEach(Thread::start)
        writers.forEach(Thread::join)
        val read = cache().read(bundle)
        assertEquals("hit", read.outcome)
        assertTrue(read.bytecode!!.contentEquals(bytecode) || read.bytecode!!.contentEquals(second))
        assertEquals(listOf("core-host.qjsc"), folder.root.list()!!.toList())
    }

    @Test fun aDeadWritersTemporaryFileIsRemovedAndALiveOnesIsKept() {
        val abandoned = File(folder.root, "core-host.qjsc.123.tmp").apply { writeText("dead"); setLastModified(System.currentTimeMillis() - 3_600_000) }
        val live = File(folder.root, "core-host.qjsc.456.tmp").apply { writeText("live") }
        assertTrue(cache().write(bundle, bytecode))
        assertFalse(abandoned.exists())
        assertEquals("live", live.readText())
    }

    @Test fun aNewWriteReplacesTheOldCache() {
        cache().write(otherBundle, bytecode)
        val next = ByteArray(5) { 7 }
        assertTrue(cache().write(bundle, next))
        assertArrayEquals(next, cache().read(bundle).bytecode)
        assertMiss("stale-bundle", cache().read(otherBundle))
    }

    @Test fun aKeyThatIsNotASha256MatchesNothing() {
        cache().write(bundle, bytecode)
        assertTrue(cache().read("").outcome.startsWith("error:"))
        assertFalse(cache().write("", bytecode))
    }

    private fun bundleFile(body: String, hashOf: String = body) =
        ("//mindwtr-bundle-sha256:" + BytecodeCache.sha256(hashOf.toByteArray()).joinToString("") { "%02x".format(it) } + "\n" + body).toByteArray()

    @Test fun theBundleKeyIsItsOwnHashLine() {
        val file = bundleFile("globalThis.x = 1;")
        val key = BytecodeCache.bundleKey(file.inputStream())
        assertEquals(BytecodeCache.sha256("globalThis.x = 1;".toByteArray()).joinToString("") { "%02x".format(it) }, key)
        assertTrue(BytecodeCache.bodyMatches(file, key))
    }

    @Test fun aBodyFromAnotherBuildDoesNotMatchTheKey() {
        val file = bundleFile("globalThis.x = 2;", hashOf = "globalThis.x = 1;")
        assertFalse(BytecodeCache.bodyMatches(file, BytecodeCache.bundleKey(file.inputStream())))
    }

    @Test fun aBundleWithoutAHashLineHasNoKey() {
        assertEquals("", BytecodeCache.bundleKey("globalThis.x = 1;".toByteArray().inputStream()))
        assertEquals("", BytecodeCache.bundleKey("//mindwtr-bundle-sha256:xyz\nglobalThis.x = 1;".toByteArray().inputStream()))
        assertFalse(BytecodeCache.bodyMatches("globalThis.x = 1;".toByteArray(), bundle))
    }

    private fun assertMiss(outcome: String, read: BytecodeCache.Read) {
        assertEquals(outcome, read.outcome)
        assertNull(read.bytecode)
    }
}
