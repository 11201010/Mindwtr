package tech.dongdongbh.mindwtr.pilot

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** A persistent capture notification that was not posted again reaches core's log (Settings › Diagnostics), not only logcat. */
class PersistentCaptureTest {
    private val on = JSONObject().put("post", JSONObject().put("title", "Quick capture").put("text", "Tap").put("channelName", "Capture"))

    @Test fun aFailedPostReachesTheDiagnosticsLog() {
        val lines = mutableListOf<Pair<String, String>>()
        PersistentCapture.restoreWith(read = { on }, granted = { true }, apply = { throw SecurityException("posting refused") },
            log = { message, context -> lines += message to context.toString() })
        assertEquals(listOf(PersistentCapture.FAILED to """{"error":"SecurityException"}"""), lines)
    }

    @Test fun offOrWithoutPermissionPostsNothingAndLogsNothing() {
        val posted = mutableListOf<JSONObject>()
        val lines = mutableListOf<String>()
        PersistentCapture.restoreWith(read = { JSONObject().put("post", JSONObject.NULL) }, granted = { true }, apply = { posted += it }, log = { m, _ -> lines += m })
        PersistentCapture.restoreWith(read = { on }, granted = { false }, apply = { posted += it }, log = { m, _ -> lines += m })
        assertEquals(0, posted.size)
        assertEquals(0, lines.size)
    }
}
