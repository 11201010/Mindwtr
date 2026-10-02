package tech.dongdongbh.mindwtr.pilot

/**
 * The start order after a journal replay that left nothing owed (ProcessCoreHost.recovered): the pending-captures drain, then
 * sync. A drain that did not finish, whatever its failure (owed, items left queued, storage, a timeout), holds the rest back:
 * it becomes the screens' owed "journal" retry (no editable data), sync waits, and CoreWork retries it. A widget check-off sweep
 * that failed holds nothing back (the store is whole): only CoreWork retries it. JVM-tested (StartOrderTest).
 */
internal object StartOrder {
    /** What one drain did. */
    sealed interface Drain {
        /** The queue is drained (or empty). */
        data object Done : Drain
        /** Another command's retry is owed; that retry comes first and is not replaced. */
        data object Waiting : Drain
        /** The drain failed with [message] (core's code first). */
        data class Failed(val message: String) : Drain
        /**
         * The queue is drained (or empty), but RN's widget check-offs did not all go into it (CheckoffStore.sweep failed): the
         * store is whole, so the screens and sync go on, as in RN, and CoreWork sweeps and drains again with its back-off.
         */
        data object Unswept : Drain
    }

    fun afterReplay(drain: () -> Drain, owe: (String) -> Unit, retryLater: () -> Unit, startSync: () -> Unit): Boolean {
        when (val result = drain()) {
            Drain.Done -> {
                startSync()
                return true
            }
            Drain.Unswept -> {
                startSync()
                retryLater()
            }
            Drain.Waiting -> retryLater()
            is Drain.Failed -> {
                owe(result.message)
                retryLater()
            }
        }
        return false
    }
}
