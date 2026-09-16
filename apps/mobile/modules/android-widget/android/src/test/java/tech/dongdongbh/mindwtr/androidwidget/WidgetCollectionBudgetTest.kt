package tech.dongdongbh.mindwtr.androidwidget

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WidgetCollectionBudgetTest {
  private lateinit var context: Context

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    context.getSharedPreferences(WidgetListStore.PREFS_NAME, Context.MODE_PRIVATE).edit().clear().commit()
  }

  @Test
  fun measuredCollectionStaysWithinBudgetAndKeepsAnOverflowRouteForLongRows() {
    val longTitle = "Long title ".repeat(2_000)
    val longContext = "Long project name ".repeat(2_000)
    val items = JSONArray().apply {
      repeat(240) { index -> put(item("task-$index", "$longTitle $index", longContext)) }
    }
    val payload = payload(
      JSONObject().put("focus", list("Focus", items, totalCount = 240)),
    )
    val factory = TasksWidgetFactory(context, WidgetKind.TASKS, 41, payload)

    val (_, stats) = WidgetRenderer.buildDirectCollection(factory)
    val renderedRows = factory.rowsForTaskLimit(stats.renderedTasks)

    assertTrue(stats.bytes <= WidgetRenderer.DIRECT_COLLECTION_BUDGET_BYTES)
    assertTrue("bounded display text must leave the first task usable", stats.renderedTasks >= 1)
    assertEquals(240, stats.eligibleTasks)
    assertTrue(stats.renderedTasks <= 200)
    val footer = renderedRows.last() as TasksWidgetFactory.Row.Footer
    assertEquals("View all 240 tasks", footer.label)
    assertEquals("mindwtr:///focus", footer.openUri)
  }

  @Test
  fun oneHundredNormalRowsStayFullyScrollableWithinTheBudget() {
    val items = JSONArray().apply {
      repeat(100) { index -> put(item("task-$index", "Normal task title $index")) }
    }
    val factory = TasksWidgetFactory(
      context,
      WidgetKind.TASKS,
      45,
      payload(JSONObject().put("focus", list("Focus", items, totalCount = 100))),
    )

    val (_, stats) = WidgetRenderer.buildDirectCollection(factory)

    assertEquals(100, stats.renderedTasks)
    assertEquals(100, stats.eligibleTasks)
    assertTrue(stats.bytes <= WidgetRenderer.DIRECT_COLLECTION_BUDGET_BYTES)
    assertTrue(factory.rowsForTaskLimit(stats.renderedTasks).none { it is TasksWidgetFactory.Row.Footer })
  }

  @Test
  fun overflowUsesTheActualTasksSelectionForNextProjectAndFilter() {
    for (listId in listOf("next", "project:p1", "filter:f1")) {
      WidgetListStore.write(context, 42, listId)
      val payload = payload(JSONObject()
        .put("focus", list("Focus", JSONArray()))
        .put(listId, list(listId, JSONArray().put(item("one", "One")), totalCount = 3)))
      val factory = TasksWidgetFactory(context, WidgetKind.TASKS, 42, payload)

      val footer = factory.rowsForTaskLimit(factory.publishedTaskCount()).last() as TasksWidgetFactory.Row.Footer

      assertEquals("mindwtr:///widget-list/${java.net.URLEncoder.encode(listId, Charsets.UTF_8.name()).replace("+", "%20")}", footer.openUri)
    }
  }

  @Test
  fun compactOverflowFollowsItsNextActionsFallback() {
    val payload = payload(JSONObject()
      .put("focus", list("Focus", JSONArray()))
      .put("next", list("Next Actions", JSONArray().put(item("one", "One")), totalCount = 4)))
    val factory = TasksWidgetFactory(context, WidgetKind.COMPACT, 43, payload)

    val footer = factory.rowsForTaskLimit(factory.publishedTaskCount()).last() as TasksWidgetFactory.Row.Footer

    assertEquals("mindwtr:///widget-list/next", footer.openUri)
    assertEquals("View all 4 tasks", footer.label)
  }

  @Test
  fun legacyPayloadWithoutATotalDoesNotInventOverflow() {
    val payload = payload(JSONObject().put("focus", list(
      "Focus",
      JSONArray().put(item("one", "One")).put(item("two", "Two")),
    )))
    val factory = TasksWidgetFactory(context, WidgetKind.TASKS, 44, payload)

    assertEquals(2, factory.getCount())
    assertTrue(factory.rowsForTaskLimit(factory.publishedTaskCount()).none { it is TasksWidgetFactory.Row.Footer })
  }

  private fun payload(lists: JSONObject): WidgetPayload = WidgetPayload.parse(JSONObject()
    .put("focusUri", "mindwtr:///focus")
    .put("viewAllLabel", "View all {{count}} tasks")
    .put("lists", lists)
    .toString())!!

  private fun list(title: String, items: JSONArray, totalCount: Int? = null): JSONObject = JSONObject()
    .put("title", title)
    .put("items", items)
    .apply { if (totalCount != null) put("totalCount", totalCount) }

  private fun item(id: String, title: String, contextLabel: String? = null): JSONObject = JSONObject()
    .put("id", id)
    .put("title", title)
    .apply { if (contextLabel != null) put("contextLabel", contextLabel) }
}
