package tech.dongdongbh.mindwtr.pilot

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import org.json.JSONObject

data class ProjectRow(
    val id: String,
    val title: String,
    val isFocused: Boolean,
    val activeTaskCount: Int,
    val nextActionTitle: String?,
    val focusedWithoutNextAction: Boolean,
)
data class ProjectGroup(val areaId: String?, val areaName: String?, val projects: List<ProjectRow>)

/** Core's three buckets, in the order the handoff and mobile show them, with mobile's heading key for each. */
val PROJECT_BUCKETS = listOf("active" to "projects.activeSection", "deferred" to "projects.deferredSection", "archived" to "projects.closed")

/** Core's getProjects reply. Groups, areas, rows, and counts stay exactly as core sent them. */
data class ProjectsView(val buckets: Map<String, List<ProjectGroup>>) {
    fun title(id: String) = buckets.values.firstNotNullOfOrNull { groups ->
        groups.firstNotNullOfOrNull { group -> group.projects.firstOrNull { it.id == id }?.title }
    }

    companion object {
        private fun JSONObject.text(name: String) = if (isNull(name)) null else getString(name)

        fun parse(json: JSONObject): ProjectsView {
            check(json.getInt("version") == 1) { "Unsupported core contract" }
            return ProjectsView(PROJECT_BUCKETS.associate { (bucket, _) ->
                bucket to json.getJSONArray(bucket).let { groups ->
                    List(groups.length()) { index ->
                        groups.getJSONObject(index).let { group ->
                            val rows = group.getJSONArray("projects")
                            ProjectGroup(group.text("areaId"), group.text("areaName"), List(rows.length()) { row ->
                                rows.getJSONObject(row).let {
                                    ProjectRow(it.getString("id"), it.getString("title"), it.getBoolean("isFocused"),
                                        it.getInt("activeTaskCount"), it.text("nextActionTitle"), it.getBoolean("focusedWithoutNextAction"))
                                }
                            })
                        }
                    }
                }
            })
        }
    }
}

sealed interface DetailItem
data class DetailSection(val id: String, val title: String, val count: Int, val muted: Boolean) : DetailItem
data class DetailTask(val row: TaskRow, val sequenceCue: String?) : DetailItem

/** Core's sequence cue values and mobile's label key for each. */
private val CUE_KEYS = mapOf("available" to "projects.availableNextAction", "later" to "projects.laterInSequence")

/** Core's getProjectDetail windows at one revision: section markers and task rows exactly in core's order. */
data class ProjectDetail(val revision: String, val projectId: String, val readOnly: Boolean, val total: Int, val items: List<DetailItem>) {
    /** Adds one later window after the items already loaded. */
    fun append(window: JSONObject): ProjectDetail {
        val next = parse(window)
        check(next.revision == revision && next.projectId == projectId) { "Unexpected project window" }
        return next.copy(items = items + next.items)
    }

    companion object {
        fun parse(json: JSONObject): ProjectDetail {
            check(json.getInt("version") == 1) { "Unsupported core contract" }
            val items = json.getJSONArray("items")
            return ProjectDetail(json.getString("revision"), json.getString("projectId"), json.getBoolean("readOnly"),
                json.getInt("total"), List(items.length()) { index ->
                    items.getJSONObject(index).let { item ->
                        if (item.getString("type") == "section") {
                            DetailSection(item.getString("id"), item.getString("title"), item.getInt("count"), item.getBoolean("muted"))
                        } else {
                            DetailTask(item.getJSONObject("row").taskRow(), if (item.isNull("sequenceCue")) null else item.getString("sequenceCue"))
                        }
                    }
                })
        }
    }
}

/**
 * The Projects tab: core's project list, or the open project's detail. Both are
 * read again on every resume and after every command.
 */
@Composable
fun ProjectsTab(model: InboxViewModel, modifier: Modifier) {
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner) {
        owner.repeatOnLifecycle(Lifecycle.State.RESUMED) { model.refreshProjects() }
    }
    if (model.openProjectId == null) ProjectList(model, modifier) else ProjectDetailList(model, modifier)
}

/** Core's groups as they come: Active, then Deferred and Archived, which open on a tap and start closed. */
@Composable
private fun ProjectList(model: InboxViewModel, modifier: Modifier) = with(model) {
    LazyColumn(modifier) {
        for ((bucket, heading) in PROJECT_BUCKETS) {
            val groups = projects?.buckets?.get(bucket).orEmpty()
            if (groups.isEmpty()) continue
            val collapsible = bucket != "active"
            val open = !collapsible || bucket in expanded
            item(key = "bucket:$bucket") {
                val toggleLabel = t(if (open) "markdown.collapse" else "markdown.expand")
                Row(
                    Modifier.fillMaxWidth()
                        .then(if (collapsible) Modifier.clickable(onClickLabel = toggleLabel) { toggle(bucket) } else Modifier)
                        .padding(top = 16.dp, bottom = 4.dp).semantics { heading() },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(t(heading), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    if (collapsible) Text(if (open) "▾" else "▸", style = MaterialTheme.typography.titleMedium)
                }
            }
            if (!open) continue
            for (group in groups) {
                item(key = "area:$bucket:${group.areaId}") {
                    Text(group.areaName ?: t("projects.noArea"), style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                }
                for (row in group.projects) item(key = "project:${row.id}") { ProjectRowItem(model, row) }
            }
        }
    }
}

/** Title, core's next action or its warning, a star when starred, and core's active task count. */
@Composable
private fun ProjectRowItem(model: InboxViewModel, row: ProjectRow) = with(model) {
    val starred = t("filters.starred")
    val count = "${row.activeTaskCount} ${t("common.tasks")}"
    Row(
        Modifier.fillMaxWidth().clickable(enabled = writable && !busy && failedAction == null) { openProject(row.id) }
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(row.title, style = MaterialTheme.typography.bodyLarge)
            if (row.nextActionTitle != null) {
                Text("↳ ${row.nextActionTitle}", style = MaterialTheme.typography.bodySmall)
            } else if (row.focusedWithoutNextAction) {
                Text(t("projects.noNextAction"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        }
        if (row.isFocused) Text("★", Modifier.padding(horizontal = 8.dp).semantics { contentDescription = starred })
        Text("${row.activeTaskCount}", Modifier.semantics { contentDescription = count })
    }
}

/**
 * One project as core lists it: section markers and task rows in core's order,
 * with core's titles and counts. A read-only (archived) project shows no Complete.
 */
@Composable
private fun ProjectDetailList(model: InboxViewModel, modifier: Modifier) = with(model) {
    // While a failed command's retry is owed, Back is left to the system, as on the lists and in the editor.
    BackHandler(enabled = failedAction == null) { closeProject() }
    val detail = project
    val completable = detail?.readOnly == false
    LazyColumn(modifier) {
        item(key = "header") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = model::closeProject, enabled = failedAction == null) { Text(t("common.back")) }
                Text(projects?.title(openProjectId.orEmpty()).orEmpty(), style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.weight(1f).semantics { heading() })
            }
        }
        for (entry in detail?.items.orEmpty()) when (entry) {
            is DetailSection -> item(key = "section:${entry.id}") {
                Text("${entry.title} · ${entry.count}", style = MaterialTheme.typography.titleMedium,
                    color = if (entry.muted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 4.dp).semantics { heading() })
            }
            is DetailTask -> item(key = "task:${entry.row.id}") {
                TaskRowItem(model, entry.row, completable, note = entry.sequenceCue?.let(CUE_KEYS::get)?.let(::t))
            }
        }
        if (detail != null && detail.items.size < detail.total) item(key = "more") {
            Button(onClick = model::loadMoreProject, enabled = writable && !busy && failedAction == null) { Text(t("common.more")) }
        }
    }
}
