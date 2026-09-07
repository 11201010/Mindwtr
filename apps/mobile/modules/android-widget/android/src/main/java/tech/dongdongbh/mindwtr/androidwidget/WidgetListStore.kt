package tech.dongdongbh.mindwtr.androidwidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context

/** Which list each placed Tasks widget shows (#1173): SharedPreferences `mindwtr_widget_lists`, key = widget id. */
object WidgetListStore {
  const val PREFS_NAME = "mindwtr_widget_lists"
  const val DEFAULT_LIST = "focus"
  /** Retired: only used to discard a selection stored before saved filters replaced project lists. */
  const val PROJECT_PREFIX = "project:"
  const val FILTER_PREFIX = "filter:"

  fun read(context: Context, appWidgetId: Int): String {
    val stored = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(appWidgetId.toString(), null)
    // Per-project lists were replaced by saved filters: a widget still holding
    // one shows Focus, the same as any list id we can no longer name.
    return if (stored == null || stored.startsWith(PROJECT_PREFIX)) DEFAULT_LIST else stored
  }

  fun write(context: Context, appWidgetId: Int, listId: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString(appWidgetId.toString(), listId).commit()
  }

  fun remove(context: Context, appWidgetIds: IntArray) {
    val editor = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    for (id in appWidgetIds) editor.remove(id.toString())
    editor.apply()
  }

  /** Distinct list ids bound to the Tasks widgets currently placed. */
  fun selections(context: Context): List<String> {
    val manager = AppWidgetManager.getInstance(context) ?: return emptyList()
    return selectionsForProviders(
      context.packageName,
      idsForProvider = { className ->
        manager.getAppWidgetIds(ComponentName(context.packageName, className))
      },
      readSelection = { appWidgetId -> read(context, appWidgetId) },
    )
  }

  internal fun selectionsForProviders(
    applicationPackage: String,
    idsForProvider: (String) -> IntArray,
    readSelection: (Int) -> String,
  ): List<String> = WidgetProviderRegistry
    .placed(applicationPackage, idsForProvider)
    .filter { it.identity.kind == WidgetKind.TASKS }
    .flatMap { it.ids.asIterable() }
    .map(readSelection)
    .distinct()
}
