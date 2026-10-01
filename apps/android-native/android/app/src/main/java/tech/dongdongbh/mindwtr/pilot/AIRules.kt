package tech.dongdongbh.mindwtr.pilot

/*
 * The AI actions' bookkeeping (AIActions.kt, AISettings.kt), apart from the screens so JVM tests drive it: which request each
 * scope still wants, which Process Inbox step an answer belongs to, and what the capture screen last asked.
 */

/**
 * The AI requests still wanted, one per scope (the editor's copilot, its Clarify or Break down, Process Inbox, the review, the
 * capture screen, a model list): a new one in a scope cancels the one before, and closing a scope cancels its request.
 */
class AIRequestSlots<T : Any>(private val cancel: (T) -> Unit) {
    private val slots = HashMap<String, T>()

    /** [call] now runs in [scope]; the one it replaces is cancelled. */
    fun start(scope: String, call: T) {
        val replaced = synchronized(this) { slots.put(scope, call) }
        if (replaced != null && replaced !== call) cancel(replaced)
    }

    /** [call] answered: its scope is free again (a newer call in the scope stays). */
    fun finished(scope: String, call: T) = synchronized(this) { if (slots[scope] === call) slots.remove(scope) }

    /** The scope closed (an input change, a screen closing): its request is cancelled. */
    fun cancel(vararg scopes: String) {
        val gone = synchronized(this) { scopes.mapNotNull { slots.remove(it) } }
        gone.forEach(cancel)
    }

    /** Whether [call] is still the one [scope] wants. */
    fun wanted(scope: String, call: T): Boolean = synchronized(this) { slots[scope] === call }

    /**
     * [call] answered off the main thread: [post] it there, where [answer] runs only if [call] is still the one [scope] wants
     * (a close, a reopen or a newer call between the answer and the post drops it).
     */
    fun reply(scope: String, call: T, post: (() -> Unit) -> Unit, answer: () -> Unit) = post {
        val wanted = wanted(scope, call)
        finished(scope, call)
        if (wanted) answer()
    }
}

/** The Process Inbox step an AI Clarify was asked on: its answer shows and applies only on that step of that session. */
data class InboxStepKey(val sessionId: String, val taskId: String, val step: String) {
    companion object {
        fun of(flow: InboxProcessing?): InboxStepKey? = flow?.let { InboxStepKey(it.sessionId, it.taskId, it.step) }
    }
}

/** What the capture screen asked the copilot: its screen session with core's question, so a new screen with the same text asks again. */
fun captureCopilotKey(session: String, request: String?): String? = request?.let { "$session\n$it" }

/**
 * A key field's text as the key ([current]: the key typed so far this focus, null before the first edit). The field starts with
 * core's dots ([mask]), so the first edit starts the key over: the text typed after the dots, or, for any other edit, what was
 * typed, dots left out. A keystroke that comes before the field shows the typed key still carries dots: they are left out too,
 * so a key never holds core's dots.
 */
fun typedKey(current: String?, mask: String, text: String): String =
    if (current == null && text.startsWith(mask)) text.removePrefix(mask) else text.replace("\u2022", "")

/**
 * The key fields' typed text while they show it (AISettings.kt), each edit numbered: a blur's saved callback clears only the
 * text up to the edit it waited for, never a newer edit typed after a refocus. Main thread.
 */
class KeyTexts {
    private val texts = HashMap<String, String>()
    private val edits = HashMap<String, Long>()
    val shown: Map<String, String> get() = texts.toMap()
    /** An edit: the field now shows [text]. */
    fun typed(field: String, text: String) { texts[field] = text; edits[field] = edit(field) + 1 }
    /** The field's latest edit. */
    fun edit(field: String): Long = edits[field] ?: 0L
    /** The field's writes up to edit [upTo] are stored: it shows saved, unless a newer edit came since. */
    fun saved(field: String, upTo: Long) { if (edits[field] == upTo) texts.remove(field) }
    fun clear() { texts.clear() }
}
