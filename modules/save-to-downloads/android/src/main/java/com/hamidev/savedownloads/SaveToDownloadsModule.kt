package com.hamidev.savedownloads

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

class SaveToDownloadsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SaveToDownloads")

    AsyncFunction("saveToDownloads") { sourceUri: String, fileName: String, mimeType: String? ->
      saveToDownloads(sourceUri, fileName, mimeType)
    }
  }

  /**
   * Copy an app-internal media file into the device's public Downloads
   * folder (the "Downloads / Media Files" app-section on Android).
   *
   * - Android 10+ (API 29+): MediaStore.Downloads insert with IS_PENDING, no
   *   storage permission required. COLLECT_FOR_ANY images/others not needed.
   * - Android 5–9 (API 21–28): direct write to
   *   Environment.getExternalStoragePublicDirectory(DIRECTORY_DOWNLOADS).
   *   Requires the WRITE_EXTERNAL_STORAGE runtime permission (requested from
   *   JS when Platform.OS === 'android' && Platform.Version < 29).
   *
   * Returns { displayName, uri } where uri is either the `content://` MediaStore
   * uri or the absolute file path for legacy devices.
   */
  private fun saveToDownloads(sourceUri: String, fileName: String, mimeType: String?): Map<String, String> {
    val context: Context = appContext.reactContext ?: throw CodedException("Could not access application context")
    val safeName = sanitizeFileName(fileName.ifBlank { "document" })
    val displayName = uniqueName(context, safeName)

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      saveViaMediaStore(context, sourceUri, displayName, mimeType)
    } else {
      saveViaPublicDirectory(context, sourceUri, displayName)
    }
  }

  private fun saveViaMediaStore(context: Context, sourceUri: String, displayName: String, mimeType: String?): Map<String, String> {
    val values = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, displayName)
      if (!mimeType.isNullOrBlank()) {
        put(MediaStore.Downloads.MIME_TYPE, mimeType)
      }
      put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
      put(MediaStore.Downloads.IS_PENDING, 1)
    }

    val resolver = context.contentResolver
    val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
    try {
      val uri = resolver.insert(collection, values)
          ?: throw CodedException("Could not create a Downloads entry for $displayName")
      val input = openInput(context, sourceUri)
      try {
        resolver.openOutputStream(uri)?.use { output ->
          input.copyTo(output)
        } ?: throw CodedException("Could not open output stream for $displayName")
      } finally {
        try {
          input.close()
        } catch (_: Exception) {
          // Best-effort close
        }
      }
      values.clear()
      values.put(MediaStore.Downloads.IS_PENDING, 0)
      resolver.update(uri, values, null, null)
      return mapOf("displayName" to displayName, "uri" to uri.toString())
    } catch (e: CodedException) {
      throw e
    } catch (e: Exception) {
      throw CodedException("Failed to save $displayName to Downloads: ${e.message}", e)
    }
  }

  @Suppress("DEPRECATION")
  private fun saveViaPublicDirectory(context: Context, sourceUri: String, displayName: String): Map<String, String> {
    val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    if (!downloadsDir.exists() && !downloadsDir.mkdirs()) {
      throw CodedException("Could not access the Downloads directory")
    }
    val destination = File(downloadsDir, displayName)
    try {
      val input = openInput(context, sourceUri)
      try {
        FileOutputStream(destination).use { output ->
          input.copyTo(output)
        }
      } finally {
        try {
          input.close()
        } catch (_: Exception) {
          // Best-effort close
        }
      }
      return mapOf("displayName" to displayName, "uri" to destination.absolutePath)
    } catch (e: CodedException) {
      throw e
    } catch (e: Exception) {
      throw CodedException("Failed to save $displayName to Downloads: ${e.message}", e)
    }
  }

  private fun openInput(context: Context, sourceUri: String): java.io.InputStream {
    val uri = Uri.parse(sourceUri)
    return when (uri.scheme) {
      "content" -> context.contentResolver.openInputStream(uri)
          ?: throw CodedException("Could not open the source file")
      "file", null -> {
        val path = uri.path
        val file = if (path != null) File(path) else File(sourceUri)
        if (!file.exists()) throw CodedException("Source file does not exist: $sourceUri")
        file.inputStream()
      }
      else -> throw CodedException("Unsupported source URI scheme: ${uri.scheme}")
    }
  }

  private fun sanitizeFileName(name: String): String {
    val cleaned = name.replace(Regex("[/\\\\:*?\"<>|]"), "_").replace(Regex("[\\s]+"), " ").trim()
    return cleaned.ifBlank { "document" }
  }

  /**
   * Avoid colliding with an existing file: `report.pdf` → `report (1).pdf`,
   * `report (2).pdf`, ... matching what the system Downloads UI shows.
   */
  private fun uniqueName(context: Context, fileName: String): String {
    val dot = fileName.lastIndexOf('.')
    val base = if (dot > 0) fileName.substring(0, dot) else fileName
    val ext = if (dot > 0) fileName.substring(dot) else ""

    val taken = existingDownloadNames(context)
    if (fileName !in taken) return fileName

    var index = 1
    while ("$base ($index)$ext" in taken) {
      index++
    }
    return "$base ($index)$ext"
  }

  @Suppress("DEPRECATION")
  private fun existingDownloadNames(context: Context): Set<String> {
    val names = mutableSetOf<String>()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val projection = arrayOf(MediaStore.Downloads.DISPLAY_NAME, MediaStore.Downloads.IS_PENDING)
        val cursor = context.contentResolver.query(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            projection,
            null,
            null,
            null
        )
        cursor?.use {
          val nameCol = it.getColumnIndexOrThrow(MediaStore.Downloads.DISPLAY_NAME)
          while (it.moveToNext()) {
            names.add(it.getString(nameCol))
          }
        }
      } else {
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        dir.listFiles()?.forEach { names.add(it.name) }
      }
    } catch (_: Exception) {
      // Falling back to no dedupe is acceptable; do not block the save.
    }
    return names
  }
}