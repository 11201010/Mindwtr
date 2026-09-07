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
      appContext.reactContext?.let { WidgetRenderer.refreshAll(it) } ?: 0
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
