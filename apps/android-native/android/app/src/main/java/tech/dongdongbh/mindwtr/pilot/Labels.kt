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
    "common.cancel", "common.close", "common.save", "common.ok", "common.clear", "common.discard",
    "common.none", "common.notSet", "taskEdit.titleLabel", "taskEdit.descriptionLabel", "taskEdit.statusLabel",
    "taskEdit.priorityLabel", "taskEdit.noProjectOption", "taskEdit.startDateLabel",
    "taskEdit.dueDateLabel", "taskEdit.discardChanges", "taskEdit.discardChangesDesc", "projects.archivedReadOnlyHint",
    // The task editor (RN's Form tab); recurrence.* are the label keys core's editor model sends.
    "taskEdit.scheduling", "taskEdit.organization", "taskEdit.details", "taskEdit.editorLayoutHelpLabel", "taskEdit.editorLayoutHelpText",
    "task.destination", "taskEdit.areaLabel", "taskEdit.noAreaOption", "taskEdit.sectionLabel", "taskEdit.noSectionOption",
    "taskEdit.contextsLabel", "taskEdit.contextsPlaceholder", "taskEdit.tagsLabel", "taskEdit.tagsPlaceholder",
    "taskEdit.energyLevel", "energyLevel.low", "energyLevel.medium", "energyLevel.high",
    "taskEdit.assignedTo", "taskEdit.assignedToPlaceholder", "taskEdit.timeEstimateLabel", "taskEdit.locationLabel",
    "taskEdit.locationPlaceholder", "taskEdit.descriptionPlaceholder", "taskEdit.reviewDateLabel", "calendar.changeTime",
    "taskEdit.recurrenceLabel", "recurrence.none", "recurrence.daily", "recurrence.weekly", "recurrence.monthly", "recurrence.yearly",
    "recurrence.custom", "recurrence.monthlyOnDay", "recurrence.repeatEvery", "recurrence.dayUnit", "recurrence.afterCompletion",
    "recurrence.showFutureInCalendar", "recurrence.showFutureInCalendarHint",
    "taskEdit.suppressMindwtrReminders", "taskEdit.suppressMindwtrRemindersHint",
    "taskEdit.startModeAbsolute", "taskEdit.startModeRelative", "taskEdit.relativeStartAmount", "taskEdit.relativeStartBeforeDue",
    "taskEdit.dateOnly", "taskEdit.timeSpentLabel", "recurrence.weekUnit", "recurrence.monthUnit", "recurrence.yearUnit",
    "recurrence.endsLabel", "recurrence.endsNever", "recurrence.endsOnDate", "recurrence.endsAfterCount", "recurrence.occurrenceUnit",
    "viewSections.somedaySection", "taskEdit.checklist", "taskEdit.tab.list", "attachments.title",
    "process.waitingFor", "process.waitingForDesc",
    "status.inbox", "status.next", "status.waiting", "status.someday", "status.reference", "status.done",
    "priority.low", "priority.medium", "priority.high", "priority.urgent",
    "projects.activeSection", "projects.deferredSection", "projects.closed", "projects.noArea", "projects.noNextAction",
    "common.tasks", "filters.starred", "projects.availableNextAction", "projects.laterInSequence",
    "markdown.expand", "markdown.collapse",
    "inbox.empty", "inbox.emptyAddHint", "agenda.allClear", "agenda.noTasks", "projects.empty",
    "agenda.addToFocus", "agenda.removeFromFocus", "projects.addToFocus", "projects.removeFromFocus",
    "taskStatus.changeStatus", "task.aria.changeStatus", "task.aria.changeStatusHint",
    "projects.addPlaceholder", "projects.add", "projects.areaFilter", "agenda.reviewDueProjects", "common.open",
    "agenda.collapseOtherSections", "agenda.expandOtherSections", "status.active", "status.archived",
    // Global search (RN's global-search.tsx); the filter sheet's words are core's filterOptions.
    "search.title", "search.placeholder", "filters.label", "search.saveSearch", "search.saveSearchPrompt", "search.helpOperators",
    "search.showingFirst", "search.hiddenCompletedMatches", "search.noResults", "search.resultTask", "search.resultProject",
    "search.inProjectSuffix", "review.markDone",
    // Process Inbox: the Inbox button and scope line; the steps' words are core's view.
    "inbox.processButton", "projects.allAreas", "common.loading", "taskEdit.projectLabel", "task.aria.action",
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
