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

/** One task row as core sent it. [revealDate] (Upcoming) is shown as the text it is; [laterToday] is core's flag. */
data class TaskRow(val id: String, val title: String, val revealDate: String? = null, val laterToday: Boolean = false)
/** The two lists. The names are the tab labels, as on mobile. */
enum class Screen { Inbox, Focus }
/** A command whose outcome is unknown; only this exact command may run again. */
data class FailedAction(
    val kind: String,
    val id: String,
    val title: String = "",
    val base: Map<String, String?> = emptyMap(),
    val patch: Map<String, String?> = emptyMap(),
)

/** Core refused the update before writing anything, so there is no retry to hold. */
private val UPDATE_REFUSALS = listOf("STALE_REVISION", "INVALID_INPUT", "TASK_NOT_FOUND")

/** Core's `rows` array, in its order. */
fun JSONObject.taskRows(): List<TaskRow> = getJSONArray("rows").let { items ->
    List(items.length()) { index ->
        items.getJSONObject(index).let { row ->
            TaskRow(row.getString("id"), row.getString("title"),
                if (row.isNull("revealDate")) null else row.getString("revealDate"), row.getBoolean("laterToday"))
        }
    }
}

private const val PAGE = 50
private data class InboxPage(val revision: String, val total: Int, val rows: List<TaskRow>) {
    companion object {
        fun parse(json: JSONObject): InboxPage {
            check(json.getInt("version") == 1) { "Unsupported core contract" }
            return InboxPage(json.getString("revision"), json.getInt("total"), json.taskRows())
        }
    }
}

/**
 * Inbox, Focus, and editor screen state. It survives Activity recreation, so a
 * command that ends after rotation updates the new screen. The selected list,
 * the capture draft, and the editor draft survive process death; rows reload
 * from core. It never closes the process host.
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
    var rows by mutableStateOf<List<TaskRow>>(emptyList()); private set
    private var revision = ""
    var total by mutableStateOf(0); private set
    var screen by mutableStateOf(Screen.entries.firstOrNull { it.name == saved.get<String>("screen") } ?: Screen.Inbox); private set
    var focus by mutableStateOf<FocusView?>(null); private set
    /** The open editor, if any. Its base is the reply it was opened (or reloaded) with, even after process death. */
    var editor by mutableStateOf(saved.get<String>("editor")?.let { source ->
        runCatching { TaskEditor.restore(source, saved.get<String>("editorEdited")!!) }.getOrNull()
    }); private set
    /** The last save was refused as stale; the screen offers Reload. */
    var conflict by mutableStateOf(false); private set
    @Volatile private var host: CoreHost? = null
    private var attaches = 0
    private val main = Handler(Looper.getMainLooper())

    init {
        saved["captureId"] = captureId
        Thread({
            try {
                val runtime = ProcessCoreHost.get(getApplication())
                ProcessCoreHost.failure?.let { pending -> ui { host = runtime; restore(pending) }; return@Thread }
                val lists = try {
                    read(runtime, emptyMap())
                } catch (failure: Throwable) {
                    // A save that failed while this screen opened blocks reads; show its retry.
                    ProcessCoreHost.failure?.let { pending -> ui { host = runtime; restore(pending) }; return@Thread }
                    throw failure
                }
                ui { host = runtime; showLists(lists); writable = true; loading = false }
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

    /** The editor opens over this list, so Save and Cancel return to it. */
    fun show(target: Screen) {
        screen = target
        saved["screen"] = target.name
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

    // ponytail: saves core's whole reply, project list included, in instance state (Binder limit ~1 MB).
    // If project lists grow to thousands, save only the fields and fetch the choices again on restore.
    private fun keepEditor(value: TaskEditor?) {
        editor = value
        saved["editor"] = value?.reply?.source
        saved["editorEdited"] = value?.let { json(it.edited) }
    }

    private fun restore(pending: ProcessCoreHost.PendingFailure) {
        val action = pending.action
        if (action.kind == "create") setCapture(action.title, action.id, action.title)
        pending.editor?.let(::keepEditor)
        rows = pending.rows
        total = pending.total
        focus = pending.focus
        show(pending.screen)
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
        val depth = focus.depth()
        perform(action) { runtime ->
            runtime.createInboxTask(title, id)
            acknowledged(action)
            val lists = read(runtime, depth)
            ui {
                setCapture("", UUID.randomUUID().toString(), null)
                showLists(lists)
            }
        }
    }

    /** From the Inbox or Focus: the same command, the same exact-retry lock. */
    fun complete(id: String) {
        val action = FailedAction("complete", id)
        val depth = focus.depth()
        perform(action) { runtime ->
            runtime.completeTask(id)
            acknowledged(action)
            val lists = read(runtime, depth)
            ui { showLists(lists) }
        }
    }

    /** The command itself succeeded, so its exact retry is no longer owed. */
    private fun acknowledged(action: FailedAction) {
        ProcessCoreHost.clearFailure(action)
        ui { failedAction = null }
    }

    fun openEditor(id: String) = perform { runtime ->
        val reply = EditorReply(runtime.taskEditor(id).toString())
        ui { keepEditor(TaskEditor.open(reply)) }
    }

    fun editField(field: String, value: String?) { editor?.let { keepEditor(it.edit(field, value)) } }

    fun editText(field: String, text: String) { editor?.let { keepEditor(it.editText(field, text)) } }

    fun closeEditor() {
        keepEditor(null)
        error = null
        conflict = false
    }

    fun updateAction(current: TaskEditor) = FailedAction("update", current.id, base = current.base, patch = current.patch)

    /** Sends only the changed fields with their loaded values. Nothing changed: close, no call. */
    fun saveEditor() {
        val current = editor ?: return
        if (current.patch.isEmpty()) { closeEditor(); return }
        val action = updateAction(current)
        val depth = focus.depth()
        perform(action) { runtime ->
            runtime.updateTask(current.id, json(current.base), json(current.patch))
            acknowledged(action)
            ui { closeEditor() }
            val lists = read(runtime, depth)
            ui { showLists(lists) }
        }
    }

    fun reloadEditor() {
        val id = editor?.id ?: return
        perform { runtime ->
            val fresh = EditorReply(runtime.taskEditor(id).toString())
            ui { editor?.let { keepEditor(it.reloaded(fresh)) } }
        }
    }

    fun refresh() = perform { runtime ->
        val page = InboxPage.parse(runtime.inboxWindow(0, PAGE, ""))
        ui { applyPage(page, false) }
    }

    fun loadMore() {
        val offset = rows.size
        val expectedRevision = revision
        perform { runtime ->
            val page = InboxPage.parse(runtime.inboxWindow(offset, PAGE, expectedRevision))
            ui { applyPage(page, true) }
        }
    }

    /** Focus from offset 0: on resume, each minute while Focus shows, and after every command. */
    fun refreshFocus() {
        val depth = focus.depth()
        perform { runtime ->
            val view = readFocus(runtime, null, depth)
            ui { focus = view }
        }
    }

    /** The next window of one section at the loaded revision. */
    fun loadMoreFocus(key: String) {
        val view = focus ?: return
        val depth = view.depth() + (key to (view.section(key)?.rows?.size ?: 0) + PAGE)
        perform { runtime ->
            val next = readFocus(runtime, view, depth)
            ui { focus = next }
        }
    }

    private fun FocusView?.depth(): Map<String, Int> = this?.sections?.associate { it.key to it.rows.size }.orEmpty()

    /**
     * Core's Focus with each section read to [depth] rows, all at one revision,
     * so a refresh keeps what Load more showed. STALE_REVISION is never an error:
     * Focus changed (an edit, a new minute, midnight), so read again from offset 0.
     */
    private fun readFocus(runtime: CoreHost, start: FocusView?, depth: Map<String, Int>): FocusView {
        var view = start ?: FocusView.parse(runtime.focus(PAGE))
        for ((key, want) in depth) {
            while (true) {
                val loaded = view.section(key) ?: break
                if (loaded.rows.size >= minOf(want, loaded.total)) break
                val next = try {
                    view.append(runtime.focusWindow(key, loaded.rows.size, PAGE, view.revision))
                } catch (failure: Exception) {
                    if (failure.message?.startsWith("STALE_REVISION") != true) throw failure
                    // A fresh read that went stale keeps its first windows; the next refresh reads deeper.
                    return if (start == null) view else readFocus(runtime, null, depth)
                }
                if (next.section(key)?.rows?.size == loaded.rows.size) break // core sent no rows: stop, never spin
                view = next
            }
        }
        return view
    }

    /** Both lists from offset 0: after boot and after every command. */
    private fun read(runtime: CoreHost, depth: Map<String, Int>) =
        InboxPage.parse(runtime.inboxWindow(0, PAGE, "")) to readFocus(runtime, null, depth)

    private fun showLists(lists: Pair<InboxPage, FocusView>) {
        applyPage(lists.first, false)
        focus = lists.second
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
        conflict = false
        Thread({
            try { work(runtime) }
            catch (failure: Throwable) {
                Log.e(CoreHost.TAG, "Core action failed", failure)
                val message = failure.message ?: failure.javaClass.simpleName
                val refused = action?.kind == "update" && UPDATE_REFUSALS.any { message.startsWith(it) }
                val failed = if ((action != null && !refused) || message.startsWith("SAVE_FAILED")) {
                    action ?: FailedAction("storage", "")
                } else null
                // Recorded before the UI update so a screen opening now still finds it.
                if (failed != null) ProcessCoreHost.recordFailure(ProcessCoreHost.PendingFailure(failed, message, rows, total, editor, screen, focus))
                ui {
                    error = message
                    conflict = message.startsWith("STALE_REVISION")
                    if (failed != null) failedAction = failed
                }
            } finally {
                ui { busy = false }
            }
        }, "mindwtr-action").start()
    }
}
