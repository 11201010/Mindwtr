package tech.dongdongbh.mindwtr.pilot

import android.content.SharedPreferences
import org.json.JSONObject

/*
 * Which sections are open, kept on this device as RN keeps them (workspaceSessionStorage):
 * the same keys, the same JSON, and the same defaults. RN's
 * app/(drawer)/(tabs)/focus.tsx and lib/view-state/project-list-view-state.ts are the spec.
 * It is UI state only, never synced and never core data.
 */

/** RN's FOCUS_VIEW_STATE_STORAGE_KEY. */
const val FOCUS_VIEW_KEY = "mindwtr:view:focus:v1"
/** RN's PROJECT_LIST_VIEW_STATE_STORAGE_KEY. */
const val PROJECTS_VIEW_KEY = "mindwtr:view:projects:v1"
/** RN's DEFAULT_EXPANDED_SECTIONS keys; every section starts open. */
val FOCUS_SECTION_KEYS = listOf("focus", "schedule", "next", "upcoming", "reviewDue", "reviewProjects")

/** RN's Focus view state. [raw] keeps fields this app does not show (RN's showDetails) as they were. */
class FocusViewState(private val raw: JSONObject, val expanded: Map<String, Boolean>) {
    fun isOpen(key: String) = expanded[key] ?: true

    fun with(changes: Map<String, Boolean>): FocusViewState = FocusViewState(raw, expanded + changes)

    /** RN's serializeFocusViewState: it also writes the legacy `nextActions` twin of `next`. */
    fun save(prefs: SharedPreferences) {
        val sections = JSONObject()
        for (key in FOCUS_SECTION_KEYS) sections.put(key, isOpen(key))
        sections.put("nextActions", isOpen("next"))
        val out = JSONObject(raw.toString()).put("showDetails", raw.optBoolean("showDetails", false)).put("expandedSections", sections)
        prefs.edit().putString(FOCUS_VIEW_KEY, out.toString()).apply()
    }

    companion object {
        /** RN's readPersistedFocusExpandedSections: only boolean values count; `next` falls back to `nextActions`. */
        fun read(prefs: SharedPreferences): FocusViewState {
            val raw = runCatching { JSONObject(prefs.getString(FOCUS_VIEW_KEY, null) ?: "{}") }.getOrDefault(JSONObject())
            val stored = raw.optJSONObject("expandedSections") ?: JSONObject()
            val expanded = HashMap<String, Boolean>()
            for (key in FOCUS_SECTION_KEYS) {
                // A non-boolean (null, text) counts as absent, so `next` falls back to `nextActions`, as in RN.
                val value = stored.opt(key).takeIf { it is Boolean } ?: if (key == "next") stored.opt("nextActions") else null
                if (value is Boolean) expanded[key] = value
            }
            return FocusViewState(raw, expanded)
        }
    }
}

/** RN's ProjectListViewState: collapsed areas (by area id, "no-area" without one) and the two closed groups. */
data class ProjectsViewState(val collapsedAreas: Set<String>, val showDeferred: Boolean, val showArchived: Boolean) {
    fun save(prefs: SharedPreferences) {
        val areas = JSONObject()
        for (id in collapsedAreas) areas.put(id, true)
        prefs.edit().putString(PROJECTS_VIEW_KEY, JSONObject().put("collapsedAreas", areas)
            .put("showArchivedProjects", showArchived).put("showDeferredProjects", showDeferred).toString()).apply()
    }

    companion object {
        /** RN's readProjectListViewState: only `true` entries with a non-blank id; both groups start closed. */
        fun read(prefs: SharedPreferences): ProjectsViewState {
            val raw = runCatching { JSONObject(prefs.getString(PROJECTS_VIEW_KEY, null) ?: "{}") }.getOrDefault(JSONObject())
            val areas = raw.optJSONObject("collapsedAreas")
            val collapsed = areas?.keys()?.asSequence()?.filter { it.isNotBlank() && areas.opt(it) == true }?.toSet().orEmpty()
            return ProjectsViewState(collapsed, raw.opt("showDeferredProjects") == true, raw.opt("showArchivedProjects") == true)
        }
    }
}
