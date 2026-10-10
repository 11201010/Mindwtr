package tech.dongdongbh.mindwtr.pilot

import android.app.Activity
import android.app.Application
import android.content.ClipData
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import androidx.lifecycle.SavedStateHandle
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.core.BackupOperations
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import tech.dongdongbh.mindwtr.pilot.core.RecoverySnapshots
import tech.dongdongbh.mindwtr.pilot.core.debugProperty
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.Base64
import java.util.Date
import java.util.UUID

/*
 * Settings › Data's Backup fold and Sync › Recovery snapshots (RN's use-sync-settings-backup-actions.ts and lib/data-transfer.ts)
 * on core's native backup document (native-backup-document.ts): export a JSON, CSV or TaskNotes file, Restore backup, Merge backup,
 * and a snapshot restore (a Recovery snapshots row, or a result's Undo). Kotlin keeps RN's screen state (which action runs, the
 * open question) and the platform's files: the system pickers, the staged copy, the recovery snapshot, the operation's plan
 * (BackupOperations) and the export's folder document. Every word, check and data change is core's. Design: pass D1 design.md.
 */

/** The measured transfer limit (design §4.1): a picked file and the library together, before anything is decoded or parsed. */
object DataTransferLimits {
    // ponytail: one fixed limit measured on the S23 (result.md, pass D1a); a device with a smaller heap gets the same number.
    private const val LIMIT_BYTES = 48L * 1024 * 1024
    /** Core's MAX_BACKUP_SOURCE_BYTES: a picked JSON backup alone. */
    const val MAX_BACKUP_SOURCE_BYTES = 128L * 1024 * 1024

    /** The limit; debug builds only: `debug.mindwtr.native.transfer_limit_mb` raises it for the measurement run. */
    val MAX_DATA_TRANSFER_BYTES: Long get() = debugProperty("transfer_limit_mb").toLongOrNull()?.takeIf { it > 0 }?.let { it * 1024 * 1024 } ?: LIMIT_BYTES

    /** A frozen plan holds the library twice (the current document and the result), plus its reply. */
    val MAX_PLAN_BYTES: Long get() = 2 * MAX_DATA_TRANSFER_BYTES + 1024 * 1024
}

/** RN's MIME type for a picked backup (pickBackupDocument). */
private const val BACKUP_MIME = "application/json"

class DataTransferModel(private val menu: MenuModel, private val saved: SavedStateHandle) {
    private val shell get() = menu.shell
    private val app get() = shell.getApplication<Application>()
    private val resolver: ContentResolver get() = app.contentResolver
    private val snapshots get() = File(app.filesDir, "snapshots")
    private val staging get() = File(app.noBackupFilesDir, "backup-import")
    private val exportPending get() = File(app.noBackupFilesDir, "export-pending.json")
    val operations get() = BackupOperations(File(app.noBackupFilesDir, "backup-operations"), snapshots, maxPlanBytes = DataTransferLimits.MAX_PLAN_BYTES)

    /** RN's backupAction: the running action ("export", "export:csv", "export:tasknotes", "restore", "merge", "snapshot:<name>"). */
    var action by mutableStateOf<String?>(null); private set
    /** The open question (RN's Alert): `{ kind: "confirm", model, mode, stage }` or `{ kind: "snapshot", model, name, undo }`. */
    var question by mutableStateOf<JSONObject?>(null); private set
    /** A system picker the Data screen opens next ("json", "tree"); the screen launches it and clears it. */
    var launch by mutableStateOf<String?>(null); private set
    /** A made export file waiting for the Data screen to open the share sheet. */
    var share by mutableStateOf<Pair<File, String>?>(null); private set
    /** The export made at press time (RN reads its snapshot before the folder picker), held for the picker's answer. */
    private var exportFile: JSONObject? = null

    val busy get() = action != null

    fun launched() { launch = null }

    private fun words() = menu.settings.page?.takeIf { it.screen == "data" }?.view?.optJSONObject("backup")

    // ---- Export ----

    /**
     * Export backup, Export CSV, Export TaskNotes (RN's exportCurrentDataBackup): core's file from the snapshot at press time,
     * then the folder picker (RN's requestDirectoryPermissionsAsync); a folder writes the file there, no folder shares it.
     */
    fun export(format: String) {
        if (busy) return
        val words = words() ?: return
        val failed = words.getString(when (format) { "csv" -> "csvFailed"; "tasknotes" -> "tasknotesFailed"; else -> "failed" })
        val running = if (format == "json") "export" else "export:$format"
        action = running
        val read = when (format) { "csv" -> "dataCsvExport"; "tasknotes" -> "dataTaskNotesExport"; else -> "dataBackup" }
        shell.anyTime({ runtime ->
            val file = runtime.menuRead(read, JSONObject().put("maxBytes", DataTransferLimits.MAX_DATA_TRANSFER_BYTES).toString()).put("format", format)
            shell.ui {
                exportFile = file
                launch = "tree"
            }
        }) { failure ->
            Log.w(CoreHost.TAG, "Export failed ${failureForLog(failure)}")
            action = null
            shell.showToast(words.getString("errorTitle"), failed, "error", durationMs = 4_200)
        }
    }

    /** The folder picker's answer: write into [tree], or (none chosen, or the write failed) RN's share fallback. */
    fun folderPicked(tree: Uri?) {
        val file = exportFile ?: run { action = null; return }
        exportFile = null
        val words = words()
        shell.anyTime({ runtime ->
            val name = file.getString("fileName")
            val bytes = if (file.getString("encoding") == "base64") Base64.getDecoder().decode(file.getString("content")) else file.getString("content").toByteArray()
            val mime = when (file.getString("format")) { "csv" -> "text/csv"; "tasknotes" -> "application/zip"; else -> "application/json" }
            val written = tree?.let { runCatching { writeToFolder(it, name, mime, bytes) }.onFailure { Log.w(CoreHost.TAG, "Export folder write failed ${failureForLog(it)}") }.isSuccess } ?: false
            if (written) {
                runtime.logLine("Native Android backup file written releaseCheck=v1.3.5/android-backup-export", JSONObject().put("releaseCheck", "v1.3.5/android-backup-export")
                    .put("format", file.getString("format")).put("route", "saf"))
                shell.ui { action = null }
            } else {
                val dir = File(app.cacheDir, "exports").apply { mkdirs() }
                dir.listFiles().orEmpty().forEach { it.delete() }
                val out = File(dir, name)
                FileOutputStream(out).use { it.write(bytes) }
                shell.ui { share = out to mime }
            }
        }) { failure ->
            Log.w(CoreHost.TAG, "Export failed ${failureForLog(failure)}")
            action = null
            words?.let { shell.showToast(it.getString("errorTitle"), it.getString("failed"), "error", durationMs = 4_200) }
        }
    }

    /**
     * RN's StorageAccessFramework.createFileAsync and writeAsStringAsync: the grant kept (as Expo takes it), the document created
     * in the folder, its URI on disk before the first byte, and deleted when the write fails. The record goes once it is closed.
     */
    private fun writeToFolder(tree: Uri, name: String, mime: String, bytes: ByteArray) {
        runCatching { resolver.takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
        val parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        writeExportDocument(exportPending,
            create = { (DocumentsContract.createDocument(resolver, parent, mime, name) ?: throw IOException("The folder refused the new file")).toString() },
            write = { uri ->
                if (debugProperty("backup_stop") == "mid-export") {
                    resolver.openOutputStream(Uri.parse(uri), "w")?.use { it.write(bytes, 0, bytes.size / 2) }
                    Log.i(CoreHost.TAG, "Native Android backup stop at=mid-export")
                    android.os.Process.killProcess(android.os.Process.myPid())
                }
                (resolver.openOutputStream(Uri.parse(uri), "w") ?: throw IOException("The new file cannot be opened")).use { it.write(bytes) }
            },
            delete = { uri -> DocumentsContract.deleteDocument(resolver, Uri.parse(uri)) })
    }

    /** RN's share fallback (expo-sharing): a chooser over ACTION_SEND with the file's FileProvider link and its read grant. */
    fun openShare(activity: Activity) {
        val (file, mime) = share ?: return
        share = null
        action = null
        try {
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.diagnostics", file)
            val send = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            send.clipData = ClipData.newRawUri(null, uri)
            activity.startActivity(Intent.createChooser(send, "Export Mindwtr Backup"))
            shell.coreHost()?.let { runtime -> Thread { runtime.logLine("Native Android backup file written releaseCheck=v1.3.5/android-backup-export", JSONObject()
                .put("releaseCheck", "v1.3.5/android-backup-export").put("format", formatOf(file.name)).put("route", "share")) }.start() }
        } catch (failure: Exception) {
            Log.w(CoreHost.TAG, "Export share failed ${failureForLog(failure)}")
            words()?.let { shell.showToast(it.getString("errorTitle"), it.getString("failed"), "error", durationMs = 4_200) }
        }
    }

    private fun formatOf(name: String) = when { name.endsWith(".csv") -> "csv"; name.endsWith(".zip") -> "tasknotes"; else -> "json" }

    // ---- Restore backup, Merge backup ----

    /** Restore backup or Merge backup: RN's backup picker (application/json). */
    fun pickBackup(mode: String) {
        if (busy) return
        action = mode
        saved["dataPick"] = mode
        launch = "json"
    }

    /** The backup picker's answer: the file staged, then core's preview (RN's Alert) or RN's invalid-file warning. */
    fun backupPicked(uri: Uri?) {
        val mode = saved.get<String>("dataPick")
        saved.remove<String>("dataPick")
        if (uri == null || mode == null) { action = null; return }
        action = mode
        // RN's failure titles for a pick that cannot be read: Restore failed, or Merge failed.
        val failedTitle = words()?.optString(if (mode == "merge") "mergeFailed" else "restoreFailed")
        whenHosted { runtime ->
            val stage = try { stage(uri) } catch (failure: Throwable) {
                Log.w(CoreHost.TAG, "Backup stage failed ${failureForLog(failure)}")
                shell.ui { finish(); warn(runtime, failedTitle, failure) }
                return@whenHosted
            }
            try { admit(runtime, stage.file.length()) } catch (failure: TransferTooLarge) {
                stage.file.delete()
                shell.ui { finish(); warn(runtime, failedTitle, failure) }
                return@whenHosted
            }
            val text = utf8(stage.file)
            val preview = runtime.backupInspect(text ?: "", stage.metadata.toString(), if (mode == "restore") "json-restore" else "json")
            shell.ui {
                if (!preview.getBoolean("valid") || text == null) {
                    stage.file.delete()
                    finish()
                    // RN's showSettingsWarning (4.2 s).
                    shell.showToast(preview.getString("errorTitle"), preview.getString("errorMessage"), "warning", durationMs = 4_200)
                } else {
                    question = JSONObject().put("kind", "confirm").put("model", preview).put("mode", mode)
                        .put("stage", stage.file.name).put("metadata", stage.metadata)
                }
            }
        }
    }

    /** The question's Cancel: nothing was written; the staged copy goes. */
    fun cancel() {
        question?.optString("stage")?.takeIf { it.isNotEmpty() }?.let { File(staging, it).delete() }
        question = null
        finish()
    }

    /** The question's Restore or Merge: the operation runs (design §4.2). */
    fun confirm() {
        val open = question ?: return
        question = null
        when (open.getString("kind")) {
            "confirm" -> {
                val file = File(staging, open.getString("stage"))
                val mode = if (open.getString("mode") == "restore") "replace" else "merge"
                run(open.getString("mode"), mode, null, open.getJSONObject("metadata"), file.length()) { utf8(file).also { file.delete() } }
            }
            "snapshot" -> {
                val name = open.getString("name")
                action = "snapshot:$name"
                val file = File(snapshots, name)
                run("snapshot:$name", "restore", name, JSONObject().put("fileName", name).put("lastModified", 0).put("appVersion", BuildConfig.VERSION_NAME), file.length()) {
                    check(file.isFile) { "Snapshot file not found." }
                    if (file.length() > DataTransferLimits.MAX_BACKUP_SOURCE_BYTES) throw TransferTooLarge()
                    utf8(file)
                }
            }
        }
    }

    // ---- Recovery snapshots ----

    /** A Recovery snapshots row, or a result's Undo ([undo]): core's question first (RN's Alert). */
    fun askSnapshot(name: String, undo: Boolean) {
        if (busy) return
        whenHosted { runtime ->
            val model = runtime.backupSnapshotModel(name, if (undo) "undo" else "restore")
            shell.ui { question = JSONObject().put("kind", "snapshot").put("model", model).put("name", name).put("undo", undo) }
        }
    }

    // ---- The operation ----

    /**
     * Prepare, recovery snapshot, plan, journaled commit (design §4.2), then RN's result toast with Undo. [running] is RN's
     * backupAction; [snapshot] the snapshot a `restore` reads (null: a new one is named now). Debug builds only:
     * `debug.mindwtr.native.backup_stop` = `after-snapshot` or `mid-plan` ends the process at that step.
     */
    private fun run(running: String, mode: String, snapshot: String?, metadata: JSONObject, sourceBytes: Long, text: () -> String?) {
        action = running
        val words = words()
        val failedTitle = when (running) { "merge" -> words?.optString("mergeFailed"); else -> words?.optString("restoreFailed") }
        whenHosted { runtime ->
            val ops = operations
            val requestId = UUID.randomUUID().toString()
            try {
                admit(runtime, sourceBytes)
                val source = text() ?: throw IllegalStateException("INVALID_INPUT: Backup file is not valid UTF-8")
                val name = snapshot ?: RecoverySnapshots.nextName(snapshots, Date())
                val prepared = runtime.backupPrepare(JSONObject().put("requestId", requestId).put("mode", mode).put("snapshotName", name)
                    .put("text", source).put("metadata", metadata).toString())
                val recovery = prepared.opt("recoveryJSON") as? String
                if (recovery != null) RecoverySnapshots.write(snapshots, name, recovery, ops.protectedNames(), exact = true)
                stop("after-snapshot")
                val reference = ops.publish(requestId, mode, prepared.getString("planJSON"), name, wrote = recovery != null) { stop("mid-plan") }
                val reply = runtime.backupCommit(reference, name)
                val result = runtime.backupResultModel(reply.toString())
                RecoverySnapshots.prune(snapshots, ops.protectedNames())
                shell.ui { finish(); showResult(requestId, result, if (mode == "restore") null else name) }
            } catch (failure: Throwable) {
                Log.w(CoreHost.TAG, "Backup operation failed mode=$mode ${failureForLog(failure)}")
                shell.ui { finish(); warn(runtime, failedTitle, failure) }
            }
        }
    }

    /** RN's result toast (core's words and duration), with Undo; the result record goes once it shows (design §4.3). */
    private fun showResult(requestId: String, result: JSONObject, undo: String?) {
        val undoLabel = result.optString("undoLabel").takeIf { it.isNotEmpty() && undo != null }
        shell.showToast(result.getString("title"), result.getString("message"), "success", undoLabel,
            if (result.isNull("durationMs")) null else result.getLong("durationMs")) { undo?.let { askSnapshot(it, undo = true) } }
        Thread { runCatching { operations.clearResult(requestId) } }.start()
    }

    /** After a start: a result record left by a death after its commit shows its toast once (design §4.3). */
    fun leftover() = whenHosted { runtime ->
        runCatching { cleanupInterruptedExport(runtime) }.onFailure { Log.w(CoreHost.TAG, "Interrupted export cleanup failed ${failureForLog(it)}") }
        val ops = operations
        val record = ops.result() ?: return@whenHosted
        val requestId = record.optString("requestId")
        val reply = record.optJSONObject("reply")
        if (record.optString("outcome") != "committed" || reply == null) { ops.clearResult(requestId); return@whenHosted }
        val result = runCatching { runtime.backupResultModel(reply.toString()) }.getOrNull() ?: run { ops.clearResult(requestId); return@whenHosted }
        val undo = record.optString("undoSnapshot").takeIf { it.isNotEmpty() && File(snapshots, it).isFile }
        shell.ui { showResult(requestId, result, undo) }
    }

    /** At start, before any export: a folder document whose write never finished is deleted (the persisted grant allows it). */
    private fun cleanupInterruptedExport(runtime: CoreHost) {
        val outcome = cleanupExportRecord(exportPending) { uri -> DocumentsContract.deleteDocument(resolver, Uri.parse(uri)) } ?: return
        runtime.logLine("Native Android interrupted export removed releaseCheck=v1.3.5/android-export-cleanup", JSONObject().put("releaseCheck", "v1.3.5/android-export-cleanup").put("outcome", outcome))
    }

    // ---- Files ----

    private class Stage(val file: File, val metadata: JSONObject)

    /** RN's picker copy (copyToCacheDirectory) as a private file: its bytes counted while copied, stopped past the limit. */
    private fun stage(uri: Uri): Stage {
        staging.mkdirs()
        val (name, modified) = details(uri)
        val file = File(staging, UUID.randomUUID().toString())
        val limit = minOf(DataTransferLimits.MAX_DATA_TRANSFER_BYTES, DataTransferLimits.MAX_BACKUP_SOURCE_BYTES)
        try {
            (resolver.openInputStream(uri) ?: throw IOException("The selected file cannot be read")).use { input -> copyBounded(input, file, limit) }
        } catch (failure: Throwable) {
            file.delete()
            throw failure
        }
        return Stage(file, JSONObject().put("fileName", name).put("lastModified", modified).put("appVersion", BuildConfig.VERSION_NAME))
    }

    /** expo-document-picker's DocumentDetailsReader: the display name, and COLUMN_LAST_MODIFIED when the provider has it. */
    private fun details(uri: Uri): Pair<String, Long> {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "import"
        var modified = 0L
        runCatching {
            resolver.query(uri, null, null, null, null)?.use { row ->
                if (row.moveToFirst()) {
                    row.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 && !row.isNull(it) }?.let { name = row.getString(it) }
                    row.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED).takeIf { it >= 0 && !row.isNull(it) }?.let { modified = row.getLong(it) }
                }
            }
        }
        return name to modified
    }

    /** The picked file and the library must fit the measured limit together (design §4.1), else RN's too-large text. */
    private fun admit(runtime: CoreHost, sourceBytes: Long) {
        if (sourceBytes + runtime.databaseBytes() > DataTransferLimits.MAX_DATA_TRANSFER_BYTES) throw TransferTooLarge()
    }

    /**
     * RN's failure toast (showSettingsErrorToast, 5.2 s) under [title]: core's too-large text when the file or the library was
     * over the limit (RN's formatThrownBackupError), else the failure's words.
     */
    private fun warn(runtime: CoreHost, title: String?, failure: Throwable) {
        val words = words() ?: return
        val message = if (failure is TransferTooLarge) {
            val mb = DataTransferLimits.MAX_DATA_TRANSFER_BYTES / (1024 * 1024)
            runCatching { runtime.strings(listOf("settings.backupDiagnostics.tooLarge")).getJSONObject("strings").getString("settings.backupDiagnostics.tooLarge") }
                .getOrDefault("").replace("{{maxSizeMb}}", "$mb")
        } else (failure.message ?: "").substringAfter(": ")
        shell.showToast(title ?: words.optString("restoreFailed"), message, "error", durationMs = 5_200)
    }

    private fun stop(at: String) {
        if (debugProperty("backup_stop") != at) return
        Log.i(CoreHost.TAG, "Native Android backup stop at=$at")
        android.os.Process.killProcess(android.os.Process.myPid())
    }

    private fun finish() { action = null }

    /** [work] on a worker once the validated boot finished (a picker's answer can arrive before it, after process death). */
    private fun whenHosted(work: (CoreHost) -> Unit) {
        val runtime = shell.coreHost() ?: run { shell.ui { whenHosted(work) }; return }
        Thread({ runCatching { work(runtime) }.onFailure { failure ->
            Log.w(CoreHost.TAG, "Data transfer failed ${failureForLog(failure)}")
            shell.ui { finish(); warn(runtime, null, failure) }
        } }, "mindwtr-data-transfer").start()
    }
}

/**
 * RN's folder write with its two guards: the created document's URI is on disk (synced) in [record] before the first byte, and
 * a failed write deletes the document (RN's 206366cce) before the failure goes on. [record] goes once the write closed.
 */
internal fun writeExportDocument(record: File, create: () -> String, write: (String) -> Unit, delete: (String) -> Boolean) {
    val created = create()
    FileOutputStream(record).use { out -> out.write(JSONObject().put("uri", created).toString().toByteArray()); out.fd.sync() }
    try {
        write(created)
    } catch (failure: Throwable) {
        runCatching { delete(created) }
        record.delete()
        throw failure
    }
    record.delete()
}

/** At start: an export [record] left by a death mid-write deletes its document, then itself; "deleted", "gone", or null (no record). */
internal fun cleanupExportRecord(record: File, delete: (String) -> Boolean): String? {
    if (!record.isFile) return null
    val outcome = runCatching { if (delete(JSONObject(record.readText()).getString("uri"))) "deleted" else "gone" }.getOrElse { "gone" }
    record.delete()
    return outcome
}

/** A picked file, or it with the library, over the measured transfer limit (design §4.1). */
internal class TransferTooLarge : IOException("The selected file is too large")

/** [input] into [file], synced; refuses once it passes [limit] bytes (the caller deletes [file]). */
internal fun copyBounded(input: InputStream, file: File, limit: Long) {
    var total = 0L
    FileOutputStream(file).use { out ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > limit) throw TransferTooLarge()
            out.write(buffer, 0, read)
        }
        out.fd.sync()
    }
}

/** [file]'s text as strict UTF-8 (iOS refuses invalid bytes too); null when it is not. */
internal fun utf8(file: File): String? = try {
    Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(file.readBytes())).toString()
} catch (_: CharacterCodingException) { null }
