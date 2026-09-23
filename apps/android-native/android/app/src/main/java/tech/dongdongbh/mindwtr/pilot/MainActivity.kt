package tech.dongdongbh.mindwtr.pilot

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
                Column(Modifier.fillMaxSize().padding(24.dp)) {
                    Text("Inbox · $total", style = MaterialTheme.typography.headlineSmall)
                    if (loading) {
                        CircularProgressIndicator(Modifier.padding(top = 16.dp))
                    } else {
                        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
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
                            items(rows, key = { it.id }) { task ->
                                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(task.title, Modifier.weight(1f))
                                    Button(onClick = { complete(task.id) }, enabled = writable && !busy &&
                                        (failedAction == null || failedAction == FailedAction("complete", task.id)),
                                        modifier = Modifier.semantics { contentDescription = "Complete ${task.title}" }) { Text("Complete") }
                                }
                            }
                            if (rows.size < total) item {
                                Button(onClick = model::loadMore, enabled = writable && !busy && failedAction == null) { Text("Load more") }
                            }
                        }
                    }
                }
            } }
        }
    }
}
