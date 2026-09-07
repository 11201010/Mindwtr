package tech.dongdongbh.mindwtr.androidwidget

import java.io.File
import java.nio.file.Files
import java.util.Date
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureIntentProcessorTest {
  private val token = "ab".repeat(32)
  private val enabled = CaptureIntentConfig(enabled = true, token = token)

  private fun extras(text: Any? = "Buy milk", suppliedToken: Any? = token): Map<String, Any?> = mapOf(
    CaptureIntentProcessor.EXTRA_TEXT to text,
    CaptureIntentProcessor.EXTRA_TOKEN to suppliedToken,
  )

  @Test
  fun rejectsDisabledWrongTokenAndWrongAction() {
    var writes = 0
    val enqueue: (String) -> Boolean = { writes += 1; true }

    assertFalse(CaptureIntentProcessor.process(CaptureIntentProcessor.ACTION, extras(), CaptureIntentConfig.DISABLED, enqueue))
    assertFalse(CaptureIntentProcessor.process(CaptureIntentProcessor.ACTION, extras(suppliedToken = "cd".repeat(32)), enabled, enqueue))
    assertFalse(CaptureIntentProcessor.process("tech.dongdongbh.mindwtr.action.OTHER", extras(), enabled, enqueue))
    assertEquals(0, writes)
  }

  @Test
  fun rejectsMalformedBlankAndOverLimitRequests() {
    val invalid = listOf(
      extras(text = 42),
      extras(suppliedToken = true),
      extras(text = " \n "),
      extras(text = "x".repeat(PendingCaptureWriter.MAX_TITLE_LENGTH + 1)),
      extras(suppliedToken = "x".repeat(100_000)),
      mapOf(CaptureIntentProcessor.EXTRA_TEXT to "Missing token"),
    )
    var writes = 0

    for (request in invalid) {
      assertFalse(CaptureIntentProcessor.process(CaptureIntentProcessor.ACTION, request, enabled) { writes += 1; true })
    }

    assertEquals(0, writes)
  }

  @Test
  fun malformedBundleReadFailsClosed() {
    var reads = 0

    val result = CaptureIntentExtrasReader.read {
      reads += 1
      throw RuntimeException("malicious parcelable")
    }

    assertNull(result)
    assertEquals(1, reads)
  }

  @Test
  fun queuesRepeatedNotesAsDistinctFilesWithTheDedicatedSource() {
    val filesDir = Files.createTempDirectory("mindwtr-capture-intent").toFile()
    val request = extras(text = "  Same dictated note  ") + mapOf(
      "id" to "attacker-id",
      "source" to "attacker-source",
      "status" to "done",
      "path" to "../outside",
    )

    repeat(2) {
      assertTrue(CaptureIntentProcessor.process(CaptureIntentProcessor.ACTION, request, enabled) { title ->
        PendingCaptureWriter.writeCaptureIntent(filesDir, title, Date(0)) != null
      })
    }

    val files = File(filesDir, PendingCaptureWriter.DIRECTORY).listFiles()!!.sortedBy { it.name }
    assertEquals(2, files.size)
    assertTrue(files[0].name != files[1].name)
    for (file in files) {
      val json = JSONObject(file.readText())
      assertEquals(file.name.removeSuffix(".json"), json.getString("id"))
      assertEquals("Same dictated note", json.getString("title"))
      assertEquals("android-capture-intent", json.getString("source"))
      assertFalse(json.has("status"))
      assertFalse(json.has("path"))
    }
  }

  @Test
  fun disablingRevokesTheOldTokenAndReenablingRotatesIt() {
    val firstToken = "11".repeat(32)
    val secondToken = "22".repeat(32)
    val first = CaptureIntentConfigPolicy.setEnabled(CaptureIntentConfig.DISABLED, true) { firstToken }
    val disabled = CaptureIntentConfigPolicy.setEnabled(first, false) { error("must not generate") }
    val second = CaptureIntentConfigPolicy.setEnabled(disabled, true) { secondToken }
    var writes = 0

    assertTrue(CaptureIntentProcessor.process(CaptureIntentProcessor.ACTION, extras(suppliedToken = firstToken), first) { writes += 1; true })
    assertFalse(CaptureIntentProcessor.process(CaptureIntentProcessor.ACTION, extras(suppliedToken = firstToken), disabled) { writes += 1; true })
    assertFalse(CaptureIntentProcessor.process(CaptureIntentProcessor.ACTION, extras(suppliedToken = firstToken), second) { writes += 1; true })
    assertTrue(CaptureIntentProcessor.process(CaptureIntentProcessor.ACTION, extras(suppliedToken = secondToken), second) { writes += 1; true })
    assertEquals(2, writes)
    assertNull(disabled.token)
  }
}
