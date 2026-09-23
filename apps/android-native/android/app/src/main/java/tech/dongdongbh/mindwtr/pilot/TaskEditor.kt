package tech.dongdongbh.mindwtr.pilot

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** One draft value as JSON text: a draft compares, saves, and survives process death exactly as core sent it. */
fun draftLiteral(value: Any?): String = when (value) {
    null, JSONObject.NULL -> "null"
    is String -> JSONObject.quote(value)
    else -> value.toString()
}

private fun draftValue(literal: String?): Any = JSONTokener(literal ?: "null").nextValue()

/** Draft fields as JSON for core's saveTaskDraft: each value exactly as the draft holds it; null is JSON null. */
fun draftJson(values: Map<String, String?>): String =
    JSONObject().apply { values.forEach { (field, literal) -> put(field, draftValue(literal)) } }.toString()

private fun JSONArray.texts() = List(length()) { getString(it) }
private fun JSONArray.objects() = List(length()) { getJSONObject(it) }

/** One of core's layout sections: its fields in core's order, its badge, and whether it starts open. */
data class EditorSection(val id: String, val titleKey: String?, val fields: List<String>, val filledCount: Int, val open: Boolean)
data class EditorChoice(val id: String, val title: String)
/** A Someday section choice: [viewSectionIds] is core's draft value (JSON text) after choosing it. */
data class SomedayChoice(val id: String, val title: String, val selected: Boolean, val viewSectionIds: String)

/**
 * Core's getTaskEditorModel reply and the task's read-only checklist and attachments (core's getTask),
 * parsed once. [source] is kept verbatim for saved instance state. Kotlin reads it as sent: the
 * fields to show, their order and sections, and every list a control picks from.
 */
class EditorModel(val source: String) {
    private val root = JSONObject(source)
    private val reply = root.getJSONObject("model").also { check(it.getInt("version") == 1) { "Unsupported core contract" } }
    val id: String = reply.getString("id")
    val readOnly = reply.getBoolean("readOnly")
    /** createTaskDraft(task), each field as JSON text. A field core left unset is absent here and reads as null. */
    val draft: Map<String, String> = reply.getJSONObject("draft").let { d -> d.keys().asSequence().associateWith { draftLiteral(d.get(it)) } }
    private val layout = reply.getJSONObject("layout")
    val sections = layout.getJSONArray("sections").objects().map {
        EditorSection(it.getString("id"), if (it.isNull("titleKey")) null else it.getString("titleKey"),
            it.getJSONArray("fields").texts(), it.getInt("filledCount"), it.getBoolean("open"))
    }
    val showSomedaySection = layout.getBoolean("showSomedaySection")
    val dailyInterval = layout.getJSONObject("recurrence").getInt("dailyInterval")
    val monthlyPattern: String = layout.getJSONObject("recurrence").getString("monthlyPattern")
    private val options = reply.getJSONObject("options")
    val statuses = options.getJSONArray("statuses").texts()
    val priorities = options.getJSONArray("priorities").texts()
    val energyLevels = options.getJSONArray("energyLevels").texts()
    /** Core's recurrence choices: the draft value and its label key. */
    val recurrences = options.getJSONArray("recurrences").objects().map { it.getString("value") to it.getString("labelKey") }
    /** Core's time estimates: the draft value and core's label in the host language. */
    val timeEstimates = options.getJSONArray("timeEstimates").objects().map { it.getString("value") to it.getString("label") }
    val projects = options.getJSONArray("projects").objects().map { EditorChoice(it.getString("id"), it.getString("title")) }
    val projectSections = options.getJSONArray("sections").objects().map { EditorChoice(it.getString("id"), it.getString("title")) }
    val areas = options.getJSONArray("areas").objects().map { EditorChoice(it.getString("id"), it.getString("name")) }
    val somedaySections = options.getJSONArray("somedaySections").objects().map {
        SomedayChoice(it.getString("id"), it.getString("title"), it.getBoolean("selected"), draftLiteral(it.opt("viewSectionIds")))
    }
    private val content = root.getJSONObject("content")
    /** The checklist and attachment titles, shown read-only (their editors are not built). */
    val checklist = content.getJSONArray("checklist").objects().map { it.getString("title") to it.getBoolean("isCompleted") }
    val attachments = content.getJSONArray("attachments").texts()

    companion object {
        fun of(model: JSONObject, content: JSONObject) = EditorModel(JSONObject().put("model", model).put("content", content).toString())
    }
}

/** The token and person fields: their text is typed freely, and core's getTaskEditorSuggestions turns it into the draft value. */
val TYPED_FIELDS = listOf("contexts", "tags", "assignedTo")

/** Core's suggestions for [text]: the draft value it stands for, RN's matches, and the quick chips (value, selected, text after a tap). */
data class EditorSuggestions(val text: String, val draftValue: String, val matches: List<Pair<String, String>>, val quick: List<Triple<String, Boolean, String>>) {
    companion object {
        fun parse(text: String, json: JSONObject) = EditorSuggestions(text, json.getString("draftValue"),
            json.getJSONArray("matches").objects().map { it.getString("value") to it.getString("text") },
            json.getJSONArray("quick").objects().map { Triple(it.getString("value"), it.getBoolean("selected"), it.getString("text")) })
    }
}

/**
 * An open editor: core's model and the user's edits of its draft, each field as JSON text.
 * Kotlin never validates, reshapes, or fills in a value, and runs no cascade: core applies
 * its rules when it saves. [bases] holds, for each edited field, the value it was loaded
 * with, so a draft restored onto a fresh model still saves against its own base and core
 * refuses a field another writer changed. [inputs] holds the typed text of the token and
 * person fields, and [resolved] the text whose draft value core already gave, so Save waits
 * for core. [waitingFor] is RN's "waiting for" prompt text while that prompt is open.
 */
data class TaskEditor(
    val model: EditorModel, val edited: Map<String, String>, val inputs: Map<String, String> = emptyMap(),
    val resolved: Map<String, String> = emptyMap(), val bases: Map<String, String> = emptyMap(), val waitingFor: String? = null,
) {
    val id get() = model.id
    val readOnly get() = model.readOnly
    private fun loaded(field: String) = model.draft[field] ?: "null"
    private fun base(field: String) = bases[field] ?: loaded(field)
    fun value(field: String): Any = draftValue(edited[field] ?: loaded(field))
    fun text(field: String) = value(field) as? String ?: ""
    fun flag(field: String) = value(field) == true
    /** Only the fields whose draft differs from the value they were loaded with, as JSON text. */
    val patch: Map<String, String?> get() = edited.filter { (field, literal) -> literal != base(field) }
    /** The loaded values of exactly the patched fields. */
    val base: Map<String, String?> get() = patch.keys.associateWith { base(it) }

    private fun withEdits(changes: Map<String, String>) =
        copy(edited = edited + changes, bases = bases + changes.keys.associateWith { base(it) })

    fun edit(changes: Map<String, Any?>) = withEdits(changes.mapValues { draftLiteral(it.value) })

    /** A field's text as typed; it starts as the draft's own text. */
    fun input(field: String) = inputs[field] ?: (draftValue(loaded(field)) as? String ?: "")
    /** Core has not yet said which draft value the typed text stands for. */
    fun unresolved(field: String) = input(field) != (resolved[field] ?: (draftValue(loaded(field)) as? String ?: ""))
    val waiting get() = TYPED_FIELDS.any(::unresolved)
    /** Unsaved: a changed field, or typed text core has not turned into a draft value yet (RN asks before closing either). */
    val dirty get() = patch.isNotEmpty() || waiting

    fun typed(field: String, text: String) = copy(inputs = inputs + (field to text))

    /**
     * Core's draft value for [text], applied only while [text] is still what the field shows. A field
     * nobody typed in keeps the draft core sent, so opening the editor never makes an edit.
     */
    fun resolve(field: String, text: String, draftValue: String) =
        if (field !in inputs || input(field) != text) this
        else withEdits(mapOf(field to draftLiteral(draftValue))).copy(resolved = resolved + (field to text))

    /** RN's waiting prompt: Waiting, and the person typed there, as RN's confirmWaitingAssignment writes them. */
    fun assignWaiting(person: String) = edit(mapOf("status" to "waiting", "assignedTo" to person))
        .copy(inputs = inputs + ("assignedTo" to person), resolved = resolved + ("assignedTo" to person), waitingFor = null)

    /**
     * After STALE_REVISION: the fresh model becomes the base. An edit stays only where the stored
     * value still equals its old base; where another writer changed a field, the draft takes the
     * stored value, and its typed text starts again from it.
     */
    fun reloaded(fresh: EditorModel): TaskEditor {
        val kept = { field: String -> (fresh.draft[field] ?: "null") == base(field) }
        return TaskEditor(fresh, edited.filterKeys(kept), inputs.filterKeys(kept), resolved.filterKeys(kept), waitingFor = waitingFor)
    }

    /** The draft's own state, without the model: the edits with their bases, the typed text, and the open prompt. */
    fun state(): JSONObject = JSONObject().put("id", id).put("edited", JSONObject(edited)).put("bases", JSONObject(edited.keys.associateWith { base(it) }))
        .put("inputs", JSONObject(inputs)).put("resolved", JSONObject(resolved)).put("waitingFor", waitingFor ?: JSONObject.NULL)

    companion object {
        fun open(model: EditorModel) = TaskEditor(model, emptyMap())

        /** A saved draft onto a model read again from core: the edits keep their own bases, so core still checks them. */
        fun restore(model: EditorModel, saved: JSONObject): TaskEditor {
            fun map(name: String) = saved.getJSONObject(name).let { m -> m.keys().asSequence().associateWith { m.getString(it) } }
            return TaskEditor(model, map("edited"), map("inputs"), map("resolved"), map("bases"),
                if (saved.isNull("waitingFor")) null else saved.getString("waitingFor"))
        }
    }
}

/** Names the day the picker chose; it returns that day's UTC midnight. Only picker output comes here, never a stored value. */
private fun pickedDay(pickerMillis: Long): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(pickerMillis))

/** The picker's hour and minute as the draft's time part (core's `yyyy-MM-ddTHH:mm`). */
private fun pickedTime(hour: Int, minute: Int) = "T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}"

/** RN's editor field glyphs (TaskEditOrganizationField and friends). */
private val STATUS_ICONS = mapOf("inbox" to Lucide.Inbox, "next" to Lucide.ArrowRight, "waiting" to Lucide.CirclePause,
    "someday" to Lucide.CircleArrowUp, "reference" to Lucide.Book, "done" to Lucide.Check)
private val ENERGY_ICONS = mapOf("low" to Lucide.BatteryLow, "medium" to Lucide.BatteryMedium, "high" to Lucide.BatteryFull)

/**
 * RN's task editor, Form tab (task-edit-modal.tsx, TaskEditFormTab and its field components): the
 * header, the title, then core's sections and fields in core's order with RN's controls. Every
 * value shown is the draft as core defined it; dates are shown as the draft holds them.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
@Composable
fun TaskEditorScreen(model: InboxViewModel, editor: TaskEditor) = with(model) {
    val theme = LocalTheme.current
    val c = theme.colors
    // After a failed save only its exact retry may run: the draft is locked,
    // and Back leaves the app as it does on the lists, so reopening finds it.
    val failed = failedAction != null
    val locked = busy || failed || editor.readOnly
    var confirmLeave by rememberSaveable { mutableStateOf(false) }
    var help by rememberSaveable { mutableStateOf(false) }
    var picker by rememberSaveable { mutableStateOf<String?>(null) }
    // A date pick: the field, and whether a time follows (RN's clock button). Then the time pick for the day chosen.
    var pickDate by rememberSaveable { mutableStateOf<String?>(null) }
    var pickTime by rememberSaveable { mutableStateOf<String?>(null) }
    // As in the mobile editor: with nothing to save it closes; unsaved edits (typed text core has not resolved included) ask first.
    val leave = { if (editor.readOnly || !editor.dirty) closeEditor() else confirmLeave = true }
    BackHandler(enabled = !failed) { if (!busy) leave() }
    // Core's quick chips and the draft value of restored typed text, whenever no action runs.
    LaunchedEffect(editor.id, busy, failed) { if (!busy && !failed) TYPED_FIELDS.forEach { suggest(it, editor.input(it)) } }

    Column(Modifier.fillMaxSize().background(c.bg).systemBarsPadding().semantics { testTagsAsResourceId = true }.testTag("task-editor")) {
        // RN's TaskEditHeader: Close at the left, Save at the right (Close alone when read-only). Its More menu is not built.
        Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).background(c.cardBg).hairline(c.border, top = false).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            if (!editor.readOnly) {
                val closeLabel = t("common.close")
                Box(Modifier.size(44.dp).clickable(enabled = !busy && !failed, role = Role.Button, onClick = leave)
                    .semantics { contentDescription = closeLabel }, contentAlignment = Alignment.CenterStart) {
                    Icon(Lucide.X, null, tint = c.tint, modifier = Modifier.size(22.dp).alpha(if (!busy && !failed) 1f else 0.5f))
                }
            }
            Spacer(Modifier.weight(1f))
            // Typed text core has not resolved yet queues the save until it has (saveEditor).
            val saveEnabled = if (editor.readOnly) true else writable && !busy &&
                (failedAction == null || failedAction == saveDraftAction(editor))
            Box(Modifier.heightIn(min = 44.dp).widthIn(min = 44.dp)
                .clickable(enabled = saveEnabled, role = Role.Button) { if (editor.readOnly) closeEditor() else saveEditor() },
                contentAlignment = Alignment.CenterEnd) {
                Text(t(if (editor.readOnly) "common.close" else "common.save"), style = rnText(18, 700), color = c.tint,
                    modifier = Modifier.alpha(if (saveEnabled) 1f else 0.5f))
            }
        }
        // Core's message; after a conflict, "Try again" takes the stored values of the fields core named and keeps the other edits.
        error?.let { message ->
            FailureBanner(message) { if (conflict) TextButton(onClick = model::reloadEditor, enabled = !busy && !failed) { Text(t("common.retry")) } }
        }
        Column(Modifier.weight(1f).imePadding().verticalScroll(rememberScrollState()).padding(20.dp)) {
            if (editor.readOnly) Text(t("projects.archivedReadOnlyHint"), style = rnText(14, 400), color = c.secondaryText,
                modifier = Modifier.padding(bottom = 16.dp))
            FormGroup {
                Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    FieldHeading(Lucide.Type, t("taskEdit.titleLabel"), Modifier.weight(1f), bottom = 0)
                    val helpLabel = t("taskEdit.editorLayoutHelpLabel")
                    Box(Modifier.size(28.dp).clip(RoundedCornerShape(7.dp)).background(c.filterBg).border(1.dp, c.border, RoundedCornerShape(7.dp))
                        .clickable(role = Role.Button) { help = true }.semantics { contentDescription = helpLabel }, contentAlignment = Alignment.Center) {
                        Icon(Lucide.CircleHelp, null, tint = c.secondaryText, modifier = Modifier.size(18.dp))
                    }
                }
                // RN's title input is multiline, and a typed line break becomes a space.
                EditorInput(editor.text("title"), { editText("title", it.replace(Regex("[\r\n]+"), " ")) }, null, !locked)
            }
            // The Destination row stands for both Project and Area, at the first of them in core's order (RN's destinationFields).
            val destination = editor.model.sections.flatMap { it.fields }.firstOrNull { it == "project" || it == "area" }
            val field = @Composable { id: String -> EditorField(model, editor, id, locked, id == destination, { picker = it }, { f, time -> pickDate = "$f:$time" }) }
            for (section in editor.model.sections) {
                if (section.titleKey == null) {
                    section.fields.forEach { field(it) }
                    if (editor.model.showSomedaySection) SomedaySections(model, editor, locked)
                } else {
                    CollapsibleSection(editor.id, section) { section.fields.forEach { field(it) } }
                }
            }
            Spacer(Modifier.heightIn(min = 100.dp))
        }
    }

    when (picker) {
        "destination" -> PickerDialog(t("task.destination"), { picker = null }) {
            PickerItem(t("common.none")) { editFields(mapOf("projectId" to "", "areaId" to "")); picker = null }
            // Core finishes the move when it saves: a project clears the area, and a section outside the project is dropped.
            PickerHeading(t("nav.projects"))
            for (project in editor.model.projects) PickerItem(project.title, "destination-project") { editFields(mapOf("projectId" to project.id)); picker = null }
            PickerHeading(t("taskEdit.areaLabel"))
            for (area in editor.model.areas) PickerItem(area.title) { editFields(mapOf("projectId" to "", "areaId" to area.id)); picker = null }
        }
        "section" -> PickerDialog(t("taskEdit.sectionLabel"), { picker = null }) {
            PickerItem(t("taskEdit.noSectionOption")) { editFields(mapOf("sectionId" to "")); picker = null }
            for (section in editor.model.projectSections) PickerItem(section.title) { editFields(mapOf("sectionId" to section.id)); picker = null }
        }
    }

    pickDate?.let { request ->
        val (target, time) = request.split(":").let { it[0] to (it[1] == "true") }
        val state = rememberDatePickerState()
        DatePickerDialog(
            onDismissRequest = { pickDate = null },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { pickerMillis ->
                        val day = pickedDay(pickerMillis)
                        if (time) pickTime = "$target:$day" else pickDay(target, day)
                    }
                    pickDate = null
                }, enabled = state.selectedDateMillis != null) { Text(t("common.ok")) }
            },
            dismissButton = { TextButton(onClick = { pickDate = null }) { Text(t("common.cancel")) } },
        ) { DatePicker(state) }
    }
    pickTime?.let { request ->
        val (target, day) = request.split(":").let { it[0] to it[1] }
        // RN opens its time picker on the draft's date, which for a date-only value is midnight.
        val state = rememberTimePickerState(initialHour = 0, initialMinute = 0)
        AlertDialog(
            onDismissRequest = { pickTime = null },
            confirmButton = { TextButton(onClick = { pickDay(target, day + pickedTime(state.hour, state.minute)); pickTime = null }) { Text(t("common.ok")) } },
            dismissButton = { TextButton(onClick = { pickTime = null }) { Text(t("common.cancel")) } },
            text = { TimePicker(state) },
        )
    }

    if (editor.waitingFor != null) WaitingPrompt(model, editor.waitingFor, locked)

    if (help) AlertDialog(
        onDismissRequest = { help = false },
        title = { Text(t("taskEdit.editorLayoutHelpLabel")) },
        text = { Text(t("taskEdit.editorLayoutHelpText")) },
        confirmButton = { TextButton(onClick = { help = false }) { Text(t("common.ok")) } },
    )

    if (confirmLeave) {
        AlertDialog(
            onDismissRequest = { confirmLeave = false },
            title = { Text(t("taskEdit.discardChanges")) },
            text = { Text(t("taskEdit.discardChangesDesc")) },
            confirmButton = { TextButton(onClick = { confirmLeave = false; saveEditor() }) { Text(t("common.save")) } },
            dismissButton = {
                Row {
                    TextButton(onClick = { confirmLeave = false }) { Text(t("common.cancel")) }
                    TextButton(onClick = { confirmLeave = false; closeEditor() }) { Text(t("common.discard")) }
                }
            },
        )
    }
}

/**
 * A picked date or date-and-time for [field]. RN's date controls write only the date field, and a start date
 * or a cleared due date also drops a relative start (use-task-edit-dates.ts); the rest is core's at save.
 */
private fun InboxViewModel.pickDay(field: String, value: String) =
    editFields(if (field == "startTime") mapOf(field to value, "relativeStartOffset" to null) else mapOf(field to value))

/** One field with RN's control for it. A field whose control is not built shows its value read-only. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EditorField(model: InboxViewModel, editor: TaskEditor, id: String, locked: Boolean, destination: Boolean,
                        openPicker: (String) -> Unit, pickDate: (String, Boolean) -> Unit) = with(model) {
    val c = LocalTheme.current.colors
    when (id) {
        "status" -> FormGroup {
            FieldHeading(Lucide.ListTodo, t("taskEdit.statusLabel"))
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
                maxItemsInEachRow = 3) {
                for (status in editor.model.statuses) {
                    val active = editor.text("status") == status
                    // RN's requestStatusChange: moving to Waiting first asks who or what it waits for.
                    val choose = { if (status == "waiting" && !active) openWaitingPrompt() else editFields(mapOf("status" to status)) }
                    Chip(active, !locked, "${t("taskEdit.statusLabel")}: ${t("status.$status")}", choose,
                        Modifier.weight(1f), RoundedCornerShape(14.dp), compact = true) { color ->
                        Icon(STATUS_ICONS[status] ?: Lucide.CircleDot, null, tint = color, modifier = Modifier.size(14.dp))
                        Text(t("status.$status"), style = rnText(13, 600), color = color, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
        }
        "project", "area" -> if (destination) FormGroup {
            val project = editor.text("projectId")
            val area = editor.text("areaId")
            val value = when {
                project.isNotEmpty() -> editor.model.projects.firstOrNull { it.id == project }?.title ?: t("taskEdit.noProjectOption")
                area.isNotEmpty() -> editor.model.areas.firstOrNull { it.id == area }?.title ?: t("taskEdit.noAreaOption")
                else -> t("common.none")
            }
            CompactRow(Lucide.Folder, t("task.destination"), value, !locked) { openPicker("destination") }
        }
        "section" -> if (editor.text("projectId").isNotEmpty()) FormGroup {
            FieldHeading(Lucide.Layers, t("taskEdit.sectionLabel"))
            // Core lists the loaded project's sections; after a project change the section waits for the next open.
            val sameProject = editor.text("projectId") == editor.model.draft["projectId"]?.let { draftValueText(it) }
            val section = editor.model.projectSections.firstOrNull { it.id == editor.text("sectionId") }
            Row(verticalAlignment = Alignment.CenterVertically) {
                DateButton(section?.title ?: t("taskEdit.noSectionOption"), t("taskEdit.sectionLabel"), !locked && sameProject, Modifier.weight(1f)) { openPicker("section") }
                if (editor.text("sectionId").isNotEmpty() && sameProject) SmallButton(Lucide.X, "${t("common.clear")} ${t("taskEdit.sectionLabel")}", !locked) {
                    editFields(mapOf("sectionId" to ""))
                }
            }
        }
        "priority" -> FormGroup {
            FieldHeading(Lucide.Flag, t("taskEdit.priorityLabel"))
            ChoiceChips(editor, "priority", editor.model.priorities, !locked, t("taskEdit.priorityLabel"), { t("priority.$it") }) { value, color ->
                Icon(Lucide.Flag, null, tint = LocalTheme.current.priority(value) ?: color, modifier = Modifier.size(12.dp))
            }
        }
        "energyLevel" -> FormGroup {
            FieldHeading(Lucide.BatteryCharging, t("taskEdit.energyLevel"))
            ChoiceChips(editor, "energyLevel", editor.model.energyLevels, !locked, t("taskEdit.energyLevel"), { t("energyLevel.$it") }) { value, color ->
                Icon(ENERGY_ICONS[value] ?: Lucide.BatteryMedium, null, tint = color, modifier = Modifier.size(14.dp))
            }
        }
        "timeEstimate" -> FormGroup {
            FieldHeading(Lucide.Hourglass, t("taskEdit.timeEstimateLabel"))
            val current = editor.text("timeEstimate")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((value, label) in editor.model.timeEstimates) {
                    Chip(current == value, !locked, "${t("taskEdit.timeEstimateLabel")}: $label", { editFields(mapOf("timeEstimate" to value)) }) { color ->
                        if (value.isEmpty()) Icon(Lucide.CircleSlash, null, tint = color, modifier = Modifier.size(16.dp))
                        else Text(label, style = rnText(14, 400), color = color)
                    }
                }
                // A custom estimate core does not list is shown selected; its input is not built.
                if (current.isNotEmpty() && editor.model.timeEstimates.none { it.first == current }) {
                    Chip(true, false, "${t("taskEdit.timeEstimateLabel")}: ${t("recurrence.custom")}", {}) { color ->
                        Text(t("recurrence.custom"), style = rnText(14, 400), color = color)
                    }
                }
            }
        }
        "contexts", "tags" -> FormGroup {
            val contexts = id == "contexts"
            val label = t(if (contexts) "taskEdit.contextsLabel" else "taskEdit.tagsLabel")
            FieldHeading(if (contexts) Lucide.AtSign else Lucide.Tag, label)
            EditorInput(editor.input(id), { editInput(id, it) }, t(if (contexts) "taskEdit.contextsPlaceholder" else "taskEdit.tagsPlaceholder"),
                !locked, description = label, tag = "editor-$id")
            val shown = suggestions[id]?.takeIf { it.text == editor.input(id) }
            if (shown != null && shown.matches.isNotEmpty()) SuggestionMenu(shown.matches, !locked) { editInput(id, it) }
            if (shown != null && shown.quick.isNotEmpty()) FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((token, selected, text) in shown.quick) {
                    Chip(selected, !locked, token, { editInput(id, text) }, shape = RoundedCornerShape(14.dp), horizontal = 10, toggle = true) { color ->
                        Text(token, style = rnText(13, 500), color = color)
                    }
                }
            }
        }
        "assignedTo" -> FormGroup {
            FieldHeading(Lucide.User, t("taskEdit.assignedTo"))
            EditorInput(editor.input(id), { editInput(id, it) }, t("taskEdit.assignedToPlaceholder"), !locked, description = t("taskEdit.assignedTo"))
            val shown = suggestions[id]?.takeIf { it.text == editor.input(id) }
            if (shown != null && shown.matches.isNotEmpty()) SuggestionMenu(shown.matches, !locked) { editInput(id, it) }
        }
        "location" -> FormGroup {
            FieldHeading(Lucide.Navigation, t("taskEdit.locationLabel"))
            EditorInput(editor.text("location"), { editText("location", it) }, t("taskEdit.locationPlaceholder"), !locked, description = t("taskEdit.locationLabel"))
        }
        "description" -> FormGroup {
            FieldHeading(Lucide.AlignLeft, t("taskEdit.descriptionLabel"))
            EditorInput(editor.text("description"), { editText("description", it) }, t("taskEdit.descriptionPlaceholder"), !locked,
                singleLine = false, minHeight = 100, description = t("taskEdit.descriptionLabel"))
        }
        "dueDate" -> FormGroup {
            val label = t("taskEdit.dueDateLabel")
            val due = editor.text("dueDate")
            if (due.isEmpty()) {
                CompactRow(Lucide.CalendarDays, label, t("common.notSet"), !locked) { pickDate(id, false) }
            } else {
                FieldHeading(Lucide.CalendarDays, label)
                DateRow(id, label, due, locked, pickDate) { editFields(mapOf("dueDate" to "", "relativeStartOffset" to null)) }
            }
            // RN's reminder controls: Skip reminders, and Repeat reminder shown read-only (its choices are not in core's model).
            if (due.isNotEmpty() || editor.text("startTime").isNotEmpty()) {
                val skip = editor.flag("suppressMindwtrReminders")
                SwitchRow(t("taskEdit.suppressMindwtrReminders"), t("taskEdit.suppressMindwtrRemindersHint"), skip, !locked) {
                    editFields(mapOf("suppressMindwtrReminders" to !skip))
                }
                val repeat = (editor.value("repeatReminderMinutes") as? Number)?.toInt()
                if (due.isNotEmpty() && !skip && repeat != null && repeat > 0) {
                    ReadOnlyRow(t("taskEdit.repeatReminderLabel"), t("taskEdit.repeatReminderEveryMinutes").replace("{count}", "$repeat"))
                }
            }
        }
        "startTime" -> FormGroup {
            val label = t("taskEdit.startDateLabel")
            FieldHeading(Lucide.Calendar, label)
            DateRow(id, label, editor.text("startTime"), locked, pickDate) { editFields(mapOf("startTime" to "", "relativeStartOffset" to null)) }
            // A relative start (core's offset before the due date) is shown read-only; its editor is not built.
            (editor.value("relativeStartOffset") as? JSONObject)?.let { offset ->
                val unit = t(when (offset.optString("unit")) {
                    "minute" -> "taskEdit.relativeStartMinutesShort"; "hour" -> "taskEdit.relativeStartHoursShort"
                    "week" -> "taskEdit.relativeStartWeeksShort"; else -> "taskEdit.relativeStartDaysShort"
                })
                ReadOnlyRow(t("taskEdit.startModeRelative"), "${kotlin.math.abs(offset.optInt("amount"))} $unit ${t("taskEdit.relativeStartBeforeDue")}")
            }
        }
        "reviewAt" -> FormGroup {
            val label = t("taskEdit.reviewDateLabel")
            FieldHeading(Lucide.CalendarClock, label)
            DateRow(id, label, editor.text("reviewAt"), locked, pickDate, clock = false) { editFields(mapOf("reviewAt" to "")) }
        }
        "recurrence" -> FormGroup {
            FieldHeading(Lucide.Repeat, t("taskEdit.recurrenceLabel"))
            val rule = editor.text("recurrence")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((value, key) in editor.model.recurrences) {
                    // A new rule starts without the old rule's details; the rule's detail editors are not built.
                    Chip(rule == value, !locked, "${t("taskEdit.recurrenceLabel")}: ${t(key)}", {
                        if (value != rule) editFields(if (value.isEmpty()) mapOf("recurrence" to "", "recurrenceStrategy" to "strict", "recurrenceRRule" to "")
                            else mapOf("recurrence" to value, "recurrenceRRule" to ""))
                    }) { color -> Text(t(key), style = rnText(14, 400), color = color) }
                }
            }
            if (rule.isNotEmpty() && rule == editor.model.draft["recurrence"]?.let { draftValueText(it) }) {
                if (rule == "daily") ReadOnlyRow(t("recurrence.repeatEvery"), "${editor.model.dailyInterval} ${t("recurrence.dayUnit")}")
                if (rule == "monthly") ReadOnlyRow(t("taskEdit.recurrenceLabel"),
                    t(if (editor.model.monthlyPattern == "custom") "recurrence.custom" else "recurrence.monthlyOnDay"))
            }
            if (rule.isNotEmpty()) {
                val fluid = editor.text("recurrenceStrategy") == "fluid"
                Row(Modifier.padding(top = 8.dp)) {
                    Chip(fluid, !locked, t("recurrence.afterCompletion"), { editFields(mapOf("recurrenceStrategy" to if (fluid) "strict" else "fluid")) }, toggle = true) { color ->
                        Text(t("recurrence.afterCompletion"), style = rnText(14, 400), color = color)
                    }
                }
                val future = editor.flag("showFutureRecurrence")
                SwitchRow(t("recurrence.showFutureInCalendar"), t("recurrence.showFutureInCalendarHint"), future, !locked) {
                    editFields(mapOf("showFutureRecurrence" to !future))
                }
            }
        }
        // Read-only: the checklist and attachment editors are not built.
        "checklist" -> if (editor.model.checklist.isNotEmpty()) FormGroup {
            FieldHeading(Lucide.ListChecks, t(if (editor.text("status") == "reference") "taskEdit.tab.list" else "taskEdit.checklist"))
            for ((title, done) in editor.model.checklist) Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (done) Lucide.Check else Lucide.Circle, null, tint = if (done) c.tint else c.secondaryText, modifier = Modifier.size(16.dp))
                Text(title, style = rnText(15, 400), color = if (done) c.secondaryText else c.text, modifier = Modifier.padding(start = 8.dp))
            }
        }
        "attachments" -> if (editor.model.attachments.isNotEmpty()) FormGroup {
            FieldHeading(Lucide.Paperclip, t("attachments.title"))
            for (title in editor.model.attachments) Text(title, style = rnText(14, 500), color = c.text, modifier = Modifier.padding(vertical = 4.dp))
        }
        else -> Unit
    }
}

private fun draftValueText(literal: String) = draftValue(literal) as? String ?: ""

/** RN's Someday section picker (SomedaySectionPicker): No section, then core's sections, as chips. Its "New section…" is not built. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SomedaySections(model: InboxViewModel, editor: TaskEditor, locked: Boolean) = with(model) {
    val current = draftValue(editor.edited["viewSectionIds"] ?: "null").toString()
    FormGroup {
        Text(t("viewSections.somedaySection").uppercase(), style = rnText(14, 400), color = LocalTheme.current.colors.secondaryText,
            modifier = Modifier.padding(bottom = 8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (choice in editor.model.somedaySections) {
                // Core marks the loaded choice; after a tap, the choice whose value the draft now holds.
                val selected = if (editor.edited.containsKey("viewSectionIds")) draftValue(choice.viewSectionIds).toString() == current else choice.selected
                Chip(selected, !locked, choice.title, { editFields(mapOf("viewSectionIds" to draftValue(choice.viewSectionIds))) }) { color ->
                    Text(choice.title, style = rnText(14, 400), color = color)
                }
            }
        }
    }
}

/** RN's CollapsibleSection: a top rule, the chevron, the title in capitals, and core's badge. Open state lasts while the editor is open. */
@Composable
private fun CollapsibleSection(editorId: String, section: EditorSection, content: @Composable ColumnScope.() -> Unit) {
    val c = LocalTheme.current.colors
    var open by rememberSaveable(editorId, section.id) { mutableStateOf(section.open) }
    val title = t(section.titleKey!!)
    Column(Modifier.padding(top = 8.dp).hairline(c.border, top = true)) {
        Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = t(if (open) "markdown.collapse" else "markdown.expand")) { open = !open }
            .semantics { contentDescription = title; heading() }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (open) Lucide.ChevronDown else Lucide.ChevronRight, null, tint = c.secondaryText, modifier = Modifier.size(16.dp))
            Text(title.uppercase(), style = rnText(12, 700, letterSpacing = 0.6f), color = c.text, modifier = Modifier.padding(start = 8.dp).weight(1f))
            if (section.filledCount > 0) Box(Modifier.clip(RoundedCornerShape(10.dp)).background(c.tint).padding(horizontal = 8.dp, vertical = 2.dp)) {
                Text("${section.filledCount}", style = rnText(12, 600), color = c.onTint)
            }
        }
        if (open) Column(Modifier.padding(bottom = 16.dp), content = content)
    }
}

@Composable
private fun FormGroup(content: @Composable ColumnScope.() -> Unit) = Column(Modifier.fillMaxWidth().padding(bottom = 16.dp), content = content)

/** RN's FieldHeading: the glyph and the label in capitals, both in the secondary text color. */
@Composable
private fun FieldHeading(icon: ImageVector, label: String, modifier: Modifier = Modifier, bottom: Int = 8) {
    val c = LocalTheme.current.colors
    Row(modifier.padding(bottom = bottom.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = c.secondaryText, modifier = Modifier.size(16.dp))
        Text(label.uppercase(), style = rnText(14, 400), color = c.secondaryText, modifier = Modifier.padding(start = 6.dp))
    }
}

/** RN's text input: 12 padding, radius 10, 16 text, the input background and border. [description] names it for TalkBack. */
@Composable
private fun EditorInput(value: String, onChange: (String) -> Unit, placeholder: String?, enabled: Boolean, singleLine: Boolean = false,
                        minHeight: Int = 0, description: String? = null, tag: String? = null) {
    val c = LocalTheme.current.colors
    val shape = RoundedCornerShape(10.dp)
    // One text-and-cursor state, the only one the field and the keyboard see. Text the app puts in (a chosen
    // suggestion or quick chip) replaces it at once with the cursor at its true end and no composing region, as
    // RN's TextInput does, so the next token types after ", ". Keyboard and IME cursor moves are kept as they come.
    var field by remember { mutableStateOf(TextFieldValue(value, TextRange(value.length))) }
    if (field.text != value) field = TextFieldValue(value, TextRange(value.length))
    BasicTextField(field, { typed -> field = typed; if (typed.text != value) onChange(typed.text) }, enabled = enabled, singleLine = singleLine, textStyle = rnText(16, 400).copy(color = if (enabled) c.text else c.secondaryText),
        cursorBrush = SolidColor(c.tint),
        modifier = Modifier.fillMaxWidth().heightIn(min = minHeight.dp).clip(shape).background(c.inputBg).border(1.dp, c.border, shape)
            .then(if (tag != null) Modifier.testTag(tag) else Modifier)
            .then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier),
        decorationBox = { inner ->
            Box(Modifier.padding(12.dp)) {
                if (value.isEmpty() && placeholder != null) Text(placeholder, style = rnText(16, 400), color = c.secondaryText)
                inner()
            }
        })
}

/**
 * RN's chip (statusChip): the tint when active, else the filter background, with a border; 44 high.
 * [content] draws in the chip's text color. A one-of-many choice (the default) is selectable, so TalkBack
 * says "selected" as RN does and the checks read `selected`; an on/off chip ([toggle]) is toggleable.
 */
@Composable
private fun Chip(active: Boolean, enabled: Boolean, description: String, onClick: () -> Unit, modifier: Modifier = Modifier,
                 shape: RoundedCornerShape = RoundedCornerShape(16.dp), compact: Boolean = false, horizontal: Int = if (compact) 10 else 12,
                 toggle: Boolean = false, content: @Composable (androidx.compose.ui.graphics.Color) -> Unit) {
    val c = LocalTheme.current.colors
    Row(modifier.heightIn(min = 44.dp).clip(shape).background(if (active) c.tint else c.filterBg).border(1.dp, if (active) c.tint else c.border, shape)
        // One node for TalkBack and the checks: the click, the label, and the state.
        .semantics { contentDescription = description }
        .then(if (toggle) Modifier.toggleable(value = active, enabled = enabled, role = Role.Button, onValueChange = { onClick() })
            else Modifier.selectable(selected = active, enabled = enabled, role = Role.Tab, onClick = onClick))
        .alpha(if (enabled || active) 1f else 0.6f).padding(horizontal = horizontal.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = if (compact) Arrangement.Center else Arrangement.Start) {
        content(if (active) c.onTint else c.secondaryText)
    }
}

/** RN's None chip (CircleSlash) and one chip per value core offers, with [icon] and core's label. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InboxViewModel.ChoiceChips(editor: TaskEditor, field: String, values: List<String>, enabled: Boolean, fieldLabel: String,
                                       label: (String) -> String, icon: @Composable (String, androidx.compose.ui.graphics.Color) -> Unit) {
    val current = editor.text(field)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Chip(current.isEmpty(), enabled, "$fieldLabel: ${t("common.none")}", { editFields(mapOf(field to "")) }) { color ->
            Icon(Lucide.CircleSlash, null, tint = color, modifier = Modifier.size(16.dp))
        }
        for (value in values) {
            Chip(current == value, enabled, "$fieldLabel: ${label(value)}", { editFields(mapOf(field to value)) }) { color ->
                icon(value, color)
                Text(label(value), style = rnText(14, 400), color = color, modifier = Modifier.padding(start = 6.dp))
            }
        }
    }
}

/** RN's compact picker row: the glyph and label at the left, the value in the tint at the right. */
@Composable
private fun CompactRow(icon: ImageVector, label: String, value: String, enabled: Boolean, onClick: () -> Unit) {
    val c = LocalTheme.current.colors
    val shape = RoundedCornerShape(10.dp)
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(shape).background(c.filterBg).border(1.dp, c.border, shape)
        .clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = "$label: $value" }
        .padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = c.secondaryText, modifier = Modifier.size(14.dp))
        Text(label.uppercase(), style = rnText(13, 700, 17), color = c.secondaryText, modifier = Modifier.padding(start = 6.dp))
        Text(value, style = rnText(14, 700, 18), color = c.tint, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.End,
            modifier = Modifier.weight(1f).padding(start = 12.dp))
    }
}

/**
 * RN's date row: the date button, RN's clock button (date, then time), and Clear. The value is the
 * draft as core holds it (`yyyy-MM-dd` or `yyyy-MM-ddTHH:mm`); Kotlin never formats or parses it.
 */
@Composable
private fun DateRow(field: String, label: String, value: String, locked: Boolean, pickDate: (String, Boolean) -> Unit, clock: Boolean = true, clear: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        DateButton(value.ifEmpty { t("common.notSet") }, label, !locked, Modifier.weight(1f)) { pickDate(field, false) }
        if (value.isNotEmpty()) {
            if (clock) SmallButton(Lucide.Clock, "${t("calendar.changeTime")} $label", !locked) { pickDate(field, true) }
            SmallButton(Lucide.CalendarX, "${t("common.clear")} $label", !locked, clear)
        }
    }
}

@Composable
private fun DateButton(text: String, label: String, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = LocalTheme.current.colors
    val shape = RoundedCornerShape(10.dp)
    Box(modifier.clip(shape).background(c.inputBg).border(1.dp, c.border, shape).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        .semantics { contentDescription = "$label: $text" }.padding(12.dp)) {
        Text(text, style = rnText(14, 400), color = c.text)
    }
}

/** RN's clearDateBtn: a small filter-background button beside a date or section. */
@Composable
private fun SmallButton(icon: ImageVector, description: String, enabled: Boolean, onClick: () -> Unit) {
    val c = LocalTheme.current.colors
    val shape = RoundedCornerShape(8.dp)
    Box(Modifier.padding(start = 8.dp).size(44.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        .semantics { contentDescription = description }, contentAlignment = Alignment.Center) {
        Box(Modifier.clip(shape).background(c.filterBg).border(1.dp, c.border, shape).padding(horizontal = 10.dp, vertical = 8.dp)) {
            Icon(icon, null, tint = c.secondaryText, modifier = Modifier.size(14.dp))
        }
    }
}

/** RN's switch row (Skip reminders, Show future occurrences): the label, the hint, and the tint border when on. */
@Composable
private fun SwitchRow(label: String, hint: String, on: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    val c = LocalTheme.current.colors
    val shape = RoundedCornerShape(10.dp)
    Column(Modifier.padding(top = 8.dp).fillMaxWidth().clip(shape).background(if (on) c.filterBg else c.cardBg).border(1.dp, if (on) c.tint else c.border, shape)
        .toggleable(value = on, enabled = enabled, role = Role.Switch, onValueChange = { onToggle() }).padding(12.dp)) {
        Text(label, style = rnText(13, 600), color = c.text)
        Text(hint, style = rnText(12, 400, 16), color = c.secondaryText, modifier = Modifier.padding(top = 4.dp))
    }
}

/** A value whose editor is not built, shown as core holds it. */
@Composable
private fun ReadOnlyRow(label: String, value: String) {
    val c = LocalTheme.current.colors
    Row(Modifier.padding(top = 8.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = rnText(13, 600), color = c.secondaryText, modifier = Modifier.weight(1f))
        Text(value, style = rnText(13, 600), color = c.text)
    }
}

/** RN's token suggestion menu: core's matches; a tap puts core's `text` in the field. */
@Composable
private fun SuggestionMenu(matches: List<Pair<String, String>>, enabled: Boolean, choose: (String) -> Unit) {
    val theme = LocalTheme.current
    val c = theme.colors
    val shape = RoundedCornerShape(10.dp)
    Column(Modifier.padding(top = 8.dp).fillMaxWidth().clip(shape).background(c.cardBg).border(1.dp, c.border, shape)) {
        matches.forEachIndexed { index, (value, text) ->
            Text(value, style = rnText(14, 500), color = c.text, modifier = Modifier.fillMaxWidth()
                .clickable(enabled = enabled, role = Role.Button) { choose(text) }
                .then(if (index < matches.size - 1) Modifier.hairline(theme.divider, top = false) else Modifier)
                .padding(horizontal = 12.dp, vertical = 10.dp))
        }
    }
}

/**
 * RN's waiting prompt (TaskEditWaitingAssignmentModal): the question, its hint, the person field
 * with core's people suggestions, Cancel and Save. Save sets Waiting and the person together.
 */
@Composable
private fun WaitingPrompt(model: InboxViewModel, text: String, locked: Boolean) = with(model) {
    val theme = LocalTheme.current
    val c = theme.colors
    BackHandler { closeWaitingPrompt() }
    Box(Modifier.fillMaxSize().background(theme.pickerScrim).pointerInput(Unit) { detectTapGestures { closeWaitingPrompt() } }.padding(20.dp),
        contentAlignment = Alignment.Center) {
        val shape = RoundedCornerShape(12.dp)
        Column(Modifier.widthIn(max = 420.dp).fillMaxWidth().clip(shape).background(c.cardBg).border(1.dp, c.border, shape)
            .pointerInput(Unit) { detectTapGestures { } }.padding(16.dp)) {
            val title = t("process.waitingFor")
            Text(title, style = rnText(16, 700), color = c.text, modifier = Modifier.padding(bottom = 12.dp).semantics { heading() })
            Text(t("process.waitingForDesc"), style = rnText(13, 600), color = c.secondaryText, modifier = Modifier.padding(bottom = 8.dp))
            EditorInput(text, model::editWaitingPrompt, t("taskEdit.assignedToPlaceholder"), !locked, singleLine = true, description = title, tag = "editor-waiting-for")
            val shown = suggestions[WAITING_PROMPT]?.takeIf { it.text == text }
            if (shown != null && shown.matches.isNotEmpty()) SuggestionMenu(shown.matches, !locked, model::editWaitingPrompt)
            Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.End) {
                for ((label, action, color) in listOf(Triple("common.cancel", model::closeWaitingPrompt, c.secondaryText), Triple("common.save", model::confirmWaiting, c.tint))) {
                    Box(Modifier.heightIn(min = 44.dp).clickable(enabled = !locked, role = Role.Button) { action() }.padding(horizontal = 10.dp),
                        contentAlignment = Alignment.Center) {
                        Text(t(label), style = rnText(14, 700), color = color)
                    }
                }
            }
        }
    }
}

/** RN's picker modal (TaskEditDestinationPicker, TaskEditSectionPicker): a card over a dimmed screen, the list, and Cancel. Search and "New …" are not built. */
@Composable
private fun PickerDialog(title: String, dismiss: () -> Unit, items: @Composable ColumnScope.() -> Unit) {
    val theme = LocalTheme.current
    val c = theme.colors
    BackHandler(onBack = dismiss)
    Box(Modifier.fillMaxSize().background(theme.pickerScrim).pointerInput(Unit) { detectTapGestures { dismiss() } }.padding(20.dp),
        contentAlignment = Alignment.Center) {
        val shape = RoundedCornerShape(12.dp)
        Column(Modifier.widthIn(max = 420.dp).fillMaxWidth().clip(shape).background(c.cardBg).border(1.dp, c.border, shape)
            .pointerInput(Unit) { detectTapGestures { } }.padding(16.dp)) {
            Text(title, style = rnText(16, 700), color = c.text, modifier = Modifier.padding(bottom = 12.dp).semantics { heading() })
            Column(Modifier.heightIn(max = 260.dp).fillMaxWidth().clip(shape).background(c.inputBg).border(1.dp, c.border, shape)
                .verticalScroll(rememberScrollState()).padding(vertical = 4.dp), content = items)
            Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.End) {
                Box(Modifier.heightIn(min = 44.dp).clickable(role = Role.Button, onClick = dismiss).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                    Text(t("common.cancel"), style = rnText(14, 700), color = c.secondaryText)
                }
            }
        }
    }
}

@Composable
private fun PickerItem(text: String, tag: String? = null, onClick: () -> Unit) {
    val c = LocalTheme.current.colors
    Box(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button, onClick = onClick)
        .then(if (tag != null) Modifier.testTag(tag) else Modifier).padding(horizontal = 14.dp, vertical = 10.dp), contentAlignment = Alignment.CenterStart) {
        Text(text, style = rnText(16, 400), color = c.text)
    }
}

@Composable
private fun PickerHeading(text: String) {
    Text(text, style = rnText(16, 700), color = LocalTheme.current.colors.secondaryText, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
}
