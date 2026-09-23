package tech.dongdongbh.mindwtr.pilot

import android.app.Application
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import java.util.UUID

data class InboxRow(val id: String, val title: String)
data class FailedAction(val kind: String, val id: String, val title: String = "")
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

/**
 * Inbox screen state. It survives Activity recreation, so a command that ends
 * after rotation updates the new screen. Only the capture draft survives
 * process death; rows reload from core. It never closes the process host.
 */
class InboxViewModel(app: Application, private val saved: SavedStateHandle) : AndroidViewModel(app) {
    var loading by mutableStateOf(true); private set
    var writable by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var draft by mutableStateOf(saved.get<String>("draft") ?: ""); private set
    var captureId by mutableStateOf(saved.get<String>("captureId") ?: UUID.randomUUID().toString()); private set
    private var submittedTitle: String? = saved.get<String>("submittedTitle")
    var failedAction by mutableStateOf<FailedAction?>(null); private set
    var rows by mutableStateOf<List<InboxRow>>(emptyList()); private set
    private var revision = ""
    var total by mutableStateOf(0); private set
    @Volatile private var host: CoreHost? = null
    private var attaches = 0
    private val main = Handler(Looper.getMainLooper())

    init {
        saved["captureId"] = captureId
        Thread({
            try {
                val runtime = ProcessCoreHost.get(getApplication())
                ProcessCoreHost.failure?.let { pending -> ui { host = runtime; restore(pending) }; return@Thread }
                val page = try {
                    InboxPage.parse(runtime.inboxWindow(0, 50, ""))
                } catch (failure: Throwable) {
                    // A save that failed while this screen opened blocks reads; show its retry.
                    ProcessCoreHost.failure?.let { pending -> ui { host = runtime; restore(pending) }; return@Thread }
                    throw failure
                }
                ui { host = runtime; applyPage(page, false); writable = true; loading = false }
            } catch (failure: Throwable) {
                Log.e(CoreHost.TAG, "Core boot failed", failure)
                ui {
                    error = "Storage unavailable: ${failure.message ?: failure.javaClass.simpleName}"
                    loading = false
                }
            }
        }, "mindwtr-startup").start()
    }

    /** Each Activity instance calls this once. A later call is a recreation on the running host. */
    fun attach() {
        attaches += 1
        if (attaches > 1) ProcessCoreHost.logHostReuse("activity-recreate", attaches, busy)
    }

    /** The draft, its capture UUID, and the title last sent with it; all survive process death. */
    private fun setCapture(text: String, id: String, submitted: String?) {
        draft = text
        captureId = id
        submittedTitle = submitted
        saved["draft"] = text
        saved["captureId"] = id
        saved["submittedTitle"] = submitted
    }

    private fun restore(pending: ProcessCoreHost.PendingFailure) {
        val action = pending.action
        if (action.kind == "create") setCapture(action.title, action.id, action.title)
        rows = pending.rows
        total = pending.total
        failedAction = action
        error = pending.error
        writable = true
        loading = false
    }

    fun editDraft(value: String) {
        if (submittedTitle != null && value != submittedTitle) setCapture(value, UUID.randomUUID().toString(), null)
        else setCapture(value, captureId, submittedTitle)
    }

    fun add() {
        val title = draft
        val id = captureId
        setCapture(title, id, submitted = title)
        val action = FailedAction("create", id, title)
        perform(action) { runtime ->
            runtime.createInboxTask(title, id)
            acknowledged(action)
            val page = InboxPage.parse(runtime.inboxWindow(0, 50, ""))
            ui {
                setCapture("", UUID.randomUUID().toString(), null)
                applyPage(page, false)
            }
        }
    }

    fun complete(id: String) {
        val action = FailedAction("complete", id)
        perform(action) { runtime ->
            runtime.completeTask(id)
            acknowledged(action)
            val page = InboxPage.parse(runtime.inboxWindow(0, 50, ""))
            ui { applyPage(page, false) }
        }
    }

    /** The command itself succeeded, so its exact retry is no longer owed. */
    private fun acknowledged(action: FailedAction) {
        ProcessCoreHost.clearFailure(action)
        ui { failedAction = null }
    }

    fun refresh() = perform { runtime ->
        val page = InboxPage.parse(runtime.inboxWindow(0, 50, ""))
        ui { applyPage(page, false) }
    }

    fun loadMore() {
        val offset = rows.size
        val expectedRevision = revision
        perform { runtime ->
            val page = InboxPage.parse(runtime.inboxWindow(offset, 50, expectedRevision))
            ui { applyPage(page, true) }
        }
    }

    private fun applyPage(page: InboxPage, append: Boolean) {
        revision = page.revision
        total = page.total
        rows = if (append) rows + page.rows else page.rows
        error = null
    }

    private fun ui(update: () -> Unit) { main.post(update) }

    private fun perform(action: FailedAction? = null, work: (CoreHost) -> Unit) {
        val runtime = host
        if (busy || runtime == null || (failedAction != null && failedAction != action)) return
        busy = true
        error = null
        Thread({
            try { work(runtime) }
            catch (failure: Throwable) {
                Log.e(CoreHost.TAG, "Core action failed", failure)
                val message = failure.message ?: failure.javaClass.simpleName
                val failed = if (action != null || failure.message?.startsWith("SAVE_FAILED") == true) {
                    action ?: FailedAction("storage", "")
                } else null
                // Recorded before the UI update so a screen opening now still finds it.
                if (failed != null) ProcessCoreHost.recordFailure(ProcessCoreHost.PendingFailure(failed, message, rows, total))
                ui {
                    error = message
                    if (failed != null) failedAction = failed
                }
            } finally {
                ui { busy = false }
            }
        }, "mindwtr-action").start()
    }
}
