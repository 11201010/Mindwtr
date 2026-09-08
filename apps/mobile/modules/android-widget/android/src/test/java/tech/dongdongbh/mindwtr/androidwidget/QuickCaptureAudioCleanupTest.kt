package tech.dongdongbh.mindwtr.androidwidget

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickCaptureAudioCleanupTest {
  private val nowMs = 20L * 24 * 60 * 60 * 1_000

  private fun tempFilesDir(): File = Files.createTempDirectory("mindwtr-audio-cleanup").toFile()

  private fun audioFile(filesDir: File, name: String, modifiedAt: Long): File {
    val directory = File(filesDir, PendingCaptureWriter.AUDIO_DIRECTORY).apply { mkdirs() }
    return File(directory, name).apply {
      writeText("orphan")
      assertTrue(setLastModified(modifiedAt))
    }
  }

  @Test
  fun deletesOnlyStaleFinalAndStagingAudioFiles() {
    val filesDir = tempFilesDir()
    val staleFinal = audioFile(filesDir, "$FINAL_ID.wav", nowMs - QuickCaptureAudioCleanup.STALE_AFTER_MS)
    val staleStaging = audioFile(filesDir, ".$STAGING_ID.wav.tmp", nowMs - QuickCaptureAudioCleanup.STALE_AFTER_MS - 1)
    val currentFinal = audioFile(filesDir, "$CURRENT_ID.wav", nowMs - QuickCaptureAudioCleanup.STALE_AFTER_MS + 1)
    val futureStaging = audioFile(filesDir, ".$FUTURE_ID.wav.tmp", nowMs + 1)

    assertEquals(2, QuickCaptureAudioCleanup.sweep(filesDir, nowMs = nowMs))
    assertFalse(staleFinal.exists())
    assertFalse(staleStaging.exists())
    assertTrue(currentFinal.exists())
    assertTrue(futureStaging.exists())
  }

  @Test
  fun queuedJsonOrPublicationTempAlwaysPreservesMatchingAudio() {
    val filesDir = tempFilesDir()
    val finalAudio = audioFile(filesDir, "$FINAL_ID.wav", 1)
    val stagedAudio = audioFile(filesDir, ".$STAGING_ID.wav.tmp", 1)
    File(filesDir, PendingCaptureWriter.DIRECTORY).apply { mkdirs() }.also { queue ->
      File(queue, "$FINAL_ID.json").writeText("{}")
      File(queue, "$STAGING_ID.tmp").writeText("pending")
    }

    assertEquals(0, QuickCaptureAudioCleanup.sweep(filesDir, nowMs = nowMs))
    assertTrue(finalAudio.exists())
    assertTrue(stagedAudio.exists())
  }

  @Test
  fun activeIdsPreserveStaleFilesCaseInsensitively() {
    val filesDir = tempFilesDir()
    val finalAudio = audioFile(filesDir, "$FINAL_ID.wav", 1)
    val stagedAudio = audioFile(filesDir, ".$STAGING_ID.wav.tmp", 1)

    assertEquals(
      0,
      QuickCaptureAudioCleanup.sweep(
        filesDir,
        activeIds = setOf(FINAL_ID.uppercase(), STAGING_ID.uppercase()),
        nowMs = nowMs,
      ),
    )
    assertTrue(finalAudio.exists())
    assertTrue(stagedAudio.exists())
  }

  @Test
  fun malformedAndNonFileEntriesAreNeverDeleted() {
    val filesDir = tempFilesDir()
    val malformed = listOf(
      ".not-a-uuid.wav.tmp",
      "$FINAL_ID.mp3",
      ".$FINAL_ID.wav",
      "$FINAL_ID.wav.tmp",
      "$FINAL_ID.json",
    ).map { audioFile(filesDir, it, 1) }
    val matchingDirectory = File(
      File(filesDir, PendingCaptureWriter.AUDIO_DIRECTORY),
      "$DIRECTORY_ID.wav",
    ).apply { mkdirs() }

    assertEquals(0, QuickCaptureAudioCleanup.sweep(filesDir, nowMs = nowMs))
    assertTrue(malformed.all(File::exists))
    assertTrue(matchingDirectory.isDirectory)
  }

  @Test
  fun symlinkedFileAndForeignAudioDirectoryAreNeverTraversed() {
    val filesDir = tempFilesDir()
    val outside = File(tempFilesDir(), "outside.wav").apply {
      writeText("keep")
      assertTrue(setLastModified(1))
    }
    val audioDirectory = File(filesDir, PendingCaptureWriter.AUDIO_DIRECTORY).apply { mkdirs() }
    val linked = File(audioDirectory, "$FINAL_ID.wav")
    Files.createSymbolicLink(linked.toPath(), outside.toPath())

    assertEquals(0, QuickCaptureAudioCleanup.sweep(filesDir, nowMs = nowMs))
    assertTrue(Files.isSymbolicLink(linked.toPath()))
    assertTrue(outside.exists())

    val redirectedFilesDir = tempFilesDir()
    val foreignAudioDirectory = Files.createTempDirectory("mindwtr-foreign-audio").toFile()
    val foreignAudio = File(foreignAudioDirectory, "$STAGING_ID.wav").apply {
      writeText("foreign")
      assertTrue(setLastModified(1))
    }
    Files.createSymbolicLink(
      File(redirectedFilesDir, PendingCaptureWriter.AUDIO_DIRECTORY).toPath(),
      foreignAudioDirectory.toPath(),
    )

    assertEquals(0, QuickCaptureAudioCleanup.sweep(redirectedFilesDir, nowMs = nowMs))
    assertTrue(foreignAudio.exists())
  }

  @Test
  fun ambiguousQueueLocationPreservesOtherwiseStaleAudio() {
    val filesDir = tempFilesDir()
    val stale = audioFile(filesDir, "$FINAL_ID.wav", 1)
    File(filesDir, PendingCaptureWriter.DIRECTORY).writeText("not a queue directory")

    assertEquals(0, QuickCaptureAudioCleanup.sweep(filesDir, nowMs = nowMs))
    assertTrue(stale.exists())
  }

  companion object {
    private const val FINAL_ID = "01234567-89ab-cdef-0123-456789abcdef"
    private const val STAGING_ID = "11234567-89ab-cdef-0123-456789abcdef"
    private const val CURRENT_ID = "21234567-89ab-cdef-0123-456789abcdef"
    private const val FUTURE_ID = "31234567-89ab-cdef-0123-456789abcdef"
    private const val DIRECTORY_ID = "41234567-89ab-cdef-0123-456789abcdef"
  }
}
