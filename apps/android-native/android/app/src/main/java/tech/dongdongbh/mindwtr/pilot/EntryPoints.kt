package tech.dongdongbh.mindwtr.pilot

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import java.io.File

/*
 * RN's system entry points (app/+native-intent.ts and hooks/root-layout/use-root-layout-external-capture.ts, with the share
 * and assistant intents of app.json and plugins/android-app-shortcuts.js): a link of the app's scheme, a text share, and an
 * assistant note. Kotlin reads only the intent's data and text extras; core's resolveNativeEntryPoint
 * (native-host-contract-entry-points.ts) says where the entry goes, and this opens what core names.
 */

/** Google Assistant's note action and its extras, as RN's MainActivity reads them (plugins/android-startup-trace.js). */
private const val CREATE_NOTE = "com.google.android.gms.actions.CREATE_NOTE"
private const val NOTE_NAME = "com.google.android.gms.actions.extra.NAME"
private const val NOTE_TEXT = "com.google.android.gms.actions.extra.TEXT"

/** A text file core can import is at most its 100,000 characters; four bytes each is the most UTF-8 can take. */
private const val IMPORT_BYTES = 400_004

/** The Menu screens a route opens by core's tile id (MenuModel.openTile). */
private val TILE_ROUTES = setOf("review", "calendar", "contexts", "board", "trash", "history", "settings")

/**
 * The intent as core's entry point input, or null for any other launch (the launcher's). Only strings are read, as
 * expo-share-intent reads a text share (EXTRA_TEXT as a string; EXTRA_TITLE's text, and EXTRA_SUBJECT, which core uses
 * when the title is missing), and a share of any other type is no share. An extra another app broke reads as no entry;
 * the input is untrusted, and core checks it again.
 */
fun Intent.entryInput(): JSONObject? = runCatching {
    fun JSONObject.extra(name: String, value: String?) = put(name, value ?: JSONObject.NULL)
    when (action) {
        Intent.ACTION_VIEW -> dataString?.let { JSONObject().put("kind", "link").put("url", it).put("scheme", BuildConfig.URL_SCHEME) }
        Intent.ACTION_SEND -> if (type?.startsWith("text/plain") != true) null else JSONObject().put("kind", "share")
            .extra("text", getStringExtra(Intent.EXTRA_TEXT)).extra("title", getCharSequenceExtra(Intent.EXTRA_TITLE)?.toString())
            .extra("subject", getStringExtra(Intent.EXTRA_SUBJECT))
        CREATE_NOTE -> JSONObject().put("kind", "createNote").extra("name", getStringExtra(NOTE_NAME))
            .extra("text", getStringExtra(NOTE_TEXT)).extra("extraText", getStringExtra(Intent.EXTRA_TEXT))
        else -> null
    }
}.getOrNull()

/**
 * The picked file's text for core's Import .txt, as UTF-8 (expo-file-system's default), or null when it cannot be read or
 * is longer than core takes. Runs off the main thread.
 */
fun Context.readPickedText(uri: Uri): String? = runCatching {
    contentResolver.openInputStream(uri)?.use { input ->
        val bytes = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8_192)
        while (bytes.size() < IMPORT_BYTES) {
            val read = input.read(buffer)
            if (read < 0) break
            bytes.write(buffer, 0, read)
        }
        if (bytes.size() >= IMPORT_BYTES) null else bytes.toString(Charsets.UTF_8.name())
    }
}.getOrNull()

/**
 * The entries waiting to open, oldest first ([EntryQueue], on disk from the intent's arrival, so a process death or a
 * force-stop keeps them). The oldest opens once no command runs or is owed and nothing the user is working in covers the
 * screen (the editor, Process Inbox, Mind Sweep, a capture's save): their work stays, and the entry opens when they end.
 */
class EntryRouter(private val shell: InboxViewModel, dir: File) {
    private val queue = EntryQueue(dir)
    /** The oldest waiting entry's id: MainActivity pumps again when it changes. */
    var head by mutableStateOf(queue.head()?.id); private set
    /** The entry core is reading: one at a time. */
    private var opening: String? = null

    /** A new intent's entry (a launch without saved state, or onNewIntent), last in the queue. */
    fun receive(intent: Intent) {
        val input = intent.entryInput() ?: return
        if (!queue.add(input.toString())) Log.w(CoreHost.TAG, "Native Android entry point dropped: the queue is full")
        head = queue.head()?.id
    }

    /** Something keeps the entry from opening now: the app is not ready, a command runs or is owed, or the user's work covers the screen. */
    val blocked: Boolean get() = with(shell) {
        !writable || busy || failedAction != null || editor != null || processing?.hidden == false || capture?.pending != null
            || menu.screen == MenuScreen.MindSweep
    }

    /** Reads the oldest entry once the app is free, then opens it once no action runs; MainActivity calls it whenever that may change. */
    fun pump(): Unit = with(shell) {
        val entry = queue.head() ?: return
        if (opening != null || blocked) return
        opening = entry.id
        perform { runtime ->
            try {
                val reply = runtime.menuRead("entryPoint", entry.input)
                check(reply.getInt("version") == 1) { "Unsupported core contract" }
                // A capture opens RN's popup: core rebuilds its known tokens (openQuickCapture), then reads the entry's draft.
                val view = reply.optJSONObject("capture")?.let { open ->
                    runtime.openQuickCapture()
                    runtime.quickCaptureView(JSONObject().put("text", open.getString("text")).put("options", open.getJSONObject("options")).toString())
                }
                ui { menu.whenIdle { open(reply, view) } }
            } finally {
                ui {
                    opening = null
                    queue.remove(entry.id)
                    head = queue.head()?.id
                }
            }
        }
    }

    /** Core's answer: its toast, its route (with the task or project it names), then its capture popup over the tabs. */
    private fun open(reply: JSONObject, view: JSONObject?): Unit = with(shell) {
        reply.optJSONObject("notice")?.let { showToast(it.getString("title"), it.getString("message"), it.getString("tone")) }
        reply.menuText("route")?.let { go(it, reply) }
        val capture = reply.optJSONObject("capture") ?: return
        // RN's capture screen replaces the screen it opens over; this popup shows over the tabs.
        closeSearch()
        menu.toTabs()
        view?.let { openedCapture(it, capture.getString("text"), capture.getBoolean("returnToPreviousApp")) }
    }

    /**
     * Opens RN's route [route] as this app has it: a tab, a Menu screen (a list, or a tile's screen), the Projects screen
     * with core's project, Focus with core's task in the editor (outlined on its row, as RN's setHighlightTask), or the global
     * search with core's query. A route this app has no screen for opens the Inbox.
     */
    private fun go(route: String, reply: JSONObject): Unit = with(shell) {
        if (route != "/global-search") closeSearch()
        menu.closeSheet()
        val name = route.removePrefix("/")
        when {
            // The project core names, or the list (an area's link): a project left open there closes.
            route == "/projects" || route == "/projects-screen" -> reply.menuText("projectId").let { id ->
                if (id == null) closeProject()
                openFromSearch(Screen.Projects, id)
            }
            route == "/global-search" -> reply.getJSONObject("search").let { search ->
                openSearch(SearchState(search.getString("query"), search.optJSONObject("filters")))
            }
            route == "/focus" -> {
                menu.toTabs()
                show(Screen.Focus)
                reply.menuText("taskId")?.let { id -> highlight(id); menu.whenIdle { openEditor(id, "view") } }
            }
            // RN's quick-access tab routes: the tab while it holds that view, else its Menu screen.
            name.endsWith("-tab") && name.removeSuffix("-tab") in TILE_ROUTES -> name.removeSuffix("-tab").let { view ->
                if (menu.quickView == view) { menu.toTabs(); show(Screen.Projects) } else menu.openTile(view)
            }
            name in TILE_ROUTES -> menu.openTile(name)
            menu.openRoute(route) -> Unit
            else -> { menu.toTabs(); show(Screen.Inbox) }
        }
    }
}
