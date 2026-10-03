package tech.dongdongbh.mindwtr.pilot.core

import java.io.IOException
import java.util.concurrent.Executor

/**
 * Where HostIo runs the attachment file port's calls. One that reads a picked document (a `content://` source) runs on a daemon
 * thread of its own, so a provider stuck in open() or a read holds only that call, never the shared [queue]; every other call
 * runs on [queue], one at a time in call order (a managed delete's barrier waits on those). [abort] (the call's operation passed
 * its deadline) keeps a call not yet started from running and ends a running one's document read ([abortReader]); a thread still
 * stuck in open() is abandoned, and its stream is closed once open() returns (HostFiles.abortRead).
 */
internal class FileJobs(
    private val queue: Executor,
    private val abortReader: (Thread) -> Unit,
    private val readDone: (Thread) -> Unit,
) {
    private val lock = Any()
    private val running = HashMap<String, Thread>()
    private val aborted = HashSet<String>()

    fun <T> start(id: String, readsDocument: Boolean, compute: () -> T, deliver: (Result<T>) -> Unit) {
        val job = Runnable {
            val thread = Thread.currentThread()
            val result = runCatching {
                synchronized(lock) {
                    if (aborted.remove(id)) throw IOException("Request cancelled")
                    running[id] = thread
                }
                compute()
            }
            synchronized(lock) { running.remove(id) }
            readDone(thread)
            deliver(result)
        }
        if (readsDocument) Thread(job, "mindwtr-document-$id").apply { isDaemon = true }.start() else queue.execute(job)
    }

    fun abort(id: String) = synchronized(lock) {
        running[id]?.let(abortReader) ?: aborted.add(id)
        Unit
    }

    companion object {
        /** A call whose source is a picked document (its request names a `content://` uri; the request is JS's JSON). */
        fun readsPickedDocument(json: String) = "\"uri\":\"content:" in json
    }
}
