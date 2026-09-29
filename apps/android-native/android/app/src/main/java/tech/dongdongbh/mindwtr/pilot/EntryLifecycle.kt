package tech.dongdongbh.mindwtr.pilot

/**
 * EntryRouter's decisions about the [queue], apart from Android so JVM tests drive them: which entry core reads now (one at a
 * time, the oldest, never while work is open or a failed read waits), how long a failed read waits before the next try, and
 * when an entry leaves: only after its screen or popup opened, or after core refused its input. [now] is the clock (uptime).
 * Main thread only.
 */
class EntryLifecycle(private val queue: EntryQueue, private val now: () -> Long) {
    sealed interface Failure {
        /** Keep the entry; read it again after [delayMs]. */
        data class Retry(val delayMs: Long) : Failure
        /** Core refused the input itself: it can never open, and has left the queue. */
        data object Refused : Failure
    }

    /** The entry core is reading, or whose screen waits to open. */
    private var reading: String? = null
    private var retryAt = 0L
    private var failures = 0

    /** The oldest waiting entry's id. */
    val head: String? get() = queue.head()?.id

    /** The entry core reads now, marked as read; null while none waits, one is being read, work is open, or a failed read waits. */
    fun next(blocked: Boolean): EntryQueue.Entry? {
        val entry = queue.head() ?: return null
        if (reading != null || blocked || now() < retryAt) return null
        reading = entry.id
        return entry
    }

    /** Its screen or popup opened: now the entry leaves, and the wait after failures starts over. */
    fun opened(entry: EntryQueue.Entry) {
        reading = null
        failures = 0
        retryAt = 0L
        queue.remove(entry.id)
    }

    /** Work opened before its screen could: the entry stays, and is read again once that work ends. */
    fun deferred(entry: EntryQueue.Entry) {
        if (reading == entry.id) reading = null
    }

    /** Core's read failed with [message]: kept with a wait that doubles from 5 s up to a minute, or gone when core refused the input. */
    fun failed(entry: EntryQueue.Entry, message: String?): Failure {
        reading = null
        if (entryRetryable(message)) {
            failures += 1
            val delay = minOf(MAX_WAIT_MS, FIRST_WAIT_MS shl minOf(failures - 1, 4))
            retryAt = now() + delay
            return Failure.Retry(delay)
        }
        queue.remove(entry.id)
        return Failure.Refused
    }

    private companion object {
        const val FIRST_WAIT_MS = 5_000L
        const val MAX_WAIT_MS = 60_000L
    }
}
