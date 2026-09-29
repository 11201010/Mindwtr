package tech.dongdongbh.mindwtr.pilot

import android.app.Application
import android.util.Log
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import tech.dongdongbh.mindwtr.pilot.core.DiagnosticsLogFile
import tech.dongdongbh.mindwtr.pilot.core.HostIo
import tech.dongdongbh.mindwtr.pilot.core.HostNetwork
import tech.dongdongbh.mindwtr.pilot.core.LegacyRnStoreGuard
import tech.dongdongbh.mindwtr.pilot.core.RnKeyValue
import java.io.File
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
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
            File(app.filesDir, "journal"), deviceStore(app), File(app.filesDir, DiagnosticsLogFile.RELATIVE_PATH),
            RnKeyValue(app.getDatabasePath("RKStorage")))
        try {
            runtime.start(app.assets.open("core-host.js").bufferedReader().use { it.readText() }, legacy?.bootState ?: "", legacy?.backup ?: "")
            setLanguage(runtime, language ?: legacy?.language)
            loadTheme(runtime, legacy?.theme)
            if (replay(runtime)) startSync(app, runtime)
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
     * True once the replay finished (no entry owed): then sync may start.
     */
    private fun replay(runtime: CoreHost): Boolean {
        val replay = runtime.replayJournal()
        replay.owed?.let { recordFailure(PendingFailure(FailedAction("journal", ""), it, null)); return false }
        // Only once the journal is empty on disk: an entry whose delete did not reach the disk still needs its receipt. That
        // entry had its final reply, so the replay itself finished: sync may start.
        if (replay.left > 0) return true
        runCatching { runtime.pruneReceipts() }
            .onSuccess { Log.i(CoreHost.TAG, "Native Android receipts pruned=${it.optInt("pruned")}") }
            .onFailure { Log.w(CoreHost.TAG, "Native Android receipts prune failed", it) }
        return true
    }

    // ---- Sync (bundle/host-sync.ts: core's service and triggers decide every cycle) ----

    /** RN's AppState: "active" while MainActivity is resumed, else "background" (RN's onHostResume and onHostPause). */
    @Volatile private var appState = "background"
    /** Set once sync started; its app state and network changes go through [syncThread], in order. */
    @Volatile private var syncHost: CoreHost? = null
    private val syncThread = Executors.newSingleThreadExecutor { task -> Thread(task, "mindwtr-sync-events") }
    private val syncListeners = CopyOnWriteArraySet<(JSONObject) -> Unit>()
    /** The last sync badge and finished-cycle count (host-sync.ts's `sync` event), for a screen that opens later. */
    @Volatile var syncState: JSONObject? = null
        private set

    /** A screen's listener for the JS host's events (a `sync` state, an automatic sync's `toast`); called on the engine thread. */
    fun listenSync(listener: (JSONObject) -> Unit) = syncListeners.add(listener)
    fun unlistenSync(listener: (JSONObject) -> Unit) = syncListeners.remove(listener)

    private fun dispatch(event: JSONObject) {
        if (event.optString("type") == "sync") syncState = event
        syncListeners.forEach { runCatching { it(event) } }
    }

    /**
     * Sync starts only after the boot's validated load and a journal replay that finished with no entry owed (plan block 1: a
     * sync never runs before the replay finished); a replay that stopped starts it once its owed retry went through
     * ([journalReplayed]). The network state goes first, then core's triggers start and ask for the app's first sync. A failure
     * here never fails the boot: the app runs without automatic sync, and Settings › Sync still opens.
     */
    private fun startSync(app: Application, runtime: CoreHost) {
        if (syncHost != null) return
        runtime.onEvent = { text -> runCatching { dispatch(JSONObject(text)) } }
        runCatching {
            val network = HostNetwork(app) { state -> syncThread.execute { runCatching { runtime.syncNetwork(state) } } }
            runtime.syncNetwork(network.state())
            val startedWith = appState
            // An event that arrived while the triggers started is newer than this reply.
            runtime.syncStart(startedWith).put("type", "sync").let { reply -> if (syncState == null) syncState = reply }
            syncHost = runtime
            network.start()
            // Resumed or paused while the triggers started.
            appState.takeIf { it != startedWith }?.let { now -> syncThread.execute { runCatching { runtime.syncAppState(now) } } }
            Log.i(CoreHost.TAG, "Native Android sync started appState=$appState")
        }.onFailure { Log.w(CoreHost.TAG, "Native Android sync start failed", it) }
    }

    /** The owed journal retry went through: sync may start now, as after a clean boot replay. */
    fun journalReplayed(app: Application, runtime: CoreHost) = startSync(app, runtime)

    /** MainActivity resumed ("active") or paused ("background"): core's triggers sync on resume and on leaving. */
    fun appState(state: String) {
        if (state == appState) return
        appState = state
        val runtime = syncHost ?: return
        syncThread.execute { runCatching { runtime.syncAppState(state) }.onFailure { Log.w(CoreHost.TAG, "Native Android sync app state failed", it) } }
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
