package tech.dongdongbh.mindwtr.pilot

import android.content.Intent
import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import kotlinx.coroutines.delay
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import java.util.UUID
import java.util.concurrent.Executors

/*
 * RN's Settings › Sync (sync-settings-screen.tsx in sync mode, its backend panels, sync-settings-sections.tsx and the encryption
 * card) on core's contract (native-host-contract-settings-sync.ts). Kotlin keeps only what RN keeps in React state for one visit:
 * the form as typed, the passphrase fields, which folds are open, and the command running. Every word, check, enabled state,
 * toast and write is core's.
 */

/**
 * Settings › Sync's screen commands (host-entry.ts MENU_COMMANDS). CoreHost.syncCommand sends them without holding the engine,
 * and never journals them (WriteJournal.UNJOURNALED; several carry a password).
 */
val SYNC_COMMANDS = setOf("openSyncSettings", "closeSyncSettings", "selectSyncBackend", "saveSyncBackend", "syncNow", "testSyncConnection",
    "pickSyncFolder", "connectDropbox", "disconnectDropbox", "runSyncEncryptionAction")

/**
 * The WebDAV or self-hosted form as typed (RN's panel state). A null [password] or [token] was not edited: the field shows core's
 * dots and the stored one is kept.
 */
data class SyncForm(val kind: String, val url: String, val username: String, val password: String?, val token: String?, val insecure: Boolean)

class SyncSettingsModel(private val menu: MenuModel) {
    private val shell get() = menu.shell
    private val settings get() = menu.settings
    /** One command at a time, in the order sent: a passphrase field's typed text never overtakes an earlier tap. */
    private val commands = Executors.newSingleThreadExecutor { task -> Thread(task, "mindwtr-sync-screen") }

    /** openSyncSettings ran for this visit: RN reads the stored configuration once, when the screen mounts. */
    @Volatile private var opened = false
    var form by mutableStateOf<SyncForm?>(null); private set
    /** The encryption card's passphrase fields as typed (current, next, confirm); core holds their text too. */
    var fields by mutableStateOf(emptyMap<String, String>()); private set
    var historyOpen by mutableStateOf(false); private set
    var preferencesOpen by mutableStateOf(false); private set
    var snapshotsOpen by mutableStateOf(false); private set
    /** The command running now; core's view shows each control's own spinner. */
    var running by mutableStateOf<String?>(null); private set
    /** The panel the form last followed (RN's form takes a stored value again whenever it changes). */
    private var followed: JSONObject? = null
    private var typed = 0

    /** Settings' read of this screen: it opens once per visit (its toasts shown), then core's view for the form's typed text. */
    fun read(runtime: CoreHost): JSONObject {
        // One open per visit: a refresh and a reload can read at once, and a second open would replace the first.
        synchronized(this) {
            if (!opened) {
                val reply = runtime.syncCommand("openSyncSettings", "{}")
                opened = true
                shell.ui { toasts(reply) }
            }
        }
        return runtime.menuRead("syncSettings", JSONObject().put("draft", draft()).toString())
    }

    /** The form's typed URL and token (null: not edited), which core's checks follow. */
    private fun draft(): JSONObject = form?.let { typed ->
        JSONObject().put("url", typed.url).apply { if (typed.kind == "selfhosted") put("token", typed.token ?: JSONObject.NULL) }
    } ?: JSONObject()

    /** RN's form effects for core's new view: a form mounts with the stored values and takes each again when it changes. Main thread. */
    fun follow(view: JSONObject) {
        val panel = view.optJSONObject("panel")
        val kind = panel?.optString("kind")
        val prior = followed
        followed = panel
        if (panel == null || (kind != "webdav" && kind != "selfhosted")) { form = null; return }
        val stored = SyncForm(kind, panel.getJSONObject("url").getString("value"),
            if (kind == "webdav") panel.getJSONObject("username").getString("value") else "", null, null,
            panel.getJSONObject("allowInsecureHttp").getBoolean("value"))
        val current = form
        if (current == null || current.kind != kind || prior?.optString("kind") != kind) { form = stored; return }
        var next = current
        if (stored.url != prior.getJSONObject("url").getString("value")) next = next.copy(url = stored.url)
        if (stored.insecure != prior.getJSONObject("allowInsecureHttp").getBoolean("value")) next = next.copy(insecure = stored.insecure)
        if (kind == "webdav") {
            if (stored.username != prior.getJSONObject("username").getString("value")) next = next.copy(username = stored.username)
            if (panel.getJSONObject("password").getString("mask") != prior.getJSONObject("password").getString("mask")) next = next.copy(password = null)
        } else if (panel.getJSONObject("token").getString("mask") != prior.getJSONObject("token").getString("mask")) next = next.copy(token = null)
        form = next
    }

    /** A field of the form as typed; core's view is read again for it once typing pauses. */
    fun edit(change: SyncForm.() -> SyncForm) {
        form = form?.change() ?: return
        val mine = ++typed
        shell.ui { if (mine == typed) settings.refresh() }
    }

    /** RN's secure field starts with the stored secret; here it starts with core's dots, so the first keystroke starts it over. */
    fun secret(masked: String?, mask: String, text: String): String = if (masked != null) text else text.removePrefix(mask)

    fun toggleHistory() { historyOpen = !historyOpen }
    fun togglePreferences() { preferencesOpen = !preferencesOpen }
    fun toggleSnapshots() { snapshotsOpen = !snapshotsOpen }

    /** Leaving the screen (RN unmounts it): core drops a backend chosen but not proven, and the next visit opens afresh. */
    fun leave() {
        if (!opened && form == null) return
        opened = false
        form = null
        followed = null
        fields = emptyMap()
        historyOpen = false
        preferencesOpen = false
        snapshotsOpen = false
        val runtime = shell.coreHost() ?: return
        commands.execute { runCatching { runtime.syncCommand("closeSyncSettings", "{}") }.onFailure { Log.w(CoreHost.TAG, "Sync screen close failed", it) } }
    }

    // ---- Commands: each tap sends core's command with a new request UUID ----

    /** A backend chip (core's option): a complete target activates through its first sync. */
    fun select(option: String) = run("selectSyncBackend", JSONObject().put("requestId", uuid()).put("option", option))

    /** The form's Save: core proves the settings with a sync, then stores them. [revision] is the view's configRevision. */
    fun save(view: JSONObject) = formFields()?.let { (name, fields) ->
        run("saveSyncBackend", JSONObject().put("requestId", uuid()).put("revision", view.getString("configRevision")).put(name, fields))
    }

    /** The panel's Sync now; the WebDAV and self-hosted forms sync what they hold, as RN's do. */
    fun syncNow(view: JSONObject) {
        val input = JSONObject().put("requestId", uuid())
        formFields()?.let { (name, fields) -> input.put("revision", view.getString("configRevision")).put(name, fields) }
        run("syncNow", input)
    }

    /** The panel's Test connection (Dropbox sends no fields). */
    fun test() = run("testSyncConnection", formFields()?.let { (name, fields) -> JSONObject().put(name, fields) } ?: JSONObject())

    fun pickFolder() = run("pickSyncFolder", JSONObject().put("requestId", uuid()))

    fun dropbox(connected: Boolean) = run(if (connected) "disconnectDropbox" else "connectDropbox", JSONObject().put("requestId", uuid()))

    /** A settings sync option: a synced setting, so it goes through the Menu tab's journaled command path. */
    fun preference(key: String, value: Boolean) = menu.command("syncPreference", JSONObject().put("key", key).put("value", value))

    /** The encryption card: core's action; a submit or decline takes a request UUID, and Generate fills both new fields. */
    fun encryption(action: JSONObject) {
        val type = action.getString("type")
        val input = JSONObject().put("action", action).apply { if (type == "submit" || type == "decline") put("requestId", uuid()) }
        run("runSyncEncryptionAction", input, light = type != "submit" && type != "decline") { reply ->
            reply.menuText("passphrase")?.let { phrase -> fields = fields + mapOf("next" to phrase, "confirm" to phrase) }
            if (type == "cancel" || type == "submit" || type == "decline") fields = emptyMap()
        }
    }

    /** A passphrase field as typed; core keeps its copy (`typed`), which also clears the card's error. */
    fun typePassphrase(field: String, text: String) {
        fields = fields + (field to text)
        run("runSyncEncryptionAction", JSONObject().put("action", JSONObject().put("type", "typed").put("field", field).put("value", text)), light = true)
    }

    /** The form's fields as core takes them: `webdav` or `selfHosted`, a password or token left null when not edited. */
    private fun formFields(): Pair<String, JSONObject>? {
        val typed = form ?: return null
        return if (typed.kind == "webdav") {
            "webdav" to JSONObject().put("url", typed.url).put("username", typed.username).put("password", typed.password ?: JSONObject.NULL)
                .put("allowInsecureHttp", typed.insecure)
        } else {
            "selfHosted" to JSONObject().put("url", typed.url).put("token", typed.token ?: JSONObject.NULL).put("allowInsecureHttp", typed.insecure)
        }
    }

    /**
     * Sends a screen command off the main thread, in order. A [light] one (a field's text, opening a flow) is not the command
     * running; the screen reads core's view again after each.
     */
    private fun run(name: String, input: JSONObject, light: Boolean = false, done: (JSONObject) -> Unit = {}) {
        if (!light) {
            if (running != null) return
            running = name
        }
        val runtime = shell.coreHost() ?: run { if (!light) running = null; return }
        commands.execute {
            val result = runCatching { runtime.syncCommand(name, input.toString()) }
            shell.ui {
                if (!light) running = null
                result.onSuccess { reply -> toasts(reply); done(reply) }
                result.exceptionOrNull()?.let { error ->
                    Log.w(CoreHost.TAG, "Sync screen command failed command=$name code=${error.message?.substringBefore(':')}")
                    val message = error.message.orEmpty()
                    shell.showToast(null, message.substringAfter(": "), if (message.startsWith("STALE_REVISION")) "warning" else "error")
                }
                settings.refresh()
            }
        }
    }

    /** Core's toasts for the command, RN's in order: the last one stays on screen, as RN's toast shows the newest. */
    private fun toasts(reply: JSONObject) {
        val toast = reply.menuObjects("toasts").lastOrNull() ?: return
        shell.showToast(toast.menuText("title")?.ifEmpty { null }, toast.getString("message"), toast.getString("tone"))
    }

    private fun uuid() = UUID.randomUUID().toString()
}

// ---- The screen ----

/** RN's Sync screen from core's view; while a command runs, the view is read again every half second (RN re-renders as it goes). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SyncSettings(model: InboxViewModel, view: JSONObject) {
    val sync = model.menu.settings.sync
    val c = LocalTheme.current.colors
    LaunchedEffect(sync.running) {
        while (sync.running != null) {
            delay(500)
            model.menu.settings.refresh()
        }
    }
    val backend = view.getJSONObject("backend")
    Card {
        Column(Modifier.padding(16.dp)) {
            Text(backend.getString("title"), style = rnText(16, 500, 21), color = c.text)
            Text(backend.getString("current"), style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 2.dp))
            Text(backend.getString("hint"), style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 10.dp))
            FlowRow(Modifier.padding(top = 10.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (option in backend.menuObjects("options")) BackendChip(sync, option, sync.running == null)
            }
            backend.optJSONObject("group")?.let { group ->
                Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(group.getString("title"), style = rnText(16, 500, 21), color = c.text)
                    Text(group.getString("description"), style = rnText(13, 400, 18), color = c.secondaryText)
                }
            }
        }
    }
    Spacer(Modifier.height(12.dp))
    GuideLink(view.getJSONObject("guide"), "sync-guide-link")
    view.optJSONObject("off")?.let { off -> HelpBox(off.getString("title"), listOf(off.getString("description"))) }
    view.optJSONObject("panel")?.let { panel ->
        when (panel.getString("kind")) {
            "webdav", "selfhosted" -> FormPanel(model, view, panel)
            "file" -> FilePanel(sync, view, panel)
            "dropbox" -> DropboxPanel(sync, view, panel)
            else -> CloudKitPanel(sync, view, panel)
        }
    }
    view.optJSONObject("encryption")?.let { EncryptionCard(sync, it) }
    PreferencesCard(model, view.getJSONObject("preferences"), view.getJSONObject("disclosure"))
    SnapshotsCard(sync, view.getJSONObject("recoverySnapshots"), view.getJSONObject("disclosure"))
}

/** RN's backendOption chip: the chosen one outlined in the tint on the filter wash. */
@Composable
private fun BackendChip(sync: SyncSettingsModel, option: JSONObject, enabled: Boolean) {
    val c = LocalTheme.current.colors
    val selected = option.getBoolean("selected")
    val label = option.getString("label")
    val shape = RoundedCornerShape(16.dp)
    Box(Modifier.clip(shape).background(if (selected) c.filterBg else Color.Transparent).border(1.dp, if (selected) c.tint else c.border, shape)
        .clearAndSetSemantics { contentDescription = label; role = Role.Button; this.selected = selected; testTag = "sync-backend-${option.getString("option")}"
            if (enabled) onClick { sync.select(option.getString("option")); true } else disabled() }
        .clickable(enabled = enabled) { sync.select(option.getString("option")) }.padding(horizontal = 10.dp, vertical = 6.dp)) {
        Text(label, style = rnText(13, 700, 17), color = if (selected) c.tint else c.secondaryText, maxLines = 2, textAlign = TextAlign.Center)
    }
}

/** RN's SettingsGuideLink: the title in the tint with lucide's external-link; it opens the guide in the browser. */
@Composable
private fun GuideLink(guide: JSONObject, tag: String) {
    val c = LocalTheme.current.colors
    val context = LocalContext.current
    val title = guide.getString("title")
    val spoken = "$title. ${guide.getString("description")}"
    val open = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, guide.getString("url").toUri())) } }
    Row(Modifier.padding(bottom = 12.dp).heightIn(min = 32.dp)
        .clearAndSetSemantics { contentDescription = spoken; role = Role.Button; testTag = tag; onClick { open(); true } }
        .clickable { open() }.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = rnText(13, 700), color = c.tint)
        Icon(Lucide.ExternalLink, null, tint = c.tint, modifier = Modifier.padding(start = 6.dp).size(15.dp))
    }
}

/** RN's helpBox: a bordered card with a 15/600 title and 13/20 lines. */
@Composable
private fun HelpBox(title: String, lines: List<String>) {
    val c = LocalTheme.current.colors
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.padding(bottom = 8.dp).fillMaxWidth().clip(shape).background(c.cardBg).border(1.dp, c.border, shape).padding(16.dp)) {
        Text(title, style = rnText(15, 600), color = c.text, modifier = Modifier.padding(bottom = 8.dp))
        lines.forEachIndexed { index, line ->
            Text(line, style = rnText(13, 400, 20), color = c.secondaryText, modifier = Modifier.padding(top = if (index > 0) 8.dp else 0.dp))
        }
    }
}

/** RN's pressable settingRow with a colored label, its description, and RN's small spinner while it runs. */
@Composable
private fun SyncAction(action: JSONObject, tag: String, divider: Boolean = true, press: () -> Unit) {
    val c = LocalTheme.current.colors
    val label = action.getString("label")
    val description = action.menuText("description")
    val enabled = action.getBoolean("enabled")
    val busy = action.getBoolean("busy")
    val spoken = if (description == null) label else "$label, $description"
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).then(if (divider) Modifier.hairline(c.border, top = true) else Modifier)
        .clearAndSetSemantics { contentDescription = spoken; role = Role.Button; testTag = tag; if (enabled) onClick { press(); true } else disabled() }
        .clickable(enabled = enabled, onClick = press).padding(16.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f).padding(end = 16.dp)) {
            Text(label, style = rnText(16, 500, 21), color = if (action.getBoolean("tinted")) c.tint else c.secondaryText)
            description?.let { Text(it, style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 2.dp)) }
        }
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = c.tint, strokeWidth = 2.dp)
    }
}

/** RN's textInput inside an inputGroup: a bordered field on the input color. */
@Composable
private fun SyncInput(value: String, label: String, placeholder: String?, secure: Boolean, tag: String, keyboard: KeyboardType, change: (String) -> Unit) {
    val c = LocalTheme.current.colors
    val shape = RoundedCornerShape(8.dp)
    BasicTextField(value, change, singleLine = true, cursorBrush = SolidColor(c.tint), textStyle = rnText(14, 400).copy(color = c.text),
        visualTransformation = if (secure) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, keyboardType = keyboard, imeAction = ImeAction.Done),
        modifier = Modifier.padding(top = 8.dp).fillMaxWidth().clip(shape).background(c.inputBg).border(1.dp, c.border, shape)
            .semantics { contentDescription = label }.testTag(tag),
        decorationBox = { inner ->
            Box(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                if (value.isEmpty() && placeholder != null) Text(placeholder, style = rnText(14, 400), color = c.secondaryText)
                inner()
            }
        })
}

/** RN's inputGroup: 16 around, a hairline above unless first. */
@Composable
private fun InputGroup(divider: Boolean, content: @Composable ColumnScope.() -> Unit) {
    val c = LocalTheme.current.colors
    Column(Modifier.fillMaxWidth().then(if (divider) Modifier.hairline(c.border, top = true) else Modifier).padding(16.dp), content = content)
}

/** The WebDAV and self-hosted forms (RN's SyncWebDavBackendPanel, SyncSelfHostedBackendPanel), with the last sync card below. */
@Composable
private fun FormPanel(model: InboxViewModel, view: JSONObject, panel: JSONObject) {
    val sync = model.menu.settings.sync
    val form = sync.form ?: return
    val c = LocalTheme.current.colors
    val theme = LocalTheme.current
    val webdav = panel.getString("kind") == "webdav"
    if (webdav) SectionTitle(panel.getString("title"), top = 16, color = c.text) else Spacer(Modifier.height(12.dp))
    Card {
        val url = panel.getJSONObject("url")
        InputGroup(divider = false) {
            Text(url.getString("label"), style = rnText(16, 500, 21), color = c.text)
            SyncInput(form.url, url.getString("label"), url.menuText("placeholder"), false, "sync-url", KeyboardType.Uri) { text -> sync.edit { copy(url = text) } }
            val hints = if (webdav) listOf(url.getString("hint")) else url.getJSONArray("hints").let { list -> List(list.length()) { list.getString(it) } }
            for (hint in hints) Text(hint, style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 2.dp))
            url.menuText("invalid")?.let { Text(it, style = rnText(13, 400, 18), color = c.danger, modifier = Modifier.padding(top = 2.dp)) }
        }
        val insecure = panel.getJSONObject("allowInsecureHttp")
        InputGroup(divider = true) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).padding(end = 16.dp)) {
                    Text(insecure.getString("label"), style = rnText(16, 500, 21), color = c.text)
                    Text(insecure.getString("hint"), style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 2.dp))
                }
                RnSwitch(form.insecure, true, insecure.getString("label"), theme.settingsSwitch) { sync.edit { copy(insecure = !this.insecure) } }
            }
        }
        if (webdav) {
            val username = panel.getJSONObject("username")
            InputGroup(divider = true) {
                Text(username.getString("label"), style = rnText(16, 500, 21), color = c.text)
                SyncInput(form.username, username.getString("label"), username.menuText("placeholder"), false, "sync-username", KeyboardType.Email) { text -> sync.edit { copy(username = text) } }
            }
            val password = panel.getJSONObject("password")
            val mask = password.getString("mask")
            InputGroup(divider = true) {
                Text(password.getString("label"), style = rnText(16, 500, 21), color = c.text)
                SyncInput(form.password ?: mask, password.getString("label"), password.getString("placeholder"), true, "sync-password", KeyboardType.Password) { text ->
                    sync.edit { copy(password = sync.secret(this.password, mask, text)) }
                }
            }
        } else {
            val token = panel.getJSONObject("token")
            val mask = token.getString("mask")
            InputGroup(divider = true) {
                Text(token.getString("label"), style = rnText(16, 500, 21), color = c.text)
                SyncInput(form.token ?: mask, token.getString("label"), token.getString("placeholder"), true, "sync-token", KeyboardType.Password) { text ->
                    sync.edit { copy(token = sync.secret(this.token, mask, text)) }
                }
                Text(token.getString("hint"), style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 2.dp))
                token.menuText("invalid")?.let { Text(it, style = rnText(13, 400, 18), color = c.danger, modifier = Modifier.padding(top = 2.dp)) }
            }
        }
        SyncAction(panel.getJSONObject("save"), "sync-save") { sync.save(view) }
        SyncAction(panel.getJSONObject("syncNow"), "sync-now") { sync.syncNow(view) }
        SyncAction(panel.getJSONObject("test"), "sync-test") { sync.test() }
    }
    LastSyncCard(sync, panel.getJSONObject("lastSync"), inside = false)
}

/** RN's File Sync panel: the how-to box, then the folder and Sync now, with the last sync card inside the card. */
@Composable
private fun FilePanel(sync: SyncSettingsModel, view: JSONObject, panel: JSONObject) {
    val c = LocalTheme.current.colors
    val help = panel.getJSONObject("help")
    HelpBox(help.getString("title"), listOf(help.getString("text"), help.getString("tip")))
    SectionTitle(panel.getString("title"), top = 16, color = c.text)
    Card {
        val folder = panel.getJSONObject("folder")
        val select = folder.getJSONObject("select")
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(16.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(end = 16.dp)) {
                Text(folder.getString("label"), style = rnText(16, 500, 21), color = c.text)
                Text(folder.getString("value"), style = rnText(13, 400, 18), color = c.secondaryText, maxLines = 1, modifier = Modifier.padding(top = 2.dp))
            }
            Text(select.getString("label"), style = rnText(16, 400, 21), color = c.tint, textAlign = TextAlign.End,
                modifier = Modifier.clearAndSetSemantics { contentDescription = select.getString("label"); role = Role.Button; testTag = "sync-select-folder"
                    if (select.getBoolean("enabled")) onClick { sync.pickFolder(); true } else disabled() }
                    .clickable(enabled = select.getBoolean("enabled")) { sync.pickFolder() })
        }
        SyncAction(panel.getJSONObject("syncNow"), "sync-now") { sync.syncNow(view) }
        Column(Modifier.fillMaxWidth().hairline(c.border, top = true).padding(16.dp)) { LastSyncCard(sync, panel.getJSONObject("lastSync"), inside = true) }
    }
}

/** RN's Dropbox panel: the app key text, the account status, Connect or Disconnect, Test connection and Sync now. */
@Composable
private fun DropboxPanel(sync: SyncSettingsModel, view: JSONObject, panel: JSONObject) {
    val c = LocalTheme.current.colors
    Card(top = 12) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(panel.getString("title"), style = rnText(16, 500, 21), color = c.text)
            Text(panel.getString("description"), style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 6.dp))
            Text(panel.getString("redirect"), style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 6.dp))
            panel.menuText("notConfigured")?.let { Text(it, style = rnText(13, 400, 18), color = c.danger, modifier = Modifier.padding(top = 8.dp)) }
            Text(panel.getString("status"), style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 8.dp))
        }
        SyncAction(panel.getJSONObject("connect"), "sync-dropbox-connect") { sync.dropbox(panel.getBoolean("connected")) }
        SyncAction(panel.getJSONObject("test"), "sync-test") { sync.test() }
        SyncAction(panel.getJSONObject("syncNow"), "sync-now") { sync.syncNow(view) }
    }
    LastSyncCard(sync, panel.getJSONObject("lastSync"), inside = false)
}

/** RN's iCloud panel (iOS only; drawn for completeness of core's view). */
@Composable
private fun CloudKitPanel(sync: SyncSettingsModel, view: JSONObject, panel: JSONObject) {
    val help = panel.getJSONObject("help")
    HelpBox(help.getString("title"), listOf(help.getString("text"), help.getString("status")))
    Card { SyncAction(panel.getJSONObject("syncNow"), "sync-now", divider = false) { sync.syncNow(view) } }
    LastSyncCard(sync, panel.getJSONObject("lastSync"), inside = false)
}

/** RN's SyncLastStatusCard: the last sync, its counts and conflicts, the error in the danger color, and the folded history. */
@Composable
private fun LastSyncCard(sync: SyncSettingsModel, card: JSONObject, inside: Boolean) {
    val c = LocalTheme.current.colors
    val body: @Composable ColumnScope.() -> Unit = {
        Text(card.getString("title"), style = rnText(16, 500, 21), color = c.text)
        Text(card.getString("status"), style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 2.dp).testTag("sync-status"))
        for (line in card.getJSONArray("lines").let { list -> List(list.length()) { list.getString(it) } }) {
            Text(line, style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 2.dp))
        }
        card.menuText("error")?.let {
            Text(it, style = rnText(13, 400, 18), color = c.danger, modifier = Modifier.padding(top = 2.dp).semantics { liveRegion = LiveRegionMode.Polite }.testTag("sync-error"))
        }
        card.optJSONObject("history")?.let { history ->
            val open = sync.historyOpen
            val toggle = if (open) history.getString("open") else history.getString("closed")
            Text(toggle, style = rnText(13, 600, 18), color = c.secondaryText,
                modifier = Modifier.padding(top = 8.dp).clearAndSetSemantics { contentDescription = toggle; role = Role.Button; testTag = "sync-history"
                    onClick { sync.toggleHistory(); true }; if (open) collapse { sync.toggleHistory(); true } else expand { sync.toggleHistory(); true } }
                    .clickable { sync.toggleHistory() })
            if (open) for (entry in history.getJSONArray("entries").let { list -> List(list.length()) { list.getString(it) } }) {
                Text(entry, style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 2.dp))
            }
        }
    }
    if (inside) Column(content = body)
    else Card(top = 12) { Column(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(16.dp), content = body) }
}

/** The encryption card (RN's SyncEncryptionCard): core's rows in order; a field's text goes back to core as typed. */
@Composable
private fun EncryptionCard(sync: SyncSettingsModel, card: JSONObject) {
    val c = LocalTheme.current.colors
    SectionTitle(card.getString("title"), top = 16, color = c.text)
    card.optJSONObject("guide")?.let { GuideLink(it, "sync-encryption-guide-link") }
    // RN groups consecutive texts in one settingRowColumn; every block after the first has a hairline above.
    val blocks = mutableListOf<List<JSONObject>>()
    for (row in card.menuObjects("rows")) {
        if (row.getString("kind") == "text" && blocks.lastOrNull()?.first()?.getString("kind") == "text") blocks[blocks.size - 1] = blocks.last() + row
        else blocks += listOf(row)
    }
    Card {
        blocks.forEachIndexed { index, block ->
            val divider = index > 0
            val row = block.first()
            when (row.getString("kind")) {
                "text" -> Column(Modifier.fillMaxWidth().then(if (divider) Modifier.hairline(c.border, top = true) else Modifier).padding(16.dp)) {
                    block.forEachIndexed { at, line ->
                        val tone = line.getString("tone")
                        val gap = if (at == 0) 0 else if (tone == "description" && block[at - 1].getString("tone") == "label") 2 else 8
                        Text(line.getString("text"), style = if (tone == "label") rnText(16, 500, 21) else rnText(13, 400, 18),
                            color = when (tone) { "label" -> c.text; "warning" -> c.warning; "danger" -> c.danger; else -> c.secondaryText },
                            modifier = Modifier.padding(top = gap.dp))
                    }
                }
                "field" -> {
                    val field = row.getString("field")
                    val label = row.getString("label")
                    InputGroup(divider) {
                        Text(label, style = rnText(16, 500, 21), color = c.text)
                        SyncInput(sync.fields[field].orEmpty(), label, null, row.getBoolean("secure"), "sync-passphrase-$field", KeyboardType.Password) { text -> sync.typePassphrase(field, text) }
                    }
                }
                "reveal" -> {
                    val label = row.getString("label")
                    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).then(if (divider) Modifier.hairline(c.border, top = true) else Modifier)
                        .clearAndSetSemantics { contentDescription = label; role = Role.Switch; onClick { sync.encryption(row.getJSONObject("action")); true } }
                        .clickable { sync.encryption(row.getJSONObject("action")) }.padding(16.dp)) {
                        Text(label, style = rnText(16, 500, 21), color = c.tint)
                    }
                }
                else -> {
                    val label = row.getString("label")
                    val enabled = row.getBoolean("enabled")
                    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).then(if (divider) Modifier.hairline(c.border, top = true) else Modifier)
                        .clearAndSetSemantics { contentDescription = label; role = Role.Button; testTag = "sync-encryption-${row.getJSONObject("action").getString("type")}"
                            if (enabled) onClick { sync.encryption(row.getJSONObject("action")); true } else disabled() }
                        .clickable(enabled = enabled) { sync.encryption(row.getJSONObject("action")) }.padding(16.dp), verticalAlignment = Alignment.Top) {
                        Text(label, style = rnText(16, 500, 21), color = if (enabled) c.tint else c.secondaryText, modifier = Modifier.weight(1f).padding(end = 16.dp))
                        if (row.getBoolean("busy")) CircularProgressIndicator(Modifier.size(20.dp), color = c.tint, strokeWidth = 2.dp)
                    }
                }
            }
        }
    }
}

/** RN's folded card heading (Settings sync options, Recovery snapshots): its title, description and ▸ or ▾. */
@Composable
private fun FoldHeading(title: String, description: String, open: Boolean, glyphs: JSONObject, tag: String, toggle: () -> Unit) {
    val c = LocalTheme.current.colors
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp)
        .clearAndSetSemantics { contentDescription = "$title, $description"; role = Role.Button; testTag = tag
            onClick { toggle(); true }; if (open) collapse { toggle(); true } else expand { toggle(); true } }
        .clickable(onClick = toggle).padding(16.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f).padding(end = 16.dp)) {
            Text(title, style = rnText(16, 500, 21), color = c.text)
            Text(description, style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 2.dp))
        }
        Text(if (open) glyphs.getString("open") else glyphs.getString("closed"), style = rnText(24, 300), color = c.secondaryText)
    }
}

/** RN's SyncPreferencesCard: folded; each option's switch sends core's setSyncPreference. */
@Composable
private fun PreferencesCard(model: InboxViewModel, preferences: JSONObject, glyphs: JSONObject) {
    val sync = model.menu.settings.sync
    val c = LocalTheme.current.colors
    val theme = LocalTheme.current
    Card(top = 16) {
        FoldHeading(preferences.getString("title"), preferences.getString("description"), sync.preferencesOpen, glyphs, "sync-preferences-disclosure") { sync.togglePreferences() }
        if (sync.preferencesOpen) for (row in preferences.menuObjects("rows")) {
            val label = row.getString("label")
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).hairline(c.border, top = true).padding(16.dp), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f).padding(end = 16.dp)) {
                    Text(label, style = rnText(16, 500, 21), color = c.text)
                    row.menuText("hint")?.let { Text(it, style = rnText(13, 400, 18), color = c.secondaryText, modifier = Modifier.padding(top = 2.dp)) }
                }
                RnSwitch(row.getBoolean("value"), model.menu.idle, label, theme.settingsSwitch) { sync.preference(row.getString("key"), !row.getBoolean("value")) }
            }
        }
    }
}

/** RN's RecoverySnapshotsCard, folded; restoring a snapshot comes with the Data screen's pass (core lists none here yet). */
@Composable
private fun SnapshotsCard(sync: SyncSettingsModel, snapshots: JSONObject, glyphs: JSONObject) {
    val c = LocalTheme.current.colors
    Card(top = 16) {
        FoldHeading(snapshots.getString("title"), snapshots.getString("description"), sync.snapshotsOpen, glyphs, "recovery-snapshots-disclosure") { sync.toggleSnapshots() }
        if (sync.snapshotsOpen) {
            val names = snapshots.getJSONArray("snapshots").let { list -> List(list.length()) { list.getString(it) } }
            if (names.isEmpty()) Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).hairline(c.border, top = true).padding(16.dp)) {
                Text(snapshots.getString("empty"), style = rnText(13, 400, 18), color = c.secondaryText)
            }
            for (name in names) Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).hairline(c.border, top = true).padding(16.dp)) {
                Text(name, style = rnText(16, 500, 21), color = c.text, maxLines = 1)
            }
        }
    }
}
