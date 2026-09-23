package tech.dongdongbh.mindwtr.pilot.core

import android.util.Log
import com.whl.quickjs.android.QuickJSLoader
import com.whl.quickjs.wrapper.JSFunction
import com.whl.quickjs.wrapper.JSObject
import com.whl.quickjs.wrapper.QuickJSContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** QuickJS and SQLite share one worker thread; Compose never enters either runtime. */
class CoreHost(private val databaseFile: File) {
    companion object {
        const val TAG = "MindwtrNativeDev"
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
        return task.get()
    }

    private fun call(method: String, vararg args: Any?): Any? = onEngine {
        val engine = checkNotNull(context)
        val host = hostObject ?: engine.globalObject.getJSObject("MindwtrHost").also { hostObject = it }
        functions.getOrPut(method) { host.getJSFunction(method) }.call(*args)
    }

    fun start(bundle: String): JSONObject = onEngine {
        try {
            val engine = QuickJSContext.create()
            context = engine
            val database = SqliteBridge(databaseFile)
            sqlite = database
            database.ensureRecoveryCheckpoint()
            val bridge = engine.createNewJSObject()
            bridge.setProperty("sqlRun") { args -> database.run(args[0] as String, args[1] as String); null }
            bridge.setProperty("sqlAll") { args -> database.all(args[0] as String, args[1] as String) }
            bridge.setProperty("sqlExec") { args -> database.exec(args[0] as String); null }
            bridge.setProperty("nowMs") { _ -> (System.nanoTime() - startedAt) / 1e6 }
            bridge.setProperty("randomBytes") { args ->
                val length = (args[0] as Number).toInt()
                require(length in 0..65_536) { "Invalid random byte count" }
                JSONArray().also { out ->
                    ByteArray(length).also(random::nextBytes).forEach { out.put(it.toInt() and 0xff) }
                }.toString()
            }
            bridge.setProperty("log") { args -> Log.i(TAG, args[0] as String); null }
            engine.globalObject.setProperty("__mindwtrNative", bridge)
            engine.evaluate(bundle, "core-host.js")
            callAsync("boot")
        } catch (error: Throwable) {
            closeOnEngine()
            throw error
        }
    }

    fun inboxWindow(offset: Int, limit: Int, revision: String): JSONObject =
        callAsync("window", offset, limit, revision)

    fun createInboxTask(title: String, captureId: String): JSONObject =
        callAsync("create", title, captureId)

    fun completeTask(id: String): JSONObject = callAsync("complete", id)

    private fun callAsync(method: String, vararg args: Any?): JSONObject = onEngine {
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
