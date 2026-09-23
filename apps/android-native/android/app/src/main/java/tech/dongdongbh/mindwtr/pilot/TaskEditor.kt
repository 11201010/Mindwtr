package tech.dongdongbh.mindwtr.pilot

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** The seven fields of core's getTaskEditor and updateTask, in core's order. */
val EDITOR_FIELDS = listOf("title", "description", "status", "priority", "projectId", "startTime", "dueDate")

private fun JSONObject.text(name: String): String? = if (isNull(name)) null else getString(name)
private fun JSONArray.texts() = List(length()) { getString(it) }

/** A field map as JSON. Null stays JSON null: `JSONObject.put(name, null)` would drop the name. */
fun json(values: Map<String, String?>): String =
    JSONObject().apply { values.forEach { (name, value) -> put(name, value ?: JSONObject.NULL) } }.toString()

/** Core's getTaskEditor reply, parsed once. [source] is kept verbatim for saved instance state. */
class EditorReply(val source: String) {
    private val reply = JSONObject(source).also { check(it.getInt("version") == 1) { "Unsupported core contract" } }
    val id: String = reply.getString("id")
    val fields: Map<String, String?> = reply.getJSONObject("fields").let { stored -> EDITOR_FIELDS.associateWith { stored.text(it) } }
    val readOnly = reply.getBoolean("readOnly")
    val statuses = reply.getJSONArray("statuses").texts()
    val priorities = reply.getJSONArray("priorities").texts()
    val projects: List<Pair<String, String>> = reply.getJSONArray("projects").let { list ->
        List(list.length()) { index -> list.getJSONObject(index).let { it.getString("id") to it.getString("title") } }
    }
}

/**
 * An open editor: core's reply and the user's draft of its fields. Values stay
 * exactly as core returned them or the user chose them. Kotlin never validates,
 * reshapes, or fills in a field; core decides every rule when it saves.
 */
data class TaskEditor(val reply: EditorReply, val edited: Map<String, String?>) {
    val id get() = reply.id
    val loaded get() = reply.fields
    val readOnly get() = reply.readOnly
    /** Only the fields whose draft differs from the loaded value. */
    val patch: Map<String, String?> get() = EDITOR_FIELDS.filter { edited[it] != loaded[it] }.associateWith { edited[it] }
    /** The loaded values of exactly the patched fields. */
    val base: Map<String, String?> get() = patch.keys.associateWith { loaded[it] }

    fun edit(field: String, value: String?) = copy(edited = edited + (field to value))

    /** A text box has no null: text equal to what the loaded value shows means "unchanged". */
    fun editText(field: String, text: String) = edit(field, if (text == (loaded[field] ?: "")) loaded[field] else text)

    /**
     * After STALE_REVISION: the fresh reply becomes the base. An edit stays only
     * where the stored value still equals the old base. Where another writer
     * changed a field, the draft takes the stored value.
     */
    fun reloaded(fresh: EditorReply) = TaskEditor(fresh, EDITOR_FIELDS.associateWith { field ->
        if (fresh.fields[field] == loaded[field]) edited[field] else fresh.fields[field]
    })

    companion object {
        fun open(reply: EditorReply) = TaskEditor(reply, reply.fields)
        fun restore(source: String, edited: String) = JSONObject(edited).let { draft ->
            TaskEditor(EditorReply(source), EDITOR_FIELDS.associateWith { draft.text(it) })
        }
    }
}

/** Names the day the picker chose; it returns that day's UTC midnight. Only picker output comes here, never a stored value. */
private fun pickedDay(pickerMillis: Long): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(pickerMillis))

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskEditorScreen(model: InboxViewModel, editor: TaskEditor) {
    with(model) {
        // After a failed save only its exact retry may run: the draft is locked,
        // and Back leaves the app as it does on the Inbox, so reopening finds it.
        val failed = failedAction != null
        val locked = busy || failed || editor.readOnly
        var confirmLeave by rememberSaveable { mutableStateOf(false) }
        var picking by remember { mutableStateOf<String?>(null) }
        // As in the mobile editor: with nothing to save it closes; unsaved edits ask first.
        val leave = { if (editor.readOnly || editor.patch.isEmpty()) closeEditor() else confirmLeave = true }
        BackHandler(enabled = !failed) { if (!busy) leave() }

        Column(Modifier.fillMaxSize().systemBarsPadding().padding(horizontal = 24.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Edit task", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                TextButton(onClick = leave, enabled = !busy && !failed) { Text(if (editor.readOnly) "Close" else "Cancel") }
                if (!editor.readOnly) {
                    Button(onClick = model::saveEditor,
                        enabled = writable && !busy && (failedAction == null || failedAction == updateAction(editor))) { Text("Save") }
                }
            }
            if (editor.readOnly) Text("Read-only: this task's project is archived.", Modifier.padding(top = 8.dp))
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
            if (conflict) {
                Text("Reload takes the stored values of the fields named above and keeps your other edits.",
                    Modifier.padding(top = 4.dp))
                Button(onClick = model::reloadEditor, enabled = !busy && !failed) { Text("Reload") }
            }
            // The field being typed into stays above the keyboard.
            Column(Modifier.weight(1f).imePadding().verticalScroll(rememberScrollState())) {
                OutlinedTextField(editor.edited["title"] ?: "", { editText("title", it) }, label = { Text("Title") },
                    enabled = !locked, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                OutlinedTextField(editor.edited["description"] ?: "", { editText("description", it) }, label = { Text("Notes") },
                    minLines = 3, enabled = !locked, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                Choice("Status", editor.edited["status"] ?: "none", editor.reply.statuses.map { it to it }, !locked) {
                    editField("status", it)
                }
                Choice("Priority", editor.edited["priority"] ?: "none",
                    listOf(null to "none") + editor.reply.priorities.map { it to it }, !locked) { editField("priority", it) }
                val projectId = editor.edited["projectId"]
                val projectTitle = projectId?.let { id -> editor.reply.projects.firstOrNull { it.first == id }?.second ?: id }
                Choice("Project", projectTitle ?: "none", listOf(null to "none") + editor.reply.projects, !locked) {
                    editField("projectId", it)
                }
                DateChoice("Start date", editor.edited["startTime"], !locked, { picking = "startTime" }) { editField("startTime", null) }
                DateChoice("Due date", editor.edited["dueDate"], !locked, { picking = "dueDate" }) { editField("dueDate", null) }
            }
        }

        picking?.let { field ->
            val state = rememberDatePickerState()
            DatePickerDialog(
                onDismissRequest = { picking = null },
                confirmButton = {
                    TextButton(onClick = {
                        state.selectedDateMillis?.let { pickerMillis -> editField(field, pickedDay(pickerMillis)) }
                        picking = null
                    }, enabled = state.selectedDateMillis != null) { Text("OK") }
                },
                dismissButton = { TextButton(onClick = { picking = null }) { Text("Cancel") } },
            ) { DatePicker(state) }
        }

        if (confirmLeave) {
            AlertDialog(
                onDismissRequest = { confirmLeave = false },
                title = { Text("Discard unsaved changes?") },
                text = { Text("Your changes will be lost if you leave now.") },
                confirmButton = { TextButton(onClick = { confirmLeave = false; saveEditor() }) { Text("Save") } },
                dismissButton = {
                    Row {
                        TextButton(onClick = { confirmLeave = false }) { Text("Cancel") }
                        TextButton(onClick = { confirmLeave = false; closeEditor() }) { Text("Discard") }
                    }
                },
            )
        }
    }
}

/** A menu of core's allowed values; [shown] is the draft value as text. */
@Composable
private fun Choice(label: String, shown: String, options: List<Pair<String?, String>>, enabled: Boolean, pick: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(Modifier.padding(top = 8.dp)) {
        OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text("$label: $shown") }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((value, text) in options) DropdownMenuItem(text = { Text(text) }, onClick = { open = false; pick(value) })
        }
    }
}

/** Shows the value exactly as stored, date-only or with a time. Picking sets a date-only value; Clear sets null. */
@Composable
private fun DateChoice(label: String, value: String?, enabled: Boolean, onPick: () -> Unit, onClear: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(onClick = onPick, enabled = enabled, modifier = Modifier.weight(1f)) { Text("$label: ${value ?: "none"}") }
        TextButton(onClick = onClear, enabled = enabled && value != null,
            modifier = Modifier.semantics { contentDescription = "Clear ${label.lowercase()}" }) { Text("Clear") }
    }
}
