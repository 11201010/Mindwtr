package tech.dongdongbh.mindwtr.pilot

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import org.json.JSONArray
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.InboxViewModel.Part
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import java.util.UUID

/*
 * RN's Calendar (components/views/calendar-view.tsx, calendar/useCalendarViewController.ts) on core's calendar contract
 * (native-host-contract-calendar.ts). Kotlin keeps only RN's screen state: the place core's view names (its `state`), the
 * search under the selected day, the open item sheet, and the open composer. Every heading, item, minute, day key and label
 * is core's; every write is core's runCalendarAction through MenuModel (perform, with its exact request). This host fetches
 * no external calendar, so it sends no `calendar` feed and core shows no events.
 */

/** Core windows every collection by NATIVE_HOST_MAX_WINDOW. */
private const val WINDOW = 100

/**
 * The open composer: core's view ([view], NativeCalendarComposerView), its request UUID (core makes it a new task's id), the
 * text typed into each field, the edits waiting for core (the latest of each kind), and a Save waiting for them.
 */
data class ComposerDraft(
    val view: JSONObject, val requestId: String, val typed: Map<String, String> = emptyMap(), val edits: List<JSONObject> = emptyList(),
    val saveQueued: Boolean = false, val session: String = UUID.randomUUID().toString(),
) {
    fun state(): JSONObject = JSONObject().put("view", view).put("requestId", requestId).put("typed", JSONObject(typed as Map<*, *>))
        .put("edits", JSONArray(edits)).put("saveQueued", saveQueued)

    companion object {
        fun restore(json: JSONObject): ComposerDraft {
            val typed = json.getJSONObject("typed")
            val edits = json.getJSONArray("edits")
            return ComposerDraft(json.getJSONObject("view"), json.getString("requestId"),
                typed.keys().asSequence().associateWith { typed.getString(it) }, List(edits.length()) { edits.getJSONObject(it) }, json.optBoolean("saveQueued"))
        }
    }
}

/**
 * The Calendar's state, held by MenuModel (so rotation keeps it) and saved in the Bundle (so process death keeps the place, the
 * search, the sheet and the composer draft). The view reloads from core.
 */
class CalendarModel(private val menu: MenuModel, private val saved: SavedStateHandle) {
    private val shell get() = menu.shell
    private val main = Handler(Looper.getMainLooper())

    /** Core's NativeCalendarState for the place on screen; null opens core's saved view mode on today. */
    var state by mutableStateOf(saved.get<String>("calendarState")?.let(::JSONObject)); private set
    /** The search under the selected day (month details, day view), as typed. */
    var query by mutableStateOf(saved.get<String>("calendarQuery").orEmpty()); private set
    /** Core's getCalendarView for [state] and [query], every window read at one revision. */
    var view by mutableStateOf<JSONObject?>(null); private set
    /** The open item sheet: core's getCalendarItemSheet reply (RN's Alert). */
    var sheet by mutableStateOf(saved.get<String>("calendarSheet")?.let(::JSONObject)); private set
    var composer by mutableStateOf(saved.get<String>("calendarComposer")?.let { ComposerDraft.restore(JSONObject(it)) }); private set
    /** A minute the timeline scrolls to once: core's scrollToMinutes after a composer save. */
    var scrollTo by mutableStateOf<Int?>(null); private set

    private fun keepState(value: JSONObject?) { state = value; saved["calendarState"] = value?.toString() }
    private fun keepQuery(value: String) { query = value; saved["calendarQuery"] = value }
    private fun keepSheet(value: JSONObject?) { sheet = value; saved["calendarSheet"] = value?.toString() }
    private fun keepComposer(value: ComposerDraft?) { composer = value; saved["calendarComposer"] = value?.state()?.toString() }

    /** RN pushes a new Calendar: core's saved mode on today, no search, nothing open. */
    fun reset() {
        keepState(null); keepQuery(""); keepSheet(null); keepComposer(null)
        view = null
        scrollTo = null
    }

    fun scrolled() { scrollTo = null }

    // ---- Reads ----

    /**
     * Core's view for [sent] and [sentQuery]: every window at one revision. A view that changed between windows (an edit, a new
     * minute) is read again from the first window once; a second change keeps what was read, as the lists do.
     */
    private fun read(runtime: CoreHost, sent: JSONObject?, sentQuery: String, again: Boolean = true): JSONObject {
        val input = JSONObject().put("scheduleQuery", sentQuery).apply { sent?.let { put("state", it) } }
        val first = runtime.menuRead("calendar", JSONObject(input.toString()).put("offset", 0).put("limit", WINDOW).toString())
        check(first.optInt("version", 1) == 1) { "Unsupported core contract" }
        val items = first.getJSONArray("items")
        try {
            while (items.length() < first.getInt("total")) {
                val next = runtime.menuRead("calendar", JSONObject(input.toString()).put("offset", items.length()).put("limit", WINDOW)
                    .put("revision", first.getString("revision")).toString()).getJSONArray("items")
                if (next.length() == 0) break // core sent no items: stop, never spin
                for (index in 0 until next.length()) items.put(next.get(index))
            }
        } catch (failure: Exception) {
            if (failure.message?.startsWith("STALE_REVISION") != true) throw failure
            if (again) return read(runtime, sent, sentQuery, again = false)
        }
        return first
    }

    /** A view counts only for the place and search it was read for; core's state (today filled in) becomes the screen's. */
    private fun show(sent: JSONObject?, sentQuery: String, next: JSONObject) {
        if (menu.list != "calendar" || sent?.toString() != state?.toString() || sentQuery != query) return
        view = next
        keepState(next.getJSONObject("state"))
    }

    /** A read the user asked for (a new place): through perform, once no action runs. */
    fun reload() = menu.whenIdle {
        val sent = state
        val sentQuery = query
        val mine = shell.issue()
        shell.perform { runtime ->
            val next = read(runtime, sent, sentQuery)
            shell.ui { if (shell.fresh(mine, Part.Menu)) show(sent, sentQuery, next) }
        }
    }

    /** On resume, each minute while shown, and after every command: the view again, in the background. */
    fun refresh() {
        val sent = state
        val sentQuery = query
        shell.background(listOf(Part.Menu), { runtime -> read(runtime, sent, sentQuery) }) { next, mine ->
            if (shell.fresh(mine, Part.Menu)) show(sent, sentQuery, next)
        }
        pumpComposer()
    }

    // ---- Navigation: every control carries the state it leads to ----

    /** Core's state for a control (previous, next, Today, a mode, a week day's header, the details' close). */
    fun go(next: JSONObject) {
        keepState(next)
        keepSheet(null)
        reload()
    }

    /** A month day: the same place with that day (core's key) selected, as RN's handleMonthDayPress. */
    fun select(dayKey: String) = state?.let { go(JSONObject(it.toString()).put("selectedDate", dayKey)) }

    /** RN's mode switch: core's state for the mode, and core's setViewMode (the saved mode), whose refresh shows it. */
    fun mode(option: JSONObject) {
        keepState(option.getJSONObject("state"))
        keepSheet(null)
        act(JSONObject().put("type", "setViewMode").put("viewMode", option.getString("mode")))
    }

    private var typedQuery = 0

    /** The search under the selected day, read once typing pauses. */
    fun typeQuery(text: String) {
        keepQuery(text)
        val mine = ++typedQuery
        main.postDelayed({ if (mine == typedQuery) menu.whenIdle { refresh() } }, 200)
    }

    // ---- Writes: core's runCalendarAction, with the view's state ----

    private fun act(action: JSONObject) = menu.command("calendarAction", JSONObject().put("action", action).apply { state?.let { put("state", it) } })

    fun showCompleted(on: Boolean) = act(JSONObject().put("type", "setShowCompleted").put("on", on))
    fun density(days: Int) = act(JSONObject().put("type", "setWeekVisibleDays").put("days", days))
    /** Done, at the task's revision as the view showed it (an item's row, or the sheet's). */
    fun complete(taskId: String, taskRevision: String) = act(JSONObject().put("type", "completeTask").put("taskId", taskId).put("taskRevision", taskRevision))

    /** A timeline block let go at [startMinutes] into [dayKey] (core's grid cell): one moveTask with the task's own duration, at its row's revision. */
    fun move(item: JSONObject, dayKey: String, startMinutes: Int) {
        val timed = item.getJSONObject("timed")
        if (startMinutes == timed.getInt("startMinutes")) return
        act(JSONObject().put("type", "moveTask").put("taskId", item.getString("taskId")).put("day", dayKey)
            .put("startMinutes", startMinutes).put("durationMinutes", timed.getInt("durationMinutes")).put("taskRevision", item.rowRevision()))
    }

    // ---- The item sheet ----

    /** Pressing an item: core's sheet for its task (Edit, Remove from calendar, Done, Delete, Cancel), in RN's dialog. */
    fun openItem(item: JSONObject) {
        val taskId = item.menuText("taskId") ?: return // an event: this host sends none
        val sent = state
        shell.perform { runtime ->
            val reply = runtime.menuRead("calendarSheet", JSONObject().put("taskId", taskId).apply { sent?.let { put("state", it) } }.toString())
            shell.ui { keepSheet(reply) }
        }
    }

    fun closeSheet() = keepSheet(null)

    /** A sheet button by core's id: Edit opens the editor; the rest are core's actions, at the sheet's taskRevision; Cancel and OK only close. */
    fun press(id: String) {
        val taskId = sheet?.menuText("taskId")
        val revision = sheet?.optString("taskRevision").orEmpty()
        keepSheet(null)
        if (taskId == null) return
        when (id) {
            "edit" -> shell.openEditor(taskId)
            "unschedule" -> act(JSONObject().put("type", "unscheduleTask").put("taskId", taskId).put("taskRevision", revision))
            "done" -> complete(taskId, revision)
            "delete" -> act(JSONObject().put("type", "deleteTask").put("taskId", taskId).put("taskRevision", revision))
        }
    }

    // ---- The composer ----

    /** Core's composer for [input] (a day, or a task to schedule on the selected day), or core's no-free-time toast. */
    private fun openComposer(input: JSONObject, start: String? = null) {
        shell.perform { runtime ->
            val reply = runtime.menuRead("calendarComposer", input.toString())
            shell.ui {
                reply.optJSONObject("toast")?.let(::toast)
                reply.optJSONObject("composer")?.let { opened ->
                    keepComposer(ComposerDraft(opened, UUID.randomUUID().toString()))
                    start?.let { typeTime("start", it) }
                }
            }
        }
    }

    /** Add task, or a week column: the day's first free slot. */
    fun addTask(dayKey: String) = openComposer(JSONObject().put("day", dayKey))

    /** A search or planning row: that task on the selected day's first free slot. */
    fun schedule(taskId: String) = state?.menuText("selectedDate")?.let { openComposer(JSONObject().put("scheduleTaskId", taskId).put("day", it)) }

    /** A day timeline tap at [minutes] into [dayKey] (core's grid cell): the composer for that day, its start typed as RN's field takes it. */
    fun addAt(dayKey: String, minutes: Int) = openComposer(JSONObject().put("day", dayKey), pickedTime(minutes / 60, minutes % 60))

    fun closeComposer() {
        keepComposer(null)
        inFlight = null
    }

    /** The title or the search typed, then core's title or query edit with it. */
    fun typeTitle(text: String) = edit("title", JSONObject().put("type", "title").put("title", text), text)
    fun typeCandidates(text: String) = edit("query", JSONObject().put("type", "query").put("query", text), text)

    /** The start or end typed ([field]: start or end), then core's time edit (NativeCalendarComposerEdit) with the raw text, as RN's field takes it. */
    fun typeTime(field: String, text: String) = edit(field, JSONObject().put("type", if (field == "start") "startTime" else "endTime").put("value", text), text)

    /** A control's edit with core's own value (the mode, a candidate, a duration chip). */
    fun choose(edit: JSONObject) = edit(null, edit, null)

    /** Queues [edit]: a queued edit of the same kind that core has not started is replaced, so typing sends the latest text. */
    private fun edit(field: String?, edit: JSONObject, text: String?) {
        val draft = composer ?: return
        val kept = ArrayList<JSONObject>()
        for (queued in draft.edits) if (queued === inFlight || queued.optString("type") != edit.optString("type")) kept.add(queued)
        // A chosen task puts its title in the search (core's selectComposerTask): the field shows core's text again.
        val typed = if (field != null && text != null) draft.typed + (field to text) else if (edit.optString("type") == "selectTask") draft.typed - "query" else draft.typed
        keepComposer(draft.copy(typed = typed, edits = kept + edit))
        pumpComposer()
    }

    /** The edit core is answering now. */
    private var inFlight: JSONObject? = null

    /** Sends the next queued edit (core's editCalendarComposer; nothing is written), then a queued Save. Called again whenever no action runs. */
    fun pumpComposer() {
        val draft = composer ?: return
        if (inFlight != null || shell.busy || shell.failedAction != null) return
        val next = draft.edits.firstOrNull() ?: run { if (draft.saveQueued) save(); return }
        inFlight = next
        val request = JSONObject().put("composer", draft.view.getJSONObject("composer")).put("edit", next)
        shell.background(emptyList(), { runtime -> runCatching { runtime.menuRead("calendarEdit", request.toString()) } }) { reply, _ ->
            if (inFlight === next) inFlight = null
            // A reply counts only for its composer and the edit it answers, still first in the queue.
            val now = composer?.takeIf { it.session == draft.session && it.edits.firstOrNull() === next } ?: return@background pumpComposer()
            reply.onSuccess { answered -> keepComposer(now.copy(view = answered, edits = now.edits.drop(1))) }
                .onFailure { failure ->
                    // Core refused the edit: its message shows, and the queue (with a queued Save) is dropped.
                    shell.showToast(null, (failure.message ?: failure.javaClass.simpleName).substringAfter(": "), "warning")
                    keepComposer(now.copy(edits = emptyList(), saveQueued = false))
                }
            pumpComposer()
        }
    }

    /** Save's exact request: core's composer as last answered, the view's state, and the composer's request UUID. */
    private fun saveAction(draft: ComposerDraft) = FailedAction("calendarCreate", draft.requestId, JSONObject()
        .put("action", JSONObject().put("type", "saveComposer").put("composer", draft.view.getJSONObject("composer")))
        .apply { state?.let { put("state", it) } }.toString())

    /** This composer's Save failed and its exact request is owed: Save sends that request again. */
    fun owed(draft: ComposerDraft): FailedAction? = shell.failedAction?.takeIf { it.kind == "calendarCreate" && it.id == draft.requestId }

    /** RN's Save: edits still with core go first; the request is on disk before the call (MenuModel.create). */
    fun save() {
        val draft = composer ?: return
        owed(draft)?.let { return menu.create(it) }
        if (draft.edits.isNotEmpty() || inFlight != null) return keepComposer(draft.copy(saveQueued = true))
        keepComposer(draft.copy(saveQueued = false))
        menu.create(saveAction(draft))
    }

    // ---- Core's answers ----

    /** Core refused this composer's Save before writing (its message shows in the failure banner): the next Save is a new request. */
    fun refused(action: FailedAction) {
        composer?.takeIf { it.requestId == action.id }?.let { keepComposer(it.copy(requestId = UUID.randomUUID().toString())) }
    }

    private fun toast(toast: JSONObject) = shell.showToast(toast.menuText("title"), toast.getString("message"), toast.getString("tone"))

    /**
     * Core's answer to a calendar action: its toast (a time conflict), a refused composer save's error (the composer stays, its
     * request ID still free), or a saved composer: it closes and the screen shows core's next place (the day view on the new
     * start, scrolled to it), with the search cleared, as RN's saveCalendarComposer does.
     */
    fun done(action: FailedAction, reply: JSONObject) {
        reply.optJSONObject("toast")?.let(::toast)
        if (action.kind != "calendarCreate") return
        val draft = composer?.takeIf { it.requestId == action.id }
        reply.optJSONObject("composer")?.let { refused -> draft?.let { keepComposer(it.copy(view = refused)) }; return }
        if (draft != null) closeComposer()
        if (menu.list != "calendar") return
        keepQuery("")
        reply.optJSONObject("next")?.let { keepState(it); keepSheet(null) }
        scrollTo = if (reply.isNull("scrollToMinutes")) null else reply.getInt("scrollToMinutes")
    }
}

/** A calendar item's task revision as the view showed it (its `row.taskRevision`); a write to that task sends it. */
internal fun JSONObject.rowRevision(): String = optJSONObject("row")?.optString("taskRevision").orEmpty()
