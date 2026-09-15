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
  fun legacyDelayedCheckoffRefreshInvalidatesRowsAndPartiallyUpdatesChrome() {
    val idsByProvider = mapOf(
      currentTasksProvider to intArrayOf(10),
      legacyTasksProvider to intArrayOf(20, 21),
      compactProvider to intArrayOf(40),
      quickCaptureProvider to intArrayOf(30),
    )
    val operations = mutableListOf<String>()

    val count = WidgetRenderer.refreshTaskCollections(
      applicationPackage,
      sdkInt = 30,
      idsForProvider = { idsByProvider[it] ?: intArrayOf() },
      invalidateRows = { ids -> operations += "rows:${ids.joinToString()}" },
      partiallyUpdateChrome = { id, kind -> operations += "chrome:${kind.name}:$id" },
    )

    assertEquals(4, count)
    assertEquals(
      listOf(
        "rows:10",
        "chrome:TASKS:10",
        "rows:20, 21",
        "chrome:TASKS:20",
        "chrome:TASKS:21",
        "rows:40",
        "chrome:COMPACT:40",
      ),
      operations,
    )
  }

  @Test
  fun modernDelayedRefreshSendsPartialRowsWithoutLegacyServiceInvalidation() {
    for (sdkInt in listOf(31, 36)) {
      val operations = mutableListOf<String>()
      val count = WidgetRenderer.refreshTaskCollections(
        applicationPackage,
        sdkInt = sdkInt,
        idsForProvider = { provider -> when (provider) {
          currentTasksProvider -> intArrayOf(10)
          legacyTasksProvider -> intArrayOf(20)
          compactProvider -> intArrayOf(40)
          quickCaptureProvider -> intArrayOf(30)
          else -> intArrayOf()
        } },
        invalidateRows = { throw AssertionError("Modern collections must not bind a service") },
        partiallyUpdateChrome = { id, kind -> operations += "${kind.name}:$id" },
      )
      assertEquals(3, count)
      assertEquals(listOf("TASKS:10", "TASKS:20", "COMPACT:40"), operations)
    }
  }

  @Test
  fun delayedCheckoffRefreshDoesNoWorkWithoutPlacedTaskWidgets() {
    var operations = 0

    val count = WidgetRenderer.refreshTaskCollections(
      applicationPackage,
      sdkInt = 31,
      idsForProvider = { intArrayOf() },
      invalidateRows = { operations += 1 },
      partiallyUpdateChrome = { _, _ -> operations += 1 },
    )

    assertEquals(0, count)
    assertEquals(0, operations)
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
