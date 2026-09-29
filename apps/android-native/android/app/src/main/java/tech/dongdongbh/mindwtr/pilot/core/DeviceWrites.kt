package tech.dongdongbh.mindwtr.pilot.core

import org.json.JSONArray

/**
 * A write's device-local part (core's deviceWrites: RN's device keys; a null value removes the key), each key kept with the
 * journal sequence of the write that set it, under "<key>@journal", in the same commit. A first send always applies; a journal
 * replay applies a key only when its entry is newer than the write that set the key last, so replaying an old entry (one whose
 * delete failed) never undoes a newer setting. [highestSequence] is the journal's floor: a new entry is numbered above it.
 */
class DeviceWrites(private val stored: () -> Map<String, *>, private val commit: (Map<String, String?>) -> Boolean) {
    companion object {
        const val SEQUENCE = "@journal"
    }

    /** [writes] from the write at journal [sequence] (null: not journaled, so no sequence is kept), on disk before this returns. */
    fun store(writes: JSONArray, sequence: Long?, replay: Boolean) {
        val now = stored()
        val changes = LinkedHashMap<String, String?>()
        for (write in List(writes.length()) { writes.getJSONObject(it) }) {
            val key = write.getString("key")
            if (replay && sequence != null && sequenceOf(now[key + SEQUENCE]) >= sequence) continue
            changes[key] = if (write.isNull("value")) null else write.getString("value")
            if (sequence != null) changes[key + SEQUENCE] = sequence.toString()
        }
        if (changes.isNotEmpty()) check(commit(changes)) { "Cannot store the device settings" }
    }

    fun highestSequence(): Long = stored().filterKeys { it.endsWith(SEQUENCE) }.values.maxOfOrNull(::sequenceOf) ?: 0

    private fun sequenceOf(value: Any?): Long = (value as? String)?.toLongOrNull() ?: 0
}
