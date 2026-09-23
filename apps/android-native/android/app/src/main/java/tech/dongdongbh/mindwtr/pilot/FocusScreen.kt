package tech.dongdongbh.mindwtr.pilot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import org.json.JSONObject

data class FocusSection(val key: String, val title: String, val total: Int, val rows: List<TaskRow>)

/**
 * Core's getFocus reply at one revision. Sections, titles, totals, and rows
 * stay exactly in core's order: Kotlin never sorts, drops, or regroups them.
 */
data class FocusView(val revision: String, val sections: List<FocusSection>) {
    fun section(key: String) = sections.firstOrNull { it.key == key }

    /** Adds one getFocusSectionWindow reply after the rows its section already has. */
    fun append(window: JSONObject): FocusView {
        check(window.getInt("version") == 1 && window.getString("revision") == revision) { "Unexpected Focus window" }
        val key = window.getString("key")
        return copy(sections = sections.map { section ->
            if (section.key == key) section.copy(total = window.getInt("total"), rows = section.rows + window.taskRows()) else section
        })
    }

    companion object {
        fun parse(json: JSONObject): FocusView {
            check(json.getInt("version") == 1) { "Unsupported core contract" }
            val items = json.getJSONArray("sections")
            return FocusView(json.getString("revision"), List(items.length()) { index ->
                items.getJSONObject(index).let { FocusSection(it.getString("key"), it.getString("title"), it.getInt("total"), it.taskRows()) }
            })
        }
    }
}

/**
 * Focus as core sent it, in one list, drawn as RN's Focus: each section title
 * (capitals and count) stays pinned while its rows scroll. Core's "Later today"
 * label goes before the first row core flags `laterToday`.
 */
@Composable
fun FocusList(model: InboxViewModel, modifier: Modifier) {
    // Core's Focus changes with the clock. Read it again on every resume and each
    // minute while this list shows; the loop stops when the screen pauses or leaves.
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner) {
        owner.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                model.refreshFocus()
                delay(60_000)
            }
        }
    }
    with(model) {
        val c = LocalTheme.current.colors
        val more = t("common.more")
        LazyColumn(modifier, contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 12.dp)) {
            val sections = focus?.sections.orEmpty()
            // RN's empty Focus: its "All Clear!" title and hint, centered.
            if (focus != null && sections.all { it.total == 0 }) item(key = "empty") {
                Column(Modifier.fillMaxWidth().padding(vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(t("agenda.allClear"), style = rnText(16, 700), color = c.text, textAlign = TextAlign.Center)
                    Text(t("agenda.noTasks"), style = rnText(12, 600), color = c.secondaryText, textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 4.dp))
                }
            }
            for (section in focus?.sections.orEmpty()) {
                stickyHeader(key = "title:${section.key}") {
                    SectionTitle(section.title, section.total,
                        Modifier.fillMaxWidth().background(c.bg).padding(top = if (section === sections.first()) 8.dp else 18.dp, bottom = 10.dp, start = 4.dp))
                }
                val laterToday = section.rows.indexOfFirst { it.laterToday }
                section.rows.forEachIndexed { index, task ->
                    if (index == laterToday) item(key = "later:${section.key}") {
                        SectionTitle(t("agenda.laterToday"), null, Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 10.dp, start = 4.dp))
                    }
                    item(key = "${section.key}:${task.id}") { TaskRowItem(model, task) }
                }
                if (section.rows.size < section.total) item(key = "more:${section.key}") {
                    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                        PillButton(more, onClick = { loadMoreFocus(section.key) }, enabled = writable && !busy && failedAction == null,
                            description = "$more ${section.title}")
                    }
                }
            }
        }
    }
}
