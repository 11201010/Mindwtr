package tech.dongdongbh.mindwtr.androidwidget

import org.junit.Assert.assertEquals
import org.junit.Test

class WidgetProviderCompatibilityTest {
  private val applicationPackage = "tech.dongdongbh.mindwtr"
  private val currentTasksProvider = "tech.dongdongbh.mindwtr.androidwidget.TasksWidgetProvider"
  private val legacyTasksProvider = "$applicationPackage.widget.TasksWidget"
  private val quickCaptureProvider = "tech.dongdongbh.mindwtr.androidwidget.QuickCaptureWidgetProvider"
  private val compactProvider = "tech.dongdongbh.mindwtr.androidwidget.CompactWidgetProvider"

  @Test
  fun enumeratesCurrentAndLegacyTaskProvidersWithoutChangingTheQuickCaptureProvider() {
    assertEquals(
      listOf(
        WidgetProviderIdentity(WidgetKind.TASKS, currentTasksProvider, isLegacy = false),
        WidgetProviderIdentity(WidgetKind.TASKS, legacyTasksProvider, isLegacy = true),
        WidgetProviderIdentity(WidgetKind.COMPACT, compactProvider, isLegacy = false),
        WidgetProviderIdentity(WidgetKind.QUICK_CAPTURE, quickCaptureProvider, isLegacy = false),
      ),
      WidgetProviderRegistry.identities(applicationPackage),
    )
  }

  @Test
  fun refreshesBothTaskProviderIdentitiesAndReportsOnlyTheLegacyCount() {
    val idsByProvider = mapOf(
      currentTasksProvider to intArrayOf(10),
      legacyTasksProvider to intArrayOf(20, 21),
      compactProvider to intArrayOf(40, 41),
      quickCaptureProvider to intArrayOf(30),
    )
    val rendered = mutableListOf<Pair<WidgetKind, List<Int>>>()

    val legacyCount = WidgetRenderer.refreshProviders(
      applicationPackage,
      idsForProvider = { idsByProvider[it] ?: intArrayOf() },
      renderProvider = { ids, kind -> rendered += kind to ids.toList() },
    )

    assertEquals(WidgetRenderer.RefreshResult(legacyWidgetCount = 2, compactWidgetCount = 2), legacyCount)
    assertEquals(
      listOf(
        WidgetKind.TASKS to listOf(10),
        WidgetKind.TASKS to listOf(20, 21),
        WidgetKind.COMPACT to listOf(40, 41),
        WidgetKind.QUICK_CAPTURE to listOf(30),
      ),
      rendered,
    )
  }

  @Test
  fun listSelectionsIncludeCurrentAndLegacyTaskWidgetsOnce() {
    val idsByProvider = mapOf(
      currentTasksProvider to intArrayOf(10, 11),
      compactProvider to intArrayOf(40),
      legacyTasksProvider to intArrayOf(20, 21),
      quickCaptureProvider to intArrayOf(30),
    )
    val selectionsById = mapOf(10 to "focus", 11 to "waiting", 20 to "waiting", 21 to "next", 30 to "someday", 40 to "inbox")

    assertEquals(
      listOf("focus", "waiting", "next"),
      WidgetListStore.selectionsForProviders(
        applicationPackage,
        idsForProvider = { idsByProvider[it] ?: intArrayOf() },
        readSelection = { selectionsById.getValue(it) },
      ),
    )
  }
}
