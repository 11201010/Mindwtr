package tech.dongdongbh.mindwtr.pilot

import android.app.Application
import android.util.Log
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import tech.dongdongbh.mindwtr.pilot.core.LegacyRnStoreGuard
import java.io.File
import java.util.Locale
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
     * A failed command's exact retry, with the screen it failed on: the list
     * (Inbox, Focus, or Projects) and its rows, and the editor draft for a failed update.
     * It lives next to the host so a new screen in this process (the old one
     * finished) reopens on the same retry instead of a locked, empty list. In
     * memory only: after process death the saved capture draft and UUID, or the
     * saved editor draft and its base, cover retry.
     */
    data class PendingFailure(
        val action: FailedAction,
        val error: String,
        val rows: List<TaskRow>,
        val total: Int,
        val editor: TaskEditor? = null,
        val screen: Screen = Screen.Inbox,
        val focus: FocusView? = null,
        val projects: ProjectsView? = null,
        val project: ProjectDetail? = null,
    )

    @Volatile var failure: PendingFailure? = null
        private set

    /** A read's storage failure never replaces an owed command: that command's exact retry is what recovers. */
    @Synchronized fun recordFailure(pending: PendingFailure) {
        if (pending.action.kind == "storage" && failure?.action?.kind.let { it != null && it != "storage" }) return
        failure = pending
    }

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
        // Nothing opens the RN database until the guard passes; it returns files/SQLite/mindwtr.db
        // and what RN left in AsyncStorage, which the JS host imports as RN's next launch would.
        val legacy = if (BuildConfig.RN_STORAGE) {
            LegacyRnStoreGuard.requireClear(app.dataDir, File(app.cacheDir, "legacy-rn-guard"))
        } else {
            null
        }
        val runtime = CoreHost(legacy?.database ?: File(app.filesDir, "mindwtr-native-dev.db"), legacy?.let { app.dataDir })
        try {
            runtime.start(app.assets.open("core-host.js").bufferedReader().use { it.readText() }, legacy?.bootState ?: "", legacy?.backup ?: "")
            setLanguage(runtime, legacy?.language)
            return runtime
        } catch (failure: Throwable) {
            runCatching { runtime.close() }
            throw failure
        }
    }

    /** Core's setLanguage, then the label map read again in that language. Screens render only after this. */
    private fun setLanguage(runtime: CoreHost, stored: String?) {
        runtime.language(stored ?: "", Locale.getDefault().toLanguageTag())
        Labels.load(runtime.strings(LABEL_KEYS))
    }

    fun logHostReuse(reason: String, attaches: Int, inFlight: Boolean) {
        Log.i(CoreHost.TAG, "Native Android host reuse releaseCheck=v1.3.3/native-android-dev-host-reuse " +
            "reason=$reason activityAttach=$attaches inFlight=$inFlight boots=$boots")
    }
}
