package tech.dongdongbh.mindwtr.pilot

import android.util.Log
import android.content.SharedPreferences
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
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/*
 * RN's Menu tab (app/(drawer)/(tabs)/_layout.tsx): the More sheet and the list screens it opens, on core's menu view
 * contract (native-host-contract-menu-views.ts), History's Archive, Contexts and Trash (the list views block of
 * native-host-contract.ts), Review with the Weekly and Daily Review (native-host-contract-review-views.ts), and the Calendar and
 * the Board (CalendarModel.kt, BoardModel.kt, on native-host-contract-calendar.ts and native-host-contract-board.ts).
 * Kotlin keeps only RN's screen state: which sheet, screen and dialog are open, the session choices RN keeps in React
 * state, and the device choices RN keeps under its keys. Every row, heading, count, label, filter and edit is core's.
 * Reads and commands run on InboxViewModel's paths (perform, background, freshness, the exact-retry lock).
 */

private const val PAGE = 50
/** Core windows every collection by NATIVE_HOST_MAX_WINDOW. */
private const val WINDOW = 100

/** The Menu tab's commands (host-entry.ts MENU_COMMANDS); core can refuse each before writing. */
val MENU_KINDS = setOf("activateProject", "somedayMove", "somedayUndo", "somedayTask", "somedaySection", "taskListSort", "archiveAction",
    "contextsAction", "trashAction", "reviewAction", "reviewTask", "calendarAction", "calendarCreate", "boardAction", "boardCreate")
/**
 * The creates whose exact request waits on disk until core answers: Someday's, the Weekly Review's project Add task, the
 * Calendar composer's Save, and the Board's Duplicate.
 */
private val CREATES = setOf("somedayTask", "somedaySection", "reviewTask", "calendarCreate", "boardCreate")

/**
 * The screens the More sheet opens here, with the title key of RN's stack header. History holds Done and Archived; Projects is
 * RN's Projects stack screen when the quick-access tab holds another view; Weekly and Daily are RN's review flows, full screen
 * over Review (or its tab), with core's own header.
 */
enum class MenuScreen(val title: String) {
    Waiting("waiting.title"), Someday("someday.title"), Reference("nav.reference"), History("nav.history"),
    Contexts("contexts.title"), Trash("trash.title"), Review("nav.review"), Projects("projects.title"), Weekly("nav.review"), Daily("nav.review"),
    Calendar("nav.calendar"), Board("nav.board"),
}

/** Core's bulk actions (Contexts, Trash, Review): each ends RN's selection mode once core answers. */
private val BULK = setOf("moveTasks", "editTaskTokens", "trashTasks", "restoreItems", "purgeItems", "emptyTrash", "addTag", "removeTags", "markReviewedTasks")

/** The lists whose contract writes their rows' status (Contexts, and the Review screens): the command kind for each. */
private val ROW_KINDS = mapOf("contexts" to "contextsAction", "review" to "reviewAction", "weekly" to "reviewAction", "daily" to "reviewAction")

/** RN's routes for the lists this app has (search results and the More sheet's tiles go there). */
private val ROUTES = mapOf("/waiting" to (MenuScreen.Waiting to null), "/someday" to (MenuScreen.Someday to null),
    "/reference" to (MenuScreen.Reference to null), "/done" to (MenuScreen.History to "done"), "/archived" to (MenuScreen.History to "archived"))
fun isMenuRoute(route: String?) = route in ROUTES

/** One list item as core sent it ([json]); a task item also carries its parsed [row]. */
class MenuItem(val json: JSONObject, val row: TaskRow?) {
    /** Waiting's rows are plain task rows; the other lists say what each item is. */
    val type: String get() = json.optString("type", "task")
    /** A multi-tag task shows under each tag heading, so the heading is part of its key, as RN's keyExtractor does. A Weekly Review context card is keyed by its context. */
    val key: String get() = if (row != null) "task:${json.optString("groupId")}:${row.id}" else "$type:${json.optString("id").ifEmpty { json.optString("context") }}"
}

private fun JSONObject.list(name: String): List<JSONObject> = optJSONArray(name)?.let { items -> List(items.length()) { items.getJSONObject(it) } }.orEmpty()

private fun JSONObject.menuItems(): List<MenuItem> {
    optJSONArray("rows")?.let { rows -> return List(rows.length()) { index -> rows.getJSONObject(index).let { MenuItem(it, it.taskRow()) } } }
    // A Daily Review item has no type: it is a task row with the step's flags.
    return list("items").map { item -> MenuItem(item, if (item.optString("type", "task") == "task") item.getJSONObject("row").taskRow() else null) }
}

/** Where each windowed collection sits in its view (native-host-contract-menu-views.ts). */
private fun window(view: JSONObject, name: String): JSONObject? = when (name) {
    "people" -> view.optJSONObject("people")
    "deferredProjects" -> view.optJSONObject("deferred")?.optJSONObject("rows")
    "tokens" -> view.optJSONObject("filters")?.optJSONObject("tokens")
    "projects" -> view.optJSONObject("filters")?.optJSONObject("projects")
    "sections" -> view.optJSONObject("sections")
    "savedSearches" -> view.optJSONObject("savedSearches")
    // The Weekly Review's nested lists (getWeeklyReviewList); a context card's tasks sit on its item (MenuPage.source).
    "staleProjects" -> view.optJSONObject("content")?.optJSONObject("projects")
    else -> null
}

/**
 * A menu view at one revision: core's reply for its first window ([view]), the inputs core accepted ([params], sent again
 * for every later window), its items as deep as shown, and each windowed collection as paged.
 */
class MenuPage(val view: JSONObject, val params: JSONObject, val items: List<MenuItem>, private val paged: Map<String, List<JSONObject>>) {
    val revision: String get() = view.getString("revision")
    val total: Int get() = view.optInt("total")
    /** A collection's items as shown: its first window, or as many as More loaded. */
    fun collection(name: String): List<JSONObject> = paged[name] ?: source(name)?.list("items").orEmpty()
    fun collectionTotal(name: String): Int = source(name)?.optInt("total") ?: 0
    /** Where a collection's first window is: in the view, or on a Weekly Review context card ("contextTasks:<context>"). */
    private fun source(name: String): JSONObject? = window(view, name)
        ?: items.firstNotNullOfOrNull { item -> item.json.optJSONObject("tasks")?.takeIf { name == "contextTasks:${item.json.optString("context")}" } }
    /** How deep each paged collection is shown, so a refresh reads it as deep. */
    val deep: Map<String, Int> get() = paged.mapValues { it.value.size }
    fun appended(more: List<MenuItem>) = MenuPage(view, params, items + more, paged)
    fun withCollection(name: String, items: List<JSONObject>) = MenuPage(view, params, this.items, paged + (name to items))
}

/** A Someday create's exact request in the no-backup folder, synced before the call, until core answers (as the capture's). */
private class MenuStore(private val dir: File) {
    private val file = File(dir, "pending")
    fun read(): FailedAction? = runCatching {
        val saved = JSONObject(file.readText())
        val patch = saved.getJSONObject("patch")
        FailedAction(saved.getString("kind"), saved.getString("id"), saved.getString("title"),
            patch = patch.keys().asSequence().associateWith<String, String?> { if (patch.isNull(it)) null else patch.getString(it) })
    }.getOrNull()
    fun write(action: FailedAction) {
        dir.mkdirs()
        val state = JSONObject().put("kind", action.kind).put("id", action.id).put("title", action.title).put("patch", JSONObject(json(action.patch)))
        val partial = File(dir, "pending-partial")
        FileOutputStream(partial).use { out -> out.write(state.toString().toByteArray()); out.fd.sync() }
        check(partial.renameTo(file)) { "Cannot save the Someday request" }
    }
    fun delete() { file.delete() }
}

private fun JSONArray.strings(): List<String> = List(length()) { getString(it) }

/**
 * The Menu tab's state, held by InboxViewModel (so rotation keeps it) and saved in the Bundle (so process death keeps the
 * open sheet, screen, History tab, dialog, and RN's session choices). Rows reload from core.
 */
class MenuModel(internal val shell: InboxViewModel, private val saved: SavedStateHandle, internal val prefs: SharedPreferences, dir: File) {
    private val store = MenuStore(dir)
    private val main = Handler(Looper.getMainLooper())

    /** RN's More sheet is open (the Menu tab toggles it). */
    var sheet by mutableStateOf(saved.get<Boolean>("menuSheet") == true); private set
    /** Core's getMoreMenu reply, with its saved searches as paged. */
    var more by mutableStateOf<MenuPage?>(null); private set
    /** Core's quickAccessView (getMoreMenu): the view on RN's quick-access tab. In the Bundle, so a recreated screen draws it at once. */
    var quickAccess by mutableStateOf(saved.get<String>("quickAccess")); private set
    /** What the quick-access tab shows: Review, Contexts or the Calendar; Projects otherwise. */
    val quickView: String get() = quickAccess?.takeIf { it == "review" || it == "contexts" || it == "calendar" } ?: "projects"
    /** The quick-access tab's label key (RN's tab title, also its header's). */
    val quickLabel: String get() = when (quickView) { "review" -> "tab.review"; "contexts" -> "nav.contexts"; "calendar" -> "nav.calendar"; else -> "nav.projects" }
    var screen by mutableStateOf(MenuScreen.entries.firstOrNull { it.name == saved.get<String>("menuScreen") }); private set
    /** History's tab, core's HistoryTab id. */
    var historyTab by mutableStateOf(saved.get<String>("historyTab") ?: "done"); private set
    /** Core's getHistoryView reply: its tabs and their labels. */
    var history by mutableStateOf<JSONObject?>(null); private set
    /** The open list at one revision. */
    var page by mutableStateOf<MenuPage?>(null); private set
    /**
     * RN's session choices, as its screens keep them in React state, by list: Waiting's person; Someday's sort, grouping,
     * details and filters; Reference's grouping, archived-projects switch and filters; Done's filters; Archive's segment,
     * search, and selection. Small, so it rides the Bundle.
     */
    var session by mutableStateOf(runCatching { JSONObject(saved.get<String>("menuState") ?: "{}") }.getOrDefault(JSONObject())); private set
    /** The sheet or dialog over the list: filters, the overflow menu, sort, group, move, new section, add task, or a confirm. */
    var dialog by mutableStateOf(saved.get<String>("menuDialog")?.let { runCatching { JSONObject(it) }.getOrNull() }); private set
    /** Core's getSomedayMoveDialog reply for the open move dialog, with its choices as paged. */
    var moveChoices by mutableStateOf<JSONObject?>(null); private set
    /** RN's Calendar and Board: their own state and reads; their writes come back here (command, create). */
    val calendar = CalendarModel(this, saved)
    val board = BoardModel(this, saved)

    /** The core read behind the open screen (History shows Done or Archive), or behind the quick-access tab when it shows. */
    val list: String? get() = when (screen) {
        MenuScreen.Waiting -> "waiting"
        MenuScreen.Someday -> "someday"
        MenuScreen.Reference -> "reference"
        MenuScreen.History -> if (historyTab == "archived") "archive" else "done"
        MenuScreen.Contexts -> "contexts"
        MenuScreen.Trash -> "trash"
        MenuScreen.Review -> "review"
        MenuScreen.Weekly -> "weekly"
        MenuScreen.Daily -> "daily"
        MenuScreen.Calendar -> "calendar"
        MenuScreen.Board -> "board"
        MenuScreen.Projects -> null
        null -> if (shell.screen == Screen.Projects && quickView != "projects") quickView else null
    }

    /** No command runs and no retry is owed: the lists' controls are enabled. */
    val idle get() = shell.writable && !shell.busy && shell.failedAction == null

    fun own(list: String): JSONObject = session.optJSONObject(list) ?: JSONObject()

    private fun keepOwn(list: String, value: JSONObject) {
        session = JSONObject(session.toString()).put(list, value)
        saved["menuState"] = session.toString()
    }

    internal fun editOwn(list: String, edit: JSONObject.() -> Unit) = keepOwn(list, JSONObject(own(list).toString()).apply(edit))

    fun keepDialog(value: JSONObject?) {
        dialog = value
        saved["menuDialog"] = value?.toString()
    }

    /** Closes the dialog of [kind] only, so an answer that arrives late never closes another one. */
    internal fun closeDialog(kind: String) { if (dialog?.optString("kind") == kind) keepDialog(null) }

    // ---- Navigation ----

    /** RN's Menu tab: opens the sheet, or closes it (RN's tab toggles it). */
    fun toggleSheet() = if (sheet) closeSheet() else openSheet()

    private fun openSheet() {
        sheet = true
        saved["menuSheet"] = true
        readMore()
    }

    fun closeSheet() {
        sheet = false
        saved["menuSheet"] = false
    }

    /**
     * A tile's destination by core's id: a list this app has opens; Projects shows the Projects tab. The other tiles are
     * drawn disabled ([opens] is false for them), so they never get here.
     */
    fun openTile(id: String) {
        when (id) {
            "waiting" -> open(MenuScreen.Waiting)
            "someday" -> open(MenuScreen.Someday)
            "reference" -> open(MenuScreen.Reference)
            "history" -> open(MenuScreen.History, "done")
            "review" -> open(MenuScreen.Review)
            "contexts" -> open(MenuScreen.Contexts)
            "trash" -> open(MenuScreen.Trash)
            "calendar" -> open(MenuScreen.Calendar)
            "board" -> open(MenuScreen.Board)
            "projects" -> openProjects(null)
        }
    }

    fun opens(id: String) = id in setOf("waiting", "someday", "reference", "history", "projects", "review", "contexts", "trash", "calendar", "board")

    /**
     * RN's Projects: the quick-access tab while it holds Projects, else RN's Projects stack screen (the tile core shows then);
     * [projectId] opens there (a parked or archived project, a search result).
     */
    fun openProjects(projectId: String?) {
        if (quickView == "projects") { closeSheet(); leave(null); shell.show(Screen.Projects) } else open(MenuScreen.Projects)
        projectId?.let(shell::openProject)
    }

    /** RN's Start Review choice (core's option id): the Daily or the Weekly Review, full screen; Close returns here. */
    fun openReview(id: String) {
        saved["reviewFrom"] = screen?.name
        keepOwn(id, JSONObject())
        open(if (id == "daily") MenuScreen.Daily else MenuScreen.Weekly)
    }

    /** RN's route for a list (a search result core routes there): true when this app has that list. */
    fun openRoute(route: String): Boolean {
        val (target, tab) = ROUTES[route] ?: return false
        open(target, tab)
        return true
    }

    private fun open(target: MenuScreen, tab: String? = null) {
        closeSheet()
        // RN's Review opens folded (its focus effect clears the expansion) and not selecting.
        if (target == MenuScreen.Review) editOwn("review") { remove("expandedAreaIds"); remove("expandedProjectIds"); remove("selected") }
        // RN pushes a new Calendar or Board: it opens in core's saved view mode on today, with no filters.
        if (target == MenuScreen.Calendar) calendar.reset()
        if (target == MenuScreen.Board) board.reset()
        screen = target
        saved["menuScreen"] = target.name
        tab?.let(::keepTab)
        page = null
        keepDialog(null)
        if (target == MenuScreen.History) readHistory()
        reload()
    }

    /**
     * RN's stack Back (the header's chevron, or the system's): the tabs again, or, from a review flow, the screen it opened
     * over (Review, or the quick-access tab), read again.
     */
    fun closeScreen() {
        val flow = screen == MenuScreen.Weekly || screen == MenuScreen.Daily
        leave(if (flow) MenuScreen.entries.firstOrNull { it.name == saved.get<String>("reviewFrom") } else null)
        if (list != null) refresh()
    }

    private fun leave(back: MenuScreen?) {
        if (screen == MenuScreen.Projects) shell.closeProject()
        screen = back
        saved["menuScreen"] = back?.name
        page = null
        keepDialog(null)
    }

    private fun keepTab(tab: String) {
        historyTab = tab
        saved["historyTab"] = tab
    }

    /** History's tab bar: the other tab's list, read from its first window. */
    fun showTab(tab: String) {
        if (tab == historyTab) return
        keepTab(tab)
        page = null
        keepDialog(null)
        readHistory()
        reload()
    }

    // ---- Reads ----

    /** The inputs of [list] as its screen keeps them, without paging. */
    private fun params(list: String): JSONObject {
        val own = own(list)
        val kept = { names: List<String> -> JSONObject().apply { for (name in names) if (own.has(name)) put(name, own.get(name)) } }
        return when (list) {
            "waiting" -> JSONObject().put("person", own.optString("person"))
            "someday" -> kept(listOf("sortBy", "groupBy", "showDetails", "filters"))
            "reference" -> kept(listOf("groupBy", "includeArchivedProjects", "filters")).put("collapsedGroupIds", GroupCollapse.all(prefs, "reference", 200))
            "done" -> ListViewState.read(prefs, DONE_VIEW_KEY).into(kept(listOf("filters"))).put("collapsedGroupIds", GroupCollapse.all(prefs, "done", 200))
            "archive" -> ListViewState.read(prefs, ARCHIVED_VIEW_KEY).into(kept(listOf("segment")))
                .put("filters", JSONObject().put("searchQuery", own.optString("search")))
                .put("collapsedGroupIds", GroupCollapse.all(prefs, "archived", 1000)).put("selectedIds", own.optJSONArray("selected") ?: JSONArray())
            "contexts" -> kept(listOf("tokens", "matchMode", "searchQuery")).put("selectedIds", own.optJSONArray("selected") ?: JSONArray())
            "trash" -> JSONObject().put("selected", JSONObject().put("taskIds", own.optJSONArray("selectedTasks") ?: JSONArray())
                .put("projectIds", own.optJSONArray("selectedProjects") ?: JSONArray()))
            // RN's Review opens on its Due scope.
            "review" -> kept(listOf("expandedAreaIds", "expandedProjectIds")).put("scope", own.optString("scope", "due"))
                .put("selectedIds", own.optJSONArray("selected") ?: JSONArray())
            // A review's place is the checkpoint core gave last, kept on the device as RN keeps its session.
            "weekly" -> JSONObject().put("checkpoint", prefs.getString(WEEKLY_REVIEW_KEY, null) ?: JSONObject.NULL)
                .put("expandedProjectId", own.opt("expandedProjectId") ?: JSONObject.NULL)
            "daily" -> JSONObject().put("checkpoint", prefs.getString(DAILY_REVIEW_KEY, null) ?: JSONObject.NULL)
            else -> JSONObject()
        }
    }

    /** What core accepted: the same inputs with core's returned filters and none of a one-time edit, for every later window. */
    private fun accepted(list: String, params: JSONObject, view: JSONObject): JSONObject = JSONObject(params.toString()).apply {
        view.optJSONObject("filters")?.optJSONObject("state")?.let { put("filters", it) }
        if (list == "waiting") put("person", view.getString("person"))
        if (list == "reference") put("includeArchivedProjects", view.getBoolean("includeArchivedProjects"))
        view.optJSONObject("selection")?.let { put("tokens", it.getJSONArray("tokens")).put("matchMode", it.getString("matchMode")) }
        if (list == "review") put("expandedAreaIds", view.getJSONArray("expandedAreaIds")).put("expandedProjectIds", view.getJSONArray("expandedProjectIds"))
        if (list == "weekly" || list == "daily") put("checkpoint", view.getString("checkpoint"))
    }

    /**
     * [list] from its first window ([edit], a filter control's exact edit or Review's expansion edit, goes with it once), its
     * items to [depth] at one revision, then each collection to its depth in [deep]. A list that changed between windows keeps
     * what it has; the next refresh reads it again, as the Inbox does.
     */
    private fun read(runtime: CoreHost, list: String, params: JSONObject, depth: Int, deep: Map<String, Int>, edit: JSONObject? = null): MenuPage {
        val first = runtime.menuRead(list, JSONObject(params.toString()).put("offset", 0).put("limit", PAGE)
            .apply { edit?.let { put(if (list == "review") "expansionEdit" else "filterEdit", it) } }.toString())
        check(first.optInt("version", 1) == 1) { "Unsupported core contract" }
        val sent = accepted(list, params, first)
        var page = MenuPage(first, sent, first.menuItems(), emptyMap())
        try {
            while (page.items.size < minOf(depth, page.total)) {
                val next = runtime.menuRead(list, JSONObject(sent.toString()).put("offset", page.items.size).put("limit", PAGE).put("revision", page.revision).toString()).menuItems()
                if (next.isEmpty()) break // core sent no items: stop, never spin
                page = page.appended(next)
            }
            for ((name, want) in deep) page = collectionTo(runtime, list, page, name, want)
        } catch (failure: Exception) {
            if (failure.message?.startsWith("STALE_REVISION") != true) throw failure
        }
        return page
    }

    /** [page]'s collection [name] paged through core's getMenuViewCollection until [want] items show. */
    private fun collectionTo(runtime: CoreHost, list: String, page: MenuPage, name: String, want: Int): MenuPage {
        var loaded = page.collection(name)
        while (loaded.size < minOf(want, page.collectionTotal(name))) {
            // The Weekly Review pages its nested lists with its own inputs (getWeeklyReviewList); the menu views through getMenuViewCollection.
            val next = if (list == "weekly") runtime.menuRead("weeklyList", JSONObject(page.params.toString()).put("list", name.substringBefore(':'))
                .apply { if (':' in name) put("key", name.substringAfter(':')) }.put("offset", loaded.size).put("limit", WINDOW).put("revision", page.revision).toString()).list("items")
            else runtime.menuRead("collection", JSONObject().put("view", list).put("collection", name).put("params", page.params)
                .put("offset", loaded.size).put("limit", WINDOW).put("revision", page.revision).toString()).list("items")
            if (next.isEmpty()) break
            loaded = loaded + next
        }
        return page.withCollection(name, loaded)
    }

    /** A new list becomes the screen's, and core's accepted inputs become its choices (the filters core pruned, the person it offers). */
    private fun show(list: String, next: MenuPage) {
        if (list != this.list) return
        page = next
        editOwn(list) {
            when (list) {
                "waiting" -> put("person", next.params.getString("person"))
                "someday", "done" -> put("filters", next.params.getJSONObject("filters"))
                "reference" -> put("filters", next.params.getJSONObject("filters")).put("includeArchivedProjects", next.params.getBoolean("includeArchivedProjects"))
                "archive", "contexts" -> put("selected", next.view.getJSONArray("selectedIds"))
                "trash" -> next.view.getJSONObject("selected").let { put("selectedTasks", it.getJSONArray("taskIds")).put("selectedProjects", it.getJSONArray("projectIds")) }
                "review" -> put("expandedAreaIds", next.params.getJSONArray("expandedAreaIds")).put("expandedProjectIds", next.params.getJSONArray("expandedProjectIds"))
                    .put("selected", next.view.optJSONObject("bulk")?.getJSONArray("selectedIds") ?: JSONArray())
            }
            if (list == "contexts") put("tokens", next.params.getJSONArray("tokens")).put("matchMode", next.params.getString("matchMode"))
        }
        // A review's place: the checkpoint core answered with, kept under core's key until the review is finished.
        if (list == "weekly" || list == "daily") prefs.edit().putString(next.view.getString("storageKey"), next.view.getString("checkpoint")).apply()
    }

    /**
     * A read the user asked for (a screen opening, a filter, sort or group choice): through perform, as the lists' More,
     * once no action runs, so a choice made while a command finishes is still read.
     */
    internal fun reload(edit: JSONObject? = null, fresh: Boolean = false) = whenIdle {
        val list = list ?: return@whenIdle
        // The Calendar and the Board read their own contracts.
        if (list == "calendar") return@whenIdle calendar.reload()
        if (list == "board") return@whenIdle board.reload()
        val params = params(list)
        // A new review step starts from its own first window, not as deep as the last step was shown.
        val shown = page.takeUnless { fresh }
        val depth = maxOf(PAGE, shown?.items?.size ?: 0)
        val deep = shown?.deep.orEmpty()
        val mine = shell.issue()
        shell.perform { runtime ->
            val next = read(runtime, list, params, depth, deep, edit)
            shell.ui { if (shell.fresh(mine, Part.Menu)) show(list, next) }
        }
    }

    /** The failure banner's Try again after a failed read: the open list again, as a read the user asked for (it clears the failure). */
    fun retryRead() = reload()

    /** After every command, on resume, and after boot: the open sheet and list from their first window, as deep as shown. */
    fun refresh() {
        if (sheet) readMore()
        val list = list ?: return
        if (list == "calendar") return calendar.refresh()
        if (list == "board") return board.refresh()
        val params = params(list)
        val shown = page
        val depth = maxOf(PAGE, shown?.items?.size ?: 0)
        val deep = shown?.deep.orEmpty()
        shell.background(listOf(Part.Menu), { runtime -> read(runtime, list, params, depth, deep) }) { next, mine ->
            if (shell.fresh(mine, Part.Menu)) show(list, next)
        }
        if (screen == MenuScreen.History && history == null) readHistory()
        if (dialog?.optString("kind") == "move" && moveChoices == null) readMoveChoices()
    }

    private fun readMore() {
        val deep = more?.deep.orEmpty()
        shell.background(listOf(Part.More), { runtime -> read(runtime, "more", JSONObject(), 0, deep) }) { next, mine ->
            if (shell.fresh(mine, Part.More)) keepMore(next)
        }
    }

    /** The sheet's reply, and with it the quick-access view the tab bar draws. */
    private fun keepMore(next: MenuPage) {
        more = next
        quickAccess = next.view.optString("quickAccessView").ifEmpty { null }
        saved["quickAccess"] = quickAccess
    }

    /** Core's More sheet at boot (on the boot thread), so the tab bar draws RN's quick-access tab from the first frame. */
    fun readSheet(runtime: CoreHost): MenuPage = read(runtime, "more", JSONObject(), 0, emptyMap())

    /** History's tab labels (cosmetic: a failed read shows no error; the list's own read reports one). */
    private fun readHistory() {
        val tab = historyTab
        shell.background(emptyList(), { runtime -> runtime.menuRead("history", JSONObject().put("tab", tab).toString()) }) { view, _ ->
            if (tab == historyTab) history = view
        }
    }

    /**
     * RN's list end: the next window of items at the loaded revision. STALE_REVISION is never an error (as on the other lists):
     * the list changed, so it is read again from the first window as deep as More asked.
     */
    fun loadMore() {
        val shown = page ?: return
        val list = list ?: return
        val mine = shell.issue()
        shell.perform { runtime ->
            val next = try {
                val window = runtime.menuRead(list, JSONObject(shown.params.toString()).put("offset", shown.items.size).put("limit", PAGE)
                    .put("revision", shown.revision).toString())
                shown.appended(window.menuItems())
            } catch (failure: Exception) {
                if (failure.message?.startsWith("STALE_REVISION") != true) throw failure
                read(runtime, list, params(list), shown.items.size + PAGE, shown.deep)
            }
            shell.ui { if (shell.fresh(mine, Part.Menu)) show(list, next) }
        }
    }

    /** The next window of a collection (people, parked projects, tokens, projects, saved searches), as for items. */
    fun loadCollection(name: String) {
        val sheetPage = name == "savedSearches"
        val shown = (if (sheetPage) more else page) ?: return
        val list = if (sheetPage) "more" else list ?: return
        val want = shown.collection(name).size + WINDOW
        val mine = shell.issue()
        shell.perform { runtime ->
            val next = try {
                collectionTo(runtime, list, shown, name, want)
            } catch (failure: Exception) {
                if (failure.message?.startsWith("STALE_REVISION") != true) throw failure
                read(runtime, list, if (sheetPage) JSONObject() else params(list), shown.items.size, shown.deep + (name to want))
            }
            shell.ui {
                if (sheetPage) { if (shell.fresh(mine, Part.More)) keepMore(next) } else if (shell.fresh(mine, Part.Menu)) show(list, next)
            }
        }
    }

    // ---- Screen choices ----

    /** Waiting's person chip ('' is All). */
    fun person(person: String) { editOwn("waiting") { put("person", person) }; reload() }

    /**
     * A filter control's exact edit, as core put it on the control, read at once with the screen's filters. Clear (or a
     * text chip's removal) also resets the sheet's typed text, so its fields show core's values again.
     */
    fun filterEdit(edit: JSONObject) {
        dialog?.takeIf { it.optString("kind") == "filters" }?.let { open ->
            val type = edit.optString("type")
            if (type == "clear" || type == "setSearch" || type == "setLocation") {
                keepDialog(JSONObject(open.toString()).apply { remove("typed:setSearch"); remove("typed:setLocation") })
            }
        }
        reload(edit)
    }

    private var filterTyped = 0
    private var searchTyped = 0

    /**
     * Typed filter text (RN's search and location fields): kept with the sheet as typed, then core's setSearch or
     * setLocation with it once typing pauses. Only typed text builds an edit here; every choice sends core's own.
     */
    fun typeFilter(type: String, text: String) {
        dialog?.let { keepDialog(JSONObject(it.toString()).put("typed:$type", text)) }
        val mine = ++filterTyped
        main.postDelayed({
            if (mine != filterTyped) return@postDelayed
            reload(JSONObject().put("type", type).put("value", text))
        }, 200)
    }

    /** Runs [read] now, or once the running action ends: a typed filter is never dropped because a read was running. */
    internal fun whenIdle(read: () -> Unit) { if (shell.busy) main.postDelayed({ whenIdle(read) }, 200) else read() }

    /** A header chip's removal: its filter edit, or Reference's archived-projects switch turned off (core's chip action). */
    fun removeChip(action: JSONObject) {
        action.optJSONObject("filterEdit")?.let { filterEdit(it); return }
        archivedProjects(false)
    }

    /** Reference's filter sheet switch. */
    fun archivedProjects(on: Boolean) { editOwn("reference") { put("includeArchivedProjects", on) }; reload() }

    /** Someday's sort and grouping (RN's session choices), and Reference's and Done's grouping. */
    fun group(value: String) {
        val list = list ?: return
        when (list) {
            "done" -> ListViewState.read(prefs, DONE_VIEW_KEY).copy(groupBy = value).save(prefs, DONE_VIEW_KEY)
            "archive" -> ListViewState.read(prefs, ARCHIVED_VIEW_KEY).copy(groupBy = value).save(prefs, ARCHIVED_VIEW_KEY)
            else -> editOwn(list) { put("groupBy", value) }
        }
        reload()
    }

    /**
     * A sort choice: Someday's is its session's, Done's and Archive's the device's (RN's view state), and Reference's is the
     * stored task-list sort every list shares, a command through core's setTaskListSort.
     */
    fun sort(value: String) {
        when (val list = list ?: return) {
            "reference" -> send(FailedAction("taskListSort", value))
            "done" -> { ListViewState.read(prefs, DONE_VIEW_KEY).copy(sortBy = value).save(prefs, DONE_VIEW_KEY); reload() }
            "archive" -> { ListViewState.read(prefs, ARCHIVED_VIEW_KEY).copy(sortBy = value).save(prefs, ARCHIVED_VIEW_KEY); reload() }
            else -> { editOwn(list) { put("sortBy", value) }; reload() }
        }
    }

    /** Someday's Details toggle. */
    fun details(on: Boolean) { editOwn("someday") { put("showDetails", on) }; reload() }

    /** A folding heading, under the grouping core showed it in (the view's groupBy), kept as RN keeps it. */
    fun toggleGroup(id: String) {
        val list = list ?: return
        val axis = page?.view?.optString("groupBy")?.ifEmpty { null } ?: return
        GroupCollapse.toggle(prefs, if (list == "archive") "archived" else list, axis, id)
        reload()
    }

    /** Archive's Tasks and Projects chips; a new segment leaves selection mode, as RN does. */
    fun segment(id: String) {
        editOwn("archive") { put("segment", id); put("selecting", false); put("selected", JSONArray()) }
        reload()
    }

    /** Archive's search box, read once typing pauses. */
    fun search(text: String) = typeSearch("archive", "search", text)

    /** A list's typed search (Archive's box, Contexts' chip search): kept as typed, read once typing pauses. */
    fun typeSearch(list: String, name: String, text: String) {
        editOwn(list) { put(name, text) }
        val mine = ++searchTyped
        main.postDelayed({ if (mine == searchTyped) reload() }, 200)
    }

    fun selecting(on: Boolean) {
        editOwn("archive") { put("selecting", on); put("selected", JSONArray()) }
        if (!on) reload()
    }

    /** One row in or out of Archive's selection; core prunes it to the rows on screen and counts it. */
    fun toggleSelected(id: String) {
        val selected = own("archive").optJSONArray("selected")?.strings().orEmpty()
        editOwn("archive") { put("selected", JSONArray(if (id in selected) selected - id else selected + id)) }
        reload()
    }

    /**
     * RN's Select all: every task row a folded heading has not removed (Archive), or every item in Trash, tasks and projects.
     * Core's windows are read to the end to find them.
     */
    fun selectAll() {
        val list = list ?: return
        val params = params(list)
        val mine = shell.issue()
        shell.perform { runtime ->
            val all = read(runtime, list, params, Int.MAX_VALUE, emptyMap())
            val ids = LinkedHashSet<String>()
            val projects = LinkedHashSet<String>()
            for (item in all.items) {
                val row = item.row
                if (row != null) ids.add(row.id) else if (item.type == "project") projects.add(item.json.getString("id"))
            }
            shell.ui {
                if (!shell.fresh(mine, Part.Menu)) return@ui
                if (list == "trash") editOwn(list) { put("selectedTasks", JSONArray(ids.toList())).put("selectedProjects", JSONArray(projects.toList())) }
                else editOwn(list) { put("selected", JSONArray(ids.toList())) }
                reload()
            }
        }
    }

    // ---- Dialogs ----

    fun openDialog(kind: String) = keepDialog(JSONObject().put("kind", kind))

    /** A sub-page of the open dialog (null: its first page): the overflow menu's Sort or Group panel, or the filter sheet's picker. */
    fun dialogPage(page: String?) { dialog?.let { keepDialog(JSONObject(it.toString()).apply { if (page == null) remove("page") else put("page", page) }) } }

    /** The filter sheet's disclosure rows (time estimate, energy, more filters) that are open. */
    fun toggleDisclosure(id: String) {
        val open = dialog ?: return
        keepDialog(JSONObject(open.toString()).put(id, !open.optBoolean(id)))
    }

    /** RN's Back inside a dialog: a sub-page returns to its first page, else the dialog closes (a new section returns to its move). */
    fun backInDialog() {
        val open = dialog ?: return
        when {
            open.has("page") -> dialogPage(null)
            open.optString("kind") == "newSection" && open.has("taskIds") -> openMove(open.getJSONArray("taskIds").strings())
            else -> keepDialog(null)
        }
    }

    /** A dialog's typed text (a new section's name, a new task's title), kept with the dialog. */
    fun typeDialog(text: String) { dialog?.let { keepDialog(JSONObject(it.toString()).put("text", text).apply { remove("error") }) } }

    /** RN's delete confirmation for a list action ([action], core's, sent as [command]), with core's words ([confirmation]). */
    fun confirm(confirmation: JSONObject, action: JSONObject, command: String = "archiveAction") =
        keepDialog(JSONObject(confirmation.toString()).put("kind", "confirm").put("action", action).put("command", command))

    // ---- Someday ----

    /** The status menu's Move to section… on Someday's rows: core's dialog title, or null elsewhere. */
    fun moveLabel(task: TaskRow): String? {
        if (screen != MenuScreen.Someday) return null
        val shown = page ?: return null
        if (shown.items.none { it.row?.id == task.id }) return null
        return shown.view.getJSONObject("text").getString("moveToSection")
    }

    /** RN's move dialog for [taskIds]: core's choices ("No section" first, the current one selected). */
    fun openMove(taskIds: List<String>) {
        moveChoices = null
        keepDialog(JSONObject().put("kind", "move").put("taskIds", JSONArray(taskIds)))
        readMoveChoices()
    }

    /**
     * Core's move dialog from its first window, its choices read to [depth] at one revision. Choices that changed between
     * windows (STALE_REVISION) are never an error: the dialog stays open with what it read, as the lists do, and its More
     * reads it again from the first window.
     */
    private fun readMoveChoices(depth: Int = WINDOW) {
        val open = dialog?.takeIf { it.optString("kind") == "move" } ?: return
        val ids = open.getJSONArray("taskIds")
        shell.background(listOf(Part.MenuDialog), { runtime ->
            val first = runtime.menuRead("moveDialog", JSONObject().put("taskIds", ids).put("offset", 0).put("limit", WINDOW).toString())
            val choices = first.getJSONObject("choices")
            val items = choices.getJSONArray("items")
            try {
                while (items.length() < minOf(depth, choices.getInt("total"))) {
                    val next = runtime.menuRead("moveDialog", JSONObject().put("taskIds", ids).put("offset", items.length()).put("limit", WINDOW)
                        .put("revision", first.getString("revision")).toString()).getJSONObject("choices").getJSONArray("items")
                    if (next.length() == 0) break // core sent no choices: stop, never spin
                    for (index in 0 until next.length()) items.put(next.get(index))
                }
            } catch (failure: Exception) {
                if (failure.message?.startsWith("STALE_REVISION") != true) throw failure
            }
            first
        }) { reply, mine -> if (shell.fresh(mine, Part.MenuDialog) && dialog?.optString("kind") == "move") moveChoices = reply }
    }

    /** The move dialog's More: its choices read again from the first window, one window deeper. */
    fun moreMoveChoices() { moveChoices?.getJSONObject("choices")?.getJSONArray("items")?.length()?.let { readMoveChoices(it + WINDOW) } }

    fun moveAction(taskIds: List<String>, sectionId: String?) =
        FailedAction("somedayMove", UUID.randomUUID().toString(), patch = mapOf("taskIds" to taskIds.joinToString(","), "sectionId" to sectionId))

    /** A move dialog choice: core's moveSomedayTasksToSection with a new request UUID. */
    fun move(taskIds: List<String>, sectionId: String?) = send(moveAction(taskIds, sectionId))

    /** The toast's Undo: core's undoSomedaySectionMove for the move's request, with its own request UUID. */
    private fun undo(moveRequestId: String) {
        Log.i(CoreHost.TAG, "Someday Undo requested busy=${shell.busy}")
        whenIdle { send(FailedAction("somedayUndo", UUID.randomUUID().toString(), moveRequestId)) }
    }

    /** RN's New section… (the list menu's, or the move dialog's "+ New section…", which then moves the tasks into it). */
    fun openNewSection(taskIds: List<String>? = null) = keepDialog(JSONObject().put("kind", "newSection").put("text", "")
        .put("requestId", UUID.randomUUID().toString()).apply { taskIds?.let { put("taskIds", JSONArray(it)) } })

    /** A heading's Add task: RN's dialog for that section (null = No section), titled with core's label. */
    fun openAddTask(heading: JSONObject) {
        val addTask = heading.getJSONObject("addTask")
        keepDialog(JSONObject().put("kind", "addTask").put("text", "").put("title", addTask.getString("accessibilityLabel"))
            .put("sectionId", addTask.opt("sectionId") ?: JSONObject.NULL).put("captureId", UUID.randomUUID().toString()))
    }

    /**
     * The open create dialog's exact request: a section's name, a task's title with its capture UUID and section, or the Weekly
     * Review's project Add task (core's addProjectTask, its request UUID the new task's id).
     */
    fun createAction(): FailedAction? {
        val open = dialog ?: return null
        val text = open.optString("text").trim()
        if (text.isEmpty()) return null
        return when (open.optString("kind")) {
            "newSection" -> FailedAction("somedaySection", open.getString("requestId"), text)
            "addTask" -> FailedAction("somedayTask", open.getString("captureId"), text,
                patch = mapOf("sectionId" to if (open.isNull("sectionId")) null else open.getString("sectionId")))
            "projectTask" -> FailedAction("reviewTask", open.getString("requestId"), addProjectTask(open.getString("projectId"), open.optString("text")).toString())
            else -> null
        }
    }

    /** Save in a create dialog: the exact request is on disk (synced) before the call, and after process death it goes first. */
    fun saveCreate() {
        val action = createAction() ?: return
        if (shell.busy || (shell.failedAction != null && shell.failedAction != action)) return
        store.write(action)
        send(action)
    }

    /** A Calendar or Board create's exact request ([action]): on disk (synced) before the call, sent first after process death. */
    internal fun create(action: FailedAction) {
        if (shell.busy || (shell.failedAction != null && shell.failedAction != action)) return
        store.write(action)
        send(action)
    }

    /** A Calendar or Board action ([kind]) with core's whole [input] and a new request UUID; the input itself is its exact retry. */
    internal fun command(kind: String, input: JSONObject) = send(FailedAction(kind, UUID.randomUUID().toString(), input.toString()))

    /** Waiting's and Someday's parked projects: RN's swipe makes one active (a target state; a retry writes nothing). */
    fun activate(projectId: String) = send(FailedAction("activateProject", projectId))

    // ---- Archive ----

    /** One of core's Archive actions, with a new request UUID; the action itself is its exact retry. */
    fun archive(action: JSONObject) = act("archiveAction", action)

    /** One of core's list actions ([kind]: archiveAction, contextsAction, trashAction, reviewAction), with a new request UUID. */
    internal fun act(kind: String, action: JSONObject) = send(FailedAction(kind, UUID.randomUUID().toString(), action.toString()))

    /**
     * RN's status change on a row of a list whose contract writes it (Contexts, the Review screens): that list's setTaskStatus,
     * from the swipe or the status menu. False for any other row (the status menu then uses updateTask).
     */
    fun rowStatus(task: TaskRow, status: String): Boolean {
        val kind = ROW_KINDS[list ?: return false] ?: return false
        if (page?.items?.none { it.row?.id == task.id } != false) return false
        shell.showStatusMenu(null)
        if (status != task.status) act(kind, setTaskStatus(task.id, status))
        return true
    }

    // ---- Commands ----

    /** The Menu tab's owed command, from the failure banner's Try again: the same exact request. */
    fun retry(action: FailedAction) = send(action)

    /** A menu command's input, as host-entry.ts passes it to core. */
    private fun input(action: FailedAction): String = when (action.kind) {
        "activateProject" -> JSONObject().put("projectId", action.id)
        "somedayMove" -> JSONObject().put("taskIds", JSONArray(action.patch["taskIds"].orEmpty().split(","))).put("requestId", action.id)
            .put("sectionId", action.patch["sectionId"] ?: JSONObject.NULL)
        "somedayUndo" -> JSONObject().put("moveRequestId", action.title).put("requestId", action.id)
        "somedayTask" -> JSONObject().put("title", action.title).put("captureId", action.id).put("sectionId", action.patch["sectionId"] ?: JSONObject.NULL)
        "somedaySection" -> JSONObject().put("title", action.title)
        "taskListSort" -> JSONObject().put("sortBy", action.id)
        // The Calendar's and the Board's input: core's action with the view's state (or filters), and the request UUID.
        "calendarAction", "calendarCreate", "boardAction", "boardCreate" -> JSONObject(action.title).put("requestId", action.id)
        else -> JSONObject().put("requestId", action.id).put("action", JSONObject(action.title))
    }.toString()

    /**
     * Core's command with [action]'s exact request, through perform: one at a time, a failure holds the exact retry (a
     * Someday create's request stays on disk), and core's refusal before writing unlocks (its record goes too).
     */
    private fun send(action: FailedAction) = shell.perform(action) { runtime ->
        val reply = try {
            runtime.menuCommand(action.kind, input(action))
        } catch (failure: Exception) {
            val refused = UPDATE_REFUSALS.any { failure.message?.startsWith(it) == true }
            if (refused && action.kind in CREATES) shell.ui { store.delete() }
            // A refused composer Save wrote nothing: the composer's next Save gets a fresh request UUID.
            if (refused && action.kind == "calendarCreate") shell.ui { calendar.refused(action) }
            // An Undo core can no longer run wrote nothing: RN's undo-failed toast (core's text), not an error.
            if (refused && action.kind == "somedayUndo") {
                Log.w(CoreHost.TAG, "Someday Undo refused: ${failure.message?.substringBefore(':')}")
                shell.ui { undoFailed() }; return@perform
            }
            throw failure
        }
        shell.acknowledged(action)
        shell.ui {
            if (action.kind in CREATES) store.delete()
            finish(action, reply)
        }
    }

    private fun undoFailed() {
        val text = page?.view?.optJSONObject("text") ?: return
        shell.showToast(text.getString("errorTitle"), text.getString("undoFailed"), "error")
    }

    private fun JSONObject.text(name: String) = if (!has(name) || isNull(name)) null else getString(name)

    /** Core's answer on screen: a refusal's words, the dialog closing, and RN's toasts with core's Undo. */
    private fun finish(action: FailedAction, reply: JSONObject) {
        when (action.kind) {
            "somedayMove" -> {
                val refused = reply.optJSONObject("refused")
                if (refused != null) { shell.showToast(refused.text("title"), refused.getString("message"), "error"); return }
                closeDialog("move")
                reply.optJSONObject("toast")?.let { toast ->
                    val moveRequestId = reply.getString("undoRequestId")
                    shell.showToast(null, toast.getString("message"), "success", toast.getString("undoLabel")) { undo(moveRequestId) }
                }
            }
            "somedayTask" -> {
                val refused = reply.optJSONObject("refused")
                // Core's refusal (the section is gone) wrote nothing: its words show, and the next Save gets a fresh capture UUID.
                if (refused != null) {
                    dialog?.let { keepDialog(JSONObject(it.toString()).put("error", refused.getString("message")).put("captureId", UUID.randomUUID().toString())) }
                    return
                }
                closeDialog("addTask")
                shell.showToast(null, reply.getString("toast"), "success")
            }
            "somedaySection" -> {
                val open = dialog?.takeIf { it.optString("kind") == "newSection" }
                closeDialog("newSection")
                // From the move dialog's "+ New section…": the tasks go into the new section, as RN's picker selects it.
                open?.optJSONArray("taskIds")?.let { ids -> whenIdle { move(ids.strings(), reply.getString("id")) } }
            }
            "archiveAction" -> {
                if (JSONObject(action.title).optString("type") in setOf("moveTasksToInbox", "trashTasks")) selecting(false)
                reply.optJSONObject("toast")?.let { toast ->
                    val undo = toast.optJSONObject("undo")
                    shell.showToast(toast.text("title"), toast.getString("message"), toast.getString("tone"), undo?.getString("label")) {
                        undo?.let { whenIdle { archive(it.getJSONObject("action")) } }
                    }
                }
            }
            "contextsAction", "trashAction", "reviewAction", "reviewTask" -> listDone(action, reply)
            "calendarAction", "calendarCreate" -> calendar.done(action, reply)
            "boardAction", "boardCreate" -> board.done(action, reply)
        }
    }

    /**
     * Core's answer to a Contexts, Trash or Review action: a bulk action leaves selection mode (RN's exitSelectionMode), a
     * project Add task closes its prompt (Save & edit opens the new task), Mark reviewed shows RN's toast, and core's toast
     * shows with its Undo (the same list's command, a new request UUID).
     */
    private fun listDone(action: FailedAction, reply: JSONObject) {
        val type = JSONObject(action.title).optString("type")
        if (action.kind == "reviewTask") {
            val open = dialog?.takeIf { it.optString("kind") == "projectTask" }
            closeDialog("projectTask")
            reply.text("createdId")?.takeIf { open?.optBoolean("edit") == true }?.let { id -> whenIdle { shell.openEditor(id) } }
        }
        if (type in BULK) endSelection()
        if (type == "markReviewedTasks" && reply.optBoolean("changed")) shell.showToast(null, t("review.markReviewedDone"), "success")
        reply.optJSONObject("toast")?.let { toast ->
            val undo = toast.optJSONObject("undo")
            val kind = if (action.kind == "reviewTask") "reviewAction" else action.kind
            shell.showToast(toast.text("title"), toast.getString("message"), toast.getString("tone"), undo?.getString("label")) {
                undo?.let { whenIdle { act(kind, it.getJSONObject("action")) } }
            }
        }
    }

    /** RN's exitSelectionMode on the open list. */
    internal fun endSelection() {
        when (val list = list ?: return) {
            "trash" -> editOwn(list) { put("selecting", false).put("selectedTasks", JSONArray()).put("selectedProjects", JSONArray()) }
            "archive" -> selecting(false)
            else -> editOwn(list) { put("selected", JSONArray()) }
        }
    }

    /**
     * After boot: a create left on disk by a dead process is sent again first (core writes it once: a capture UUID, a section
     * title that already exists, or a project task under its request UUID), even without saved state; then the open sheet and
     * screen are read. [sheet] is core's More sheet read at boot (the quick-access tab).
     */
    fun start(sheet: MenuPage?) {
        sheet?.let(::keepMore)
        store.read()?.let { pending ->
            if (shell.failedAction == null) {
                shell.owe(pending)
                send(pending)
            }
        }
        refresh()
    }
}
