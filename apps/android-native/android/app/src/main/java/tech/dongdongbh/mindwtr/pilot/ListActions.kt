package tech.dongdongbh.mindwtr.pilot

import org.json.JSONArray
import org.json.JSONObject

/*
 * Core's Contexts, Trash and Review actions (NativeContextsAction, NativeTrashAction and NativeReviewAction), as their screens
 * send them through MenuModel.act. Kotlin names core's action and passes core's ids and values; core checks each and decides
 * what it writes. A new request UUID goes with each; the action itself is its exact retry.
 */

internal fun setTaskStatus(taskId: String, status: String): JSONObject = JSONObject().put("type", "setTaskStatus").put("taskId", taskId).put("status", status)
internal fun trashTask(taskId: String): JSONObject = JSONObject().put("type", "trashTask").put("taskId", taskId)
internal fun trashTasks(taskIds: List<String>): JSONObject = JSONObject().put("type", "trashTasks").put("taskIds", JSONArray(taskIds))
internal fun moveTasks(taskIds: List<String>, status: String): JSONObject = JSONObject().put("type", "moveTasks").put("taskIds", JSONArray(taskIds)).put("status", status)

/** Contexts' bulk token edit: add or remove tags or contexts ([field], [mode] and [values] as core's picker offers them). */
internal fun editTaskTokens(taskIds: List<String>, field: String, mode: String, values: List<String>): JSONObject =
    JSONObject().put("type", "editTaskTokens").put("taskIds", JSONArray(taskIds)).put("field", field).put("mode", mode).put("values", JSONArray(values))

/** Trash: one item ([kind] "task" or "project", as core's item says), the selection, or Clear Trash at the revision its question showed. */
internal fun restoreItem(kind: String, id: String): JSONObject = JSONObject().put("type", "restoreItem").put("kind", kind).put("id", id)
internal fun purgeItem(kind: String, id: String): JSONObject = JSONObject().put("type", "purgeItem").put("kind", kind).put("id", id)
internal fun restoreItems(taskIds: List<String>, projectIds: List<String>): JSONObject =
    JSONObject().put("type", "restoreItems").put("taskIds", JSONArray(taskIds)).put("projectIds", JSONArray(projectIds))
internal fun purgeItems(taskIds: List<String>, projectIds: List<String>): JSONObject =
    JSONObject().put("type", "purgeItems").put("taskIds", JSONArray(taskIds)).put("projectIds", JSONArray(projectIds))
internal fun emptyTrash(revision: String): JSONObject = JSONObject().put("type", "emptyTrash").put("revision", revision)

/**
 * Review's bulk bar: the typed tag, the tags picked from core's list, Mark reviewed, and Organize's Apply (the draft core answered).
 * Mark reviewed and Apply carry each task's revision as the view showed it (core's `bulk.taskRevisions`): core refuses a task that
 * changed since (STALE_REVISION).
 */
internal fun addTag(taskIds: List<String>, tag: String): JSONObject = JSONObject().put("type", "addTag").put("taskIds", JSONArray(taskIds)).put("tag", tag)
internal fun removeTags(taskIds: List<String>, tags: List<String>): JSONObject = JSONObject().put("type", "removeTags").put("taskIds", JSONArray(taskIds)).put("tags", JSONArray(tags))
internal fun markReviewedTasks(taskIds: List<String>, taskRevisions: JSONObject): JSONObject =
    JSONObject().put("type", "markReviewedTasks").put("taskIds", JSONArray(taskIds)).put("taskRevisions", taskRevisions)
internal fun organizeTasks(taskIds: List<String>, draft: JSONObject, taskRevisions: JSONObject): JSONObject =
    JSONObject().put("type", "organizeTasks").put("taskIds", JSONArray(taskIds)).put("draft", draft).put("taskRevisions", taskRevisions)

/** The Weekly Review's project Add task (the typed title, core's quick-add grammar) and the Daily Review's Follow up today. */
internal fun addProjectTask(projectId: String, title: String): JSONObject = JSONObject().put("type", "addProjectTask").put("projectId", projectId).put("title", title)
internal fun followUpToday(taskId: String): JSONObject = JSONObject().put("type", "followUpToday").put("taskId", taskId)

/** The ids of a JSON array core sent (a selection, a bulk bar's ids), in core's order. */
internal fun JSONArray?.ids(): List<String> = this?.let { list -> List(list.length()) { list.getString(it) } }.orEmpty()
