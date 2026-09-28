package tech.dongdongbh.mindwtr.pilot.core

import android.icu.text.Collator
import android.icu.text.RuleBasedCollator
import android.icu.util.ULocale
import android.util.Log
import com.whl.quickjs.android.QuickJSLoader
import com.whl.quickjs.wrapper.JSCallFunction
import com.whl.quickjs.wrapper.JSFunction
import com.whl.quickjs.wrapper.JSObject
import com.whl.quickjs.wrapper.QuickJSContext
import org.json.JSONArray
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.BuildConfig
import java.io.File
import java.security.SecureRandom
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * QuickJS and SQLite share one worker thread; Compose never enters either runtime.
 * [rnDataDir] is set only when [databaseFile] is the React Native app's database:
 * then the JS host may apply RN's AsyncStorage change after it imported RN's backup.
 * [io] runs the JS host's fetch and secret calls off this thread; their answers come back in [callAsync]'s pump loop.
 */
class CoreHost(private val databaseFile: File, private val rnDataDir: File? = null, private val io: HostIo, private val journalDir: File) {
    companion object {
        const val TAG = "MindwtrNativeDev"
        /** Must match NATIVE_ERROR in bundle/host-entry.ts. */
        private const val NATIVE_ERROR = "!MindwtrNativeError:"

        /**
         * An operation's deadline: the longest core timeout it can wrap. A contract read or command waits at most on core's
         * storage (STORAGE_TIMEOUT_MS, 15 s), inside core's request timeout (DEFAULT_TIMEOUT_MS, 30 s).
         */
        const val OPERATION_DEADLINE_MS = 30_000L
        /** An operation that sends requests: HostIo's ceiling for one request, plus core's 30 s for the work around it. */
        const val NETWORK_DEADLINE_MS = HostIo.CALL_TIMEOUT_MS + OPERATION_DEADLINE_MS
        /** How long a timed-out operation may take to end once cancelled, before the host stops for good. */
        const val DRAIN_MS = 10_000L

        /**
         * A Kotlin exception must not cross the QuickJS JNI boundary: the
         * wrapper keeps calling JNI with it pending and the process aborts.
         * Return it as a marked string; host-entry.ts throws it inside JS.
         */
        private fun guarded(work: (Array<out Any?>) -> Any?) = JSCallFunction { args ->
            try { work(args) } catch (error: Throwable) { NATIVE_ERROR + (error.message ?: error.javaClass.simpleName) }
        }
        init { QuickJSLoader.init() }
    }

    private val lifecycleLock = Any()
    private var shutdown: Future<*>? = null
    private val random = SecureRandom()
    private val startedAt = System.nanoTime()
    private var context: QuickJSContext? = null
    private var sqlite: SqliteBridge? = null
    /** The write-ahead journal (WriteJournal), opened at start on this thread. */
    private var journal: WriteJournal? = null
    private val functions = HashMap<String, JSFunction>()
    /** Set when an operation outlived its deadline and its drain. The engine is gone, so that operation never resumes. */
    @Volatile private var stopped: String? = null
    /** ICU collators by "sensitivity:numeric", made and used on the engine thread only. */
    private val collators = HashMap<String, Collator>()
    private var hostObject: JSObject? = null
    @Volatile private var engineThread: Thread? = null
    private val executor = Executors.newSingleThreadExecutor { task ->
        Thread(task, "mindwtr-core").also { engineThread = it }
    }

    private fun <T> onEngine(work: () -> T): T {
        if (Thread.currentThread() === engineThread) return work()
        val task = synchronized(lifecycleLock) {
            check(shutdown == null) { "Core host is closed" }
            executor.submit(Callable { work() })
        }
        // Rethrow the engine's own exception: callers match "SAVE_FAILED" on its message.
        return try { task.get() } catch (failure: ExecutionException) { throw failure.cause ?: failure }
    }

    private fun call(method: String, vararg args: Any?): Any? = onEngine {
        val engine = checkNotNull(context)
        val host = hostObject ?: engine.globalObject.getJSObject("MindwtrHost").also { hostObject = it }
        functions.getOrPut(method) { host.getJSFunction(method) }.call(*args)
    }

    /** [legacyState] and [legacyBackup] come from LegacyRnStoreGuard; both are "" for the dev database. */
    fun start(bundle: String, legacyState: String = "", legacyBackup: String = ""): JSONObject = onEngine {
        try {
            journal = WriteJournal(journalDir, log = { Log.i(TAG, it) })
            val engine = QuickJSContext.create()
            context = engine
            val database = SqliteBridge(databaseFile)
            sqlite = database
            database.ensureRecoveryCheckpoint()
            val bridge = engine.createNewJSObject()
            bridge.setProperty("sqlRun", guarded { args -> database.run(args[0] as String, args[1] as String); null })
            bridge.setProperty("sqlAll", guarded { args -> database.all(args[0] as String, args[1] as String) })
            bridge.setProperty("sqlExec", guarded { args -> database.exec(args[0] as String); null })
            bridge.setProperty("nowMs", guarded { _ -> (System.nanoTime() - startedAt) / 1e6 })
            bridge.setProperty("randomBytes", guarded { args ->
                val length = (args[0] as Number).toInt()
                require(length in 0..65_536) { "Invalid random byte count" }
                JSONArray().also { out ->
                    ByteArray(length).also(random::nextBytes).forEach { out.put(it.toInt() and 0xff) }
                }.toString()
            })
            // `{ clearJsonAhead, setReconciled }`, decided by core's planLegacyJsonImport after the saved import is read back.
            bridge.setProperty("rnStateCommit", guarded { args ->
                val change = JSONObject(args[0] as String)
                LegacyRnStoreGuard.commitRnState(checkNotNull(rnDataDir) { "No React Native state in this build" },
                    change.getBoolean("clearJsonAhead"), change.getBoolean("setReconciled"))
                null
            })
            // QuickJS has no Intl: the host's Intl.Collator and localeCompare sort by these ICU collation keys, from the device
            // locale's collator as Hermes uses on Android, so titles order as in RN ("éclair" before "Zoo"). The key's bytes
            // become chars 1-255 (the trailing 0 dropped), so comparing two keys as strings compares them as ICU does.
            bridge.setProperty("collationKey", guarded { args ->
                val options = args[1] as String
                val collator = collators.getOrPut(options) {
                    val (sensitivity, numeric) = options.split(':')
                    Collator.getInstance(ULocale.getDefault()).apply {
                        strength = when (sensitivity) { "base", "case" -> Collator.PRIMARY; "accent" -> Collator.SECONDARY; else -> Collator.TERTIARY }
                        (this as? RuleBasedCollator)?.let { rules ->
                            rules.isCaseLevel = sensitivity == "case"
                            rules.numericCollation = numeric == "1"
                        }
                        freeze()
                    }
                }
                val bytes = collator.getCollationKey(args[0] as String).toByteArray()
                String(CharArray(bytes.size - 1) { (bytes[it].toInt() and 0xff).toChar() })
            })
            // A diagnostic line must never fail the caller: coerce and swallow.
            bridge.setProperty("log", guarded { args -> runCatching { Log.i(TAG, args.getOrNull(0).toString()) }; null })
            // fetch and the secret calls (host-polyfills.js): each only starts here; HostIo runs it off this thread and
            // queues its answer, and the polyfill settles it when the pump loop below takes that answer with ioNext.
            bridge.setProperty("netFetch", guarded { args -> io.fetch(args[0] as String) })
            bridge.setProperty("netAbort", guarded { args -> io.abort(args[0] as String); null })
            bridge.setProperty("secretCall", guarded { args -> io.secret(args[0] as String) })
            bridge.setProperty("ioNext", guarded { _ -> io.next() })
            bridge.setProperty("ioBody", guarded { _ -> io.body() })
            engine.globalObject.setProperty("__mindwtrNative", bridge)
            engine.evaluate(bundle, "core-host.js")
            callAsync("boot", legacyState, legacyBackup).also { netCheck() }
        } catch (error: Throwable) {
            closeOnEngine()
            throw error
        }
    }

    /**
     * Core's getFocus: its sections in its order, the first [limit] rows of each, for the control state [controls] (JSON; ""
     * reads the flat Focus) after a control's [controlEdit] (JSON, or "").
     */
    fun focus(limit: Int, controls: String = "", controlEdit: String = ""): JSONObject = callAsync("focus", limit, controls, controlEdit)

    /** Core's getFocusSectionWindow for the same [controls]. A changed Focus fails with "STALE_REVISION: …". */
    fun focusWindow(key: String, offset: Int, limit: Int, revision: String, controls: String = ""): JSONObject =
        callAsync("focusWindow", key, offset, limit, revision, controls)

    /** Core's openQuickCapture: the popup's empty draft and its starting options. */
    fun openQuickCapture(): JSONObject = callAsync("captureOpen")

    /** Core's getQuickCaptureView with [json] (`{ text, options, picker? }`) unchanged. */
    fun quickCaptureView(json: String): JSONObject = callAsync("captureView", json)

    /** Core's editQuickCapture with [json] (`{ text, options, edit, picker? }`) unchanged. */
    fun editQuickCapture(json: String): JSONObject = callAsync("captureEdit", json)

    /** Core's submitQuickCapture with [json] unchanged; its captureId makes a retry exact. */
    fun submitQuickCapture(json: String): JSONObject = callAsync("captureSubmit", json)

    /** Core's createQuickCaptureSnapshot, as `{ snapshot: { fileName, contents } | null }`. */
    fun createQuickCaptureSnapshot(): JSONObject = callAsync("captureSnapshot")

    /** Core's submitQuickCaptureLines with [json] unchanged; one capture ID per line. */
    fun submitQuickCaptureLines(json: String): JSONObject = callAsync("captureLines", json)

    /** Core's submitQuickCapturePickerQuery with [json] unchanged; its requestId makes a create's retry exact. */
    fun submitQuickCapturePickerQuery(json: String): JSONObject = callAsync("capturePicker", json)

    /** Core's completeTask; [taskRevision] is the row's: a task changed since is refused (STALE_REVISION). */
    fun completeTask(id: String, taskRevision: String): JSONObject = callAsync("complete", id, taskRevision)

    /** Core's setTaskFocus to the target [focused], at the row's [taskRevision]. A reply with `blocked` wrote nothing. */
    fun setTaskFocus(id: String, focused: Boolean, taskRevision: String): JSONObject = callAsync("taskFocus", id, focused, taskRevision)

    /** Core's setProjectFocus to the target [focused], at the row's [projectRevision]. `{ blocked: "" }` wrote nothing. */
    fun setProjectFocus(id: String, focused: Boolean, projectRevision: String): JSONObject = callAsync("projectFocus", id, focused, projectRevision)

    /** Core's createProject; [areaId] "" is no area, and [requestId] is kept for the exact retry. */
    fun createProject(title: String, areaId: String, requestId: String): JSONObject =
        callAsync("createProject", title, areaId, requestId)

    /** Core's getAreaFilter: the trigger label, the summary, and each option with its `next` selection. */
    fun areaFilter(): JSONObject = callAsync("areaFilter")

    /** Core's setAreaFilter with one of getAreaFilter's `next` selections, unchanged. */
    fun setAreaFilter(selectionJson: String): JSONObject = callAsync("setAreaFilter", selectionJson)

    /** Core's searchTasks with [json] (`{ query, filters, limit }`) unchanged. */
    fun searchTasks(json: String): JSONObject = callAsync("search", json)

    /** Core's saveSearch with [json] (`{ query, name, requestId }`) unchanged. */
    fun saveSearch(json: String): JSONObject = callAsync("saveSearch", json)

    /** Core's startInboxProcessing in [mode] ('guided' or 'quick'). */
    fun startInboxProcessing(mode: String): JSONObject = callAsync("inboxStart", mode)

    /** Core's getInboxProcessingStep with [json] unchanged: one edit or a mode, for the step on screen. */
    fun inboxProcessingStep(json: String): JSONObject = callAsync("inboxStep", json)

    /** Core's commitInboxProcessingStep with [json] unchanged; its requestId makes a retry exact. */
    fun commitInboxProcessingStep(json: String): JSONObject = callAsync("inboxCommit", json)

    /** Core's skipInboxProcessingTask with [json] unchanged. */
    fun skipInboxProcessingTask(json: String): JSONObject = callAsync("inboxSkip", json)

    /** Core's endInboxProcessing; it writes nothing. */
    fun endInboxProcessing(sessionId: String): JSONObject = callAsync("inboxEnd", sessionId)

    /** A Menu tab read (host-entry.ts MENU_READS: the More sheet, the lists, their collections) with [json], its input, unchanged. */
    fun menuRead(name: String, json: String): JSONObject = callAsync("menuRead", name, json)

    /** A Menu tab command (host-entry.ts MENU_COMMANDS) with [json] unchanged; its request or capture UUID makes a retry exact. */
    fun menuCommand(name: String, json: String): JSONObject = callAsync("menuCommand", name, json)

    /** Core's getTaskEditorModel for one task: its draft, the fields to show by section, and each field's choices. */
    fun taskEditorModel(id: String): JSONObject = callAsync("editorModel", id)

    /**
     * Core's editTaskDraft: the editor model for [draftJson] after one control's edit ([editJson], "" for none), laid out for the
     * editor's own checklist ([checklistJson], unsaved items included; "" for the saved one).
     * It writes nothing; the editor saves the returned draft with saveTaskDraft.
     */
    fun editTaskDraft(id: String, draftJson: String, editJson: String, checklistJson: String = ""): JSONObject =
        callAsync("editDraft", JSONObject().put("id", id).put("draft", JSONObject(draftJson))
            .apply { if (editJson.isNotEmpty()) put("edit", JSONObject(editJson)) }
            .apply { if (checklistJson.isNotEmpty()) put("checklist", JSONArray(checklistJson)) }.toString())

    /** Core's getTaskView with [json] (`{ id, draft?, checklist?, offset?, limit?, revision? }`) unchanged: RN's View tab. */
    fun taskView(json: String): JSONObject = callAsync("taskView", json)

    /**
     * Core's editTaskChecklist: one checklist edit ([editJson], "" for none: the Form tab's field as it is) on [draftJson] and
     * [checklistJson]. It writes nothing; saveTaskDraft saves the checklist with the draft.
     */
    fun editTaskChecklist(id: String, draftJson: String, checklistJson: String, editJson: String): JSONObject =
        callAsync("editChecklist", JSONObject().put("id", id).put("draft", JSONObject(draftJson)).put("checklist", JSONArray(checklistJson))
            .apply { if (editJson.isNotEmpty()) put("edit", JSONObject(editJson)) }.toString())

    /**
     * Core's resetTaskChecklist, written at once; [requestId] makes a retry only finish a failed save, and [taskRevision] (getTaskView's)
     * refuses a task changed since (STALE_REVISION).
     */
    fun resetTaskChecklist(id: String, requestId: String, taskRevision: String): JSONObject =
        callAsync("resetChecklist", JSONObject().put("id", id).put("requestId", requestId).put("taskRevision", taskRevision).toString())

    /** Core's getTaskEditorSuggestions for a context, tag, or person input's whole text as typed. */
    fun editorSuggestions(id: String, field: String, query: String, limit: Int): JSONObject =
        callAsync("editorSuggestions", id, field, query, limit)

    /**
     * [baseJson], [patchJson] and [checklistJson] (`{ base, value }`, "" when the checklist is unchanged) go to core's saveTaskDraft
     * unchanged, in one write; core decides everything. [requestId] makes a repeat answer the first reply (core's receipt).
     */
    fun saveTaskDraft(id: String, baseJson: String, patchJson: String, checklistJson: String, requestId: String): JSONObject =
        callAsync("saveDraft", JSONObject().put("id", id).put("base", JSONObject(baseJson)).put("patch", JSONObject(patchJson))
            .apply { if (checklistJson.isNotEmpty()) put("checklist", JSONObject(checklistJson)) }.put("requestId", requestId).toString())

    /**
     * The status menu and the Restore and Next swipes: [baseJson] and [patchJson] go to core's updateTask unchanged, with the
     * request's [requestId].
     */
    fun updateTask(id: String, baseJson: String, patchJson: String, requestId: String): JSONObject =
        callAsync("update", JSONObject().put("id", id).put("base", JSONObject(baseJson)).put("patch", JSONObject(patchJson))
            .put("requestId", requestId).toString())

    /** Core's receipts older than 30 days go; ProcessCoreHost calls it once, after a boot replay that left no entry. */
    fun pruneReceipts(): JSONObject = callAsync("pruneReceipts")

    /**
     * Core's setLanguage: [stored] is RN's saved language ("" for none), [system] the device locale tag.
     * A debug build lets `debug.mindwtr.native.language` replace [stored] for the language check.
     */
    fun language(stored: String, system: String): JSONObject =
        callAsync("language", debugFault("language").ifEmpty { stored }, system)

    /** Core's getStrings for [keys], in the language core chose. */
    fun strings(keys: List<String>): JSONObject = callAsync("strings", JSONArray(keys).toString())

    /** RN's theme as core resolves it: [stored] is RN's device-local `@mindwtr_theme` ("" for none). */
    fun theme(stored: String): JSONObject = callAsync("theme", stored)

    /** Core's General row for RN's app lock (its `value` is the stored setting); an owed save does not block it. */
    fun appLock(): JSONObject = callAsync("appLock")

    /** Core's getProjects: its Active, Deferred, and Archived groups in its order. */
    fun projects(): JSONObject = callAsync("projects")

    /** Core's getProjectDetail. A changed project fails with "STALE_REVISION: …". */
    fun projectDetail(id: String, offset: Int, limit: Int, revision: String): JSONObject =
        callAsync("projectDetail", id, offset, limit, revision)

    /**
     * Debug-build fault injection for the device checks, and the language override at boot.
     * Read once per task command, on the engine thread. Release builds return
     * "" before reading anything, so no property can reach them.
     */
    private fun debugFault(name: String): String = debugProperty(name)

    /**
     * Debug builds only: with `debug.mindwtr.native.net_check=<port>`, core's WebDAV calls and the secret calls run against
     * check-net-device.mjs's server on 127.0.0.1:<port> (adb reverse) once, after boot, and log their outcomes.
     */
    private fun netCheck() {
        val port = debugFault("net_check").ifEmpty { return }
        runCatching { callAsync("netCheck", port, deadlineMs = NETWORK_DEADLINE_MS) }
            .onSuccess { Log.i(TAG, "Native Android net check $it") }
            .onFailure { Log.w(TAG, "Native Android net check failed", it) }
        // Operations past a short deadline: "drain" ends once cancelled; "stuck" cannot, so the host stops and this boot fails.
        for (mode in listOf("drain", "stuck")) {
            runCatching { callAsync("netDeadline", port, mode, deadlineMs = 1_500L) }
                .onFailure { Log.i(TAG, "Native Android net deadline $mode: ${it.message}") }
        }
    }

    private fun debugDelay(name: String) {
        val ms = debugFault(name).toLongOrNull() ?: return
        if (ms > 0) Thread.sleep(minOf(ms, 60_000L))
    }

    /**
     * Every host call. A write ([WriteJournal.WRITES]) is on disk in the journal before the engine sees it, and core's reply
     * settles it: a final reply drops it, SAVE_FAILED keeps it for the owed retry, and no reply (a timeout, a stopped engine,
     * process death) keeps it for the next boot's replay.
     */
    private fun callAsync(method: String, vararg args: Any?, deadlineMs: Long = OPERATION_DEADLINE_MS): JSONObject = onEngine {
        stopped?.let { throw IllegalStateException(it) }
        val entry = if (method in WriteJournal.WRITES) checkNotNull(journal).append(method, args.toList()) else null
        val stop = if (entry != null) debugFault("journal_stop") else ""
        if (entry != null) {
            checkNotNull(sqlite).failCommits = debugFault("fail_commit") == "1"
            debugDelay("delay_before_ms")
            journalStop(stop, "before", entry)
        }
        val result = answer(method, args, deadlineMs)
        if (entry != null) {
            debugDelay("delay_after_ms")
            journalStop(stop, "after", entry)
            checkNotNull(journal).settle(entry, result.error())
        }
        if (!result.getBoolean("ok")) throw IllegalStateException(result.getString("error"))
        result.getJSONObject("value")
    }

    /** Operation [method]'s reply, `{ ok, value }` or `{ ok: false, error }`; one past [deadlineMs] is cancelled and throws. */
    private fun answer(method: String, args: Array<out Any?>, deadlineMs: Long): JSONObject {
        val id = call(method, *args) as String
        val answer = pumpUntil(id, deadlineMs) ?: run {
            // Past its deadline: its signal fires, its fetches reject and new host calls are refused, so it ends now, before
            // the failure is reported. One that still has not ended stops the host: no JS runs again, so it never resumes.
            call("cancel", id)
            if (pumpUntil(id, DRAIN_MS) == null) {
                val reason = "Core host stopped: $method did not end after its deadline"
                stopped = reason
                Log.e(TAG, reason)
                closeOnEngine()
                throw IllegalStateException(reason)
            }
            checkNotNull(context).globalObject.getJSFunction("__resumeHostCalls").call()
            throw IllegalStateException("Core $method timed out")
        }
        return JSONObject(answer)
    }

    private fun JSONObject.error(): String? = if (getBoolean("ok")) null else getString("error")

    /** What one replay did: requests [sent], [dropped] after a final reply, entries [left], and the failure that stopped it. */
    data class Replay(val sent: Int, val dropped: Int, val left: Int, val owed: String?)

    /**
     * The journal's requests, sent again in journal order, one at a time, each exactly as first sent: at boot (ProcessCoreHost,
     * after the validated load and before any screen gets this host), and as the owed retry of a replay that stopped. A reply
     * that keeps its entry (SAVE_FAILED), or no reply, stops the replay; that entry and the ones after it wait for the retry.
     */
    fun replayJournal(): Replay = onEngine {
        stopped?.let { throw IllegalStateException(it) }
        val journal = checkNotNull(journal)
        var sent = 0
        var dropped = 0
        var owed: String? = null
        for (entry in journal.pending()) {
            sent += 1
            checkNotNull(sqlite).failCommits = debugFault("fail_commit") == "1"
            val error = try {
                answer(entry.method, entry.args.toTypedArray(), OPERATION_DEADLINE_MS).error()
            } catch (failure: Throwable) {
                owed = failure.message ?: failure.javaClass.simpleName
                break
            }
            journal.settle(entry, error)
            if (WriteJournal.keeps(error)) { owed = error; break }
            dropped += 1
        }
        stopped?.let { throw IllegalStateException(it) }
        Replay(sent, dropped, journal.pending().size, owed).also {
            Log.i(TAG, "Native Android journal replay sent=${it.sent} dropped=${it.dropped} left=${it.left} owed=${owed?.substringBefore(':') ?: "none"}")
        }
    }

    /**
     * Debug builds only (check-journal-device.mjs): [stop] is `debug.mindwtr.native.journal_stop`; set to `<at>:<op>`, the
     * process dies at [at] ("before": the entry is on disk and the engine has not seen it; "after": core replied and the entry
     * is not settled) of the write [op] (the method, or a Menu command's name). A replay never stops.
     */
    private fun journalStop(stop: String, at: String, entry: WriteJournal.Entry) {
        val op = if (entry.method == "menuCommand") entry.args[0] else entry.method
        if (stop != "$at:$op") return
        Log.i(TAG, "Native Android journal stop at=$at op=$op entry=${entry.file.name}")
        android.os.Process.killProcess(android.os.Process.myPid())
    }

    /** Pumps timers and host call answers until operation [id] answers (its JSON), or null once [ms] have passed. */
    private fun pumpUntil(id: String, ms: Long): String? {
        val engine = checkNotNull(context)
        val pump = engine.globalObject.getJSFunction("__pumpTimers")
        val nextDelay = engine.globalObject.getJSFunction("__nextTimerDelay")
        val deadline = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < deadline) {
            pump.call()
            (call("poll", id) as String?)?.let { return it }
            val delay = (nextDelay.call() as? Number)?.toLong() ?: 1L
            // An open fetch or secret call wakes the loop as soon as its answer is queued.
            if (io.busy()) io.await(if (delay < 0) 25L else minOf(delay, 25L))
            else if (delay > 0) Thread.sleep(minOf(delay, 25L))
        }
        return null
    }

    private fun closeOnEngine() {
        functions.clear()
        hostObject = null
        io.close()
        try {
            sqlite?.close()
        } finally {
            sqlite = null
            context?.destroy()
            context = null
        }
    }

    fun close() {
        check(Thread.currentThread() !== engineThread) { "Core host cannot close itself" }
        val task = synchronized(lifecycleLock) {
            shutdown ?: executor.submit(Callable { closeOnEngine() }).also {
                shutdown = it
                executor.shutdown()
            }
        }
        task.get()
    }
}

/**
 * A device check's debug property `debug.mindwtr.native.<name>`. Release builds return "" before reading anything,
 * so no property can reach them.
 */
fun debugProperty(name: String): String {
    if (!BuildConfig.DEBUG) return ""
    return runCatching {
        val process = ProcessBuilder("getprop", "debug.mindwtr.native.$name").start()
        process.inputStream.bufferedReader().use { it.readText().trim() }.also { process.waitFor() }
    }.getOrDefault("")
}
