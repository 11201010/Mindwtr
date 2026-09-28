package tech.dongdongbh.mindwtr.pilot

import android.app.Application
import android.util.Log
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import tech.dongdongbh.mindwtr.pilot.core.HostIo
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
     * A failed command's exact retry, with the screen it failed on: the tab
     * (Inbox, Focus, or Projects) and its lists (the open Menu or Inbox list's page, Focus,
     * Projects), and the editor draft for a failed update.
     * It lives next to the host so a new screen in this process (the old one
     * finished) reopens on the same retry instead of a locked, empty list. In
     * memory only: after process death the saved capture draft and UUID, or the
     * saved editor draft and its base, cover retry.
     */
    data class PendingFailure(
        val action: FailedAction,
        val error: String,
        val menuPage: MenuPage?,
        val editor: TaskEditor? = null,
        val screen: Screen = Screen.Inbox,
        val focus: FocusView? = null,
        val projects: ProjectsView? = null,
        val project: ProjectDetail? = null,
        val areas: AreaFilter? = null,
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

    /**
     * Blocks until the shared boot finishes. Call off the main thread. [language] is the language chosen in this app's
     * Settings (RN's device key), if any: the boot that starts here sets it before the journal replay, so a replayed
     * request (a capture's words) is read in the language it was written in.
     */
    fun get(app: Application, language: String? = null): CoreHost {
        var starter = false
        val task = synchronized(this) {
            boot ?: FutureTask { start(app, language) }.also {
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

    private fun start(app: Application, language: String?): CoreHost {
        // Nothing opens the RN database until the guard passes; it returns files/SQLite/mindwtr.db
        // and what RN left in AsyncStorage, which the JS host imports as RN's next launch would.
        val legacy = if (BuildConfig.RN_STORAGE) {
            LegacyRnStoreGuard.requireClear(app.dataDir, File(app.cacheDir, "legacy-rn-guard"))
        } else {
            null
        }
        val runtime = CoreHost(legacy?.database ?: File(app.filesDir, "mindwtr-native-dev.db"), legacy?.let { app.dataDir }, HostIo(app),
            File(app.filesDir, "journal"))
        try {
            runtime.start(app.assets.open("core-host.js").bufferedReader().use { it.readText() }, legacy?.bootState ?: "", legacy?.backup ?: "")
            setLanguage(runtime, language ?: legacy?.language)
            loadTheme(runtime, legacy?.theme)
            replay(runtime)
            return runtime
        } catch (failure: Throwable) {
            runCatching { runtime.close() }
            throw failure
        }
    }

    /**
     * The write journal's replay: after the validated load, before this boot hands the host to any screen or entry point
     * (get() waits for it). A replay stopped by an owed save leaves that entry, and every screen opens on its exact retry
     * (InboxViewModel.retryOwed, kind "journal"), as for any owed command. Only a replay that left nothing prunes core's old
     * receipts, so an entry never outlives the receipt its replay needs; a failed prune only logs (the next boot prunes).
     */
    private fun replay(runtime: CoreHost) {
        val owed = runtime.replayJournal().owed
        if (owed != null) return recordFailure(PendingFailure(FailedAction("journal", ""), owed, null))
        runCatching { runtime.pruneReceipts() }
            .onSuccess { Log.i(CoreHost.TAG, "Native Android receipts pruned=${it.optInt("pruned")}") }
            .onFailure { Log.w(CoreHost.TAG, "Native Android receipts prune failed", it) }
    }

    /** Core's setLanguage, then the label map read again in that language. Screens render only after this. */
    private fun setLanguage(runtime: CoreHost, stored: String?) {
        runtime.language(stored ?: "", Locale.getDefault().toLanguageTag())
        Labels.load(runtime.strings(LABEL_KEYS))
    }

    /** RN's theme as core resolves it. The theme is cosmetic: a failed read keeps RN's default look. */
    private fun loadTheme(runtime: CoreHost, stored: String?) {
        runCatching { ThemeChoice.load(runtime.theme(stored ?: "")) }
            .onFailure { Log.w(CoreHost.TAG, "Native Android theme read failed; using the default theme", it) }
    }

    fun logHostReuse(reason: String, attaches: Int, inFlight: Boolean) {
        Log.i(CoreHost.TAG, "Native Android host reuse releaseCheck=v1.3.3/native-android-dev-host-reuse " +
            "reason=$reason activityAttach=$attaches inFlight=$inFlight boots=$boots")
    }
}
