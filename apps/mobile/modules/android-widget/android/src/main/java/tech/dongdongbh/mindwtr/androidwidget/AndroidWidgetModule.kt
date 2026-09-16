package tech.dongdongbh.mindwtr.androidwidget

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AndroidWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MindwtrAndroidWidget")

    Function("setPayload") { json: String ->
      val context = appContext.reactContext ?: return@Function
      WidgetPayloadStore.write(context, json)
    }

    Function("updateWidgets") {
      val context = appContext.reactContext
      val result = context?.let { WidgetRenderer.refreshAll(it) } ?: WidgetRenderer.RefreshResult()
      val hiddenCheckoffCount = context?.let { CheckoffStore.consumeHiddenCount(it) } ?: 0
      mapOf(
        "legacyWidgetCount" to result.legacyWidgetCount,
        "compactWidgetCount" to result.compactWidgetCount,
        "hiddenCheckoffCount" to hiddenCheckoffCount,
        "directCollectionCount" to result.directCollectionCount,
        "renderedTaskCount" to result.renderedTaskCount,
        "eligibleTaskCount" to result.eligibleTaskCount,
        "collectionBytes" to result.collectionBytes,
      )
    }

    Function("getWidgetListSelections") {
      appContext.reactContext?.let { WidgetListStore.selections(it) } ?: emptyList<String>()
    }

    AsyncFunction("getCaptureIntentConfig") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("Capture intent is unavailable without an Android application context")
      CaptureIntentConfigStore.read(context).toBridgeValue()
    }

    AsyncFunction("setCaptureIntentEnabled") { enabled: Boolean ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("Capture intent is unavailable without an Android application context")
      CaptureIntentConfigStore.setEnabled(context, enabled).toBridgeValue()
    }
  }
}
