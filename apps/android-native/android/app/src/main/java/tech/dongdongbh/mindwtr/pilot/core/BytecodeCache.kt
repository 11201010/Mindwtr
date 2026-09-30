package tech.dongdongbh.mindwtr.pilot.core

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

/**
 * The bundle compiled to QuickJS bytecode, so a start skips parsing the 7 MB source (about 400 ms on the S23).
 *
 * One file, keyed by the SHA-256 of the exact bundle bytes (build-bundle.mjs writes it beside the bundle) and by the QuickJS
 * wrapper version, with the bytecode's own SHA-256 in its header. [read] returns bytecode only when all three match and the
 * file is whole; anything else (no file, another bundle, another engine, a damaged or short file, an IO error) returns null
 * with the reason, and the caller runs the source. A stale cache never runs.
 */
class BytecodeCache(
    private val file: File,
    private val engineVersion: String,
    private val syncDirectory: (File) -> Unit = ::syncDirectory,
) {
    /** [bytecode] is null unless [outcome] is "hit". */
    class Read(val bytecode: ByteArray?, val outcome: String)

    fun read(bundleHash: String): Read = try {
        if (!file.exists()) Read(null, "absent")
        else DataInputStream(file.inputStream().buffered()).use { input ->
            val magic = ByteArray(MAGIC.size).also(input::readFully)
            when {
                !magic.contentEquals(MAGIC) -> Read(null, "corrupt")
                !ByteArray(32).also(input::readFully).contentEquals(hex(bundleHash)) -> Read(null, "stale-bundle")
                input.readUTF() != engineVersion -> Read(null, "other-engine")
                else -> {
                    val length = input.readInt()
                    val digest = ByteArray(32).also(input::readFully)
                    if (length < 0 || length.toLong() != file.length() - HEADER_FIXED - utfLength(engineVersion)) Read(null, "truncated")
                    else {
                        val bytecode = ByteArray(length).also(input::readFully)
                        if (sha256(bytecode).contentEquals(digest)) Read(bytecode, "hit") else Read(null, "corrupt")
                    }
                }
            }
        }
    } catch (short: EOFException) {
        Read(null, "truncated")
    } catch (error: Exception) {
        Read(null, "error:${error.javaClass.simpleName}")
    }

    /**
     * Written whole under a temporary name of its own (created exclusively, so no other writer can share it), synced,
     * renamed over the old file, then the directory synced. False on any failure, with no partial file left under the
     * cache's name: the next start runs the source and tries again.
     */
    fun write(bundleHash: String, bytecode: ByteArray): Boolean {
        val temporary = runCatching {
            removeAbandonedTemporaryFiles()
            File.createTempFile("${file.name}.", ".tmp", file.parentFile)
        }.getOrElse { return false }
        return try {
            val header = ByteArrayOutputStream().also { bytes ->
                DataOutputStream(bytes).use { out ->
                    out.write(MAGIC)
                    out.write(hex(bundleHash))
                    out.writeUTF(engineVersion)
                    out.writeInt(bytecode.size)
                    out.write(sha256(bytecode))
                }
            }.toByteArray()
            FileOutputStream(temporary).use { out ->
                out.write(header)
                out.write(bytecode)
                out.fd.sync()
            }
            check(temporary.renameTo(file)) { "Cannot rename the bytecode cache into place" }
            syncDirectory(file.parentFile!!)
            true
        } catch (error: Exception) {
            temporary.delete()
            false
        }
    }

    /** A writer's temporary file left by a process that died mid-write (5 MB each); a live writer's is younger. */
    private fun removeAbandonedTemporaryFiles() {
        val cutoff = System.currentTimeMillis() - ABANDONED_AFTER_MS
        file.parentFile?.listFiles { other -> other.name.startsWith("${file.name}.") && other.name.endsWith(".tmp") }
            ?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
    }

    companion object {
        private val MAGIC = "MWQJSBC1".toByteArray(Charsets.US_ASCII)
        private const val ABANDONED_AFTER_MS = 10 * 60_000L
        /** Magic, bundle hash, the bytecode's length and hash; the engine version's UTF length comes on top. */
        private val HEADER_FIXED = MAGIC.size + 32L + 4 + 32
        private fun utfLength(text: String) = 2L + text.toByteArray(Charsets.UTF_8).size

        fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

        /** A 64-character hex SHA-256; anything else is refused (the caller's key is broken, so nothing may match). */
        fun hex(text: String): ByteArray {
            require(text.length == 64 && text.all { it in '0'..'9' || it in 'a'..'f' }) { "Not a SHA-256: $text" }
            return ByteArray(32) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
        }
    }
}
