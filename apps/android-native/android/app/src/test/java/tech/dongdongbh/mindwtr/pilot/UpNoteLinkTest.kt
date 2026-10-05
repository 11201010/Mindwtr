package tech.dongdongbh.mindwtr.pilot

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import org.json.JSONArray

class UpNoteLinkTest {
    private val original = "upnote://x-callback-url/openNote?noteId=Note%2FCase%2520&new_window=true"

    @Test fun recoveryTextSurvivesActualLabelLoadAndLanguageReload() {
        val keys = listOf("common.error", "markdown.openLinkFailed", "markdown.copyLink", "markdown.copyLinkFailed")
        for (language in listOf("fr", "de")) {
            val translated = keys.associateWith { "$language:$it translated" }
            // This is the same request/response boundary as boot: core replies only to LABEL_KEYS.
            val response = JSONObject().put("language", language).put("missing", JSONArray())
                .put("strings", JSONObject(translated.filterKeys { LABEL_KEYS.contains(it) }))
            Labels.load(response, reportLoaded = {})
            for (key in keys) {
                // A missing label logs through android.util.Log (a stub in JVM tests), then the UI's fallback is the raw key.
                val displayed = runCatching { t(key) }.getOrElse { key }
                assertEquals(translated.getValue(key), displayed)
            }
        }
    }

    @Test fun preservesOriginalForAcceptedHandoff() {
        val opened = mutableListOf<String>()
        val failed = mutableListOf<String>()
        assertEquals(true, attemptUpNoteLink(original, { opened.add(it) }, { failed.add(it) }))
        assertEquals(listOf(original), opened)
        assertTrue(failed.isEmpty())
    }
    @Test fun absentAppOffersExactOriginalForCopyWithoutRetrying() {
        val failed = mutableListOf<String>()
        var calls = 0
        assertEquals(false, attemptUpNoteLink(original, { calls++; throw IllegalStateException("private error") }, { failed.add(it) }))
        assertEquals(1, calls)
        assertEquals(listOf(original), failed)
    }
    @Test fun leavesOrdinaryAndBlockedSchemesToTheirExistingPolicy() {
        for (href in listOf("https://example.org", "mailto:a@example.org", "tel:123", "javascript:alert(1)", "file:///secret", "data:text/plain,x", "obsidian://vault", "upnote:opaque")) {
            assertNull(attemptUpNoteLink(href, { fail("Must not open") }, { fail("Must not offer recovery") }))
        }
    }
}
