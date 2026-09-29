package tech.dongdongbh.mindwtr.pilot.core

import org.json.JSONArray
import java.io.File
import java.io.IOException

/**
 * The JS host's app-private files (host-entry.ts's pending-captures queue port): a path is `files/<path>` or `cache/<path>`,
 * under this app's files or cache folder, and never resolves outside it. Only what the queue needs: list a folder, read a
 * file's text, delete a file (on disk before the call returns). Engine thread only.
 */
class HostFiles(private val files: File, private val cache: File, private val syncDirectory: (File) -> Unit = ::syncDirectory) {
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
