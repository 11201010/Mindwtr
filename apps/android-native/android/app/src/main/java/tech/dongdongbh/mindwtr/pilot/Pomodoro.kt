package tech.dongdongbh.mindwtr.pilot

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.InboxViewModel.Part

/*
 * RN's Pomodoro card on the Focus screen (components/pomodoro-panel.tsx) on core's getPomodoroPanel: the folded time row or the full
 * card, its task picker, every word and action core's. Kotlin keeps only whether the picker is open and its loaded rows; each control
 * sends core's action (runPomodoroAction), the state it asks for.
 */

/** The card's state on screen: core's panel, read again each second while its timer runs, and the open picker's rows. */
class PomodoroModel(private val shell: InboxViewModel) {
    var panel by mutableStateOf<JSONObject?>(null); private set
    /** The picker's rows while it is open (core's getPomodoroTaskPicker windows), null while closed. */
    var picker by mutableStateOf<List<JSONObject>?>(null); private set
    private var pickerTotal = 0

    /**
     * Core's card now, in the background (it reconciles the session, as RN's one-second tick does). A read asked for while an
     * action runs (the boot's first Focus read) waits for it, never drops.
     */
    fun read() {
        if (shell.busy) return shell.menu.whenIdle(::read)
        shell.background(listOf(Part.Pomodoro), { runtime -> runtime.menuRead("pomodoroPanel", "{}") }) { next, mine ->
            if (shell.fresh(mine, Part.Pomodoro)) panel = next
        }
    }

    /** A control's action, with a new request UUID; the answer carries the card after it. */
    fun act(action: JSONObject) = shell.menu.command("pomodoroAction", JSONObject().put("action", action))

    /** runPomodoroAction's answer on screen; a link changes the picker's checked row too. */
    internal fun applied(reply: JSONObject) {
        reply.optJSONObject("panel")?.let { panel = it }
    }

    fun openPicker() { picker = emptyList(); pickerTotal = 0; more() }
    fun closePicker() { picker = null }

    /** The next window of the picker's tasks, for the Focus controls on screen (RN's card gets the Focus screen's lists). */
    fun more() {
        val loaded = picker ?: return
        if (loaded.isNotEmpty() && loaded.size >= pickerTotal) return
        val controls = shell.menu.focusControls.state.toString()
        shell.background(listOf(Part.Pomodoro), { runtime ->
            runtime.menuRead("pomodoroTaskPicker", JSONObject().put("controls", JSONObject(controls)).put("offset", loaded.size).put("limit", WINDOW).toString())
        }) { next, _ ->
            val shown = picker ?: return@background
            if (shown.size != loaded.size) return@background
            pickerTotal = next.getInt("total")
            picker = shown + next.menuObjects("items")
        }
    }

    private companion object {
        const val WINDOW = 100
    }
}

/** RN's card: core's panel while the Pomodoro feature is on, read again each second while its timer runs and Focus shows. */
@Composable
fun PomodoroCard(model: InboxViewModel) = with(model.pomodoro) {
    val shown = panel?.takeIf { it.getBoolean("enabled") } ?: return
    val running = shown.getBoolean("running")
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(owner, running) {
        if (running) owner.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                delay(1_000)
                read()
            }
        }
    }
    val c = LocalTheme.current.colors
    val theme = LocalTheme.current
    val loading = !shown.isNull("loading")
    val enabled = !loading && model.menu.idle && model.failedAction == null
    val phaseColor = if (shown.getString("phase") == "focus") c.tint else c.success
    val shape = RoundedCornerShape(14.dp)
    val toggle = shown.getJSONObject("collapseToggle")
    @Composable fun Fold(collapsed: Boolean) {
        val label = toggle.getString("label")
        Box(Modifier.clearAndSetSemantics { testTag = "pomodoro-fold"; contentDescription = label; role = Role.Button; onClick { act(toggle.getJSONObject("action")); true } }
            .clickable(enabled = model.menu.idle) { act(toggle.getJSONObject("action")) }.padding(horizontal = 6.dp, vertical = 2.dp)) {
            Icon(if (collapsed) Lucide.ChevronDownPlain else Lucide.ChevronUp, null, tint = c.secondaryText, modifier = Modifier.size(18.dp))
        }
    }
    val card = Modifier.padding(bottom = 12.dp).fillMaxWidth().clip(shape).background(c.cardBg).border(1.dp, c.border, shape).testTag("pomodoro-card")
    if (shown.getBoolean("collapsed")) {
        Row(card.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(shown.getString("clock"), style = rnText(20, 700).copy(fontFeatureSettings = "tnum"), color = c.text, modifier = Modifier.testTag("pomodoro-clock"))
            Text(shown.getString("status").uppercase(), style = rnText(11, 700), color = phaseColor, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (running) Box(Modifier.size(8.dp).clip(CircleShape).background(phaseColor))
            Spacer(Modifier.weight(1f))
            Fold(true)
        }
        return
    }
    Column(card.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            Text(shown.getString("title"), style = rnText(16, 700), color = c.text, modifier = Modifier.weight(1f).semantics { heading() })
            Text(shown.getString("phaseLabel").uppercase(), style = rnText(11, 700), color = phaseColor, modifier = Modifier.padding(top = 2.dp))
            Fold(false)
        }
        if (loading) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CircularProgressIndicator(Modifier.size(20.dp), color = c.tint, strokeWidth = 2.dp)
            Text(shown.getString("loading"), style = rnText(12, 500), color = c.secondaryText)
        }
        Presets(shown, enabled, loading)
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(shown.getString("clock"), style = rnText(36, 800, letterSpacing = 1f).copy(fontFeatureSettings = "tnum"), color = c.text,
                modifier = Modifier.testTag("pomodoro-clock"))
            Text(shown.getString("sessions"), style = rnText(11, 600), color = c.secondaryText)
        }
        shown.optJSONObject("link")?.let { link -> LinkRow(model, link, enabled, loading) }
        @OptIn(ExperimentalLayoutApi::class)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val primary = shown.getJSONObject("primary")
            // RN fades only the primary button while the session loads.
            CardButton(primary, enabled, loading, theme.filledBg, theme.filledBg, theme.filledText, 14, "pomodoro-primary")
            CardButton(shown.getJSONObject("reset"), enabled, false, c.filterBg, c.border, c.secondaryText, 12, "pomodoro-reset")
            CardButton(shown.getJSONObject("switchPhase"), enabled, false, c.filterBg, c.border, c.secondaryText, 12, "pomodoro-switch")
        }
        shown.menuText("event")?.let { Text(it, style = rnText(12, 500), color = c.secondaryText, modifier = Modifier.testTag("pomodoro-event")) }
    }
}

/** RN's preset chips: the active one filled with the tint. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PomodoroModel.Presets(shown: JSONObject, enabled: Boolean, loading: Boolean) {
    val c = LocalTheme.current.colors
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (preset in shown.menuObjects("presets")) {
            val active = preset.getBoolean("active")
            val label = preset.getString("label")
            Box(Modifier.fade(if (loading) 0.6f else 1f).clip(CircleShape).background(if (active) c.tint else c.filterBg).border(1.dp, if (active) c.tint else c.border, CircleShape)
                .clearAndSetSemantics { testTag = "pomodoro-preset-${preset.getString("id")}"; contentDescription = label; role = Role.Button; selected = active; if (enabled) onClick { act(preset.getJSONObject("action")); true } else disabled() }
                .clickable(enabled = enabled) { act(preset.getJSONObject("action")) }.padding(horizontal = 10.dp, vertical = 6.dp)) {
                Text(label, style = rnText(11, 700), color = if (active) c.onTint else c.secondaryText)
            }
        }
    }
}

/** RN's actionPrimary (padding 14) or actionSecondary (12): core's label and action. */
@Composable
private fun PomodoroModel.CardButton(button: JSONObject, enabled: Boolean, faded: Boolean, background: Color, border: Color, text: Color, horizontal: Int,
                                      tag: String) {
    val shape = RoundedCornerShape(10.dp)
    val label = button.getString("label")
    Box(Modifier.fade(if (faded) 0.5f else 1f).clip(shape).background(background).border(1.dp, border, shape)
        .clearAndSetSemantics { testTag = tag; contentDescription = label; role = Role.Button; if (enabled) onClick { act(button.getJSONObject("action")); true } else disabled() }
        .clickable(enabled = enabled) { act(button.getJSONObject("action")) }.padding(horizontal = horizontal.dp, vertical = 9.dp)) {
        Text(label, style = rnText(12, 700), color = text)
    }
}

/** RN's linked task row: the picker button (its label, the task or Timer only, Change or Link task) and Task done while a task is linked. */
@Composable
private fun PomodoroModel.LinkRow(model: InboxViewModel, link: JSONObject, enabled: Boolean, loading: Boolean) {
    val c = LocalTheme.current.colors
    val shape = RoundedCornerShape(10.dp)
    val label = link.getString("label")
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.weight(1f).clip(shape).background(c.filterBg).border(1.dp, c.border, shape)
            .clearAndSetSemantics { testTag = "pomodoro-link"; contentDescription = label; role = Role.Button; onClick { openPicker(); true } }
            .clickable(enabled = model.menu.idle) { openPicker() }.padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(label.uppercase(), style = rnText(10, 700), color = c.secondaryText)
                Text(link.getString("value"), style = rnText(13, 700), color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(link.getString("changeLabel"), style = rnText(12, 700), color = c.tint)
        }
        link.optJSONObject("markDone")?.let { done ->
            val spoken = done.getString("accessibilityLabel")
            Box(Modifier.fillMaxHeight().fade(if (loading) 0.5f else 1f).clip(shape).background(c.success.copy(alpha = 0x18 / 255f)).border(1.dp, c.success, shape)
                .clearAndSetSemantics { testTag = "pomodoro-done"; contentDescription = spoken; role = Role.Button; if (enabled) onClick { act(done.getJSONObject("action")); true } else disabled() }
                .clickable(enabled = enabled) { act(done.getJSONObject("action")) }.padding(horizontal = 10.dp, vertical = 8.dp),
                contentAlignment = Alignment.Center) {
                Text(done.getString("label"), style = rnText(12, 700), color = c.success)
            }
        }
    }
}

/** RN's task picker modal: core's title, Timer only, then the Focus lists' tasks (core's windows), or core's empty line. */
@Composable
fun PomodoroPicker(model: InboxViewModel) = with(model.pomodoro) {
    val rows = picker ?: return
    val shown = panel ?: return
    val words = shown.getJSONObject("picker")
    val c = LocalTheme.current.colors
    BackHandler { closePicker() }
    val choose = { action: JSONObject -> closePicker(); act(action) }
    Box(Modifier.fillMaxSize().background(Color(0x99000000)).pointerInput(Unit) { detectTapGestures { closePicker() } }.padding(20.dp),
        contentAlignment = Alignment.Center) {
        val shape = RoundedCornerShape(14.dp)
        Column(Modifier.fillMaxWidth().heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.72f).dp).clip(shape).background(c.cardBg)
            .border(1.dp, c.border, shape).pointerInput(Unit) { detectTapGestures { } }.padding(12.dp).testTag("pomodoro-picker"),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(words.getString("title"), style = rnText(16, 800), color = c.text, modifier = Modifier.semantics { heading() })
            val timerOnly = words.getJSONObject("timerOnly")
            Option(timerOnly.getString("label"), timerOnly.getBoolean("selected"), 1, "pomodoro-timer-only") { choose(timerOnly.getJSONObject("action")) }
            LazyColumn(Modifier.heightIn(max = 320.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                itemsIndexed(rows, key = { _, row -> row.getString("id") }) { index, row ->
                    if (index == rows.size - 1) LaunchedEffect(rows.size) { more() }
                    Option(row.getString("title"), row.getBoolean("selected"), 2, "pomodoro-task") { choose(row.getJSONObject("action")) }
                }
                if (rows.isEmpty()) item {
                    Text(words.getString("empty"), style = rnText(13, 600), color = c.secondaryText, modifier = Modifier.padding(vertical = 8.dp))
                }
            }
        }
    }
}

/** RN's taskPickerOption: the selected one in the tint, washed `${tint}18`. */
@Composable
private fun Option(label: String, selected: Boolean, lines: Int, tag: String, onClick: () -> Unit) {
    val c = LocalTheme.current.colors
    val shape = RoundedCornerShape(10.dp)
    Box(Modifier.fillMaxWidth().clip(shape).background(if (selected) c.tint.copy(alpha = 0x18 / 255f) else c.filterBg).border(1.dp, if (selected) c.tint else c.border, shape)
        .clearAndSetSemantics { testTag = tag; contentDescription = label; role = Role.Button; this.selected = selected; onClick { onClick(); true } }
        .clickable(onClick = onClick).padding(10.dp)) {
        Text(label, style = rnText(14, 700), color = if (selected) c.tint else c.text, maxLines = lines, overflow = TextOverflow.Ellipsis)
    }
}
