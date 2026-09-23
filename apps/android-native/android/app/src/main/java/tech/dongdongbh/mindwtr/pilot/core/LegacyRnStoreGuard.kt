package tech.dongdongbh.mindwtr.pilot.core

import android.util.Log
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import java.io.File

/**
 * Decides whether this build may open the React Native app's database,
 * before anything opens it. It refuses when:
 *
 * - the database is missing although RN left other state: opening the path
 *   would create an empty database and show a blank Inbox;
 * - RN set the AsyncStorage marker [MARKER]: a save reached only its JSON
 *   backup (#964), and this build cannot import that backup yet;
 * - AsyncStorage or the database cannot be read, or the database fails
 *   `quick_check`.
 *
 * It never opens the originals with SQLite. Even a read-only connection writes
 * beside a WAL database: it creates `-wal` and `-shm` when they are missing and
 * updates read marks in `-shm`. A read-write connection that fails a check can
 * also checkpoint the WAL into the file when it closes. So the guard copies the
 * bytes and queries the copy.
 *
 * It assumes no concurrent writer. Replacing the package kills the RN process,
 * and this process owns exactly one host, so the files cannot change while the
 * guard copies them.
 */
internal object LegacyRnStoreGuard {
    private const val MARKER = "mindwtr-data:json-ahead-of-sqlite"
    /** androidx profileinstaller writes these into any app's files/; they are not RN state. */
    private val PLATFORM_FILES = setOf("profileInstalled", "profileinstaller_profileWrittenFor_lastUpdateTime.dat")
    private val MESSAGES = mapOf(
        "database-missing" to "The previous app version's database is missing, so this build will not start an empty one",
        "json-ahead" to "Unsaved changes from the previous app version need an import this build cannot do yet",
        "async-storage-unreadable" to "Cannot read the previous app version's saved state",
        "database-unreadable" to "The previous app version's database failed its integrity check",
    )

    /** Returns the RN database to open, or throws before anything has opened it. */
    fun requireClear(dataDir: File, scratch: File): File {
        val database = File(dataDir, "files/SQLite/mindwtr.db")
        val asyncStorage = File(dataDir, "databases/RKStorage")
        val blocked = blockedReason(dataDir, database, asyncStorage, scratch)
        Log.i(CoreHost.TAG, "Native Android legacy store guard releaseCheck=v1.3.3/native-android-legacy-json-ahead-guard " +
            "outcome=${if (blocked == null) "clear" else "blocked"}${blocked?.let { " reason=$it" } ?: ""}")
        check(blocked == null) { MESSAGES.getValue(blocked!!) }
        // Only a fresh install gets here without the file. SQLite creates the file, not its folder.
        database.parentFile!!.mkdirs()
        return database
    }

    private fun blockedReason(dataDir: File, database: File, asyncStorage: File, scratch: File): String? {
        if (!database.exists()) return if (hasRnState(dataDir, asyncStorage)) "database-missing" else null
        if (asyncStorage.exists()) {
            val marker = runCatching {
                // A copy without the RN table fails here and counts as unreadable.
                queryCopy(asyncStorage, scratch) { copy ->
                    copy.prepare("SELECT 1 FROM catalystLocalStorage WHERE key = ?").use { statement ->
                        statement.bindText(1, MARKER)
                        statement.step()
                    }
                }
            }
            if (marker.isFailure) return "async-storage-unreadable"
            if (marker.getOrThrow()) return "json-ahead"
        }
        // ponytail: copies the whole database on every boot. Skip it once a native-owned
        // marker proves the last shutdown was clean.
        val intact = runCatching {
            queryCopy(database, scratch) { copy ->
                copy.prepare("PRAGMA quick_check").use { it.step() && it.getText(0) == "ok" && !it.step() }
            }
        }
        return if (intact.getOrDefault(false)) null else "database-unreadable"
    }

    private fun hasRnState(dataDir: File, asyncStorage: File): Boolean =
        asyncStorage.exists() ||
            File(dataDir, "files").walk().any { it.isFile && it.name !in PLATFORM_FILES } ||
            File(dataDir, "shared_prefs").walk().any { it.isFile }

    /** Runs [query] on a byte copy of [file] with its `-wal` and `-journal`, then deletes the copy. */
    private fun <T> queryCopy(file: File, scratch: File, query: (SQLiteConnection) -> T): T {
        scratch.deleteRecursively()
        check(scratch.mkdirs()) { "Cannot create the guard's scratch folder" }
        try {
            // A committed row can live only in -wal, and a hot -journal must roll back: copy both.
            for (suffix in listOf("", "-wal", "-journal")) {
                val source = File(file.path + suffix)
                if (source.exists()) source.copyTo(File(scratch, file.name + suffix))
            }
            return BundledSQLiteDriver().open(File(scratch, file.name).path).use(query)
        } finally {
            scratch.deleteRecursively()
        }
    }
}
