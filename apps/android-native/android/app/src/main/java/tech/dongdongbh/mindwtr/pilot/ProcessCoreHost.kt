package tech.dongdongbh.mindwtr.pilot

import android.app.Application
import android.util.Log
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import tech.dongdongbh.mindwtr.pilot.core.LegacyRnStoreGuard
import java.io.File
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask

/**
 * The one CoreHost of this process.
 *
 * Activities and ViewModels never close it. Process death is the only
 * shutdown: WAL with `synchronous = FULL` makes every acknowledged write
 * durable without a clean close. Two hosts on one database would reject each
 * other's writes, so recreation must reuse this one.
 */
internal object ProcessCoreHost {
    private var boot: FutureTask<CoreHost>? = null
    @Volatile private var boots = 0

    /**
     * A failed command's exact retry, with the screen it failed on (and the
     * editor draft, for a failed update). It lives next to the host so a new
     * screen in this process (the old one finished) reopens on the same retry
     * instead of a locked, empty Inbox. In memory only: after process death the
     * saved capture draft and UUID, or the saved editor draft and its base,
     * cover retry.
     */
    data class PendingFailure(
        val action: FailedAction,
        val error: String,
        val rows: List<InboxRow>,
        val total: Int,
        val editor: TaskEditor? = null,
    )

    @Volatile var failure: PendingFailure? = null
        private set

    @Synchronized fun recordFailure(pending: PendingFailure) { failure = pending }

    /** Called only after [action] itself succeeds. */
    @Synchronized fun clearFailure(action: FailedAction) {
        if (failure?.action == action) failure = null
    }

    /** Blocks until the shared boot finishes. Call off the main thread. */
    fun get(app: Application): CoreHost {
        var starter = false
        val task = synchronized(this) {
            boot ?: FutureTask { start(app) }.also {
                boot = it
                boots += 1
                starter = true
                Log.i(CoreHost.TAG, "Core host boot started boot=$boots")
            }
        }
        if (starter) task.run()
        val host = try {
            task.get()
        } catch (failure: ExecutionException) {
            // A failed boot is not cached: the next new screen may boot again.
            synchronized(this) { if (boot === task) boot = null }
            throw failure.cause ?: failure
        }
        if (!starter) logHostReuse("new-screen", attaches = 1, inFlight = false)
        return host
    }

    private fun start(app: Application): CoreHost {
        val database = if (BuildConfig.RN_STORAGE) {
            // Nothing opens the RN database until the guard passes; it returns files/SQLite/mindwtr.db.
            LegacyRnStoreGuard.requireClear(app.dataDir, File(app.cacheDir, "legacy-rn-guard"))
        } else {
            File(app.filesDir, "mindwtr-native-dev.db")
        }
        val runtime = CoreHost(database)
        try {
            runtime.start(app.assets.open("core-host.js").bufferedReader().use { it.readText() })
            return runtime
        } catch (failure: Throwable) {
            runCatching { runtime.close() }
            throw failure
        }
    }

    fun logHostReuse(reason: String, attaches: Int, inFlight: Boolean) {
        Log.i(CoreHost.TAG, "Native Android host reuse releaseCheck=v1.3.3/native-android-dev-host-reuse " +
            "reason=$reason activityAttach=$attaches inFlight=$inFlight boots=$boots")
    }
}
