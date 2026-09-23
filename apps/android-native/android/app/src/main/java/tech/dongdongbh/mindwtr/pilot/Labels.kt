package tech.dongdongbh.mindwtr.pilot

import android.util.Log
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import java.util.Collections

/**
 * Every core i18n key this app shows (packages/core/src/i18n/locales/en.ts), the
 * one mobile uses for the same control where mobile has one. Kotlin holds no text
 * of its own: core's getStrings fills these at boot, in the language core chose.
 */
val LABEL_KEYS = listOf(
    "tab.inbox", "tab.next", "nav.projects",
    "nav.addTask", "quickAdd.inputLabel", "common.more", "common.retry", "common.done", "common.edit", "common.back",
    "agenda.laterToday",
    "taskEdit.editTask", "common.cancel", "common.close", "common.save", "common.ok", "common.clear", "common.discard",
    "common.none", "common.notSet", "taskEdit.titleLabel", "taskEdit.descriptionLabel", "taskEdit.statusLabel",
    "taskEdit.priorityLabel", "taskEdit.projectLabel", "taskEdit.noProjectOption", "taskEdit.startDateLabel",
    "taskEdit.dueDateLabel", "taskEdit.discardChanges", "taskEdit.discardChangesDesc", "projects.archivedReadOnlyHint",
    "status.inbox", "status.next", "status.waiting", "status.someday", "status.reference", "status.done",
    "priority.low", "priority.medium", "priority.high", "priority.urgent",
    "projects.activeSection", "projects.deferredSection", "projects.closed", "projects.noArea", "projects.noNextAction",
    "common.tasks", "filters.starred", "projects.availableNextAction", "projects.laterInSequence",
    "markdown.expand", "markdown.collapse",
    "inbox.empty", "inbox.emptyAddHint", "agenda.allClear", "agenda.noTasks", "projects.empty",
    "agenda.addToFocus", "agenda.removeFromFocus", "projects.addToFocus", "projects.removeFromFocus",
    "taskStatus.changeStatus", "task.aria.changeStatus", "task.aria.changeStatusHint",
    "projects.addPlaceholder", "projects.add", "projects.areaFilter", "agenda.reviewDueProjects", "common.open",
    "agenda.collapseOtherSections", "agenda.expandOtherSections", "status.active", "status.archived", "list.done", "archived.restoreToInbox",
)

/** The label map: core's text for each of [LABEL_KEYS]. It has no fallback text; a key core lacks shows as the key. */
object Labels {
    @Volatile private var strings: Map<String, String> = emptyMap()
    private val logged: MutableSet<String> = Collections.synchronizedSet(HashSet())

    /** Replaces the map with a getStrings reply. Core already put English in for a key the language lacks. */
    fun load(reply: JSONObject) {
        val values = reply.getJSONObject("strings")
        strings = LABEL_KEYS.filter(values::has).associateWith(values::getString)
        val missing = reply.getJSONArray("missing")
        for (index in 0 until missing.length()) missing(missing.getString(index))
        Log.i(CoreHost.TAG, "Native Android labels language=${reply.getString("language")} missing=${missing.length()}")
    }

    operator fun get(name: String): String = strings[name] ?: name.also(::missing)

    private fun missing(name: String) {
        if (logged.add(name)) Log.w(CoreHost.TAG, "Native Android label missing label=$name")
    }
}

/** Core's text for one of [LABEL_KEYS]. */
fun t(name: String): String = Labels[name]
