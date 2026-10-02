package tech.dongdongbh.mindwtr.pilot

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import tech.dongdongbh.mindwtr.pilot.core.CoreHost
import tech.dongdongbh.mindwtr.pilot.core.RnKeyValue
import tech.dongdongbh.mindwtr.pilot.core.debugProperty
import java.util.Calendar
import java.util.TimeZone

/*
 * Reminder alarms on AlarmManager, as React Native's patched alarm library (react-native-alarm-notification, patched by
 * plugins/patch-alarm-notification-gradle.js) sets and shows them. Core decides every alarm: which, when, its id, why one goes,
 * and when to plan again (native-host-contract-reminders.ts; bundle/host-reminders.ts runs the timers in the engine). Kotlin
 * applies core's plan in core's order, posts what a fired alarm carries, and hands Done and Snooze to CoreWork.
 */

/** Core's plan applied in core's order, apart from Android (JVM-tested: ReminderPlanTest). */
internal object ReminderPlan {
    /** RN's alarm map in RN's RKStorage (core's REMINDER_ALARM_MAP_STORAGE_KEY). */
    const val MAP_KEY = "mindwtr:local:alarms:v1"
    /** The native host's own reminder state beside it (core's NATIVE_REMINDER_STATE_STORAGE_KEY); RN never reads it. */
    const val STATE_KEY = "mindwtr:native:reminders:v1"

    interface Port {
        /** RKStorage [entries] in one write, on disk before this returns. */
        fun store(entries: Map<String, String>)
        /** The notification alarm [id] delivered, if it is still shown. */
        fun removeDelivered(id: Int)
        fun cancel(id: Int)
        /** Core's alarm (NativeReminderAlarm) under its id: an alarm held under that id is replaced. */
        fun schedule(alarm: JSONObject)
        /** Every delivered reminder notification: no notification permission. */
        fun clearDelivered()
    }

    /**
     * [plan] (core's NativeReminderAlarmPlan): `writeAhead` and `stateAhead` (a Snooze about to be made) stored (on disk) in one
     * write, then each cancel, then each alarm made, then `alarms`
     * (not when `unchanged`: the stored map already says it) and `state` (null when unchanged) stored in one write, so a delivered
     * reminder core lets expire is remembered whenever its alarm leaves the map. A withdrawn alarm's delivered notification goes before its
     * cancel; an expired one's stays. A failed removal never
     * stops a cancel. A refused alarm throws before `alarms` is stored: the next plan, from `writeAhead`, makes the pending alarms
     * again under the same ids, so nothing is made twice or left behind. [checkpoint] names each point a process death is safe at.
     */
    fun apply(plan: JSONObject, port: Port, checkpoint: (String) -> Unit = {}) {
        val ahead = buildMap {
            if (!plan.isNull("writeAhead")) put(MAP_KEY, plan.getString("writeAhead"))
            if (plan.has("stateAhead") && !plan.isNull("stateAhead")) put(STATE_KEY, plan.getString("stateAhead"))
        }
        if (ahead.isNotEmpty()) {
            port.store(ahead)
            checkpoint("write-ahead")
        }
        val cancel = plan.getJSONArray("cancel")
        for (index in 0 until cancel.length()) {
            val item = cancel.getJSONObject(index)
            val id = item.getInt("id")
            if (item.getString("reason") == "withdrawn") runCatching { port.removeDelivered(id) }
            port.cancel(id)
        }
        val schedule = plan.getJSONArray("schedule")
        for (index in 0 until schedule.length()) {
            val alarm = schedule.getJSONObject(index)
            if (alarm.optString("replacing") == "withdrawn") runCatching { port.removeDelivered(alarm.getInt("id")) }
            port.schedule(alarm)
        }
        checkpoint("scheduled")
        if (plan.optBoolean("clearDelivered")) runCatching { port.clearDelivered() }
        // As RN's saveAlarmMap: a map that did not change is not written again (#766).
        val after = buildMap {
            if (!plan.optBoolean("unchanged")) put(MAP_KEY, plan.getString("alarms"))
            if (plan.has("state") && !plan.isNull("state")) put(STATE_KEY, plan.getString("state"))
        }
        if (after.isNotEmpty()) port.store(after)
    }

    /**
     * A repeating alarm's next time after [nowMs], at the same local time a day or a week on, as RN's library re-arms one when it
     * fires (AlarmUtil.rescheduleRepeatingAlarm). Null for a one-shot alarm.
     */
    fun nextRepeat(fireAtMs: Long, repeat: String, nowMs: Long, zone: TimeZone = TimeZone.getDefault()): Long? {
        val field = when (repeat) {
            "daily" -> Calendar.DAY_OF_YEAR
            "weekly" -> Calendar.WEEK_OF_YEAR
            else -> return null
        }
        val next = Calendar.getInstance(zone).apply { timeInMillis = fireAtMs }
        // ponytail: steps one at a time; a weekly alarm stale for years is a few hundred steps.
        do next.add(field, 1) while (next.timeInMillis <= nowMs)
        return next.timeInMillis
    }
}

/**
 * React Native's alarms, cancelled once at the first native start, before the first plan (JVM-tested: ReminderPlanTest). RN's
 * library keeps them in `databases/rnandb`, table `alarmtbl`; each is a broadcast to its AlarmReceiver under the request code in
 * the row's `alarmId`. Their order makes a process death safe anywhere: every alarm is cancelled, then RN's delivered reminders lose
 * their buttons (Done, Snooze and Dismiss target RN's receiver, which is gone; a tap still opens the app), then RN's maps go (core
 * plans every alarm afresh, and RN's Pomodoro record no longer names a cancelled alarm), then the table. Until the table is gone each
 * start runs it again, and cancelling twice is harmless; no plan runs before it finished.
 */
internal object RnAlarmCleanup {
    /** [rows]: each RN alarm's request code, null when RN left no table. The number cancelled. */
    fun run(rows: () -> List<Int>?, cancel: (Int) -> Unit, stripButtons: () -> Unit, forgetMaps: () -> Unit, deleteTable: () -> Unit): Int {
        val ids = rows() ?: return 0
        ids.forEach(cancel)
        stripButtons()
        forgetMaps()
        deleteTable()
        return ids.size
    }

    /**
     * Each row's request code (its `gson_data`'s `alarmId`, as RN's library cancels it). A row that cannot be read throws: its alarm
     * may still be set under a code only that row holds, so the cleanup fails and keeps the table and the maps for the next start.
     */
    fun requestCodes(rows: List<String?>): List<Int> = rows.map { row ->
        runCatching { JSONObject(row!!).getInt("alarmId") }.getOrElse { throw IllegalStateException("An RN alarm row cannot be read", it) }
    }

    /** RN's database without its table (a stop inside its onCreate) holds no alarm; any other failed read fails the cleanup. */
    fun isMissingTable(failure: Throwable): Boolean = failure.message?.contains("no such table") == true
}

/**
 * The reminder alarms' start on the process's host (ProcessCoreHost; JVM-tested: ReminderStartTest): once the boot reached it,
 * [start] runs core's first plan and arms core's timers. A resume plans once more after a start (RN's start runs one more cycle),
 * or starts again after a start that failed, so a transient failure never leaves the timers unarmed until the next process.
 */
internal class ReminderStart<H : Any>(private val start: (H) -> JSONObject, private val cycle: (H) -> Unit) {
    /** The start's reply (`ask`: RN would ask for the notification permission now); null until a start succeeded. */
    @Volatile var reply: JSONObject? = null; private set
    @Volatile private var started: H? = null
    @Volatile private var failed: H? = null

    /** True when it started now; throws what the start threw. A host already started is not started again. */
    @Synchronized fun start(host: H): Boolean {
        if (started != null) return false
        failed = host
        reply = start.invoke(host)
        started = host
        failed = null
        return true
    }

    /** Throws what the plan or the start threw. */
    fun resume() {
        started?.let { cycle(it); return }
        failed?.let(::start)
    }
}

/**
 * The Android side of core's reminder alarms (CoreHost's alarm bridges): AlarmManager, the tray, RN's old alarms. Called on the
 * engine thread, which alone opens RKStorage.
 */
internal class ReminderAlarms(private val context: Context, private val keyValue: RnKeyValue) : CoreHost.Reminders, ReminderPlan.Port {
    companion object {
        /** Core's POMODORO_ALARM_STORAGE_KEY: RN's record of its Pomodoro alarm. */
        private const val POMODORO_KEY = "mindwtr:local:pomodoro-alarm:v1"
        /** RN's library, which no longer exists here: its alarms are cancelled through its component name. */
        private const val RN_RECEIVER = "com.emekalites.react.alarm.notification.AlarmReceiver"
        private const val RN_DATABASE = "rnandb"
        const val FIRE = "tech.dongdongbh.mindwtr.reminder.FIRE"
        /** The alarm (core's NativeReminderAlarm, with the channel's name), as JSON. */
        const val EXTRA_ALARM = "alarm"

        private fun fireIntent(context: Context) = Intent(context, ReminderAlarmReceiver::class.java).setAction(FIRE)

        /**
         * Alarm [alarm] under its id (a held alarm under that id is replaced), as RN's library sets one: exact while Android allows
         * exact alarms (Android 12+ asks the user), else inexact but still allowed while idle.
         */
        fun arm(context: Context, alarm: JSONObject) {
            val manager = context.getSystemService(AlarmManager::class.java)
            val intent = PendingIntent.getBroadcast(context, alarm.getInt("id"), fireIntent(context).putExtra(EXTRA_ALARM, alarm.toString()),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val at = alarm.getLong("fireAtMs")
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
            }
        }

        /** RN's exact-alarm check (exact-alarm-permission.ts): only Android 12+ can withhold exact alarms. */
        fun exactAlarmsDenied(context: Context): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && !context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

        /** Android's Alarms & reminders page for this app (RN's openExactAlarmSettings). */
        fun openExactAlarmSettings(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
            runCatching { context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))) }
                .onFailure { Log.w(CoreHost.TAG, "Native Android exact-alarm settings not opened", it) }
        }

        /** RN's rule (getAndroidNotificationPermissionStatus): before Android 13 notifications need no permission. */
        fun permissionGranted(context: Context): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    private val alarms = context.getSystemService(AlarmManager::class.java)
    private val notifications = context.getSystemService(NotificationManager::class.java)
    /** The reminder channel's name core sent with the plan (core's REMINDER_NOTIFICATION_CHANNEL_NAME). */
    private var channelName = ""

    override fun apply(plan: String) {
        val parsed = JSONObject(plan)
        channelName = parsed.optString("channelName")
        ReminderPlan.apply(parsed, this) { point ->
            // Debug builds only (check-reminders-device.mjs): `debug.mindwtr.native.reminder_stop=<point>` kills the process there.
            if (debugProperty("reminder_stop") == point) {
                Log.i(CoreHost.TAG, "Native Android reminder stop at=$point")
                android.os.Process.killProcess(android.os.Process.myPid())
            }
        }
    }

    override fun permissionGranted() = permissionGranted(context)

    override fun cleanupRn(): Int = RnAlarmCleanup.run(rows = ::rnAlarmIds, cancel = ::cancelRn, stripButtons = ::stripRnButtons,
        // Only maps that exist: an RN user who never had reminders keeps RKStorage untouched.
        forgetMaps = { keyValue.multiGet(listOf(ReminderPlan.MAP_KEY, POMODORO_KEY)).filterValues { it != null }.keys.toList()
            .takeIf { it.isNotEmpty() }?.let(keyValue::multiRemove); Unit },
        deleteTable = { check(context.deleteDatabase(RN_DATABASE) || !context.getDatabasePath(RN_DATABASE).exists()) { "Cannot delete $RN_DATABASE" } })

    override fun store(entries: Map<String, String>) { keyValue.multiSet(entries.toList()) }

    override fun removeDelivered(id: Int) = notifications.cancel(id)

    override fun cancel(id: Int) {
        PendingIntent.getBroadcast(context, id, fireIntent(context), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let {
            alarms.cancel(it)
            it.cancel()
        }
    }

    override fun schedule(alarm: JSONObject) = arm(context, JSONObject(alarm.toString()).put("channelName", channelName))

    override fun clearDelivered() {
        for (shown in notifications.activeNotifications) {
            if (NotificationCompat.getChannelId(shown.notification) == CoreNotifications.REMINDER_CHANNEL) notifications.cancel(shown.tag, shown.id)
        }
    }

    /** Each RN alarm's request code (its row's `alarmId`); null when RN left no alarm database. */
    private fun rnAlarmIds(): List<Int>? {
        val file = context.getDatabasePath(RN_DATABASE)
        if (!file.exists()) return null
        return SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
            val cursor = try {
                database.rawQuery("SELECT gson_data FROM alarmtbl", null)
            } catch (failure: Exception) {
                if (RnAlarmCleanup.isMissingTable(failure)) return emptyList()
                throw failure
            }
            RnAlarmCleanup.requestCodes(cursor.use { rows -> buildList { while (rows.moveToNext()) add(rows.getString(0)) } })
        }
    }

    /**
     * RN's delivered reminders, shown again as they are without their buttons (RN's library posts each under its alarm's id on the
     * reminder channel). The first native plan runs after this cleanup, so a native reminder is here only after an RN recovery build
     * ran in between; it keeps its tap too.
     */
    private fun stripRnButtons() {
        for (shown in notifications.activeNotifications) {
            val notification = shown.notification
            if (NotificationCompat.getChannelId(notification) != CoreNotifications.REMINDER_CHANNEL || notification.actions.isNullOrEmpty()) continue
            notifications.notify(shown.tag, shown.id, Notification.Builder.recoverBuilder(context, notification).setActions().build())
        }
    }

    /** RN's alarm [id] as RN's library cancels it (AlarmUtil.stopAlarm): its explicit broadcast under that request code. */
    private fun cancelRn(id: Int) {
        val intent = Intent().setComponent(ComponentName(context.packageName, RN_RECEIVER))
        PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let {
            alarms.cancel(it)
            it.cancel()
        }
    }
}

/** An alarm fired: its notification, as RN's AlarmReceiver posts it; a repeating alarm comes back at the same local time. */
class ReminderAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ReminderAlarms.FIRE) return
        val alarm = runCatching { JSONObject(intent.getStringExtra(ReminderAlarms.EXTRA_ALARM)!!) }.getOrNull() ?: return
        runCatching { CoreNotifications.postReminder(context, alarm) }.onFailure { Log.w(CoreHost.TAG, "Native Android reminder not posted", it) }
        runCatching {
            ReminderPlan.nextRepeat(alarm.getLong("fireAtMs"), alarm.optString("repeat"), System.currentTimeMillis())
                ?.let { next -> ReminderAlarms.arm(context, alarm.put("fireAtMs", next)) }
        }.onFailure { Log.w(CoreHost.TAG, "Native Android repeating reminder not re-armed", it) }
    }
}

/**
 * A reminder notification's buttons, as RN's AlarmReceiver takes them: Dismiss clears it; Done and Snooze go to CoreWork as core's
 * journaled commands under the request UUID the notification was posted with, so a second tap or a retry is the same request.
 * Snooze sends the tap's time with it. The notification goes once WorkManager stored the job. Not exported: only this app's notifications
 * send these.
 */
class ReminderActionReceiver : BroadcastReceiver() {
    companion object {
        const val COMPLETE = "ACTION_COMPLETE"
        const val SNOOZE = "ACTION_SNOOZE"
        const val DISMISS = "ACTION_DISMISS"
        const val EXTRA_ID = "notificationId"
        const val EXTRA_REQUEST = "requestId"
        const val EXTRA_TASK = "taskId"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getIntExtra(EXTRA_ID, 0)
        val dismiss = { context.getSystemService(NotificationManager::class.java).cancel(id) }
        runCatching {
            when (intent.action) {
                DISMISS -> dismiss()
                COMPLETE -> CoreWork.enqueueDurably(this, context, CoreJob.REMINDER_DONE, mapOf(
                    "requestId" to intent.getStringExtra(EXTRA_REQUEST)!!, "taskId" to intent.getStringExtra(EXTRA_TASK)!!), done = dismiss)
                SNOOZE -> {
                    val alarm = JSONObject(intent.getStringExtra(ReminderAlarms.EXTRA_ALARM)!!)
                    val details = alarm.getJSONObject("details")
                    // Debug builds only (check-reminders-device.mjs): `debug.mindwtr.native.snooze_minutes` shortens RN's 10 minutes.
                    debugProperty("snooze_minutes").toDoubleOrNull()?.let { details.put("snooze_interval", it) }
                    CoreWork.enqueueDurably(this, context, CoreJob.REMINDER_SNOOZE, mapOf("requestId" to intent.getStringExtra(EXTRA_REQUEST)!!,
                        "requestedAt" to System.currentTimeMillis().toString(), "details" to details.toString()), done = dismiss)
                }
                else -> Unit
            }
        }.onFailure { Log.w(CoreHost.TAG, "Native Android reminder action not queued action=${intent.action}", it) }
    }
}

/**
 * Remakes every alarm after a reboot (Android dropped them all; RN's library re-arms its rows then), a clock or time zone change, an
 * update, and once Android allows exact alarms (RN's rescheduleLocalAlarmsAsExact). A remake, not a plain plan: the stored map says
 * each alarm is held, and only a remake re-arms one Android dropped. Exported as RN's boot receiver is: each of these actions only
 * the system sends. CoreWork runs core's plan; nothing here decides an alarm.
 */
class ReminderRescheduleReceiver : BroadcastReceiver() {
    companion object {
        /** Debug builds only (check-reminders-device.mjs): the same path, for a reboot or a time change the test phone cannot have. */
        const val DEBUG_RESCHEDULE = "tech.dongdongbh.mindwtr.debug.RESCHEDULE_REMINDERS"
        private val ACTIONS = setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED,
            Intent.ACTION_MY_PACKAGE_REPLACED, AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED)
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action !in ACTIONS && !(action == DEBUG_RESCHEDULE && BuildConfig.DEBUG)) return
        Log.i(CoreHost.TAG, "Native Android reminders reschedule action=$action")
        // Held until WorkManager stored the job: a process that ends first would lose the remake until the next start.
        runCatching { CoreWork.enqueueDurably(this, context, CoreJob.REMINDERS, mapOf("mode" to "rebuild")) }
            .onFailure { Log.w(CoreHost.TAG, "Native Android reminders reschedule not queued", it) }
    }
}
