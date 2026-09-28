package tech.dongdongbh.mindwtr.pilot

import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/*
 * The dialogs a list's own read carries (core's pass 12 inputs): Review's Organize sheet (native-host-contract-review-views.ts
 * `organize` and `picker`, the lists' Bulk organize dialog on Review's bar) and the token pickers' search (RN's TokenPickerModal
 * filter: Contexts' `picker`, Review's and the lists' Remove tag `picker.query`). Kotlin sends the dialog as the user left it;
 * core answers the draft, the options and the matching tokens.
 */

private val main = Handler(Looper.getMainLooper())
private var tokenTyped = 0

/** The token picker's typed text as its search (RN's one query field): null while blank, when core's whole list shows. */
internal fun tokenQuery(open: JSONObject): String? = open.optString("text").takeIf { it.isNotBlank() }

/**
 * The open dialog's inputs for [list]'s own read ([into]): Review's Organize (its draft, and its project or area picker with the
 * search as typed), Review's Remove tag search, or a Contexts token action's search. Dialog state, not paging state: core's
 * revision ignores it, and later windows go without it (MenuModel.accepted).
 */
internal fun MenuModel.dialogInputs(list: String, into: JSONObject) {
    val open = dialog ?: return
    if (list == "review" && open.optString("kind") == "organize") {
        into.put("organize", JSONObject().put("draft", open.optJSONObject("draft") ?: JSONObject()))
        open.menuText("picker")?.let { kind -> into.put("picker", JSONObject().put("kind", kind).apply { open.menuText("query")?.let { put("query", it) } }) }
        return
    }
    if (open.optString("kind") != "tokens" || open.optString("list") != list) return
    val query = tokenQuery(open) ?: return
    into.put("picker", (if (list == "review") JSONObject().put("kind", "removeTag") else JSONObject().put("field", open.getString("field")).put("mode", open.getString("mode")))
        .put("query", query))
}

/** The token picker's field as typed (kept with the dialog at once), then core's matching tokens once typing pauses. */
internal fun MenuModel.typeToken(next: JSONObject) {
    keepDialog(next)
    val mine = ++tokenTyped
    main.postDelayed({ if (mine == tokenTyped) reload() }, 200)
}

/** Core ended [list]'s selection: the dialogs on it (Organize, Move to, Add tag, Remove tag) close with its bar, as the bar goes. */
internal fun MenuModel.closeSelectionDialogs(list: String) {
    val open = dialog ?: return
    if (open.optString("kind") in setOf("organize", "reviewMove", "reviewTag") || (open.optString("kind") == "tokens" && open.optString("list") == list)) keepDialog(null)
}
