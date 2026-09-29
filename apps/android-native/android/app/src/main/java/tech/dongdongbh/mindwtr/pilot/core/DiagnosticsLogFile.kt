package tech.dongdongbh.mindwtr.pilot.core

import java.io.File
import java.io.FileOutputStream

/**
 * RN's diagnostics log, files/logs/mindwtr.log, as plain file operations for core's DiagnosticsLogFile (host-entry.ts
 * nativeLogFile). Core decides every write: the Debug logging switch or a forced line, the JSON line, the size cap, one write
 * at a time. Runs on the engine thread, never the UI thread.
 */
class DiagnosticsLogFile(val file: File) {
    companion object {
        /** Core's DIAGNOSTICS_LOG_RELATIVE_PATH under the app's files directory (a boot gate compares them). */
        const val RELATIVE_PATH = "logs/mindwtr.log"
    }

    /** One operation as nativeLogFile sends it; each answer is text, "" for none or false. */
    fun run(operation: String, text: String): String = when (operation) {
        "path" -> file.path
        // A folder where the log should be is removed first, as RN's ensureLogFile and clearLog do.
        "ensure" -> {
            file.parentFile?.mkdirs()
            if (file.isDirectory) file.deleteRecursively()
            file.createNewFile()
            if (file.isFile) file.path else ""
        }
        "exists" -> if (file.isFile) "1" else ""
        "read" -> file.readText()
        "size" -> file.length().toString()
        // One write() in append mode: the whole line is in the kernel before the call returns, so a process kill keeps it.
        "append" -> {
            FileOutputStream(file, true).use { it.write(text.toByteArray()) }
            ""
        }
        // The size cap's trim: the kept tail is written beside the log and renamed over it, so a kill leaves one whole file.
        "write" -> {
            val partial = File(file.parentFile, "${file.name}.partial")
            FileOutputStream(partial).use { out -> out.write(text.toByteArray()); out.fd.sync() }
            check(partial.renameTo(file)) { "Cannot replace the diagnostics log" }
            ""
        }
        "delete" -> when {
            file.isFile -> if (file.delete()) "1" else ""
            file.isDirectory -> { file.deleteRecursively(); "" }
            else -> ""
        }
        // A file core cannot read, past twice the cap: kept whole beside the log, replacing an older one; the next line starts anew.
        "moveAside" -> {
            val aside = File(file.parentFile, "${file.name}.unreadable")
            aside.delete()
            check(file.renameTo(aside)) { "Cannot move the diagnostics log aside" }
            ""
        }
        else -> throw IllegalArgumentException("Unknown log operation $operation")
    }
}
