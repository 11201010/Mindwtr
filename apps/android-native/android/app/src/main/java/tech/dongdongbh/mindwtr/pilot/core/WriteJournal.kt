package tech.dongdongbh.mindwtr.pilot.core

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * The write-ahead journal under the app's `files/journal`: every write request (a [WRITES] method and its exact arguments,
 * its request UUID included) is on disk before the engine sees it, and leaves only after core's final reply. After process
 * death or a stopped engine, the next boot replays what is left, in order (CoreHost.replayJournal); core's crash-safe
 * commands make a replay write nothing wrong. Engine thread only.
 *
 * An entry is one file, `<sequence>.json`: written whole to a temporary file, synced, renamed into place, and the directory
 * synced. A temporary file left by a death mid-write was never sent, so it is removed. An entry that cannot be read, or names
 * a method that is not a write, is moved to [ASIDE], never replayed and never deleted.
 */
class WriteJournal(
    private val dir: File,
    private val syncDirectory: (File) -> Unit = ::syncDirectory,
    private val log: (String) -> Unit = {},
) {
    companion object {
        /**
         * CoreHost's write methods: host-entry.ts's task commands, each answered through taskResult. check-boot-gates.mjs
         * keeps this list equal to host-entry's and to core's write commands.
         */
        val WRITES = setOf("captureSubmit", "captureLines", "capturePicker", "complete", "update", "saveDraft", "resetChecklist", "taskFocus", "projectFocus",
            "createProject", "setAreaFilter", "saveSearch", "inboxCommit", "inboxSkip", "menuCommand")
        /**
         * Writes never journaled: a key (the host method, or a Menu command's name) whose core command is in core's
         * NATIVE_UNJOURNALED_COMMANDS, a payload that can carry a secret. check-boot-gates.mjs keeps it equal to core's set.
         */
        val UNJOURNALED = emptySet<String>()
        const val ASIDE = "aside"
        private val NAME = Regex("""^(\d{16})\.json$""")
        private const val PARTIAL = ".tmp"

        /**
         * SAVE_FAILED keeps an entry: the write landed in memory only, and the owed retry (or the next boot) saves it. Every
         * other reply is final (a success, changed or not, STALE_REVISION, INVALID_INPUT, NOT_FOUND and other refusals).
         */
        fun keeps(error: String?): Boolean = error?.startsWith("SAVE_FAILED") == true
    }

    /** One journaled request: [text] is the file's exact contents, and two equal requests have equal texts. */
    class Entry(val file: File, val method: String, val args: List<Any>, val text: String)

    private val entries = ArrayList<Entry>()
    private var next = 1L

    init {
        dir.mkdirs()
        var partial = 0
        var aside = 0
        for (file in dir.listFiles().orEmpty().filter { it.isFile }.sortedBy { it.name }) {
            if (file.name.endsWith(PARTIAL)) {
                file.delete()
                partial += 1
                continue
            }
            val entry = NAME.matchEntire(file.name)?.let { runCatching { read(file) }.getOrNull() }
            if (entry == null) {
                moveAside(file)
                aside += 1
                continue
            }
            entries += entry
            next = maxOf(next, NAME.matchEntire(file.name)!!.groupValues[1].toLong() + 1)
        }
        log("Native Android journal open entries=${entries.size} aside=$aside partial=$partial")
    }

    /** The entries on disk, oldest first. */
    fun pending(): List<Entry> = entries.toList()

    /**
     * [method] with [args], durable before this returns; null for an [UNJOURNALED] write, which never reaches the disk. The
     * same request while its entry is still here (an owed retry) returns that entry: the journal never holds a request twice.
     */
    fun append(method: String, args: List<Any?>): Entry? {
        require(method in WRITES) { "$method is not a write" }
        if (key(method, args) in UNJOURNALED) return null
        val text = JSONObject().put("method", method).put("args", JSONArray().apply { args.forEach { put(requireNotNull(it)) } }).toString()
        entries.firstOrNull { it.text == text }?.let { return it }
        val file = File(dir, "%016d.json".format(next++))
        val partial = File(dir, file.name + PARTIAL)
        try {
            FileOutputStream(partial).use { out -> out.write(text.toByteArray()); out.fd.sync() }
            check(partial.renameTo(file)) { "Cannot save the write journal entry" }
        } catch (failure: Throwable) {
            partial.delete()
            throw failure
        }
        syncDirectory(dir)
        return Entry(file, method, args.map { it!! }, text).also { entries += it }
    }

    /** Core's final reply for [entry] ([error] null for a success): the entry goes, unless the reply [keeps] it. */
    fun settle(entry: Entry, error: String?) {
        if (keeps(error)) return
        entries.remove(entry)
        // A delete that fails leaves the entry for the next boot's replay, which core's crash-safe commands allow.
        if (!entry.file.delete() && entry.file.exists()) log("Native Android journal entry not deleted ${entry.file.name}")
    }

    private fun read(file: File): Entry? {
        val text = file.readText()
        val json = JSONObject(text)
        val method = json.getString("method")
        if (method !in WRITES) return null
        val array = json.getJSONArray("args")
        val args = List(array.length()) { array.get(it) }
        if (args.any { it !is String && it !is Boolean && it !is Int } || key(method, args) in UNJOURNALED) return null
        return Entry(file, method, args, text)
    }

    private fun key(method: String, args: List<Any?>): Any? = if (method == "menuCommand") args.firstOrNull() else method

    private fun moveAside(file: File) {
        val aside = File(dir, ASIDE).apply { mkdirs() }
        var target = File(aside, file.name)
        var copy = 1
        while (target.exists()) target = File(aside, "${file.name}.${copy++}")
        if (!file.renameTo(target)) log("Native Android journal entry not moved aside ${file.name}")
    }
}
