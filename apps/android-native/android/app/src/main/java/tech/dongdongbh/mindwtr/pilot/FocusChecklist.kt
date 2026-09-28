package tech.dongdongbh.mindwtr.pilot

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.SavedStateHandle
import org.json.JSONArray
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.InboxViewModel.Part
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/*
 * RN's Focus checklist page (app/check-focus.tsx) on core's Focus checklist contract (native-host-contract-focus-checklist.ts): the
 * task's title and checklist, where every tick, rename, delete and add is written at once. RN pushes the route only from the task
 * editor's onFocusMode, and RN's editor never calls it, so no control in RN opens the page; here MenuModel.openFocusChecklist is that
 * route, and a debug build opens it from a device check's launch extra (FOCUS_CHECKLIST_EXTRA), as RN's route opens from its link.
 *
 * Every edit is core's (the item's own toggle and remove, a rename with the typed text, an add with a new item UUID) and names its
 * item by id. The edits wait in a queue that belongs to their task, not to the page: in a synced file (so process death keeps them),
 * sent one at a time with the task revision the last answer (or core's page) gave, at the item's position then, and going on after
 * the page closes, as RN wrote each edit at once. The edit with core is an exact request on disk before it is sent (MenuModel's
 * create path), so after process death it is sent again first with its original revision, and a failed save keeps its exact retry.
 * Core refuses an edit made on an older revision (STALE_REVISION): that edit goes, core's list is read again, and the rest go on from
 * it, as RN's page shows the store's. A write that did not land shows RN's error toast with core's words.
 */

/** Core windows the checklist by NATIVE_HOST_MAX_WINDOW. */
private const val WINDOW = 100
/** How many times a view whose later window went stale is read again from its first window before core's failure shows. */
private const val STALE_READS = 3

/** A debug build's launch extra: the task whose checklist page opens (MainActivity), for the device check. */
const val FOCUS_CHECKLIST_EXTRA = "focusChecklistTaskId"

/**
 * A view read window by window under its first window's revision ([read]): when a later window went stale (the view changed), the
 * partial view is dropped and the whole view is read again from offset 0, at most [STALE_READS] times; then core's failure shows.
 */
internal fun <T> wholeView(read: () -> T): T {
    repeat(STALE_READS - 1) {
        try {
            return read()
        } catch (failure: Exception) {
            if (failure.message?.startsWith("STALE_REVISION") != true) throw failure
        }
    }
    return read()
}

class FocusChecklistModel(private val menu: MenuModel, private val saved: SavedStateHandle, private val file: File) {
    private val shell get() = menu.shell

    /** The open page's task (RN's route param `id`); it rides the Bundle. */
    var taskId by mutableStateOf(saved.get<String>("focusChecklistId")); private set
    /** Core's page (getFocusChecklist), its items read to the end under one revision. */
    var page by mutableStateOf<JSONObject?>(null); private set
    /**
     * The edits core has not answered, oldest first, each `{ task, edit }`, whatever page is open. The first is with core while
     * [sending]; [sent] is its request UUID (on disk with the queue, so the answer to a replay after process death is matched).
     */
    var queue by mutableStateOf<List<JSONObject>>(emptyList()); private set
    private var sent: String? = null
    private var sending = false
    /** Per task: the revision and the item order its next edit is made on (core's page, then each answer). */
    private var known = JSONObject()
    /** Edits core answered that the page on screen does not show yet (core's page is read again after each). */
    private var settled by mutableStateOf<List<JSONObject>>(emptyList())

    init {
        runCatching { JSONObject(file.readText()) }.getOrNull()?.let { stored ->
            queue = stored.menuObjects("queue")
            sent = stored.menuText("sent")
            known = stored.getJSONObject("known")
        }
    }

    /** The queue, the request UUID with core and the revisions, synced and renamed into place before anything is sent. */
    private fun keep() {
        file.parentFile?.mkdirs()
        val state = JSONObject().put("queue", JSONArray(queue)).put("sent", sent ?: JSONObject.NULL).put("known", known)
        val partial = File(file.parentFile, "${file.name}.partial")
        FileOutputStream(partial).use { out -> out.write(state.toString().toByteArray()); out.fd.sync() }
        check(partial.renameTo(file)) { "Cannot save the checklist edits" }
    }

    /** RN pushes the page for a task: its checklist read afresh (edits still waiting for it stay, and go first). */
    fun reset(id: String) {
        taskId = id
        saved["focusChecklistId"] = id
        page = null
        settled = emptyList()
        // Without an edit waiting, the task's next edit is made on the page this opening reads.
        if (queue.none { it.getString("task") == id }) known.remove(id)
        keep()
    }

    // ---- Reads ----

    private fun read(runtime: CoreHost, id: String): JSONObject = wholeView {
        val first = runtime.menuRead("focusChecklist", JSONObject().put("id", id).put("offset", 0).put("limit", WINDOW).toString())
        val items = first.getJSONArray("items")
        while (items.length() < first.getInt("total")) {
            val next = runtime.menuRead("focusChecklist", JSONObject().put("id", id).put("offset", items.length()).put("limit", WINDOW)
                .put("revision", first.getString("revision")).toString()).getJSONArray("items")
            if (next.length() == 0) break // core sent no items: stop, never spin
            for (index in 0 until next.length()) items.put(next.get(index))
        }
        first
    }

    /**
     * Core's page for a task: on screen when it is the open page's; with none of the task's edits at core, its revision and order are
     * the next edit's (a task core no longer shows takes its waiting edits with it). Then the next queued edit goes.
     */
    private fun show(next: JSONObject) {
        val id = next.getString("id")
        if (menu.list == "focusChecklist" && id == taskId) {
            shell.readSucceeded()
            page = next
            settled = emptyList()
        }
        if (!(sending && queue.firstOrNull()?.getString("task") == id)) {
            val revision = next.menuText("taskRevision")
            if (revision == null) {
                queue = buildList { for (entry in queue) if (entry.getString("task") != id) add(entry) }
                known.remove(id)
            } else {
                known.put(id, JSONObject().put("revision", revision).put("order", JSONArray(next.menuObjects("items").map { it.getString("id") })))
            }
            keep()
        }
        pump()
    }

    /** A read the user asked for (the page opening, after an edit's answer), or the one a waiting edit needs: through perform once no action runs. */
    fun reload(id: String? = taskId) = menu.whenIdle {
        val task = id ?: return@whenIdle
        val mine = shell.issue()
        shell.perform { runtime ->
            val next = read(runtime, task)
            shell.ui { if (shell.fresh(mine, Part.Menu)) show(next) }
        }
    }

    /** On resume and after every command, in the background. */
    fun refresh() {
        val id = taskId ?: return
        shell.background(listOf(Part.Menu), { runtime -> read(runtime, id) }) { next, mine -> if (shell.fresh(mine, Part.Menu)) show(next) }
    }

    // ---- Edits ----

    /** The last edit of [kind] on [itemId] of the open page's task that the page does not show yet: answered, or waiting. */
    private fun unshown(itemId: String, kind: String) = (settled + queue).lastOrNull { entry ->
        val edit = entry.getJSONObject("edit")
        entry.getString("task") == taskId && edit.getString("kind") == kind && edit.getString("itemId") == itemId
    }?.getJSONObject("edit")

    /** The target of the tick not yet on the page for [itemId], or null: RN shows a tick at once. */
    fun pendingTick(itemId: String): Boolean? = unshown(itemId, "toggle")?.getBoolean("isCompleted")

    /** A delete of [itemId] not yet on the page: the row is gone already, as in RN. */
    fun removing(itemId: String) = unshown(itemId, "remove") != null

    /** A rename of [itemId] not yet on the page: the field keeps the text as typed. */
    fun renaming(itemId: String) = unshown(itemId, "rename") != null

    /** The checkbox: core's toggle for the item; after a tick still waiting for core, its opposite. */
    fun toggle(item: JSONObject) {
        val id = item.getString("id")
        val waiting = pendingTick(id)
        enqueue(if (waiting == null) item.getJSONObject("edits").getJSONObject("toggle") else JSONObject().put("kind", "toggle").put("itemId", id).put("isCompleted", !waiting))
    }

    /** The trash button: core's remove for the item. */
    fun remove(item: JSONObject) = enqueue(item.getJSONObject("edits").getJSONObject("remove"))

    /** The item's text as typed: core's rename; a rename of the same item still waiting to be sent takes the newer text. */
    fun rename(itemId: String, text: String) {
        val task = taskId ?: return
        val entry = JSONObject().put("task", task).put("edit", JSONObject().put("kind", "rename").put("itemId", itemId).put("text", text))
        val last = queue.lastOrNull()
        val waiting = last != null && (queue.size > 1 || !sending) && last.getString("task") == task
            && last.getJSONObject("edit").let { it.getString("kind") == "rename" && it.getString("itemId") == itemId }
        queue = if (waiting) queue.dropLast(1) + entry else queue + entry
        keep()
        pump()
    }

    /** Add Item: core's add with a new item UUID. */
    fun add() = enqueue(JSONObject().put("kind", "add").put("itemId", UUID.randomUUID().toString()))

    private fun enqueue(edit: JSONObject) {
        val task = taskId ?: return
        queue = queue + JSONObject().put("task", task).put("edit", JSONObject(edit.toString()))
        keep()
        pump()
    }

    /** After boot: waiting edits go on once a request left on disk by a dead process is settled (MenuModel.start). */
    fun resume() = pump()

    /**
     * The next edit to core once no action runs, whatever page is open: its item named by id at the item's position now (an edit whose
     * item is gone is dropped), with the task revision it is made on (a task not read yet is read first). Core's editFocusChecklist with
     * a new request UUID: the queue with that UUID, then the request itself, are on disk before it is sent.
     */
    private fun pump() {
        if (sending) return
        val head = queue.firstOrNull() ?: return
        if (shell.busy) return menu.whenIdle { pump() }
        if (shell.failedAction != null) return
        val task = head.getString("task")
        val made = known.optJSONObject(task) ?: return reload(task)
        val next = head.getJSONObject("edit")
        val edit = if (next.getString("kind") == "add") next
            else made.getJSONArray("order").ids().indexOf(next.getString("itemId")).takeIf { it >= 0 }?.let { JSONObject(next.toString()).put("index", it) }
        if (edit == null) {
            queue = queue.drop(1)
            keep()
            return pump()
        }
        val action = FailedAction("focusChecklistEdit", UUID.randomUUID().toString(),
            JSONObject().put("id", task).put("taskRevision", made.getString("revision")).put("edit", edit).toString())
        sending = true
        sent = action.id
        keep()
        menu.create(action)
    }

    /**
     * Core's answer to the edit with core (the exact request [sent], a replay after process death too): the saved checklist's order and
     * the task revision are that task's next edit's, and the next edit goes on, the page open or not; an open page reads core's list again.
     */
    fun done(action: FailedAction, reply: JSONObject) {
        if (action.id != sent) return
        val task = JSONObject(action.title).getString("id")
        sending = false
        sent = null
        if (task == taskId) settled = settled + queue.take(1)
        queue = queue.drop(1)
        known.put(task, JSONObject().put("revision", reply.getString("taskRevision")).put("order", JSONArray(reply.menuObjects("checklist").map { it.getString("id") })))
        keep()
        pump()
        if (menu.list == "focusChecklist" && task == taskId) reload()
    }

    /**
     * Core wrote nothing for the edit with core: a stale revision (it landed before process death, a later edit, another device), a
     * changed item, or a write that did not land (RN's error toast with core's message). That edit goes; core's list for its task is
     * read again, and the rest go on from it.
     */
    fun refused(action: FailedAction, failure: Exception) {
        if (action.id != sent) return
        val task = JSONObject(action.title).getString("id")
        sending = false
        sent = null
        queue = queue.drop(1)
        settled = emptyList()
        known.remove(task)
        keep()
        val message = failure.message.orEmpty()
        if (message.startsWith("ACTION_FAILED")) page?.getJSONObject("error")?.let { error ->
            shell.showToast(error.getString("title"), message.substringAfter(": ").ifBlank { error.getString("fallbackMessage") }, "error")
        }
        reload(task)
    }
}

/**
 * RN's check-focus page: Back in a bordered header, the task's title (28 bold), then its checklist: each item's checkbox, its text
 * (struck through once done), and its delete button; core's empty line; and Add Item. A task core cannot find shows core's line alone,
 * as RN's page does. A failure shows above the list with its retry.
 */
@Composable
fun FocusChecklistPage(model: InboxViewModel) = with(model.menu.focusChecklist) {
    val c = LocalTheme.current.colors
    val shown = page
    Column(Modifier.fillMaxSize().background(c.bg).imePadding().testTag("focus-checklist")) {
        model.error?.let { message ->
            FailureBanner(message) {
                if (model.failedAction == null) TextButton(onClick = { reload() }, enabled = !model.busy, modifier = Modifier.testTag("read-retry")) { Text(t("common.retry")) }
                else OwedRetry(model)
            }
        }
        if (shown == null) return@Column
        if (!shown.getBoolean("found")) {
            Text(shown.getString("missingText"), style = rnText(16, 400), color = c.text, modifier = Modifier.padding(20.dp))
            return@Column
        }
        val back = shown.getString("backLabel")
        val canBack = model.failedAction == null
        Box(Modifier.fillMaxWidth().hairline(c.border, top = false).padding(horizontal = 16.dp, vertical = 10.dp)) {
            Box(Modifier.size(44.dp).clearAndSetSemantics { contentDescription = back; role = Role.Button; if (canBack) onClick { model.menu.closeScreen(); true } else disabled() }
                .clickable(enabled = canBack) { model.menu.closeScreen() }, contentAlignment = Alignment.CenterStart) {
                Icon(Ionicons.ChevronBack, null, tint = c.text, modifier = Modifier.size(24.dp))
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Text(shown.optString("title"), style = rnText(28, 700), color = c.text, modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 10.dp)
                    .semantics { heading() })
                Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 10.dp)) {
                    shown.menuText("emptyText")?.let { Text(it, style = rnText(14, 400).copy(fontStyle = FontStyle.Italic), color = c.secondaryText, modifier = Modifier.padding(top = 10.dp)) }
                    for (item in shown.menuObjects("items")) {
                        if (!removing(item.getString("id"))) ChecklistPageItem(model, item)
                    }
                    val addLabel = shown.getString("addLabel")
                    val canEdit = model.writable && model.failedAction == null
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp)
                        .clearAndSetSemantics { contentDescription = addLabel; role = Role.Button; testTag = "focus-checklist-add"; if (canEdit) onClick { add(); true } else disabled() }
                        .clickable(enabled = canEdit) { add() }.padding(vertical = 20.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Lucide.PlusPlain, null, tint = c.tint, modifier = Modifier.size(20.dp))
                        Text(addLabel, style = rnText(16, 500), color = c.tint)
                    }
                }
                Spacer(Modifier.height(100.dp))
            }
            ToastCard(model, Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp))
        }
    }
}

/**
 * One item: the checkbox (core's toggle; a tick still waiting for core shows its target), the text (each change is core's rename),
 * and the delete button (core's remove). While the field has focus the typing wins; core's text is taken when it is not being typed
 * in, no rename of it waits, and it differs from what the field last sent.
 */
@Composable
private fun ChecklistPageItem(model: InboxViewModel, item: JSONObject) = with(model.menu.focusChecklist) {
    val theme = LocalTheme.current
    val c = theme.colors
    val id = item.getString("id")
    val title = item.getString("title")
    val canEdit = model.writable && model.failedAction == null
    var input by rememberSaveable(id, stateSaver = TextFieldValue.Saver) { mutableStateOf(TextFieldValue(title, TextRange(title.length))) }
    var sent by rememberSaveable(id) { mutableStateOf(title) }
    var typing by rememberSaveable(id) { mutableStateOf(false) }
    val waiting = renaming(id)
    LaunchedEffect(title, typing, waiting) { if (!typing && !waiting && title != sent) { input = TextFieldValue(title, TextRange(title.length)); sent = title } }
    val done = pendingTick(id) ?: item.getBoolean("isCompleted")
    Row(Modifier.fillMaxWidth().hairline(c.border, top = false).padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        val label = item.getString("checkboxLabel")
        Box(Modifier.size(44.dp).clearAndSetSemantics {
            contentDescription = label; role = Role.Checkbox; toggleableState = ToggleableState(done)
            if (canEdit) onClick { toggle(item); true } else disabled()
        }.clickable(enabled = canEdit) { toggle(item) }, contentAlignment = Alignment.CenterStart) {
            val box = RoundedCornerShape(6.dp)
            Box(Modifier.size(28.dp).clip(box).border(2.dp, c.tint, box).background(if (done) c.tint else c.bg), contentAlignment = Alignment.Center) {
                if (done) Icon(Lucide.Check, null, tint = c.onTint, modifier = Modifier.size(18.dp))
            }
        }
        val text = input.text
        val placeholder = item.getString("placeholder")
        val inputLabel = item.getString("inputLabel")
        BasicTextField(input, { next ->
            val changed = next.text != input.text
            input = next
            if (changed) { sent = next.text; rename(id, next.text) }
        }, enabled = canEdit, cursorBrush = SolidColor(c.tint),
            textStyle = rnText(18, 400).copy(color = if (done) c.secondaryText else c.text, textDecoration = if (done) TextDecoration.LineThrough else null),
            modifier = Modifier.weight(1f).onFocusChanged { typing = it.isFocused }.semantics { contentDescription = inputLabel }.testTag("focus-checklist-item-input"),
            decorationBox = { inner -> Box { if (text.isEmpty()) Text(placeholder, style = rnText(18, 400), color = c.secondaryText); inner() } })
        val removeLabel = item.getString("deleteLabel")
        Box(Modifier.size(44.dp).clearAndSetSemantics { contentDescription = removeLabel; role = Role.Button; if (canEdit) onClick { remove(item); true } else disabled() }
            .clickable(enabled = canEdit) { remove(item) }, contentAlignment = Alignment.Center) {
            Icon(Lucide.Trash2, null, tint = c.secondaryText, modifier = Modifier.size(20.dp))
        }
    }
}
