package tech.dongdongbh.mindwtr.pilot

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat

/** Isolated development UI. Task rules and writes stay in the shared core; every label comes from core's getStrings. */
class MainActivity : ComponentActivity() {
    private val model: InboxViewModel by viewModels()

    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = true
        model.attach()
        setContent {
            MaterialTheme { with(model) {
                val open = editor
                if (open != null && writable) TaskEditorScreen(model, open) else Column(
                    Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).systemBarsPadding()
                        .padding(horizontal = 24.dp, vertical = 8.dp).semantics { testTagsAsResourceId = true },
                ) {
                    if (loading) {
                        CircularProgressIndicator(Modifier.padding(top = 16.dp))
                    } else if (!writable) {
                        // The boot failed: no command can run, and core's labels may never have loaded.
                        Text(error.orEmpty(), color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("boot-failure"))
                    } else {
                        // Three lists in one Activity: tabs, no navigation library. The editor opens over the selected list.
                        TabRow(selectedTabIndex = screen.ordinal) {
                            for (tab in Screen.entries) Tab(selected = screen == tab, onClick = { show(tab) }, text = { Text(t(tab.label)) })
                        }
                        // A failure stays in view above the list. A failed read offers Try again; a failed command only its exact retry.
                        error?.let { message ->
                            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(message, color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                                if (failedAction == null) TextButton(onClick = { refresh() }, enabled = !busy) { Text(t("common.retry")) }
                            }
                        }
                        when (screen) {
                            Screen.Inbox -> InboxList(model, Modifier.weight(1f))
                            Screen.Focus -> FocusList(model, Modifier.weight(1f))
                            Screen.Projects -> ProjectsTab(model, Modifier.weight(1f))
                        }
                    }
                }
            } }
        }
    }
}

/** The Inbox as one list: its header and the capture row scroll with the rows, so landscape shows rows, not chrome. */
@Composable
private fun InboxList(model: InboxViewModel, modifier: Modifier) = with(model) {
    LazyColumn(modifier) {
        item(key = "header") {
            val inbox = t("tab.inbox")
            Text("$inbox · $total", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 12.dp))
        }
        item(key = "capture") {
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = model::editDraft,
                    label = { Text(t("nav.addTask")) },
                    singleLine = true,
                    enabled = !busy && failedAction == null,
                    modifier = Modifier.weight(1f),
                )
                Button(onClick = model::add, enabled = writable && !busy && draft.isNotBlank() &&
                    (failedAction == null || failedAction == FailedAction("create", captureId, draft)),
                    modifier = Modifier.padding(start = 8.dp)) { Text(t("common.add")) }
            }
        }
        items(rows, key = { it.id }) { task -> TaskRowItem(model, task) }
        if (rows.size < total) item(key = "more") {
            Button(onClick = model::loadMore, enabled = writable && !busy && failedAction == null) { Text(t("common.more")) }
        }
    }
}

/**
 * One row on any list: the title opens the editor, Complete calls core. An Upcoming row also shows core's
 * reveal date, and a project row core's sequence cue as [note]. A read-only project's rows are not [completable].
 */
@Composable
fun TaskRowItem(model: InboxViewModel, task: TaskRow, completable: Boolean = true, note: String? = null) = with(model) {
    val done = t("common.done")
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(task.title, Modifier.fillMaxWidth().clickable(
                enabled = writable && !busy && failedAction == null, onClickLabel = t("common.edit"),
            ) { openEditor(task.id) })
            task.revealDate?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            note?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
        if (completable) {
            Button(onClick = { complete(task.id) }, enabled = writable && !busy &&
                (failedAction == null || failedAction == FailedAction("complete", task.id)),
                modifier = Modifier.semantics { contentDescription = "$done ${task.title}" }) { Text(done) }
        }
    }
}
