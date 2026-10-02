package tech.dongdongbh.mindwtr.pilot.core

import android.content.Context
import android.content.res.Configuration
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import tech.dongdongbh.mindwtr.androidwidget.CheckoffStore
import tech.dongdongbh.mindwtr.androidwidget.WidgetListStore
import tech.dongdongbh.mindwtr.androidwidget.WidgetPayloadStore
import tech.dongdongbh.mindwtr.androidwidget.WidgetRenderer
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * RN's widget module bridge (AndroidWidgetModule.kt) for the engine's widget publisher (bundle/host-widgets.ts): the device inputs
 * core's publication needs, and setPayload + updateWidgets in one call. The payload is core's; this only stores it where RN's
 * widgets read it and redraws them, in order, off the engine thread (a redraw can take seconds).
 */
class HostWidgets(private val app: Context) {
    private val worker = Executors.newSingleThreadExecutor { task -> Thread(task, "mindwtr-widgets") }
    /** The last publication's store or redraw failed: the publisher sends it again on its next refresh, even if unchanged. */
    @Volatile private var stale = false

    /**
     * `{ systemColorScheme, systemLocale, listSelections, stale }`: what RN's widget service reads from React Native and the
     * module, and whether the last publication failed.
     */
    fun inputs(): String {
        val night = app.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        return JSONObject()
            .put("systemColorScheme", if (night) "dark" else "light")
            .put("systemLocale", Locale.getDefault().toLanguageTag())
            .put("listSelections", JSONArray(WidgetListStore.selections(app)))
            .put("stale", stale)
            // Debug builds only (check-widgets-device.mjs): the widgets' language, whatever the synced setting says.
            .apply { debugProperty("widget_language").takeIf { it.isNotEmpty() }?.let { put("language", it) } }
            .toString()
    }

    /** RN's setPayload then updateWidgets, queued: the widgets read [payload] from RN's store and redraw. */
    fun publish(payload: String) {
        worker.execute {
            runCatching {
                WidgetPayloadStore.write(app, payload)
                val drawn = WidgetRenderer.refreshAll(app)
                Log.i(CoreHost.TAG, "Native Android widgets refreshed bytes=${payload.length} legacy=${drawn.legacyWidgetCount} " +
                    "compact=${drawn.compactWidgetCount} rendered=${drawn.renderedTaskCount} hiddenCheckoffs=${CheckoffStore.consumeHiddenCount(app)} " +
                    "serializedCheckoffs=${CheckoffStore.consumeSerializedCount(app)}")
            }.onSuccess { stale = false }.onFailure {
                stale = true
                Log.w(CoreHost.TAG, "Native Android widget refresh failed", it)
            }
        }
    }

    /**
     * Waits until every publication handed over so far is stored and drawn: CoreWork's job ends only after it. One still running
     * when the wait ends goes on; if it then fails, [stale] has the next refresh send it again.
     */
    fun settle() {
        runCatching { worker.submit {}.get(SETTLE_SECONDS, TimeUnit.SECONDS) }
            .onFailure { Log.w(CoreHost.TAG, "Native Android widget refresh still running after ${SETTLE_SECONDS}s", it) }
    }

    private companion object {
        const val SETTLE_SECONDS = 30L
    }
}
