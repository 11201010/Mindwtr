package tech.dongdongbh.mindwtr.pilot

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
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

/** Core's groups as they come, drawn as RN's project list: Active, then Deferred and Archived, which open on a tap and start closed. */
@Composable
private fun ProjectList(model: InboxViewModel, modifier: Modifier) = with(model) {
    val c = LocalTheme.current.colors
    LazyColumn(modifier, contentPadding = PaddingValues(12.dp)) {
        if (projects != null && PROJECT_BUCKETS.all { (bucket, _) -> projects?.buckets?.get(bucket).isNullOrEmpty() }) item(key = "empty") {
            Text(t("projects.empty"), style = rnText(16, 400), color = c.secondaryText, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(48.dp))
        }
        var first = true
        for ((bucket, heading) in PROJECT_BUCKETS) {
            val groups = projects?.buckets?.get(bucket).orEmpty()
            if (groups.isEmpty()) continue
            val collapsible = bucket != "active"
            val open = !collapsible || bucket in expanded
            val ruled = !first
            first = false
            item(key = "bucket:$bucket") {
                val toggleLabel = t(if (open) "markdown.collapse" else "markdown.expand")
                val title = t(heading)
                // RN's section toggle: 12/700 capitals and a chevron, a rule above all but the first.
                Row(
                    Modifier.fillMaxWidth().then(if (ruled) Modifier.hairline(c.border, top = true) else Modifier)
                        .clearAndSetSemantics {
                            text = AnnotatedString(title)
                            heading()
                            if (collapsible) onClick(label = toggleLabel) { toggle(bucket); true }
                        }
                        .then(if (collapsible) Modifier.clickable(onClickLabel = toggleLabel) { toggle(bucket) } else Modifier)
                        .padding(top = 14.dp, bottom = 10.dp, start = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(title.uppercase(), style = rnText(12, 700, letterSpacing = 0.4f), color = c.secondaryText, modifier = Modifier.weight(1f))
                    if (collapsible) Icon(if (open) Lucide.ChevronDown else Lucide.ChevronRight, null, tint = c.secondaryText, modifier = Modifier.size(16.dp))
                }
            }
            if (!open) continue
            for (group in groups) {
                item(key = "area:$bucket:${group.areaId}") {
                    val area = group.areaName ?: t("projects.noArea")
                    // RN's area header: 12/700 capitals, 44 high.
                    Text(area.uppercase(), style = rnText(12, 700, letterSpacing = 0.4f), color = c.secondaryText,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(top = 14.dp, bottom = 8.dp, start = 4.dp)
                            .clearAndSetSemantics { text = AnnotatedString(area); heading() })
                }
                for (row in group.projects) item(key = "project:${row.id}") { ProjectRowItem(model, row) }
            }
        }
    }
}

/** RN's project row: the title, core's next action or its warning, then core's active task count and a star when starred. */
@Composable
private fun ProjectRowItem(model: InboxViewModel, row: ProjectRow) = with(model) {
    val theme = LocalTheme.current
    val c = theme.colors
    val starred = t("filters.starred")
    val count = "${row.activeTaskCount} ${t("common.tasks")}"
    Row(
        Modifier.fillMaxWidth().padding(bottom = 6.dp).clip(RoundedCornerShape(8.dp)).background(c.cardBg)
            .clickable(enabled = writable && !busy && failedAction == null) { openProject(row.id) }
            .heightIn(min = 52.dp).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(row.title, style = rnText(16, 500), color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (row.nextActionTitle != null) {
                Text("↳ ${row.nextActionTitle}", style = rnText(12, 400), color = c.secondaryText, maxLines = 1, overflow = TextOverflow.Ellipsis)
            } else if (row.focusedWithoutNextAction) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Lucide.TriangleAlert, null, tint = theme.attention, modifier = Modifier.size(12.dp))
                    Text(t("projects.noNextAction"), style = rnText(12, 400), color = theme.attention, modifier = Modifier.padding(start = 4.dp))
                }
            }
        }
        Text("${row.activeTaskCount}", style = rnText(12, 600, 16), color = c.secondaryText,
            modifier = Modifier.padding(start = 8.dp).semantics { contentDescription = count })
        if (row.isFocused) {
            Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                Icon(Lucide.StarFilled, starred, tint = theme.star, modifier = Modifier.size(18.dp))
            }
        }
    }
}

/**
 * One project as core lists it, under RN's project header (Back and the title):
 * section markers and task rows in core's order, with core's titles and counts.
 * A read-only (archived) project shows no Complete.
 */
@Composable
private fun ProjectDetailList(model: InboxViewModel, modifier: Modifier) = with(model) {
    // While a failed command's retry is owed, Back is left to the system, as on the lists and in the editor.
    BackHandler(enabled = failedAction == null) { closeProject() }
    val c = LocalTheme.current.colors
    val detail = project
    val completable = detail?.readOnly == false
    Column(modifier) {
        Row(Modifier.fillMaxWidth().background(c.cardBg).hairline(c.border, top = false).padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically) {
            val back = t("common.back")
            IconButton(onClick = model::closeProject, enabled = failedAction == null, modifier = Modifier.semantics { contentDescription = back }) {
                Icon(Lucide.ChevronLeft, null, tint = c.tint, modifier = Modifier.size(24.dp))
            }
            Text(projects?.title(openProjectId.orEmpty()).orEmpty(), style = rnText(18, 700), color = c.text, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 4.dp).semantics { heading() })
        }
        LazyColumn(Modifier.weight(1f).background(c.bg), contentPadding = PaddingValues(12.dp)) {
            for (entry in detail?.items.orEmpty()) when (entry) {
                is DetailSection -> item(key = "section:${entry.id}") {
                    SectionTitle(entry.title, entry.count,
                        Modifier.fillMaxWidth().alpha(if (entry.muted) 0.6f else 1f).padding(top = 12.dp, bottom = 8.dp, start = 4.dp))
                }
                is DetailTask -> item(key = "task:${entry.row.id}") {
                    TaskRowItem(model, entry.row, completable, note = entry.sequenceCue?.let(CUE_KEYS::get)?.let(::t),
                        available = entry.sequenceCue == "available")
                }
            }
            if (detail != null && detail.items.size < detail.total) item(key = "more") {
                Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                    PillButton(t("common.more"), onClick = model::loadMoreProject, enabled = writable && !busy && failedAction == null)
                }
            }
        }
    }
}
