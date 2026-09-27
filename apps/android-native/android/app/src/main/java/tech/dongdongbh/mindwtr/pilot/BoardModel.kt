package tech.dongdongbh.mindwtr.pilot

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.InboxViewModel.Part
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import java.util.UUID

/*
 * RN's Board (components/views/board-view.tsx) on core's Board contract (native-host-contract-board.ts). Kotlin keeps only RN's
 * screen state: core's filter state (sent back with every read and move), the search as typed, and the open filter sheet. The
 * columns, cards, counts, filter options and labels are core's; every write is core's runBoardAction through MenuModel.
 */

/** A column's cards per window. */
private const val PAGE = 50
/** Core windows every collection by NATIVE_HOST_MAX_WINDOW. */
private const val WINDOW = 100

/** The Board at one revision: core's view, each column's cards as loaded (by status), and the sheet's lists as paged. */
class BoardPage(val view: JSONObject, val cards: Map<String, List<JSONObject>>, val lists: Map<String, List<JSONObject>>) {
    val revision: String get() = view.getString("revision")
    val filters: JSONObject get() = view.getJSONObject("filters")
    /** A sheet list (tokens, projects, chips) as shown: its first window, or as many as More loaded. */
    fun collection(name: String): List<JSONObject> = lists[name] ?: view.getJSONObject("sheet").getJSONObject(name).menuObjects("items")
    fun collectionTotal(name: String): Int = view.getJSONObject("sheet").getJSONObject(name).getInt("total")
    /** How deep each column and list is shown, so a refresh reads it as deep. */
    val depth: Map<String, Int> get() = cards.mapValues { it.value.size } + lists.mapValues { it.value.size }
}

class BoardModel(private val menu: MenuModel, private val saved: SavedStateHandle) {
    private val shell get() = menu.shell
    private val main = Handler(Looper.getMainLooper())

    /** Core's effective filter state (the view's `filters`), sent back with every read and move. */
    var filters by mutableStateOf(saved.get<String>("boardFilters")?.let(::JSONObject) ?: JSONObject()); private set
    /** The search box as typed, until core's setSearch has read it. */
    var typed by mutableStateOf(saved.get<String>("boardSearch")); private set
    var page by mutableStateOf<BoardPage?>(null); private set
    /** RN's filter sheet: open with its page (the tokens or projects picker) and the due-date section's fold. */
    var sheet by mutableStateOf(saved.get<String>("boardSheet")?.let(::JSONObject)); private set

    private fun keepFilters(value: JSONObject) { filters = value; saved["boardFilters"] = value.toString() }
    private fun keepTyped(value: String?) { typed = value; saved["boardSearch"] = value }
    fun keepSheet(value: JSONObject?) { sheet = value; saved["boardSheet"] = value?.toString() }

    /** RN pushes a new Board: no filters, no search, the sheet closed. */
    fun reset() {
        keepFilters(JSONObject()); keepTyped(null); keepSheet(null)
        page = null
    }

    // ---- Reads ----

    /**
     * Core's Board for [sent] (with [edit] once), each column and sheet list read to its depth in [depth] at one revision. A Board
     * that changed between windows is read again from its first window once; a second change keeps what was read.
     */
    private fun read(runtime: CoreHost, sent: JSONObject, edit: JSONObject?, depth: Map<String, Int>, again: Boolean = true): BoardPage {
        val view = runtime.menuRead("board", JSONObject().put("filters", sent).put("limit", PAGE).apply { edit?.let { put("filterEdit", it) } }.toString())
        check(view.optInt("version", 1) == 1) { "Unsupported core contract" }
        val cards = LinkedHashMap<String, List<JSONObject>>()
        for (column in view.menuObjects("columns")) cards[column.getString("status")] = column.menuObjects("cards")
        var shown = BoardPage(view, cards, emptyMap())
        try {
            for ((name, want) in depth) shown = pageTo(runtime, shown, name, want)
        } catch (failure: Exception) {
            if (failure.message?.startsWith("STALE_REVISION") != true) throw failure
            if (again) return read(runtime, view.getJSONObject("filters"), null, depth, again = false)
        }
        return shown
    }

    /** [shown]'s column (by status) or sheet list ([name]) paged through core's getBoardList until [want] items show. */
    private fun pageTo(runtime: CoreHost, shown: BoardPage, name: String, want: Int): BoardPage {
        val column = shown.view.menuObjects("columns").firstOrNull { it.getString("status") == name }
        var loaded = if (column != null) shown.cards[name].orEmpty() else shown.collection(name)
        val total = column?.getInt("count") ?: shown.collectionTotal(name)
        while (loaded.size < minOf(want, total)) {
            val input = JSONObject().put("filters", shown.filters).put("offset", loaded.size).put("limit", if (column != null) PAGE else WINDOW)
                .put("revision", shown.revision).apply { if (column != null) put("list", "cards").put("status", name) else put("list", name) }
            val next = runtime.menuRead("boardList", input.toString()).menuObjects("items")
            if (next.isEmpty()) break // core sent no items: stop, never spin
            loaded = loaded + next
        }
        return if (column != null) BoardPage(shown.view, shown.cards + (name to loaded), shown.lists)
        else BoardPage(shown.view, shown.cards, shown.lists + (name to loaded))
    }

    /** Core's answer on screen, and its effective filters (selections no longer offered dropped) become the screen's. */
    private fun show(next: BoardPage) {
        if (menu.list != "board") return
        page = next
        keepFilters(next.filters)
    }

    /** A read the user asked for: a new filter ([edit], core's own edit or a control's documented one) or More, through perform. */
    fun reload(edit: JSONObject? = null, depth: Map<String, Int> = page?.depth.orEmpty()) = menu.whenIdle {
        val sent = filters
        val mine = shell.issue()
        shell.perform { runtime ->
            val next = read(runtime, sent, edit, depth)
            shell.ui { if (shell.fresh(mine, Part.Menu)) show(next) }
        }
    }

    /** On resume and after every command: the Board again, as deep as shown, in the background. */
    fun refresh() {
        val sent = filters
        val depth = page?.depth.orEmpty()
        shell.background(listOf(Part.Menu), { runtime -> read(runtime, sent, null, depth) }) { next, mine ->
            if (shell.fresh(mine, Part.Menu)) show(next)
        }
    }

    /** A column's (by status) or a sheet list's next window. */
    fun more(name: String) {
        val shown = page ?: return
        val loaded = shown.cards[name]?.size ?: shown.collection(name).size
        reload(depth = shown.depth + (name to loaded + if (shown.cards.containsKey(name)) PAGE else WINDOW))
    }

    // ---- Filters: each control sends core's edit ----

    /** A chip's or option's edit as core put it on the control (a chip's removal, a due preset, Clear). */
    fun filterEdit(edit: JSONObject) {
        val type = edit.optString("type")
        if (type == "clear" || type == "setSearch") keepTyped(null)
        reload(edit)
    }

    /** The search box's clear button and the bar's Clear: core's setSearch with nothing, and core's clear. */
    fun clearSearch() = filterEdit(JSONObject().put("type", "setSearch").put("value", ""))
    fun clearFilters() = filterEdit(JSONObject().put("type", "clear"))

    private var searchTyped = 0

    /** The search box: kept as typed, then core's setSearch once typing pauses. */
    fun typeSearch(text: String) {
        keepTyped(text)
        val mine = ++searchTyped
        main.postDelayed({ if (mine == searchTyped) reload(JSONObject().put("type", "setSearch").put("value", text)) }, 200)
    }

    /** The sheet's token and project rows and the match control, as the contract documents their edits. */
    fun toggleToken(value: String) = reload(JSONObject().put("type", "toggleToken").put("value", value))
    fun toggleProject(id: String) = reload(JSONObject().put("type", "toggleProject").put("value", id))
    fun matchMode(kind: String, value: String) = reload(JSONObject().put("type", "setMatchMode").put("kind", kind).put("value", value))

    /** A due preset folds the section, as RN's handleToggleDuePreset does. */
    fun duePreset(preset: String) {
        sheet?.let { keepSheet(JSONObject(it.toString()).put("due", false)) }
        reload(JSONObject().put("type", "toggleDuePreset").put("preset", preset))
    }

    // ---- Writes: core's runBoardAction ----

    /**
     * A drop: into another column only the status ([afterId] absent); inside its column after [afterId] (null: first), among the
     * cards as these filters show them. Core plans the write from the moved card's id (no column is renumbered here).
     */
    fun move(taskId: String, status: String, afterId: String?, sameColumn: Boolean) {
        val action = JSONObject().put("type", "moveCard").put("taskId", taskId).put("status", status).put("filters", filters)
        if (sameColumn) action.put("afterId", afterId ?: JSONObject.NULL)
        menu.command("boardAction", JSONObject().put("action", action))
    }

    /** RN's swipe-left panel: Delete (core's trashTask; RN asks nothing and offers no Undo here). */
    fun trash(taskId: String) = menu.command("boardAction", JSONObject().put("action", JSONObject().put("type", "trashTask").put("taskId", taskId)))

    /** RN's swipe-right panel: Duplicate, which keeps the original; the request UUID becomes the copy's id, on disk first. */
    fun duplicate(taskId: String) = menu.create(FailedAction("boardCreate", UUID.randomUUID().toString(),
        JSONObject().put("action", JSONObject().put("type", "duplicateTask").put("taskId", taskId)).toString()))

    /** Core's answer: a Duplicate opens its copy in the editor, as RN's openTaskScreen does. */
    fun done(action: FailedAction, reply: JSONObject) {
        if (action.kind != "boardCreate") return
        // After the command ends: openEditor is a read that refuses while the command still runs (the copy never opened, run 44).
        reply.optJSONObject("open")?.let { open -> menu.whenIdle { shell.openEditor(open.getString("taskId")) } }
    }
}
