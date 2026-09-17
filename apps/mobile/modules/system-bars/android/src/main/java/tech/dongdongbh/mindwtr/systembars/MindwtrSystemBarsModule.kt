package tech.dongdongbh.mindwtr.systembars

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MindwtrSystemBarsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MindwtrSystemBars")

    AsyncFunction("setNavigationBarColorAsync") { color: String, darkButtons: Boolean ->
      applyNavigationBarStyle(color, darkButtons) != "unavailable"
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("applyNavigationBarStyleAsync") { color: String, darkButtons: Boolean ->
      applyNavigationBarStyle(color, darkButtons)
    }.runOnQueue(Queues.MAIN)
  }

  private fun applyNavigationBarStyle(color: String, darkButtons: Boolean): String {
    val activity = appContext.currentActivity ?: return "unavailable"
    return NavigationBarStyle.apply(activity.window, color, darkButtons)
  }
}
