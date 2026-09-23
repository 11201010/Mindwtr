package tech.dongdongbh.mindwtr.pilot

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import java.io.File
import java.util.UUID

private data class InboxRow(val id: String, val title: String)
private data class FailedAction(val kind: String, val id: String, val title: String = "")
private data class InboxPage(val revision: String, val total: Int, val rows: List<InboxRow>) {
    companion object {
        fun parse(json: JSONObject): InboxPage {
            check(json.getInt("version") == 1) { "Unsupported core contract" }
            val items = json.getJSONArray("rows")
            return InboxPage(json.getString("revision"), json.getInt("total"),
                List(items.length()) { index ->
                    items.getJSONObject(index).let { InboxRow(it.getString("id"), it.getString("title")) }
                })
        }
    }
}

/** Isolated development UI. Task rules and writes stay in the shared core. */
class MainActivity : ComponentActivity() {
    private var loading by mutableStateOf(true)
    private var writable by mutableStateOf(false)
    private var busy by mutableStateOf(false)
    private var error by mutableStateOf<String?>(null)
    private var draft by mutableStateOf("")
    private var captureId = UUID.randomUUID().toString()
    private var submittedTitle: String? = null
    private var failedAction by mutableStateOf<FailedAction?>(null)
    private var rows by mutableStateOf<List<InboxRow>>(emptyList())
    private var revision = ""
    private var total by mutableStateOf(0)
    private val hostLock = Any()
    @Volatile private var destroyed = false
    private var host: CoreHost? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = true
        setContent {
            MaterialTheme {
                Column(Modifier.fillMaxSize().padding(24.dp)) {
                    Text("Inbox · $total", style = MaterialTheme.typography.headlineSmall)
                    if (loading) {
                        CircularProgressIndicator(Modifier.padding(top = 16.dp))
                    } else {
                        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
                        Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = draft,
                                onValueChange = { value ->
                                    if (submittedTitle != null && value != submittedTitle) {
                                        captureId = UUID.randomUUID().toString()
                                        submittedTitle = null
                                    }
                                    draft = value
                                },
                                label = { Text("Capture task") },
                                singleLine = true,
                                enabled = !busy && failedAction == null,
                                modifier = Modifier.weight(1f),
                            )
                            Button(onClick = {
                                val title = draft
                                val id = captureId
                                submittedTitle = title
                                perform(FailedAction("create", id, title)) { runtime ->
                                    runtime.createInboxTask(title, id)
                                    runOnUiThread { if (!destroyed) failedAction = null }
                                    val page = InboxPage.parse(runtime.inboxWindow(0, 50, ""))
                                    runOnUiThread { if (!destroyed) {
                                        draft = ""
                                        captureId = UUID.randomUUID().toString()
                                        submittedTitle = null
                                        applyPage(page, false)
                                    } }
                                }
                            }, enabled = writable && !busy && draft.isNotBlank() &&
                                (failedAction == null || failedAction == FailedAction("create", captureId, draft)),
                                modifier = Modifier.padding(start = 8.dp)) { Text("Add") }
                        }
                        Button(onClick = { refresh() }, enabled = writable && !busy && failedAction == null) { Text("Refresh") }
                        LazyColumn(modifier = Modifier.weight(1f)) {
                            items(rows, key = { it.id }) { task ->
                                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(task.title, Modifier.weight(1f))
                                    Button(onClick = {
                                        perform(FailedAction("complete", task.id)) { runtime ->
                                            runtime.completeTask(task.id)
                                            runOnUiThread { if (!destroyed) failedAction = null }
                                            val page = InboxPage.parse(runtime.inboxWindow(0, 50, ""))
                                            runOnUiThread { if (!destroyed) applyPage(page, false) }
                                        }
                                    }, enabled = writable && !busy &&
                                        (failedAction == null || failedAction == FailedAction("complete", task.id)),
                                        modifier = Modifier.semantics { contentDescription = "Complete ${task.title}" }) { Text("Complete") }
                                }
                            }
                            if (rows.size < total) item {
                                Button(onClick = {
                                    val offset = rows.size
                                    val expectedRevision = revision
                                    perform { runtime ->
                                        val page = InboxPage.parse(runtime.inboxWindow(offset, 50, expectedRevision))
                                        runOnUiThread { if (!destroyed) applyPage(page, true) }
                                    }
                                }, enabled = writable && !busy && failedAction == null) { Text("Load more") }
                            }
                        }
                    }
                }
            }
        }
        Thread({
            var runtime: CoreHost? = null
            try {
                runtime = CoreHost(File(filesDir, "mindwtr-native-dev.db"))
                val active = synchronized(hostLock) {
                    if (destroyed) false else { host = runtime; true }
                }
                if (!active) { runtime.close(); return@Thread }
                val bundle = assets.open("core-host.js").bufferedReader().use { it.readText() }
                val page = InboxPage.parse(runtime.start(bundle))
                runOnUiThread { if (!destroyed) { applyPage(page, false); writable = true; loading = false } }
            } catch (failure: Throwable) {
                synchronized(hostLock) { if (host === runtime) host = null }
                runCatching { runtime?.close() }
                if (!destroyed) {
                    Log.e(CoreHost.TAG, "Core boot failed", failure)
                    runOnUiThread { if (!destroyed) {
                        error = "Storage unavailable: ${failure.message ?: failure.javaClass.simpleName}"
                        loading = false
                    } }
                }
            }
        }, "mindwtr-startup").start()
    }

    private fun applyPage(page: InboxPage, append: Boolean) {
        revision = page.revision
        total = page.total
        rows = if (append) rows + page.rows else page.rows
        error = null
    }

    private fun refresh() = perform { runtime ->
        val page = InboxPage.parse(runtime.inboxWindow(0, 50, ""))
        runOnUiThread { if (!destroyed) applyPage(page, false) }
    }

    private fun perform(action: FailedAction? = null, work: (CoreHost) -> Unit) {
        val runtime = synchronized(hostLock) { host }
        if (busy || runtime == null || (failedAction != null && failedAction != action)) return
        busy = true
        error = null
        Thread({
            try { work(runtime) }
            catch (failure: Throwable) {
                Log.e(CoreHost.TAG, "Core action failed", failure)
                runOnUiThread { if (!destroyed) {
                    error = failure.message ?: failure.javaClass.simpleName
                    if (action != null || failure.message?.startsWith("SAVE_FAILED") == true) {
                        failedAction = action ?: FailedAction("storage", "")
                    }
                } }
            } finally {
                runOnUiThread { if (!destroyed) busy = false }
            }
        }, "mindwtr-action").start()
    }

    override fun onDestroy() {
        val runtime = synchronized(hostLock) {
            destroyed = true
            host.also { host = null }
        }
        if (runtime != null) Thread({ runtime.close() }, "mindwtr-shutdown").start()
        super.onDestroy()
    }
}
