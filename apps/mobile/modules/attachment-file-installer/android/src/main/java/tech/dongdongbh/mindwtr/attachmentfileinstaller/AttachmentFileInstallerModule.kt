package tech.dongdongbh.mindwtr.attachmentfileinstaller

import android.content.Context
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

private class AttachmentFileInstallerException(message: String, cause: Throwable? = null) :
  CodedException("ATTACHMENT_FILE_INSTALLER_FAILED: $message", cause)

class AttachmentFileInstallerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AttachmentFileInstaller")

    AsyncFunction("installAsync") {
        stagedPath: String,
        targetPath: String,
        expected: Map<String, String>,
        expectedDownloadSha256: String,
      ->
      try {
        val filesRoot = context.filesDir.canonicalFile
        val cacheRoot = context.cacheDir.canonicalFile
        val fileOps = AndroidAttachmentInstallerFileOps()
        val installer = AttachmentFileInstallerCore(
          targetRoot = File(filesRoot, "attachments"),
          sourceRoots = listOf(filesRoot, cacheRoot),
          ops = fileOps,
        )
        val outcome = installer.install(
          stagedInput = fileFromPath(stagedPath),
          targetInput = fileFromPath(targetPath),
          expected = parseExpected(expected),
          expectedDownloadSha256 = parseSha256(expectedDownloadSha256, "Expected download"),
        )
        when (outcome) {
          is AttachmentInstallOutcome.Installed -> buildMap {
            put("status", "installed")
            if (fileOps.usedExclusiveCopyFallback) put("publication", "exclusive-copy")
            outcome.preservedFile?.let { put("preservedPath", Uri.fromFile(it).toString()) }
          }
          is AttachmentInstallOutcome.Conflict -> buildMap {
            put("status", "conflict")
            put("preservedPath", Uri.fromFile(outcome.preservedFile).toString())
          }
        }
      } catch (error: AttachmentFileInstallerException) {
        throw error
      } catch (error: Throwable) {
        throw AttachmentFileInstallerException(error.message ?: "Attachment install failed", error)
      }
    }

    AsyncFunction("publishImmutableAsync") {
        stagedPath: String,
        targetPath: String,
        expectedStagedSha256: String,
        expectedStagedIdentity: String,
        expectedDirectoryIdentity: String,
        expectedPrivateDirectoryIdentity: String,
      ->
      try {
        val staged = fileFromPath(stagedPath).absoluteFile
        val target = fileFromPath(targetPath).absoluteFile
        val targetRoot = target.parentFile
          ?: throw AttachmentFileInstallerException("Target attachment parent is unavailable")
        val stagedRoot = staged.parentFile
          ?: throw AttachmentFileInstallerException("Staged attachment parent is unavailable")
        if (stagedRoot.parentFile?.canonicalFile != targetRoot.canonicalFile) {
          throw AttachmentFileInstallerException(
            "Immutable attachment stage must use a private child of the target directory",
          )
        }
        val outcome = ImmutableAttachmentFilePublisherCore(
          targetRoot = targetRoot,
          ops = AndroidAttachmentInstallerFileOps(),
        ).publish(
          staged,
          target,
          parseSha256(expectedStagedSha256, "Expected staged attachment"),
          expectedStagedIdentity,
          expectedDirectoryIdentity,
          expectedPrivateDirectoryIdentity,
        )
        when (outcome) {
          ImmutableAttachmentPublishOutcome.PUBLISHED -> mapOf("status" to "published")
          ImmutableAttachmentPublishOutcome.ALREADY_EXISTS -> mapOf("status" to "alreadyExists")
        }
      } catch (error: AttachmentFileInstallerException) {
        throw error
      } catch (error: Throwable) {
        throw AttachmentFileInstallerException(
          error.message ?: "Immutable attachment publication failed",
          error,
        )
      }
    }

    AsyncFunction("prepareImmutableStageAsync") { targetPath: String, operationId: String ->
      try {
        val target = fileFromPath(targetPath).absoluteFile
        val targetRoot = target.parentFile
          ?: throw AttachmentFileInstallerException("Target attachment parent is unavailable")
        val prepared = ImmutableAttachmentStageRecoveryCore(
          targetRoot,
          AndroidAttachmentInstallerFileOps(),
        ).prepare(target, operationId)
        mapOf(
          "stagedPath" to Uri.fromFile(prepared.stagedPath).toString(),
          "stagedIdentity" to prepared.stagedIdentity,
          "directoryIdentity" to prepared.directoryIdentity,
          "privateDirectoryIdentity" to prepared.privateDirectoryIdentity,
        )
      } catch (error: Throwable) {
        throw AttachmentFileInstallerException(error.message ?: "Attachment stage preparation failed", error)
      }
    }

    AsyncFunction("snapshotImmutableStageAsync") {
        stagedPath: String,
        targetPath: String,
        expectedStagedSha256: String,
      ->
      try {
        val staged = fileFromPath(stagedPath).absoluteFile
        val target = fileFromPath(targetPath).absoluteFile
        val targetRoot = target.parentFile
          ?: throw AttachmentFileInstallerException("Target attachment parent is unavailable")
        val identity = ImmutableAttachmentStageRecoveryCore(
          targetRoot,
          AndroidAttachmentInstallerFileOps(),
        ).snapshot(staged, target, parseSha256(expectedStagedSha256, "Expected staged attachment"))
        mapOf(
          "stagedIdentity" to identity.stagedIdentity,
          "directoryIdentity" to identity.directoryIdentity,
        )
      } catch (error: Throwable) {
        throw AttachmentFileInstallerException(error.message ?: "Attachment stage snapshot failed", error)
      }
    }

    AsyncFunction("cleanupImmutableStageAsync") {
        stagedPath: String,
        targetPath: String,
        operationId: String,
        expectedStagedSha256: String?,
        expectedStagedIdentity: String?,
        expectedDirectoryIdentity: String?,
        expectedPrivateDirectoryIdentity: String?,
      ->
      try {
        val staged = fileFromPath(stagedPath).absoluteFile
        val target = fileFromPath(targetPath).absoluteFile
        val targetRoot = target.parentFile
          ?: throw AttachmentFileInstallerException("Target attachment parent is unavailable")
        val outcome = ImmutableAttachmentStageRecoveryCore(
          targetRoot,
          AndroidAttachmentInstallerFileOps(),
        ).cleanup(
          staged,
          target,
          operationId,
          expectedStagedSha256,
          expectedStagedIdentity,
          expectedDirectoryIdentity,
          expectedPrivateDirectoryIdentity,
        )
        mapOf("status" to when (outcome) {
          ImmutableAttachmentStageCleanupOutcome.REMOVED -> "removed"
          ImmutableAttachmentStageCleanupOutcome.MISSING -> "missing"
          ImmutableAttachmentStageCleanupOutcome.CONFLICT -> "conflict"
        })
      } catch (error: Throwable) {
        throw AttachmentFileInstallerException(error.message ?: "Attachment stage cleanup failed", error)
      }
    }

    AsyncFunction("hashAsync") { targetPath: String ->
      try {
        val filesRoot = context.filesDir.canonicalFile
        val ops = AndroidAttachmentInstallerFileOps()
        val snapshot = AttachmentFileHasherCore(
          targetRoot = File(filesRoot, "attachments"),
          ops = ops,
        ).hash(fileFromPath(targetPath))
        mapOf(
          "sha256" to snapshot.sha256,
          "size" to snapshot.size.toDouble(),
          "modificationTimeMs" to snapshot.modificationTimeMs,
        )
      } catch (error: AttachmentFileInstallerException) {
        throw error
      } catch (error: Throwable) {
        throw AttachmentFileInstallerException(error.message ?: "Attachment hash failed", error)
      }
    }
  }

  private fun fileFromPath(value: String): File {
    if (value.isBlank()) throw AttachmentFileInstallerException("Attachment path is required")
    val uri = Uri.parse(value)
    return when (uri.scheme?.lowercase()) {
      null, "" -> File(value)
      "file" -> File(uri.path ?: throw AttachmentFileInstallerException("Invalid file URI"))
      else -> throw AttachmentFileInstallerException("Only app-private file paths are supported")
    }
  }

  private fun parseExpected(value: Map<String, String>): ExpectedAttachmentGeneration {
    return when (value["kind"]) {
      "absent" -> ExpectedAttachmentGeneration.Absent
      "present" -> {
        val digest = parseSha256(value["sha256"].orEmpty(), "Expected attachment")
        ExpectedAttachmentGeneration.Present(digest)
      }
      else -> throw AttachmentFileInstallerException("Expected attachment generation is invalid")
    }
  }

  private fun parseSha256(value: String, label: String): String {
    val digest = value.trim().lowercase()
    if (!SHA256_HEX_PATTERN.matches(digest)) {
      throw AttachmentFileInstallerException("$label SHA-256 is invalid")
    }
    return digest
  }
}
