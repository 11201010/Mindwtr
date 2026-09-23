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

/**
 * One item of core's row meta line (TaskRowMetaPart), as core sent it: [text] is shown as is.
 * [dotColor] is core's area color (null: the tint), [tone] a due date's urgency, [overflow]
 * a context's or tag's "+N", [done]/[of] the checklist count, [spoken] core's TalkBack text.
 */
data class MetaPart(
    val kind: String, val text: String, val detail: Boolean, val dotColor: String? = null, val tone: String? = null,
    val overflow: Int = 0, val done: Int = 0, val of: Int = 0, val spoken: String? = null,
)
/** Core's TaskRowMeta: the meta line in order, the priority strip, the status label, the star rule, and TalkBack's label. */
data class RowMeta(
    val parts: List<MetaPart>, val priority: String?, val statusLabel: String?, val canFocus: Boolean,
    val rtl: Boolean, val accessibilityLabel: String,
)
/**
 * One task row as core sent it (NativeTaskRow). Kotlin never parses or formats a date:
 * the meta line is core's text. [revealDate] (Upcoming) and [laterToday] are core's.
 */
data class TaskRow(
    val id: String,
    val title: String,
    val status: String,
    val isFocusedToday: Boolean,
    val meta: RowMeta,
    val revealDate: String? = null,
    val laterToday: Boolean = false,
)
/** The three lists. [label] is the core key of the tab label mobile shows. */
enum class Screen(val label: String) { Inbox("tab.inbox"), Focus("tab.next"), Projects("nav.projects") }
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

private fun JSONObject.metaPart(): MetaPart = MetaPart(
    getString("kind"), getString("text"), getBoolean("detail"), text("dotColor"), text("tone"),
    optInt("overflowCount"), optInt("completed"), optInt("total"), text("accessibilityLabel"),
)

private fun JSONObject.text(name: String) = if (!has(name) || isNull(name)) null else getString(name)

/** One NativeTaskRow as core sent it. */
fun JSONObject.taskRow() = getJSONObject("meta").let { meta ->
    TaskRow(getString("id"), getString("title"), getString("status"), getBoolean("isFocusedToday"),
        RowMeta(meta.getJSONArray("parts").let { parts -> List(parts.length()) { parts.getJSONObject(it).metaPart() } },
            meta.text("priority"), meta.text("statusLabel"), meta.getBoolean("canFocus"),
            meta.getString("textDirection") == "rtl", meta.getString("accessibilityLabel")),
        text("revealDate"), getBoolean("laterToday"))
}

/** Core's `rows` array, in its order. */
fun JSONObject.taskRows(): List<TaskRow> = getJSONArray("rows").let { items ->
    List(items.length()) { index -> items.getJSONObject(index).taskRow() }
}

private const val PAGE = 50

/** How deep each list is shown, so a refresh reads it again as deep. */
private data class Depth(val focus: Map<String, Int>, val project: String?, val projectItems: Int)
private class Lists(val inbox: InboxPage, val focus: FocusView, val projects: ProjectsView, val projectId: String?, val project: ProjectDetail?, val areas: AreaFilter)

private data class InboxPage(val revision: String, val total: Int, val rows: List<TaskRow>) {
    companion object {
        fun parse(json: JSONObject): InboxPage {
            check(json.getInt("version") == 1) { "Unsupported core contract" }
            return InboxPage(json.getString("revision"), json.getInt("total"), json.taskRows())
        }
    }
}

/**
 * Inbox, Focus, Projects, and editor screen state. It survives Activity recreation,
 * so a command that ends after rotation updates the new screen. The selected list,
 * the open project, the capture draft, and the editor draft survive process death;
 * rows reload from core. It never closes the process host.
 */
class InboxViewModel(app: Application, private val saved: SavedStateHandle) : AndroidViewModel(app) {
    var loading by mutableStateOf(true); private set
    var writable by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var draft by mutableStateOf(saved.get<String>("draft") ?: ""); private set
    var captureId by mutableStateOf(saved.get<String>("captureId") ?: UUID.randomUUID().toString()); private set
    /** The quick capture sheet is open. It survives rotation and process death with its draft. */
    var capturing by mutableStateOf(saved.get<Boolean>("capturing") ?: false); private set
    private var submittedTitle: String? = saved.get<String>("submittedTitle")
    var failedAction by mutableStateOf<FailedAction?>(null); private set
    var rows by mutableStateOf<List<TaskRow>>(emptyList()); private set
    private var revision = ""
    var total by mutableStateOf(0); private set
    var screen by mutableStateOf(Screen.entries.firstOrNull { it.name == saved.get<String>("screen") } ?: Screen.Inbox); private set
    var focus by mutableStateOf<FocusView?>(null); private set
    var projects by mutableStateOf<ProjectsView?>(null); private set
    /** The project whose detail shows on the Projects tab; its rows reload from core after process death. */
    var openProjectId by mutableStateOf(saved.get<String>("project")); private set
    var project by mutableStateOf<ProjectDetail?>(null); private set
    private val prefs = app.getSharedPreferences("mindwtr-view-state", android.content.Context.MODE_PRIVATE)
    /** Focus sections shown open, device-local as RN keeps them (every section starts open). */
    var focusView by mutableStateOf(FocusViewState.read(prefs)); private set
    /** Collapsed area groups and the open Someday / Waiting and Closed groups, device-local as RN keeps them. */
    var projectsView by mutableStateOf(ProjectsViewState.read(prefs)); private set
    /** Core's area filter: the header trigger's label and the sheet's options. */
    var areaFilter by mutableStateOf<AreaFilter?>(null); private set
    /** RN's area sheet is open. */
    var areaSheet by mutableStateOf(false); private set
    /** The row whose status menu is open (RN's SwipeableTaskItemStatusMenu). */
    var statusMenu by mutableStateOf<TaskRow?>(null); private set
    /** RN's toast: a title and a message, shown for RN's 3.2 s. */
    var toast by mutableStateOf<Pair<String, String>?>(null); private set
    /** The "Add new project…" draft, its area ("" = no area), and its request UUID; all survive process death. */
    var projectDraft by mutableStateOf(saved.get<String>("projectDraft") ?: ""); private set
    var projectAreaId by mutableStateOf(saved.get<String>("projectAreaId")); private set
    var projectRequestId by mutableStateOf(saved.get<String>("projectRequestId") ?: UUID.randomUUID().toString()); private set
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
        saved["projectRequestId"] = projectRequestId
        val at = depth()
        Thread({
            try {
                val runtime = ProcessCoreHost.get(getApplication())
                ProcessCoreHost.failure?.let { pending -> ui { host = runtime; restore(pending) }; return@Thread }
                val lists = try {
                    read(runtime, at)
                } catch (failure: Throwable) {
                    // A save that failed while this screen opened blocks reads; show its retry.
                    ProcessCoreHost.failure?.let { pending -> ui { host = runtime; restore(pending) }; return@Thread }
                    throw failure
                }
                ui { host = runtime; showLists(lists, ++issued); writable = true; loading = false }
            } catch (failure: Throwable) {
                Log.e(CoreHost.TAG, "Core boot failed", failure)
                // No command can run, and core's labels may never have loaded: the screen shows only this message.
                ui {
                    error = failure.message ?: failure.javaClass.simpleName
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

    /** Opens or closes the quick capture sheet. The draft stays either way; only a saved capture clears it. */
    fun showCapture(open: Boolean) {
        capturing = open
        saved["capturing"] = open
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
        if (action.kind == "create") { setCapture(action.title, action.id, action.title); showCapture(true) }
        if (action.kind == "createProject") setProjectDraft(action.title, action.base["areaId"], action.id)
        areaFilter = pending.areas
        pending.editor?.let(::keepEditor)
        rows = pending.rows
        total = pending.total
        focus = pending.focus
        projects = pending.projects
        keepProject(pending.project?.projectId)
        project = pending.project
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
        perform(action) { runtime ->
            runtime.createInboxTask(title, id)
            acknowledged(action)
            // As in RN's quick capture: a saved capture closes the sheet.
            ui { setCapture("", UUID.randomUUID().toString(), null); showCapture(false) }
        }
    }

    /** From the Inbox, Focus, or a project: the same command, the same exact-retry lock. */
    fun complete(id: String) {
        val action = FailedAction("complete", id)
        perform(action) { runtime ->
            runtime.completeTask(id)
            acknowledged(action)
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
        perform(action) { runtime ->
            runtime.updateTask(current.id, json(current.base), json(current.patch))
            acknowledged(action)
            ui { closeEditor() }
        }
    }

    fun reloadEditor() {
        val id = editor?.id ?: return
        perform { runtime ->
            val fresh = EditorReply(runtime.taskEditor(id).toString())
            ui { editor?.let { keepEditor(it.reloaded(fresh)) } }
        }
    }

    /** Try again after a failed read: every list from offset 0, as deep as it is shown. */
    fun refresh() {
        val at = depth()
        val mine = ++issued
        perform { runtime ->
            val lists = read(runtime, at)
            ui { showLists(lists, mine) }
        }
    }

    fun loadMore() {
        val offset = rows.size
        val expectedRevision = revision
        val mine = ++issued
        perform { runtime ->
            val page = try {
                InboxPage.parse(runtime.inboxWindow(offset, PAGE, expectedRevision))
            } catch (failure: Exception) {
                // As in Focus, STALE_REVISION is never an error: the Inbox changed (an edit, a
                // new minute, midnight), so read it again from offset 0 as deep as Load more asked.
                if (failure.message?.startsWith("STALE_REVISION") != true) throw failure
                val reread = readInbox(runtime, offset + PAGE)
                ui { if (fresh(mine, Part.Inbox)) applyPage(reread, false) }
                return@perform
            }
            ui { if (fresh(mine, Part.Inbox)) applyPage(page, true) }
        }
    }

    /** The Inbox from offset 0 to [depth] rows at one revision; a read that goes stale keeps what it has. */
    private fun readInbox(runtime: CoreHost, depth: Int): InboxPage {
        var page = InboxPage.parse(runtime.inboxWindow(0, PAGE, ""))
        while (page.rows.size < minOf(depth, page.total)) {
            val next = try {
                InboxPage.parse(runtime.inboxWindow(page.rows.size, PAGE, page.revision))
            } catch (failure: Exception) {
                if (failure.message?.startsWith("STALE_REVISION") != true) throw failure
                return page
            }
            if (next.rows.isEmpty()) break // core sent no rows: stop, never spin
            page = page.copy(revision = next.revision, total = next.total, rows = page.rows + next.rows)
        }
        return page
    }

    /** Focus from offset 0, in the background: on resume and each minute while Focus shows. */
    fun refreshFocus() {
        val depth = focus.depth()
        background(listOf(Part.Focus), { runtime -> readFocus(runtime, null, depth) }) { view, mine -> if (fresh(mine, Part.Focus)) focus = view }
    }

    /** The next window of one section at the loaded revision. */
    fun loadMoreFocus(key: String) {
        val view = focus ?: return
        val depth = view.depth() + (key to (view.section(key)?.rows?.size ?: 0) + PAGE)
        val mine = ++issued
        perform { runtime ->
            val next = readFocus(runtime, view, depth)
            ui { if (fresh(mine, Part.Focus)) focus = next }
        }
    }

    private fun FocusView?.depth(): Map<String, Int> = this?.sections?.associate { it.key to it.rows.size }.orEmpty()

    private fun depth() = Depth(focus.depth(), openProjectId, maxOf(PAGE, project?.items?.size ?: 0))

    /** Opens or closes Someday / Waiting ("deferred") or Closed ("archived"), as RN's toggleProjectSection. */
    fun toggle(group: String) {
        val view = projectsView
        projectsView = if (group == "deferred") view.copy(showDeferred = !view.showDeferred) else view.copy(showArchived = !view.showArchived)
        projectsView.save(prefs)
    }

    /** RN's toggleAreaCollapse: [areaId] is the area's id, "no-area" without one. */
    fun toggleArea(areaId: String) {
        val collapsed = projectsView.collapsedAreas
        projectsView = projectsView.copy(collapsedAreas = if (areaId in collapsed) collapsed - areaId else collapsed + areaId)
        projectsView.save(prefs)
    }

    /** RN's toggleSection on Focus. */
    fun toggleFocusSection(key: String) {
        focusView = focusView.with(mapOf(key to !focusView.isOpen(key)))
        focusView.save(prefs)
    }

    /** RN's toggleOtherSections: Today's Focus stays open; the others all open, or all close. */
    fun setOtherFocusSections(open: Boolean) {
        focusView = focusView.with(FOCUS_SECTION_KEYS.associateWith { it == "focus" || open })
        focusView.save(prefs)
    }

    fun showAreaSheet(open: Boolean) { areaSheet = open }

    fun showStatusMenu(task: TaskRow?) { statusMenu = task }

    private var toastShown = 0
    private fun showToast(title: String, message: String) {
        toast = title to message
        val mine = ++toastShown
        main.postDelayed({ if (mine == toastShown) toast = null }, 3_200)
    }

    fun dismissToast() { toast = null }

    /** The star's target state: the exact retry of a failed star re-sends the same target. */
    fun taskFocusAction(id: String, focused: Boolean) = FailedAction("taskFocus", id, patch = mapOf("focused" to "$focused"))

    /** RN's row star through core's setTaskFocus. A refusal writes nothing and shows core's text in RN's toast. */
    fun setTaskFocus(id: String, focused: Boolean) {
        val action = taskFocusAction(id, focused)
        perform(action) { runtime ->
            val reply = runtime.setTaskFocus(id, focused)
            acknowledged(action)
            val blocked = reply.optString("blocked")
            if (blocked.isNotEmpty()) ui { showToast(reply.getString("blockedTitle"), blocked) }
        }
    }

    fun projectFocusAction(id: String, focused: Boolean) = FailedAction("projectFocus", id, patch = mapOf("focused" to "$focused"))

    /** RN's project star through core's setProjectFocus. Core's `{ blocked: "" }` shows nothing, as RN gives only its haptic. */
    fun setProjectFocus(id: String, focused: Boolean) {
        val action = projectFocusAction(id, focused)
        perform(action) { runtime ->
            runtime.setProjectFocus(id, focused)
            acknowledged(action)
        }
    }

    fun statusAction(task: TaskRow, status: String) =
        FailedAction("update", task.id, base = mapOf("status" to task.status), patch = mapOf("status" to status))

    /** RN's status menu: core's updateTask with the status the row was loaded with, so core refuses a stale change. */
    fun changeStatus(task: TaskRow, status: String) {
        statusMenu = null
        if (status == task.status) return
        val action = statusAction(task, status)
        perform(action) { runtime ->
            runtime.updateTask(task.id, json(action.base), json(action.patch))
            acknowledged(action)
        }
    }

    private fun setProjectDraft(text: String, areaId: String?, requestId: String) {
        projectDraft = text
        projectAreaId = areaId
        projectRequestId = requestId
        saved["projectDraft"] = text
        saved["projectAreaId"] = areaId
        saved["projectRequestId"] = requestId
    }

    fun editProjectDraft(text: String) = setProjectDraft(text, projectAreaId, projectRequestId)

    /** RN's area chip under the field; null means the default (the one area the filter selects, else none). */
    fun chooseProjectArea(areaId: String) = setProjectDraft(projectDraft, areaId, projectRequestId)

    fun createProjectAction(areaId: String) = FailedAction("createProject", projectRequestId, projectDraft, base = mapOf("areaId" to areaId))

    /**
     * RN's handleAddProject through core's createProject. The request UUID stays with the draft,
     * so the exact retry in this process re-sends it and core creates the project once. After
     * process death the draft comes back, but nothing is sent until the user taps + again.
     */
    fun createProject(areaId: String) {
        val action = createProjectAction(areaId)
        perform(action) { runtime ->
            runtime.createProject(action.title, areaId, action.id)
            acknowledged(action)
            ui { setProjectDraft("", null, UUID.randomUUID().toString()) }
        }
    }

    fun areaFilterAction(option: AreaOption) = FailedAction("areaFilter", option.next)

    /** RN's area sheet: one tap sends that option's `next` selection; every list is then read again. */
    fun setAreaFilter(option: AreaOption) {
        val action = areaFilterAction(option)
        perform(action) { runtime ->
            runtime.setAreaFilter(option.next)
            acknowledged(action)
        }
    }

    private fun keepProject(id: String?) {
        openProjectId = id
        saved["project"] = id
    }

    /** Opens one project's detail at core's first window. */
    fun openProject(id: String) {
        val mine = ++issued
        perform { runtime ->
            val detail = readProject(runtime, id, null, PAGE)
            ui { if (fresh(mine, Part.Project)) { keepProject(id); project = detail } }
        }
    }

    fun closeProject() {
        keepProject(null)
        project = null
    }

    /** The open project's next window at the loaded revision. */
    fun loadMoreProject() {
        val view = project ?: return
        val mine = ++issued
        perform { runtime ->
            val next = readProject(runtime, view.projectId, view, view.items.size + PAGE)
            ui { if (fresh(mine, Part.Project)) showProject(view.projectId, next) }
        }
    }

    /** Projects, and the open project from offset 0 as deep as it is shown, in the background: on every resume of the Projects tab. */
    fun refreshProjects() {
        val at = depth()
        background(listOf(Part.Projects, Part.Project), { runtime -> ProjectsView.parse(runtime.projects()) to readOpen(runtime, at) }) { (list, detail), mine ->
            if (fresh(mine, Part.Projects)) projects = list
            if (fresh(mine, Part.Project)) showProject(at.project, detail)
        }
    }

    /** Every list from offset 0, as deep as it is shown, in the background: after every command. */
    private fun refreshAll() {
        val at = depth()
        background(Part.entries, { runtime -> read(runtime, at) }, ::showLists)
    }

    /** The open project from offset 0 as deep as it is shown. A project core no longer has reads as null. */
    private fun readOpen(runtime: CoreHost, at: Depth): ProjectDetail? = at.project?.let { id ->
        try {
            readProject(runtime, id, null, at.projectItems)
        } catch (failure: Exception) {
            if (failure.message?.startsWith("TASK_NOT_FOUND") != true) throw failure
            null
        }
    }

    /** A read of project [id]. It is dropped if that project is no longer open; a project core no longer has closes. */
    private fun showProject(id: String?, detail: ProjectDetail?) {
        if (id != openProjectId) return
        if (detail == null) keepProject(null)
        project = detail
    }

    /**
     * Core's project detail read to [depth] items at one revision. As in Focus,
     * STALE_REVISION is never an error: the project changed, so read it again
     * from offset 0. A fresh read that went stale keeps its first window.
     */
    private fun readProject(runtime: CoreHost, id: String, start: ProjectDetail?, depth: Int): ProjectDetail {
        var view = start ?: ProjectDetail.parse(runtime.projectDetail(id, 0, PAGE, ""))
        while (view.items.size < minOf(depth, view.total)) {
            val next = try {
                view.append(runtime.projectDetail(id, view.items.size, PAGE, view.revision))
            } catch (failure: Exception) {
                if (failure.message?.startsWith("STALE_REVISION") != true) throw failure
                return if (start == null) view else readProject(runtime, id, null, depth)
            }
            if (next.items.size == view.items.size) break // core sent no items: stop, never spin
            view = next
        }
        return view
    }

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

    /** Every list from offset 0, as deep as it is shown: after boot and after every command. */
    private fun read(runtime: CoreHost, at: Depth) = Lists(
        InboxPage.parse(runtime.inboxWindow(0, PAGE, "")),
        readFocus(runtime, null, at.focus),
        ProjectsView.parse(runtime.projects()),
        at.project,
        readOpen(runtime, at),
        AreaFilter.parse(runtime.areaFilter()),
    )

    /** A full read, each list applied on its own: a list a newer read already showed keeps the newer rows. */
    private fun showLists(lists: Lists, mine: Long) {
        if (fresh(mine, Part.Inbox)) applyPage(lists.inbox, false)
        if (fresh(mine, Part.Focus)) focus = lists.focus
        if (fresh(mine, Part.Projects)) projects = lists.projects
        if (fresh(mine, Part.Project)) showProject(lists.projectId, lists.project)
        if (fresh(mine, Part.Areas)) areaFilter = lists.areas
    }

    private fun applyPage(page: InboxPage, append: Boolean) {
        revision = page.revision
        total = page.total
        rows = if (append) rows + page.rows else page.rows
        // A read's success clears a read's failure, never an owed retry's.
        if (failedAction == null) error = null
    }

    private fun ui(update: () -> Unit) { main.post(update) }

    // Read numbers, main thread only. A command outdates every read started before it,
    // so a read that began before a command can never show data from before it.
    // Each list keeps its own number: a quick Focus read that lands first never
    // makes a later-started full read drop its Inbox, Projects, or area filter.
    private var issued = 0L
    private var commandAt = 0L
    private val shownAt = HashMap<Part, Long>()

    /** One list a read can show. */
    private enum class Part { Inbox, Focus, Projects, Project, Areas }

    /** A read's result for [part] is shown only if no command, and no newer read of that list, came first. */
    private fun fresh(mine: Long, part: Part) = (mine > commandAt && mine > (shownAt[part] ?: 0L)).also { if (it) shownAt[part] = mine }

    /**
     * A read the app starts itself: on resume, each minute, and after every command.
     * It never takes [busy], so it disables no control and never turns a tap away:
     * a user action that starts meanwhile runs, and the engine thread queues both.
     * It starts only while no user action runs and no retry is owed.
     */
    private fun <T> background(parts: List<Part>, read: (CoreHost) -> T, apply: (T, Long) -> Unit) {
        val runtime = host
        if (runtime == null || busy || failedAction != null) return
        val mine = ++issued
        Thread({
            val result = runCatching { read(runtime) }
            result.exceptionOrNull()?.let { Log.e(CoreHost.TAG, "Core action failed action=background", it) }
            ui {
                // A failure is shown only if it is still the newest read of one of its lists.
                if (result.isFailure && parts.map { fresh(mine, it) }.none { it }) return@ui
                result.onSuccess { apply(it, mine) }.onFailure { failure ->
                    // A user action running now reports its own outcome; an owed retry is never replaced.
                    if (busy || failedAction != null) return@onFailure
                    val message = failure.message ?: failure.javaClass.simpleName
                    error = message
                    if (message.startsWith("SAVE_FAILED")) {
                        val failed = FailedAction("storage", "")
                        Log.w(CoreHost.TAG, "Core background read failed lock=storage")
                        ProcessCoreHost.recordFailure(ProcessCoreHost.PendingFailure(failed, message, rows, total, editor, screen, focus, projects, project, areaFilter))
                        failedAction = failed
                    }
                }
            }
        }, "mindwtr-read").start()
    }

    /**
     * A user action, one at a time: a command ([action]) or a read the user asked for.
     * Only these take [busy]. While a failed command's retry is owed, only that exact
     * [action] runs: no read starts, so none can clear the failure or replace it. The
     * retry keeps the failure on screen until it succeeds or fails again. After a
     * command succeeds, its lists are read again in the background.
     */
    private fun perform(action: FailedAction? = null, work: (CoreHost) -> Unit) {
        val runtime = host
        if (busy || runtime == null || (failedAction != null && failedAction != action)) return
        busy = true
        if (action != null) commandAt = ++issued
        if (failedAction == null) error = null
        conflict = false
        Thread({
            var done = false
            try { work(runtime); done = true }
            catch (failure: Throwable) {
                val message = failure.message ?: failure.javaClass.simpleName
                val refused = action?.kind == "update" && UPDATE_REFUSALS.any { message.startsWith(it) }
                val failed = if ((action != null && !refused) || message.startsWith("SAVE_FAILED")) {
                    action ?: FailedAction("storage", "")
                } else null
                Log.e(CoreHost.TAG, "Core action failed action=${action?.kind ?: "read"} lock=${failed?.kind ?: "none"}", failure)
                // Recorded before the UI update so a screen opening now still finds it.
                if (failed != null) {
                    ProcessCoreHost.recordFailure(ProcessCoreHost.PendingFailure(failed, message, rows, total, editor, screen, focus, projects, project, areaFilter))
                }
                ui {
                    // A read never replaces an owed command's retry, whatever order the failures arrive in.
                    val owed = failedAction?.takeIf { action == null && it.kind != "storage" }
                    if (owed == null) {
                        error = message
                        conflict = message.startsWith("STALE_REVISION")
                        if (failed != null) failedAction = failed
                    }
                }
            } finally {
                ui {
                    busy = false
                    if (done && action != null) refreshAll()
                }
            }
        }, "mindwtr-action").start()
    }
}
