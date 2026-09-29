package tech.dongdongbh.mindwtr.pilot

import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * The links, shares and assistant notes waiting to open (EntryPoints.kt), oldest first, in a file in the app's no-backup
 * folder: one line per entry, its id, a tab, and the entry's JSON (JSON escapes every line break). Each change goes to a
 * temporary file that is synced and renamed into place, so a process death leaves the queue as it was before or after the
 * change. An entry leaves only when its own id is removed, after its screen or popup opened. At most [limit] wait: a later
 * one is refused, so another app cannot grow the file without end.
 */
class EntryQueue(private val dir: File, private val limit: Int = 20) {
    data class Entry(val id: String, val input: String)

    private val file = File(dir, "queue")

    /** Every waiting entry, oldest first; a line that is not an entry (a damaged file) is skipped. */
    fun all(): List<Entry> = runCatching { if (file.exists()) file.readLines() else emptyList() }.getOrDefault(emptyList()).mapNotNull { line ->
        val tab = line.indexOf('\t')
        if (tab <= 0) null else Entry(line.substring(0, tab), line.substring(tab + 1))
    }

    fun head(): Entry? = all().firstOrNull()

    /** Adds [input] last, on disk before this returns. False (nothing added) when [limit] entries wait or [input] holds a line break. */
    fun add(input: String): Boolean {
        if ('\n' in input || '\r' in input) return false
        val entries = all()
        if (entries.size >= limit) return false
        write(entries + Entry(UUID.randomUUID().toString(), input))
        return true
    }

    /** Removes the entry [id] only; another entry with the same input stays. */
    fun remove(id: String) {
        val entries = all()
        val kept = entries.filterNot { it.id == id }
        if (kept.size != entries.size) write(kept)
    }

    private fun write(entries: List<Entry>) {
        dir.mkdirs()
        val partial = File(dir, "queue-partial")
        FileOutputStream(partial).use { out ->
            out.write(entries.joinToString("") { "${it.id}\t${it.input}\n" }.toByteArray())
            out.fd.sync()
        }
        check(partial.renameTo(file)) { "Cannot save the entry queue" }
    }
}

/**
 * Whether an entry stays queued after core's read of it failed: only core's refusal of the input itself (INVALID_INPUT: it can
 * never open) drops it; storage not ready, a save owed, or a timeout keeps it for another try.
 */
fun entryRetryable(message: String?): Boolean = message?.startsWith("INVALID_INPUT") != true
