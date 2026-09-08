package tech.dongdongbh.mindwtr.androidwidget

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URI
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import org.json.JSONObject

/**
 * Appends one item to the pending-captures queue (#845 contract): native code
 * never writes the app database. `apps/mobile/lib/pending-captures.ts`
 * (`parsePendingCapture`) reads `<filesDir>/pending-captures/<uuid>.json` on
 * the next app start or foreground and creates the Inbox task through the
 * normal store path.
 */
object PendingCaptureWriter {
  const val DIRECTORY = "pending-captures"
  const val AUDIO_DIRECTORY = "quick-capture-audio"
  const val SOURCE = "android-quick-capture"
  const val CAPTURE_INTENT_SOURCE = "android-capture-intent"
  const val CHECKOFF_SOURCE = "android-widget"
  const val MAX_TITLE_LENGTH = 2000

  /** Returns the queued file, or null when the trimmed title is empty. */
  @Throws(IOException::class)
  fun write(filesDir: File, rawTitle: String, now: Date = Date()): File? {
    val title = rawTitle.trim().take(MAX_TITLE_LENGTH).trim()
    if (title.isEmpty()) return null

    return writeCapture(filesDir, title, SOURCE, now)
  }

  /**
   * Queues an automation capture without truncating it. Losing the end of a
   * dictated note is worse than rejecting an invalid request, so callers get
   * null for blank or over-limit text.
   */
  @Throws(IOException::class)
  fun writeCaptureIntent(filesDir: File, rawTitle: String, now: Date = Date()): File? {
    if (rawTitle.length > MAX_TITLE_LENGTH) return null
    val title = rawTitle.trim()
    if (title.isEmpty()) return null

    return writeCapture(filesDir, title, CAPTURE_INTENT_SOURCE, now)
  }

  private fun writeCapture(filesDir: File, title: String, source: String, now: Date): File {
    val id = UUID.randomUUID().toString()
    val json = JSONObject()
      .put("id", id)
      .put("title", title)
      .put("createdAt", isoTimestamp(now))
      .put("source", source)
      .toString()
    return publish(filesDir, id, json)
  }

  /** A widget check-off: `{ kind: "complete", taskId }`, applied through the store when the app next runs. */
  @Throws(IOException::class)
  fun writeCompletion(filesDir: File, taskId: String, now: Date = Date()): File {
    val id = UUID.randomUUID().toString()
    val json = JSONObject()
      .put("id", id)
      .put("kind", "complete")
      .put("taskId", taskId)
      .put("completedAt", isoTimestamp(now))
      .put("source", CHECKOFF_SOURCE)
      .toString()
    return publish(filesDir, id, json)
  }

  /**
   * Publishes an audio capture in two durable phases: the validated WAV first,
   * then the matching queue JSON that makes it visible to React Native.
   * Repeating the call for the exact same UUID and JSON is safe after a partial
   * failure; an existing distinct WAV or JSON is never overwritten.
   */
  @Throws(IOException::class)
  fun publishAudio(filesDir: File, draft: QuickCaptureAudioDraft, rawTitle: String): File {
    val paths = ownedAudioPaths(filesDir, draft) ?: throw IOException("Invalid audio capture path")
    val staged = paths.first
    val target = paths.second
    if (staged.exists()) {
      if (!staged.isFile || staged.length() != QuickCaptureWave.HEADER_SIZE + draft.dataBytes.toLong() || !QuickCaptureWave.isValid(staged)) {
        throw IOException("Invalid staged audio capture")
      }
      if (target.exists()) throw IOException("Audio capture already exists")
      if (!staged.renameTo(target)) throw IOException("Could not publish audio capture")
      // The recorder synced the staging file; sync its final name before making
      // the JSON discoverable by the queue reader.
      FileOutputStream(target, true).use { it.fd.sync() }
    } else if (!target.isFile || target.length() != QuickCaptureWave.HEADER_SIZE + draft.dataBytes.toLong() || !QuickCaptureWave.isValid(target)) {
      throw IOException("Audio capture is unavailable")
    }

    val title = rawTitle.trim().take(MAX_TITLE_LENGTH).trim()
    val json = JSONObject()
      .put("kind", "audio")
      .put("id", draft.id)
      // Match Expo's Uri.fromFile(context.filesDir) identity. Canonical paths
      // remain mandatory above for ownership validation only: Android may
      // expose /data/user/0 while its canonical alias is /data/data.
      .put("audioPath", absoluteFileUri(target))
      .put("source", SOURCE)
      .put("createdAt", isoTimestamp(draft.createdAt))
      .apply { if (title.isNotEmpty()) put("title", title) }
      .toString()
    return publish(filesDir, draft.id, json)
  }

  /** Deletes only an owned, not-yet-queued draft. */
  fun discardAudioDraft(filesDir: File, draft: QuickCaptureAudioDraft): Boolean {
    val paths = try {
      ownedAudioPaths(filesDir, draft)
    } catch (_: IOException) {
      null
    } ?: return false
    if (File(File(filesDir, DIRECTORY), "${draft.id}.json").exists()) return false
    val stagedDeleted = !paths.first.exists() || paths.first.delete()
    val targetDeleted = !paths.second.exists() || paths.second.delete()
    return stagedDeleted && targetDeleted
  }

  /**
   * Removes a queued item the app has not ingested yet (a widget check-off the
   * user undid). The name comes from our own SharedPreferences, but it still
   * names a file path, so anything but a plain `<uuid>.json` is refused.
   * Returns true when the queue no longer holds the file.
   */
  fun deleteQueued(filesDir: File, fileName: String): Boolean {
    if (!fileName.endsWith(".json") || fileName.contains('/') || fileName.contains('\\') || fileName.contains("..")) return false
    val file = File(File(filesDir, DIRECTORY), fileName)
    return !file.exists() || file.delete()
  }

  internal fun isSafeAudioId(id: String): Boolean = AUDIO_ID.matches(id)

  @Throws(IOException::class)
  private fun ownedAudioPaths(filesDir: File, draft: QuickCaptureAudioDraft): Pair<File, File>? {
    if (!isSafeAudioId(draft.id) || draft.dataBytes !in QuickCaptureWave.MINIMUM_DATA_BYTES..QuickCaptureWave.MAXIMUM_DATA_BYTES) return null
    val directory = File(filesDir, AUDIO_DIRECTORY)
    val staged = File(directory, ".${draft.id}.wav.tmp")
    val target = File(directory, "${draft.id}.wav")
    if (draft.stagedFile.canonicalFile != staged.canonicalFile) return null
    if (directory.canonicalFile.parentFile != filesDir.canonicalFile) return null
    return staged to target
  }

  private fun publish(filesDir: File, id: String, json: String): File {
    val directory = File(filesDir, DIRECTORY)
    if (!directory.isDirectory && !directory.mkdirs()) {
      throw IOException("Could not create ${directory.absolutePath}")
    }
    // Ingest only picks up `*.json`, so a half-written `.tmp` is never read.
    val temp = File(directory, "$id.tmp")
    val target = File(directory, "$id.json")
    if (target.exists()) {
      if (target.isFile && target.readText(Charsets.UTF_8) == json) return target
      throw IOException("Capture already exists")
    }
    FileOutputStream(temp).use { stream ->
      stream.write(json.toByteArray(Charsets.UTF_8))
      stream.fd.sync()
    }
    if (target.exists()) {
      temp.delete()
      if (target.isFile && target.readText(Charsets.UTF_8) == json) return target
      throw IOException("Capture already exists")
    }
    if (!temp.renameTo(target)) {
      temp.delete()
      throw IOException("Could not publish capture")
    }
    return target
  }

  private fun isoTimestamp(date: Date): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
      .apply { timeZone = TimeZone.getTimeZone("UTC") }
      .format(date)

  private fun absoluteFileUri(file: File): String =
    URI("file", "", file.absolutePath, null).toASCIIString()

  private val AUDIO_ID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
}
