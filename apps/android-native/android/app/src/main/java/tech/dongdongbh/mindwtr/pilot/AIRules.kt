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
}

/** The Process Inbox step an AI Clarify was asked on: its answer shows and applies only on that step of that session. */
data class InboxStepKey(val sessionId: String, val taskId: String, val step: String) {
    companion object {
        fun of(flow: InboxProcessing?): InboxStepKey? = flow?.let { InboxStepKey(it.sessionId, it.taskId, it.step) }
    }
}

/** What the capture screen asked the copilot: its screen session with core's question, so a new screen with the same text asks again. */
fun captureCopilotKey(session: String, request: String?): String? = request?.let { "$session\n$it" }
