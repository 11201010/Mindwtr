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
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat

/** Isolated development UI. Task rules and writes stay in the shared core. */
class MainActivity : ComponentActivity() {
    private val model: InboxViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = true
        model.attach()
        setContent {
            MaterialTheme { with(model) {
                val open = editor
                if (open != null && !loading) TaskEditorScreen(model, open) else Column(
                    Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).systemBarsPadding()
                        .padding(horizontal = 24.dp, vertical = 8.dp),
                ) {
                    // Two lists in one Activity: tabs, no navigation library. The editor opens over the selected list.
                    TabRow(selectedTabIndex = screen.ordinal) {
                        for (tab in Screen.entries) Tab(selected = screen == tab, onClick = { show(tab) }, text = { Text(tab.name) })
                    }
                    if (screen == Screen.Inbox) {
                        Text("Inbox · $total", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 12.dp))
                    }
                    if (loading) {
                        CircularProgressIndicator(Modifier.padding(top = 16.dp))
                    } else {
                        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
                        if (screen == Screen.Focus) FocusList(model, Modifier.weight(1f)) else {
                            Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                OutlinedTextField(
                                    value = draft,
                                    onValueChange = model::editDraft,
                                    label = { Text("Capture task") },
                                    singleLine = true,
                                    enabled = !busy && failedAction == null,
                                    modifier = Modifier.weight(1f),
                                )
                                Button(onClick = model::add, enabled = writable && !busy && draft.isNotBlank() &&
                                    (failedAction == null || failedAction == FailedAction("create", captureId, draft)),
                                    modifier = Modifier.padding(start = 8.dp)) { Text("Add") }
                            }
                            Button(onClick = { refresh() }, enabled = writable && !busy && failedAction == null) { Text("Refresh") }
                            LazyColumn(modifier = Modifier.weight(1f)) {
                                items(rows, key = { it.id }) { task -> TaskRowItem(model, task) }
                                if (rows.size < total) item {
                                    Button(onClick = model::loadMore, enabled = writable && !busy && failedAction == null) { Text("Load more") }
                                }
                            }
                        }
                    }
                }
            } }
        }
    }
}

/** One row on either list: the title opens the editor, Complete calls core. An Upcoming row also shows core's reveal date. */
@Composable
fun TaskRowItem(model: InboxViewModel, task: TaskRow) = with(model) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(task.title, Modifier.fillMaxWidth().clickable(
                enabled = writable && !busy && failedAction == null, onClickLabel = "Edit task",
            ) { openEditor(task.id) })
            task.revealDate?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
        Button(onClick = { complete(task.id) }, enabled = writable && !busy &&
            (failedAction == null || failedAction == FailedAction("complete", task.id)),
            modifier = Modifier.semantics { contentDescription = "Complete ${task.title}" }) { Text("Complete") }
    }
}
