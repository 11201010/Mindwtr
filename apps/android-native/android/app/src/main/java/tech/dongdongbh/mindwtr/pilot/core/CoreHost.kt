package tech.dongdongbh.mindwtr.pilot.core

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
 */
class CoreHost(private val databaseFile: File, private val rnDataDir: File? = null) {
    companion object {
        const val TAG = "MindwtrNativeDev"
        /** Must match NATIVE_ERROR in bundle/host-entry.ts. */
        private const val NATIVE_ERROR = "!MindwtrNativeError:"

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
    private val functions = HashMap<String, JSFunction>()
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
            // A diagnostic line must never fail the caller: coerce and swallow.
            bridge.setProperty("log", guarded { args -> runCatching { Log.i(TAG, args.getOrNull(0).toString()) }; null })
            engine.globalObject.setProperty("__mindwtrNative", bridge)
            engine.evaluate(bundle, "core-host.js")
            callAsync("boot", legacyState, legacyBackup)
        } catch (error: Throwable) {
            closeOnEngine()
            throw error
        }
    }

    fun inboxWindow(offset: Int, limit: Int, revision: String): JSONObject =
        callAsync("window", offset, limit, revision)

    /** Core's getFocus: its sections in its order, the first [limit] rows of each. */
    fun focus(limit: Int): JSONObject = callAsync("focus", limit)

    /** Core's getFocusSectionWindow. A changed Focus fails with "STALE_REVISION: …". */
    fun focusWindow(key: String, offset: Int, limit: Int, revision: String): JSONObject =
        callAsync("focusWindow", key, offset, limit, revision)

    fun createInboxTask(title: String, captureId: String): JSONObject =
        callAsync("create", title, captureId)

    fun completeTask(id: String): JSONObject = callAsync("complete", id)

    /** Core's editor reply for one task: its seven fields as stored, plus the choices core allows. */
    fun taskEditor(id: String): JSONObject = callAsync("editor", id)

    /** [baseJson] and [patchJson] go to core's updateTask unchanged; core decides everything. */
    fun updateTask(id: String, baseJson: String, patchJson: String): JSONObject =
        callAsync("update", JSONObject().put("id", id).put("base", JSONObject(baseJson)).put("patch", JSONObject(patchJson)).toString())

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
    private fun debugFault(name: String): String {
        if (!BuildConfig.DEBUG) return ""
        return runCatching {
            val process = ProcessBuilder("getprop", "debug.mindwtr.native.$name").start()
            process.inputStream.bufferedReader().use { it.readText().trim() }.also { process.waitFor() }
        }.getOrDefault("")
    }

    private fun debugDelay(name: String) {
        val ms = debugFault(name).toLongOrNull() ?: return
        if (ms > 0) Thread.sleep(minOf(ms, 60_000L))
    }

    private fun callAsync(method: String, vararg args: Any?): JSONObject = onEngine {
        val command = method in setOf("create", "complete", "update")
        if (command) {
            checkNotNull(sqlite).failCommits = debugFault("fail_commit") == "1"
            debugDelay("delay_before_ms")
        }
        val id = call(method, *args) as String
        val engine = checkNotNull(context)
        val pump = engine.globalObject.getJSFunction("__pumpTimers")
        val nextDelay = engine.globalObject.getJSFunction("__nextTimerDelay")
        val deadline = System.currentTimeMillis() + 30_000
        while (System.currentTimeMillis() < deadline) {
            pump.call()
            val answer = call("poll", id) as String?
            if (answer != null) {
                val result = JSONObject(answer)
                if (command) debugDelay("delay_after_ms")
                if (!result.getBoolean("ok")) throw IllegalStateException(result.getString("error"))
                return@onEngine result.getJSONObject("value")
            }
            val delay = (nextDelay.call() as? Number)?.toLong() ?: 1L
            if (delay > 0) Thread.sleep(minOf(delay, 25L))
        }
        throw IllegalStateException("Core $method timed out")
    }

    private fun closeOnEngine() {
        functions.clear()
        hostObject = null
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
