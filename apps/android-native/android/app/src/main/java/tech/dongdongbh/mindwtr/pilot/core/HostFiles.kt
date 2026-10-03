package tech.dongdongbh.mindwtr.pilot.core

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

/**
 * The JS host's app-private files, under this app's files or cache folder, never resolving outside it (`..` and symbolic
 * links are resolved first, so neither escapes).
 *
 * - The pending-captures queue port (host-entry.ts): a path is `files/<path>` or `cache/<path>`; list a folder, read a file's
 *   text, delete a file (on disk before the call returns). Engine thread.
 * - Core's attachment file port (MobileAttachmentFileSystemPort, bundle/host-attachments.ts): [call] takes a `file://` URI under
 *   the same folders, as expo-file-system takes it, and reads a picked `content://` document as a source. HostIo runs each call
 *   off the engine thread, one at a time, in order.
 */
class HostFiles(
    private val files: File,
    private val cache: File,
    private val syncDirectory: (File) -> Unit = ::syncDirectory,
    /** Picked documents (`content://`); null where the host has no content resolver (a JVM test). */
    private val content: ContentSource? = null,
    /** The largest read [call] answers whole (its bytes travel to JS as base64, as a fetch body does). */
    private val maxReadBytes: Long = Runtime.getRuntime().maxMemory() / 5,
) {
    /** The part of Android's ContentResolver the attachment port reads through. */
    interface ContentSource {
        fun open(uri: String): InputStream
        /** The document's size, or null when its provider does not say; throws when the document is gone. */
        fun size(uri: String): Long?
    }

    /** The names of the files in folder [path], as a JSON array; "null" when the folder does not exist. */
    fun list(path: String): String {
        val dir = resolve(path)
        if (!dir.isDirectory) return "null"
        val names = dir.listFiles() ?: throw IOException("Cannot list $path")
        return JSONArray(names.filter { it.isFile }.map { it.name }).toString()
    }

    fun readText(path: String): String = resolve(path).readText()

    /** Deletes the file at [path] and syncs its folder; a file already gone is no error. */
    fun delete(path: String) {
        val file = resolve(path)
        if (!file.delete()) {
            if (file.exists()) throw IOException("Cannot delete $path")
            return
        }
        syncDirectory(file.parentFile!!)
    }

    /** The two folders as `file://` URIs, as expo-file-system's documentDirectory and cacheDirectory name them. */
    val documentDirectory get() = "file://${files.absolutePath}/"
    val cacheDirectory get() = "file://${cache.absolutePath}/"

    /** One answer of [call]: its JSON `value`, and a read's bytes. */
    class Reply(val value: Any?, val bytes: ByteArray? = null)

    /**
     * One call of core's attachment file port: [json] is `{ op, uri, to?, position?, length? }`, and [bytes] a write's (or a
     * `sha256` call's) bytes. A
     * missing file is an error whose text names ENOENT (core reads that as "not found"), except for getInfo (`exists: false`)
     * and delete (nothing to do).
     */
    fun call(json: String, bytes: ByteArray? = null): Reply {
        val request = JSONObject(json)
        val op = request.getString("op")
        // Core's SHA-256 (setSha256HexProvider): QuickJS has no WebCrypto, so a file's bytes are hashed here, as RN's native module does.
        if (op == "sha256") return Reply(MessageDigest.getInstance("SHA-256").digest(bytes ?: ByteArray(0)).joinToString("") { "%02x".format(it.toInt() and 0xff) })
        // Answers once every call before it is done (HostIo runs them in order): a managed delete waits on it, then deletes at once
        // with [deleteNow] in the engine turn that asked core who owns the file.
        if (op == "barrier") return Reply(null)
        val uri = request.getString("uri")
        return when (op) {
            "getInfo" -> Reply(info(uri))
            "makeDirectory" -> Reply(null.also { makeDirectory(writable(local(uri), folder = true)) })
            // In the file system's order, as expo-file-system lists it.
            "readDirectory" -> Reply(JSONArray(local(uri).let { dir -> if (dir.isDirectory) dir.list() else missing() }
                ?.toList() ?: throw IOException("Cannot read directory")))
            // A file's SHA-256, streamed where it lies (core's fs.sha256): its bytes never cross into the engine.
            "sha256File" -> Reply(open(uri).use { input ->
                val digest = MessageDigest.getInstance("SHA-256")
                val buffer = ByteArray(64 * 1024)
                while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
                digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
            })
            "readBytes" -> Reply(null, read(uri, 0, Long.MAX_VALUE))
            "readBytesRange" -> Reply(null, read(uri, request.getLong("position"), request.getLong("length")))
            "writeBytes" -> Reply(null.also { write(target(local(uri)), bytes ?: ByteArray(0)) })
            "copy" -> Reply(null.also { copy(uri) { target(local(request.getString("to"))) } })
            "move" -> Reply(null.also { writable(local(uri)).let { from -> if (!from.exists()) missing(); move(from, target(local(request.getString("to")))) } })
            "delete" -> Reply(null.also { remove(entry(uri)) })
            "syncParent" -> Reply(null.also { syncDirectory(entry(uri).parentFile!!) })
            else -> throw IllegalArgumentException("Unsupported file call $op")
        }
    }

    /**
     * The unlink of [call]'s `delete` (its rules, no folder sync), on the caller's thread: the engine's, in the turn that asked
     * core who owns the file. The folder's sync, slow and deciding nothing, follows on the files thread (`syncParent`).
     */
    // ponytail: one unlink on the engine thread (a file; a folder's tree would be slower), the price of a race-free ownership check.
    fun deleteNow(uri: String) {
        val file = entry(uri)
        if (file.exists() || isLink(file)) removeTree(file)
    }

    private fun info(uri: String): JSONObject {
        if (uri.startsWith("content://")) {
            val size = checkNotNull(content) { "No content resolver" }.size(uri)
            return JSONObject().put("exists", true).put("isDirectory", false).put("uri", uri).apply { size?.let { put("size", it) } }
        }
        val file = local(uri)
        if (!file.exists()) return JSONObject().put("exists", false).put("isDirectory", false).put("uri", uri)
        // expo-file-system's unit: modificationTime in seconds (core's port turns it back into milliseconds).
        return JSONObject().put("exists", true).put("isDirectory", file.isDirectory).put("uri", uri)
            .put("size", if (file.isDirectory) 0 else file.length()).put("modificationTime", file.lastModified() / 1000.0)
    }

    private fun makeDirectory(dir: File) {
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) throw IOException("Cannot make directory ${dir.name}")
    }

    private fun open(uri: String): InputStream = if (uri.startsWith("content://")) checkNotNull(content) { "No content resolver" }.open(uri).also { source = it }
        else local(uri).let { file -> if (file.isFile) file.inputStream() else missing() }

    /** The picked document the running call reads, for [abortRead]. */
    @Volatile private var source: InputStream? = null

    /**
     * Closes the picked document the running call reads (HostIo.fileAbort, once the call's operation passed its deadline): a read
     * stalled on its document provider then ends with an IOException, and the files thread is free for the next call.
     */
    fun abortRead() {
        runCatching { source?.close() }
    }

    /** [length] bytes from [position] (to the end with Long.MAX_VALUE). A read past [maxReadBytes] throws, never answers short. */
    private fun read(uri: String, position: Long, length: Long): ByteArray {
        require(position >= 0 && length >= 0) { "Invalid byte range" }
        open(uri).use { input ->
            var skipped = 0L
            while (skipped < position) {
                val step = input.skip(position - skipped)
                if (step > 0) skipped += step else if (input.read() < 0) return ByteArray(0) else skipped += 1
            }
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            var left = length
            while (left > 0) {
                val count = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
                if (count < 0) break
                out.write(buffer, 0, count)
                left -= count
                if (out.size() > maxReadBytes) throw IOException("File exceeds the $maxReadBytes byte read limit")
            }
            return out.toByteArray()
        }
    }

    /**
     * A write's, copy's or move's [file], made ready as RN's file-system.ts prepareFileTarget does: its folder made, and a folder
     * at [file] itself removed (a link is removed as a link). Only where a write may land.
     */
    private fun target(file: File): File {
        val ready = writable(file)
        makeDirectory(ready.parentFile!!)
        if (ready.isDirectory) remove(ready)
        return ready
    }

    /** Creates or replaces [file] with [bytes], synced. */
    private fun write(file: File, bytes: ByteArray) {
        FileOutputStream(file).use { out -> out.write(bytes); out.fd.sync() }
        syncDirectory(file.parentFile!!)
    }

    /** [from]'s bytes into [to], made ready only once the source opened (a missing source changes nothing). */
    private fun copy(from: String, to: () -> File) {
        val file = open(from).use { input -> to().also { file -> FileOutputStream(file).use { out -> input.copyTo(out, 64 * 1024); out.fd.sync() } } }
        syncDirectory(file.parentFile!!)
    }

    /** A rename that replaces [to], as expo-file-system's move does. */
    private fun move(from: File, to: File) {
        if (!from.renameTo(to)) throw IOException("Cannot move ${from.name}")
        syncDirectory(to.parentFile!!)
        if (from.parentFile != to.parentFile) syncDirectory(from.parentFile!!)
    }

    /**
     * A file, or a folder and everything in it; one already gone is no error (expo-file-system's idempotent delete). A symbolic
     * link is removed as a link: nothing it points to is ever touched.
     */
    private fun remove(file: File) {
        if (!file.exists() && !isLink(file)) return
        removeTree(file)
        syncDirectory(file.parentFile!!)
    }

    private fun removeTree(file: File) {
        if (!isLink(file) && file.isDirectory) file.listFiles()?.forEach(::removeTree)
        // File.delete removes a link itself, never what it points to.
        if (!file.delete() && (file.exists() || isLink(file))) throw IOException("Cannot delete ${file.name}")
    }

    /** [file] is a symbolic link: its own path differs from its resolved one (plain java.io, as minSdk 24 has no java.nio.file). */
    private fun isLink(file: File): Boolean = file.parentFile?.let { File(it.canonicalFile, file.name).canonicalPath != File(it.canonicalFile, file.name).absolutePath } == true

    private fun missing(): Nothing = throw IOException("ENOENT: no such file or directory")

    /** A `file://` URI as a file inside the files or cache folder (either folder itself included); any other URI is refused. */
    private fun local(uri: String): File {
        require(uri.startsWith("file:///")) { "Not an app file URI" }
        val file = File(decode(uri.removePrefix("file://").substringBefore('?').substringBefore('#'))).canonicalFile
        require(listOf(files, cache).any { root -> root.canonicalFile.let { file == it || file.path.startsWith(it.path + File.separator) } }) { "Not an app file URI" }
        return file
    }

    /**
     * Where a write may land: under files/attachments/ (the folder itself only for [folder], makeDirectory) or under cache/. Any
     * other file of the app (the database, the journal, the log) and either root is refused.
     */
    private fun writable(file: File, folder: Boolean = false): File {
        val attachments = File(files.canonicalFile, "attachments")
        val cacheRoot = cache.canonicalFile
        require(file.path.startsWith(attachments.path + File.separator) || (folder && file == attachments)
            || file.path.startsWith(cacheRoot.path + File.separator)) { "Not a writable attachment URI" }
        return file
    }

    /** A delete's target as named, a link itself included (its folder resolved, never the link), and only where a write may land. */
    private fun entry(uri: String): File {
        require(uri.startsWith("file:///")) { "Not an app file URI" }
        val named = File(decode(uri.removePrefix("file://").substringBefore('?').substringBefore('#')))
        val parent = named.parentFile ?: throw IllegalArgumentException("Not an app file URI")
        require(named.name.isNotEmpty() && named.name != "." && named.name != ".." && !uri.substringBefore('?').endsWith("/")) { "Not an app file URI" }
        return writable(File(local("file://${parent.path}"), named.name))
    }

    /** Percent-escapes decoded as a URI path holds them ('+' stays '+'). */
    private fun decode(path: String): String = if ('%' !in path) path else java.net.URLDecoder.decode(path.replace("+", "%2B"), "UTF-8")

    private fun resolve(path: String): File {
        val root = when (path.substringBefore('/')) {
            "files" -> files
            "cache" -> cache
            else -> throw IllegalArgumentException("Not an app file: $path")
        }.canonicalFile
        val file = File(root, path.substringAfter('/', "")).canonicalFile
        require(file.path.startsWith(root.path + File.separator)) { "Not an app file: $path" }
        return file
    }
}

/** A picked document read through Android's ContentResolver, as expo-file-system reads a `content://` source. */
class AndroidContentSource(context: android.content.Context) : HostFiles.ContentSource {
    private val resolver = context.applicationContext.contentResolver

    override fun open(uri: String): InputStream =
        resolver.openInputStream(android.net.Uri.parse(uri)) ?: throw IOException("ENOENT: no such file or directory")

    override fun size(uri: String): Long? =
        resolver.query(android.net.Uri.parse(uri), arrayOf(android.provider.OpenableColumns.SIZE), null, null, null)?.use { row ->
            if (!row.moveToFirst()) throw IOException("ENOENT: no such file or directory")
            if (row.isNull(0)) null else row.getLong(0)
        } ?: throw IOException("ENOENT: no such file or directory")
}
